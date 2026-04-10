import "dotenv/config";
import WebSocket from "ws";
import {
  TwitchChatManager,
  ChatCommandManager,
} from "../../../utils/chatgod-js/src/services/TwitchChatManager.js";

const API_URL = "ws://localhost:8004";
const PLUGIN_NAME = "RandomMovementGenerator";
const PLUGIN_DEVELOPER = "Sarxina";
const TRIGGER_COMMAND = "!getdown";
const FPS = 30;
const FRAME_INTERVAL = 1000 / FPS; // ms

let requestId = 0;

function nextId(): string {
  return String(++requestId);
}

// --- Terminal UI helpers ---

function clearScreen(): void {
  process.stdout.write(process.platform === "win32" ? "\x1Bc" : "\x1B[2J\x1B[H");
}

function printHeader(): void {
  console.log("\x1B[1;36m" + "=".repeat(50));
  console.log("  GetDown - Random Movement Generator");
  console.log("=".repeat(50) + "\x1B[0m");
  console.log();
  console.log("  Press \x1B[1;33mCtrl+C\x1B[0m to stop");
  console.log();
}

interface ParamValue {
  id: string;
  value: number;
  min: number;
  max: number;
}

function printParams(paramValues: ParamValue[], frame: number): void {
  // Move cursor to line 7 (after header)
  process.stdout.write("\x1B[7;0H");
  process.stdout.write(`  \x1B[1mFrame ${frame}\x1B[0m\n`);
  process.stdout.write(`  ${"─".repeat(46)}\n`);

  for (const pv of paramValues) {
    const { id: name, value: val, min, max } = pv;

    // Color based on value magnitude
    let color: string;
    if (Math.abs(val) > 50) {
      color = "\x1B[1;31m"; // red
    } else if (Math.abs(val) > 10) {
      color = "\x1B[1;33m"; // yellow
    } else {
      color = "\x1B[0;37m"; // white
    }

    // Simple bar visualization
    const barWidth = 20;
    const barCenter = Math.floor(barWidth / 2);
    const norm = Math.max(-1, Math.min(1, val / Math.max(Math.abs(max || 100), 1)));
    let barPos = Math.floor(barCenter + norm * barCenter);
    barPos = Math.max(0, Math.min(barWidth - 1, barPos));

    const bar = Array(barWidth).fill("·");
    bar[barCenter] = "│";
    bar[barPos] = "█";
    const barStr = bar.join("");

    process.stdout.write(
      `  ${color}${name.padEnd(22)}\x1B[0m [${barStr}] ${color}${val.toFixed(2).padStart(8)}\x1B[0m\n`
    );
  }

  // Clear remaining lines
  process.stdout.write("\x1B[J");
}

// --- VTube Studio API ---

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

interface ModelParam {
  name: string;
  min: number;
  max: number;
}

async function getModelParameters(ws: WebSocket): Promise<ModelParam[] | null> {
  const resp = await sendRequest(ws, "InputParameterListRequest");
  if (resp.messageType === "APIError") return null;

  const data = resp.data;
  let params: any[] | null =
    data.modelParameters ?? data.defaultParameters ?? data.customParameters ?? null;

  if (!params) {
    const allParams: any[] = [];
    for (const val of Object.values(data)) {
      if (Array.isArray(val)) allParams.push(...val);
    }
    params = allParams.length > 0 ? allParams : null;
  }

  return params;
}

// --- Movement logic ---

async function runRandomMovements(ws: WebSocket): Promise<void> {
  const modelParams = await getModelParameters(ws);
  if (!modelParams) {
    console.error("  Could not get model parameters. Exiting.");
    process.exit(1);
  }

  const paramInfo = new Map<string, { min: number; max: number }>();
  for (const p of modelParams) {
    paramInfo.set(p.name, { min: p.min, max: p.max });
  }

  // Find left/right pairs for desync
  const leftRightPairs: [string, string][] = [];
  const seen = new Set<string>();
  for (const name of paramInfo.keys()) {
    const nl = name.toLowerCase();
    if (nl.includes("left")) {
      const rightName = name.replace("Left", "Right").replace("left", "right");
      if (paramInfo.has(rightName) && !seen.has(name)) {
        leftRightPairs.push([name, rightName]);
        seen.add(name);
        seen.add(rightName);
      }
    }
  }

  clearScreen();
  printHeader();

  let frame = 0;
  let elapsed = 0;
  let timerId: ReturnType<typeof setTimeout> | null = null;

  stopFn = () => {
    if (timerId) clearTimeout(timerId);
  };

  const techniques = ["snap", "oscillate", "sine_stack", "hold_extreme"] as const;

  const tick = (): void => {
    if (!running) return;
    const frameStart = performance.now();
    frame++;

    const paramValues: ParamValue[] = [];

    for (const [name, info] of paramInfo) {
      const { min: lo, max: hi } = info;
      const mid = (lo + hi) / 2;
      let rng = hi - lo;
      if (rng === 0) rng = 1;

      const technique = techniques[Math.floor(Math.random() * techniques.length)];
      let val: number;

      switch (technique) {
        case "snap":
          val = Math.random() < 0.5 ? lo : hi;
          break;
        case "oscillate": {
          const freq = Math.random() * 32 + 8;
          val = mid + (rng / 2) * Math.sin(elapsed * freq * 2 * Math.PI);
          break;
        }
        case "sine_stack": {
          val = mid;
          for (let i = 0; i < 4; i++) {
            const freq = Math.random() * 22 + 3;
            val += (rng / 4) * Math.sin(elapsed * freq + i * 1.7);
          }
          val = Math.max(lo, Math.min(hi, val));
          break;
        }
        case "hold_extreme":
          val = frame % 7 < 3 ? lo : hi;
          break;
      }

      paramValues.push({ id: name, value: val, min: lo, max: hi });
    }

    // Desync left/right pairs
    for (const [leftName, rightName] of leftRightPairs) {
      const loL = paramInfo.get(leftName)!.min;
      const hiL = paramInfo.get(leftName)!.max;
      const loR = paramInfo.get(rightName)!.min;
      const hiR = paramInfo.get(rightName)!.max;

      const phase = Math.sin(elapsed * (Math.random() * 10 + 5));
      let leftVal: number, rightVal: number;
      if (phase > 0) {
        leftVal = hiL;
        rightVal = loR;
      } else {
        leftVal = loL;
        rightVal = hiR;
      }

      if (Math.random() < 0.2) {
        leftVal = rightVal = hiL;
      }

      for (const pv of paramValues) {
        if (pv.id === leftName) pv.value = leftVal;
        else if (pv.id === rightName) pv.value = rightVal;
      }
    }

    // Send to VTube Studio
    const request = {
      apiName: "VTubeStudioPublicAPI",
      apiVersion: "1.0",
      requestID: String(frame),
      messageType: "InjectParameterDataRequest",
      data: {
        faceFound: true,
        mode: "set",
        parameterValues: paramValues.map((pv) => ({ id: pv.id, value: pv.value })),
      },
    };
    ws.send(JSON.stringify(request));

    // Update terminal display
    printParams(paramValues, frame);

    elapsed += FRAME_INTERVAL / 1000;
    const frameTime = performance.now() - frameStart;
    const sleepTime = Math.max(0, FRAME_INTERVAL - frameTime);
    timerId = setTimeout(tick, sleepTime);
  };

  tick();
}

let running = false;
let stopFn: (() => void) | null = null;

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

  const chatManager = new TwitchChatManager(() => {});
  new ChatCommandManager(
    TRIGGER_COMMAND,
    (subcommand, chatter) => {
      const arg = subcommand.trim().toLowerCase();
      if (arg === "" || arg === "on") {
        if (!running) {
          console.log(`\n  ${chatter} started random movement!`);
          running = true;
          runRandomMovements(ws);
        }
      } else if (arg === "off") {
        if (running && stopFn) {
          console.log(`\n  ${chatter} stopped random movement.`);
          running = false;
          stopFn();
          stopFn = null;
        }
      }
    },
    chatManager
  );

  console.log(`  Listening for "${TRIGGER_COMMAND}" in Twitch chat. Ctrl+C to quit.\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

process.on("SIGINT", () => {
  clearScreen();
  console.log("\n  Stopped.\n");
  process.exit(0);
});
