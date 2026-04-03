import "dotenv/config";
import WebSocket from "ws";
import { StaticAuthProvider } from "@twurple/auth";
import { ChatClient } from "@twurple/chat";
import {
  authenticate,
  loadItemFromFile,
  loadItemFromBase64,
  pinItemToArtMesh,
  unpinItem,
  unloadItem,
  hideFaceArtMeshes,
  showFaceArtMeshes,
} from "./vts.js";
import {
  VTS_API_URL,
  PIN_ARTMESH,
  DEFAULT_EMOTE_PATH,
  EMOTE_SIZE,
  TRIGGER_COMMAND,
  FACE_HIDE_PATTERNS,
} from "./config.js";

let active = false;
let currentItemId: string | null = null;

async function downloadEmote(emoteId: string): Promise<string> {
  const url = `https://static-cdn.jtvnbs.net/emoticons/v2/${emoteId}/default/dark/3.0`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to download emote ${emoteId}: ${resp.status}`);
  const buffer = Buffer.from(await resp.arrayBuffer());
  return buffer.toString("base64");
}

async function enableEmojiHead(ws: WebSocket, emoteBase64?: string): Promise<void> {
  // If already active, disable first (swap emotes)
  if (active) {
    await disableEmojiHead(ws);
  }

  console.log("  Loading emote...");
  if (emoteBase64) {
    currentItemId = await loadItemFromBase64(ws, emoteBase64, EMOTE_SIZE);
  } else {
    currentItemId = await loadItemFromFile(ws, DEFAULT_EMOTE_PATH, EMOTE_SIZE);
  }
  console.log(`  Loaded item: ${currentItemId}`);

  console.log(`  Pinning to ${PIN_ARTMESH}...`);
  await pinItemToArtMesh(ws, currentItemId, PIN_ARTMESH, EMOTE_SIZE);

  console.log("  Hiding face artmeshes...");
  const hidden = await hideFaceArtMeshes(ws, FACE_HIDE_PATTERNS);
  console.log(`  Hidden ${hidden} artmeshes.`);

  active = true;
  console.log("  EmojiHead ON");
}

async function disableEmojiHead(ws: WebSocket): Promise<void> {
  if (!active || !currentItemId) return;

  console.log("  Restoring face...");
  await showFaceArtMeshes(ws, FACE_HIDE_PATTERNS);

  console.log("  Removing emote...");
  await unpinItem(ws, currentItemId);
  await unloadItem(ws, currentItemId);

  currentItemId = null;
  active = false;
  console.log("  EmojiHead OFF");
}

async function main(): Promise<void> {
  // Connect to VTube Studio
  console.log(`  Connecting to VTube Studio at ${VTS_API_URL}...`);
  const ws = new WebSocket(VTS_API_URL);

  await new Promise<void>((resolve, reject) => {
    ws.on("open", resolve);
    ws.on("error", reject);
  });

  await authenticate(ws);

  // Connect to Twitch chat
  const clientId = process.env.TWITCH_CLIENT_ID;
  const accessToken = process.env.TWITCH_ACCESS_TOKEN;
  const channel = process.env.TWITCH_CHANNEL_NAME;

  if (!clientId || !accessToken || !channel) {
    console.log("  Twitch credentials not set — running without chat integration.");
    console.log(`  Press Enter to toggle EmojiHead, Ctrl+C to quit.\n`);

    process.stdin.setRawMode?.(false);
    process.stdin.resume();
    process.stdin.on("data", async () => {
      try {
        if (active) {
          await disableEmojiHead(ws);
        } else {
          await enableEmojiHead(ws);
        }
      } catch (e: any) {
        console.error(`  Error: ${e.message}`);
      }
    });
    return;
  }

  const authProvider = new StaticAuthProvider(clientId, accessToken);
  const chatClient = new ChatClient({ authProvider, channels: [channel] });

  chatClient.onMessage(async (_channel, user, message, msg) => {
    const lower = message.trim().toLowerCase();
    if (!lower.startsWith(TRIGGER_COMMAND)) return;

    console.log(`  ${user}: ${message.trim()}`);
    try {
      if (lower === `${TRIGGER_COMMAND} off`) {
        await disableEmojiHead(ws);
      } else {
        // Try to get first emote from the message
        const emoteOffsets = msg.emoteOffsets;
        let emoteBase64: string | undefined;

        if (emoteOffsets.size > 0) {
          const firstEmoteId = emoteOffsets.keys().next().value;
          if (firstEmoteId) {
            console.log(`  Downloading emote ${firstEmoteId}...`);
            emoteBase64 = await downloadEmote(firstEmoteId);
          }
        }

        if (!emoteBase64) {
          console.log("  No emote in message, skipping.");
          return;
        }

        await enableEmojiHead(ws, emoteBase64);
      }
    } catch (e: any) {
      console.error(`  Error: ${e.message}`);
    }
  });

  await chatClient.connect();
  console.log(`  Connected to Twitch chat (${channel})`);
  console.log(`  Listening for "${TRIGGER_COMMAND}" in chat. Ctrl+C to quit.\n`);
}

main().catch((e) => {
  console.error(`  Fatal: ${e.message}`);
  process.exit(1);
});

process.on("SIGINT", () => {
  console.log("\n  Stopped.");
  process.exit(0);
});
