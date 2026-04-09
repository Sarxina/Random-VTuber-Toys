import WebSocket from "ws";
import { readFileSync, existsSync } from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";
import { exec } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));

const API_URL = "ws://localhost:8001";
const PLUGIN_NAME = "FoxyJumpscare";
const PLUGIN_DEVELOPER = "Sarxina";

// 1 in CHANCE_DENOM per second
const CHANCE_DENOM = 10000;
const TICK_INTERVAL = 1000; // ms

// Paths to assets (relative to this script's parent dir)
const SCRIPT_DIR = resolve(__dirname, "..");
const GIF_PATH = join(SCRIPT_DIR, "..", "assets", "jumpscare.gif");
const GIF_FILENAME = "foxyjumpscare.gif";
const WAV_PATH = join(SCRIPT_DIR, "..", "assets", "jumpscare.wav");

// Item display
const ITEM_SIZE = 0.5;
const ITEM_DURATION = 1200; // ms

let requestId = 0;

function nextId(): string {
  return String(++requestId);
}

async function sendRequest(ws: WebSocket, messageType: string, data?: Record<string, unknown>): Promise<any> {
  const request: Record<string, unknown> = {
    apiName: "VTubeStudioPublicAPI",
    apiVersion: "1.0",
    requestID: nextId(),
    messageType,
  };
  if (data) request.data = data;

  return new Promise((resolve, reject) => {
    const handler = (raw: WebSocket.RawData) => {
      const resp = JSON.parse(raw.toString());
      if (resp.requestID === request.requestID) {
        ws.off("message", handler);
        resolve(resp);
      }
    };
    ws.on("message", handler);
    ws.send(JSON.stringify(request));
    setTimeout(() => {
      ws.off("message", handler);
      reject(new Error(`Request ${messageType} timed out`));
    }, 10000);
  });
}

async function authenticate(ws: WebSocket): Promise<void> {
  console.log("  Requesting authentication token...");
  const tokenResp = await sendRequest(ws, "AuthenticationTokenRequest", {
    pluginName: PLUGIN_NAME,
    pluginDeveloper: PLUGIN_DEVELOPER,
  });

  if (tokenResp.messageType === "APIError") {
    console.error(`  Error: ${tokenResp.data.message}`);
    process.exit(1);
  }

  const token = tokenResp.data.authenticationToken;
  console.log("  Approve the plugin in VTube Studio if prompted...");
  await new Promise((r) => setTimeout(r, 2000));

  const authResp = await sendRequest(ws, "AuthenticationRequest", {
    pluginName: PLUGIN_NAME,
    pluginDeveloper: PLUGIN_DEVELOPER,
    authenticationToken: token,
  });

  if (!authResp.data?.authenticated) {
    console.error("  Authentication failed. Did you approve the plugin in VTube Studio?");
    process.exit(1);
  }

  console.log("  Authenticated!");
}

function playJumpscareSound(): void {
  if (!existsSync(WAV_PATH)) return;

  if (process.platform === "win32") {
    // Use PowerShell to play sound on Windows
    exec(`powershell -c "(New-Object Media.SoundPlayer '${WAV_PATH}').PlaySync()"`);
  } else {
    // macOS/Linux fallback
    const cmd = process.platform === "darwin"
      ? `afplay "${WAV_PATH}"`
      : `ffplay -nodisp -autoexit -loglevel quiet "${WAV_PATH}"`;
    exec(cmd);
  }
}

async function triggerJumpscare(ws: WebSocket, gifBase64: string): Promise<void> {
  // Play audio in parallel with showing the item
  playJumpscareSound();

  const resp = await sendRequest(ws, "ItemLoadRequest", {
    fileName: GIF_FILENAME,
    positionX: 0,
    positionY: 0,
    size: ITEM_SIZE,
    rotation: 0,
    fadeTime: 0,
    order: 30,
    failIfOrderTaken: false,
    smoothing: 0,
    censored: false,
    flipped: false,
    locked: true,
    unloadWhenPluginDisconnects: true,
    customDataBase64: gifBase64,
    customDataAskUserFirst: true,
    customDataSkipAskingUserIfWhitelisted: true,
    customDataAskTimer: -1,
  });

  if (resp.messageType === "APIError") {
    console.error(`  Failed to load jumpscare: ${resp.data.message}`);
    return;
  }

  const instanceId = resp.data.instanceID;
  await new Promise((r) => setTimeout(r, ITEM_DURATION));

  await sendRequest(ws, "ItemUnloadRequest", {
    instanceIDs: [instanceId],
    unloadAllInScene: false,
    unloadAllLoadedByThisPlugin: false,
    allowUnloadingItemsLoadedByUserOrOtherPlugins: false,
  });
}

async function runLoop(ws: WebSocket): Promise<void> {
  if (!existsSync(GIF_PATH)) {
    console.error(`  ERROR: GIF not found at ${GIF_PATH}`);
    process.exit(1);
  }

  const gifBytes = readFileSync(GIF_PATH);
  const gifBase64 = gifBytes.toString("base64");
  console.log(`  Loaded jumpscare GIF (${Math.floor(gifBytes.length / 1024)} KB)`);
  console.log(`  Rolling 1/${CHANCE_DENOM} every ${TICK_INTERVAL / 1000}s. Ctrl+C to stop.\n`);

  let ticks = 0;
  while (true) {
    await new Promise((r) => setTimeout(r, TICK_INTERVAL));
    ticks++;
    const roll = Math.floor(Math.random() * CHANCE_DENOM) + 1;
    process.stdout.write(`\r  Tick ${ticks}: rolled ${roll}/${CHANCE_DENOM}   `);
    if (roll === 1) {
      console.log("\n  *** IT'S ME ***");
      try {
        await triggerJumpscare(ws, gifBase64);
      } catch (e) {
        console.error(`  Error triggering jumpscare: ${e}`);
      }
    }
  }
}

async function main(): Promise<void> {
  console.log(`  Connecting to VTube Studio at ${API_URL}...`);

  const ws = new WebSocket(API_URL);

  await new Promise<void>((resolve, reject) => {
    ws.on("open", resolve);
    ws.on("error", () => {
      console.error("  Could not connect to VTube Studio.");
      console.error("  Make sure VTube Studio is running and the API is enabled.");
      console.error(`  Settings > General Settings > Start API (check port matches ${API_URL})`);
      process.exit(1);
    });
  });

  await authenticate(ws);
  await new Promise((r) => setTimeout(r, 1000));
  await runLoop(ws);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

process.on("SIGINT", () => {
  console.log("\n  Stopped.\n");
  process.exit(0);
});
