import WebSocket from "ws";
import { readFileSync } from "fs";
import { resolve } from "path";

const PLUGIN_NAME = "EmojiHead";
const PLUGIN_DEVELOPER = "Sarxina";

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

export async function authenticate(ws: WebSocket): Promise<void> {
  console.log("  Requesting VTS authentication token...");
  const tokenResp = await sendRequest(ws, "AuthenticationTokenRequest", {
    pluginName: PLUGIN_NAME,
    pluginDeveloper: PLUGIN_DEVELOPER,
  });

  if (tokenResp.messageType === "APIError") {
    throw new Error(`VTS auth error: ${tokenResp.data.message}`);
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
    throw new Error("VTS authentication failed. Did you approve the plugin?");
  }
  console.log("  Authenticated with VTube Studio.");
}

export async function loadItemFromFile(ws: WebSocket, filePath: string, size: number = 0.4): Promise<string> {
  const imageBuffer = readFileSync(resolve(filePath));
  const base64 = imageBuffer.toString("base64");

  const resp = await sendRequest(ws, "ItemLoadRequest", {
    fileName: "emojihead_emote.png",
    positionX: 0,
    positionY: 0,
    size,
    rotation: 0,
    fadeTime: 0.2,
    order: 1,
    failIfOrderTaken: false,
    smoothing: 0,
    censored: false,
    flipped: false,
    locked: false,
    unloadWhenPluginDisconnects: true,
    customDataBase64: base64,
    customDataAskUserFirst: true,
    customDataSkipAskingUserIfWhitelisted: true,
    customDataAskTimer: -1,
  });

  if (resp.messageType === "APIError") {
    throw new Error(`Failed to load item: ${resp.data.message}`);
  }

  return resp.data.instanceID;
}

export async function pinItemToArtMesh(ws: WebSocket, instanceId: string, artMeshId: string, size: number = 0.62): Promise<void> {
  const resp = await sendRequest(ws, "ItemPinRequest", {
    pin: true,
    itemInstanceID: instanceId,
    angleRelativeTo: "RelativeToModel",
    sizeRelativeTo: "RelativeToWorld",
    vertexPinType: "Center",
    pinInfo: {
      modelID: "",
      artMeshID: artMeshId,
      angle: 0,
      size,
    },
  });

  if (resp.messageType === "APIError") {
    throw new Error(`Failed to pin item: ${resp.data.message}`);
  }
}

export async function unpinItem(ws: WebSocket, instanceId: string): Promise<void> {
  await sendRequest(ws, "ItemPinRequest", {
    pin: false,
    itemInstanceID: instanceId,
  });
}

export async function unloadItem(ws: WebSocket, instanceId: string): Promise<void> {
  await sendRequest(ws, "ItemUnloadRequest", {
    instanceIDs: [instanceId],
    unloadAllInScene: false,
    unloadAllLoadedByThisPlugin: false,
    allowUnloadingItemsLoadedByUserOrOtherPlugins: false,
  });
}

export async function hideFaceArtMeshes(ws: WebSocket, patterns: string[]): Promise<number> {
  const resp = await sendRequest(ws, "ColorTintRequest", {
    colorTint: {
      colorR: 255,
      colorG: 255,
      colorB: 255,
      colorA: 0,
      mixWithSceneLightingColor: 0,
    },
    artMeshMatcher: {
      tintAll: false,
      artMeshNumber: [],
      nameExact: [],
      nameContains: patterns,
      tagExact: [],
      tagContains: [],
    },
  });

  if (resp.messageType === "APIError") {
    throw new Error(`Failed to hide artmeshes: ${resp.data.message}`);
  }

  return resp.data.matchedArtMeshes;
}

export async function showFaceArtMeshes(ws: WebSocket, patterns: string[]): Promise<void> {
  await sendRequest(ws, "ColorTintRequest", {
    colorTint: {
      colorR: 255,
      colorG: 255,
      colorB: 255,
      colorA: 255,
      mixWithSceneLightingColor: 0,
    },
    artMeshMatcher: {
      tintAll: false,
      artMeshNumber: [],
      nameExact: [],
      nameContains: patterns,
      tagExact: [],
      tagContains: [],
    },
  });
}
