import asyncio
import base64
import json
import os
import random
import sys
from pathlib import Path

import websockets

try:
    import winsound
    HAS_WINSOUND = True
except ImportError:
    HAS_WINSOUND = False

API_URL = "ws://localhost:8001"
PLUGIN_NAME = "FoxyJumpscare"
PLUGIN_DEVELOPER = "Sarxina"

# 1 in CHANCE_DENOM per second
CHANCE_DENOM = 10000
TICK_INTERVAL = 1.0

# Paths to assets (relative to this script)
SCRIPT_DIR = Path(__file__).parent
GIF_PATH = SCRIPT_DIR.parent / "assets" / "jumpscare.gif"
# VTS routes custom image parsing by filename extension — must match actual format
GIF_FILENAME = "foxyjumpscare.gif"
WAV_PATH = SCRIPT_DIR.parent / "assets" / "jumpscare.wav"

# Item display
ITEM_SIZE = 0.5           # 1.0 = roughly fullscreen
ITEM_DURATION = 1.2       # seconds to keep item on screen (video is ~0.95s)


async def send_request(ws, message_type, data=None):
    request = {
        "apiName": "VTubeStudioPublicAPI",
        "apiVersion": "1.0",
        "requestID": str(random.randint(1000, 9999)),
        "messageType": message_type,
    }
    if data:
        request["data"] = data
    await ws.send(json.dumps(request))
    return json.loads(await ws.recv())


async def authenticate(ws):
    print("  Requesting authentication token...")
    resp = await send_request(ws, "AuthenticationTokenRequest", {
        "pluginName": PLUGIN_NAME,
        "pluginDeveloper": PLUGIN_DEVELOPER,
    })

    if resp.get("messageType") == "APIError":
        print(f"  Error: {resp['data']['message']}")
        sys.exit(1)

    token = resp["data"]["authenticationToken"]
    print("  Approve the plugin in VTube Studio if prompted...")
    await asyncio.sleep(2)

    resp = await send_request(ws, "AuthenticationRequest", {
        "pluginName": PLUGIN_NAME,
        "pluginDeveloper": PLUGIN_DEVELOPER,
        "authenticationToken": token,
    })

    if not resp["data"].get("authenticated"):
        print("  Authentication failed. Did you approve the plugin in VTube Studio?")
        sys.exit(1)

    print("  Authenticated!")


def play_jumpscare_sound():
    if not WAV_PATH.exists():
        return
    if HAS_WINSOUND:
        winsound.PlaySound(str(WAV_PATH), winsound.SND_ASYNC | winsound.SND_FILENAME)
    else:
        # Fallback for non-Windows — best effort, non-blocking
        try:
            import subprocess
            subprocess.Popen(
                ["ffplay", "-nodisp", "-autoexit", "-loglevel", "quiet", str(WAV_PATH)],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
        except Exception:
            pass


async def trigger_jumpscare(ws, gif_base64):
    # Play audio in parallel with showing the item
    play_jumpscare_sound()

    resp = await send_request(ws, "ItemLoadRequest", {
        "fileName": GIF_FILENAME,
        "positionX": 0,
        "positionY": 0,
        "size": ITEM_SIZE,
        "rotation": 0,
        "fadeTime": 0,
        "order": 30,
        "failIfOrderTaken": False,
        "smoothing": 0,
        "censored": False,
        "flipped": False,
        "locked": True,
        "unloadWhenPluginDisconnects": True,
        "customDataBase64": gif_base64,
        "customDataAskUserFirst": True,
        "customDataSkipAskingUserIfWhitelisted": True,
        "customDataAskTimer": -1,
    })

    if resp.get("messageType") == "APIError":
        print(f"  Failed to load jumpscare: {resp['data']['message']}")
        return

    instance_id = resp["data"]["instanceID"]
    await asyncio.sleep(ITEM_DURATION)

    await send_request(ws, "ItemUnloadRequest", {
        "instanceIDs": [instance_id],
        "unloadAllInScene": False,
        "unloadAllLoadedByThisPlugin": False,
        "allowUnloadingItemsLoadedByUserOrOtherPlugins": False,
    })


async def run_loop(ws):
    if not GIF_PATH.exists():
        print(f"  ERROR: GIF not found at {GIF_PATH}")
        sys.exit(1)

    gif_bytes = GIF_PATH.read_bytes()
    gif_base64 = base64.b64encode(gif_bytes).decode("ascii")
    print(f"  Loaded jumpscare GIF ({len(gif_bytes) // 1024} KB)")
    print(f"  Rolling 1/{CHANCE_DENOM} every {TICK_INTERVAL}s. Ctrl+C to stop.\n")

    ticks = 0
    while True:
        await asyncio.sleep(TICK_INTERVAL)
        ticks += 1
        roll = random.randint(1, CHANCE_DENOM)
        print(f"\r  Tick {ticks}: rolled {roll}/{CHANCE_DENOM}   ", end="", flush=True)
        if roll == 1:
            print("\n  *** IT'S ME ***")
            try:
                await trigger_jumpscare(ws, gif_base64)
            except Exception as e:
                print(f"  Error triggering jumpscare: {e}")


async def main():
    print(f"  Connecting to VTube Studio at {API_URL}...")
    try:
        async with websockets.connect(API_URL) as ws:
            await authenticate(ws)
            await asyncio.sleep(1)
            await run_loop(ws)
    except ConnectionRefusedError:
        print("  Could not connect to VTube Studio.")
        print("  Make sure VTube Studio is running and the API is enabled.")
        print(f"  Settings > General Settings > Start API (check port matches {API_URL})")
        sys.exit(1)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n  Stopped.\n")
