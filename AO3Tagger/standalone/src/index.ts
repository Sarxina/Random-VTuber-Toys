import WebSocket from "ws";
import { createCanvas, registerFont } from "canvas";
import * as readline from "readline";

const API_URL = "ws://localhost:8001";
const PLUGIN_NAME = "AO3Tagger";
const PLUGIN_DEVELOPER = "Sarxina";
const TRIGGER_COMMAND = "!ao3tag";

// Rendering config
const FONT_SIZE = 13;
const MAX_WIDTH = 500;
const PADDING = 12;
const LINE_SPACING = 1.35;

// AO3 colors
const TAG_COLOR = "rgb(153, 0, 0)";
const COMMA_COLOR = "rgb(42, 42, 42)";
const BG_COLOR = "rgb(255, 255, 255)";

// VTS item
const ITEM_SIZE = 0.32;

// State
const tags: string[] = [];
let currentItemId: string | null = null;
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

function renderTagImage(tagList: string[]): Buffer {
  const font = `${FONT_SIZE}px Verdana, sans-serif`;
  const contentWidth = MAX_WIDTH - PADDING * 2;
  const lineHeight = Math.floor(FONT_SIZE * LINE_SPACING);

  // Measure tags
  const measureCanvas = createCanvas(1, 1);
  const measureCtx = measureCanvas.getContext("2d");
  measureCtx.font = font;

  const tagWidths = tagList.map((tag) => measureCtx.measureText(tag).width);
  const commaWidth = measureCtx.measureText(", ").width;

  // Layout: which tags on which line
  const lines: number[][] = [];
  let currentLine: number[] = [];
  let currentX = 0;

  for (let i = 0; i < tagList.length; i++) {
    let needed = tagWidths[i];
    if (i > 0 && currentLine.length > 0) {
      needed += commaWidth;
    }

    if (currentX + needed > contentWidth && currentLine.length > 0) {
      lines.push(currentLine);
      currentLine = [];
      currentX = 0;
      needed = tagWidths[i];
    }

    currentLine.push(i);
    currentX += needed;
  }
  if (currentLine.length > 0) {
    lines.push(currentLine);
  }

  // Render
  const totalHeight = Math.max(64, PADDING * 2 + lines.length * lineHeight);
  const totalWidth = Math.max(64, MAX_WIDTH);
  const canvas = createCanvas(totalWidth, totalHeight);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, totalWidth, totalHeight);
  ctx.font = font;
  ctx.textBaseline = "top";

  let y = PADDING;
  for (const line of lines) {
    let x = PADDING;
    for (let li = 0; li < line.length; li++) {
      const tagIdx = line[li];
      if (li > 0) {
        ctx.fillStyle = COMMA_COLOR;
        ctx.fillText(", ", x, y);
        x += commaWidth;
      }
      ctx.fillStyle = TAG_COLOR;
      ctx.fillText(tagList[tagIdx], x, y);
      x += tagWidths[tagIdx];
    }
    y += lineHeight;
  }

  return canvas.toBuffer("image/png");
}

async function findPinMesh(ws: WebSocket): Promise<string> {
  const resp = await sendRequest(ws, "ArtMeshListRequest");
  if (resp.messageType === "APIError") return "";

  const meshNames: string[] = resp.data?.artMeshNames ?? [];
  const patterns = ["forehead", "eyebrow", "brow", "nose", "face"];
  for (const pattern of patterns) {
    for (const mesh of meshNames) {
      if (mesh.toLowerCase().includes(pattern)) return mesh;
    }
  }
  return meshNames[0] ?? "";
}

async function unloadCurrentItem(ws: WebSocket): Promise<void> {
  if (!currentItemId) return;

  await sendRequest(ws, "ItemUnloadRequest", {
    instanceIDs: [currentItemId],
    unloadAllInScene: false,
    unloadAllLoadedByThisPlugin: false,
    allowUnloadingItemsLoadedByUserOrOtherPlugins: false,
  });
  currentItemId = null;
}

async function displayTags(ws: WebSocket): Promise<void> {
  if (tags.length === 0) {
    await unloadCurrentItem(ws);
    return;
  }

  const pngBuffer = renderTagImage(tags);
  const b64 = pngBuffer.toString("base64");

  await unloadCurrentItem(ws);

  const resp = await sendRequest(ws, "ItemLoadRequest", {
    fileName: "ao3taggerimg.png",
    positionX: 0,
    positionY: 0.5,
    size: ITEM_SIZE,
    rotation: 0,
    fadeTime: 0.1,
    order: 25,
    failIfOrderTaken: false,
    smoothing: 0,
    censored: false,
    flipped: false,
    locked: false,
    unloadWhenPluginDisconnects: true,
    customDataBase64: b64,
    customDataAskUserFirst: true,
    customDataSkipAskingUserIfWhitelisted: true,
    customDataAskTimer: -1,
  });

  if (resp.messageType === "APIError") {
    console.error(`  Failed to load item: ${resp.data.message}`);
    return;
  }

  currentItemId = resp.data.instanceID;

  // Pin to head
  const pinMesh = await findPinMesh(ws);
  if (pinMesh) {
    await sendRequest(ws, "ItemPinRequest", {
      pin: true,
      itemInstanceID: currentItemId,
      angleRelativeTo: "RelativeToModel",
      sizeRelativeTo: "RelativeToWorld",
      vertexPinType: "Center",
      pinInfo: {
        modelID: "",
        artMeshID: pinMesh,
        angle: 0,
        size: ITEM_SIZE,
      },
    });
    console.log(`  Pinned to ${pinMesh}`);
  }
}

async function handleCommand(ws: WebSocket, message: string): Promise<void> {
  const lower = message.trim().toLowerCase();
  if (!lower.startsWith(TRIGGER_COMMAND)) return;

  let arg = message.trim();
  arg = arg.length > TRIGGER_COMMAND.length ? arg.slice(TRIGGER_COMMAND.length).trim() : "";

  if (lower === `${TRIGGER_COMMAND} clear` || lower === `${TRIGGER_COMMAND} off`) {
    tags.length = 0;
    await unloadCurrentItem(ws);
    console.log("  Tags cleared.");
    return;
  }

  if (!arg) return;

  tags.push(arg);
  console.log(`  Tags: ${tags.join(", ")}`);
  await displayTags(ws);
}

async function main(): Promise<void> {
  console.log(`  Connecting to VTube Studio at ${API_URL}...`);

  const ws = new WebSocket(API_URL);

  await new Promise<void>((resolve, reject) => {
    ws.on("open", resolve);
    ws.on("error", (err) => {
      console.error("  Could not connect to VTube Studio.");
      console.error("  Make sure VTube Studio is running and the API is enabled.");
      console.error(`  Settings > General Settings > Start API (check port matches ${API_URL})`);
      process.exit(1);
    });
  });

  await authenticate(ws);

  console.log(`\n  Type tags and press Enter. 'clear' to reset. Ctrl+C to quit.\n`);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const askLine = (): void => {
    rl.question("  > ", async (line) => {
      line = line.trim();
      if (!line) {
        askLine();
        return;
      }
      if (line.toLowerCase() === "clear" || line.toLowerCase() === "off") {
        line = `${TRIGGER_COMMAND} ${line}`;
      } else if (!line.toLowerCase().startsWith(TRIGGER_COMMAND)) {
        line = `${TRIGGER_COMMAND} ${line}`;
      }
      await handleCommand(ws, line);
      askLine();
    });
  };

  askLine();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

process.on("SIGINT", () => {
  console.log("\n  Stopped.\n");
  process.exit(0);
});
