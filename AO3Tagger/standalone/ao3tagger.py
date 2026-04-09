import asyncio
import base64
import io
import json
import random
import sys
from pathlib import Path

import websockets
from PIL import Image, ImageDraw, ImageFont

API_URL = "ws://localhost:8001"
PLUGIN_NAME = "AO3Tagger"
PLUGIN_DEVELOPER = "Sarxina"
TRIGGER_COMMAND = "!ao3tag"

# Rendering config
FONT_FAMILY = "Verdana"
FONT_SIZE = 13
MAX_WIDTH = 500
PADDING = 12
LINE_SPACING = 1.35

# AO3 colors
TAG_COLOR = (153, 0, 0)       # #900
COMMA_COLOR = (42, 42, 42)    # #2a2a2a
BG_COLOR = (255, 255, 255)    # white

# VTS item
ITEM_SIZE = 0.32
PIN_ARTMESH_PATTERN = "head"

# State
tags: list[str] = []
current_item_id: str | None = None


def get_font():
    """Try to load Verdana, fall back to default."""
    try:
        return ImageFont.truetype("verdana.ttf", FONT_SIZE)
    except OSError:
        try:
            return ImageFont.truetype("C:/Windows/Fonts/verdana.ttf", FONT_SIZE)
        except OSError:
            return ImageFont.load_default()


def render_tag_image(tag_list: list[str]) -> bytes:
    font = get_font()
    content_width = MAX_WIDTH - (PADDING * 2)
    line_height = int(FONT_SIZE * LINE_SPACING)

    # Measure tags and comma
    temp_img = Image.new("RGB", (1, 1))
    temp_draw = ImageDraw.Draw(temp_img)

    tag_widths = []
    for tag in tag_list:
        bbox = temp_draw.textbbox((0, 0), tag, font=font)
        tag_widths.append(bbox[2] - bbox[0])

    comma_bbox = temp_draw.textbbox((0, 0), ", ", font=font)
    comma_width = comma_bbox[2] - comma_bbox[0]

    # Layout: which tags on which line
    lines: list[list[int]] = []
    current_line: list[int] = []
    current_x = 0.0

    for i in range(len(tag_list)):
        needed = tag_widths[i]
        if i > 0 and len(current_line) > 0:
            needed += comma_width

        if current_x + needed > content_width and len(current_line) > 0:
            lines.append(current_line)
            current_line = []
            current_x = 0
            needed = tag_widths[i]

        current_line.append(i)
        current_x += needed

    if current_line:
        lines.append(current_line)

    # Render
    total_height = max(64, PADDING * 2 + len(lines) * line_height)
    total_width = max(64, MAX_WIDTH)
    img = Image.new("RGB", (total_width, total_height), BG_COLOR)
    draw = ImageDraw.Draw(img)

    y = PADDING
    for line in lines:
        x = PADDING
        for li, tag_idx in enumerate(line):
            if li > 0:
                draw.text((x, y), ", ", fill=COMMA_COLOR, font=font)
                x += comma_width
            draw.text((x, y), tag_list[tag_idx], fill=TAG_COLOR, font=font)
            x += tag_widths[tag_idx]
        y += line_height

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


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


async def find_pin_mesh(ws) -> str:
    resp = await send_request(ws, "ArtMeshListRequest")
    if resp.get("messageType") == "APIError":
        return ""

    mesh_names = resp.get("data", {}).get("artMeshNames", [])
    # Common Live2D naming — avoid "head" which matches BackHead on many models
    patterns = ["forehead", "eyebrow", "brow", "nose", "face"]
    for pattern in patterns:
        for mesh in mesh_names:
            if pattern in mesh.lower():
                return mesh
    return mesh_names[0] if mesh_names else ""


async def unload_current_item(ws):
    global current_item_id
    if not current_item_id:
        return

    await send_request(ws, "ItemUnloadRequest", {
        "instanceIDs": [current_item_id],
        "unloadAllInScene": False,
        "unloadAllLoadedByThisPlugin": False,
        "allowUnloadingItemsLoadedByUserOrOtherPlugins": False,
    })
    current_item_id = None


async def display_tags(ws):
    global current_item_id

    if not tags:
        await unload_current_item(ws)
        return

    png_bytes = render_tag_image(tags)
    b64 = base64.b64encode(png_bytes).decode("ascii")

    await unload_current_item(ws)

    resp = await send_request(ws, "ItemLoadRequest", {
        "fileName": "ao3taggerimg.png",
        "positionX": 0,
        "positionY": 0.5,
        "size": ITEM_SIZE,
        "rotation": 0,
        "fadeTime": 0.1,
        "order": 25,
        "failIfOrderTaken": False,
        "smoothing": 0,
        "censored": False,
        "flipped": False,
        "locked": False,
        "unloadWhenPluginDisconnects": True,
        "customDataBase64": b64,
        "customDataAskUserFirst": True,
        "customDataSkipAskingUserIfWhitelisted": True,
        "customDataAskTimer": -1,
    })

    if resp.get("messageType") == "APIError":
        print(f"  Failed to load item: {resp['data']['message']}")
        return

    current_item_id = resp["data"]["instanceID"]

    # Pin to head
    pin_mesh = await find_pin_mesh(ws)
    if pin_mesh:
        await send_request(ws, "ItemPinRequest", {
            "pin": True,
            "itemInstanceID": current_item_id,
            "angleRelativeTo": "RelativeToModel",
            "sizeRelativeTo": "RelativeToWorld",
            "vertexPinType": "Center",
            "pinInfo": {
                "modelID": "",
                "artMeshID": pin_mesh,
                "angle": 0,
                "size": ITEM_SIZE,
            },
        })
        print(f"  Pinned to {pin_mesh}")


async def handle_command(ws, message: str):
    global tags

    lower = message.strip().lower()
    if not lower.startswith(TRIGGER_COMMAND):
        return

    arg = message.strip()
    if len(arg) > len(TRIGGER_COMMAND):
        arg = arg[len(TRIGGER_COMMAND):].strip()
    else:
        arg = ""

    if lower == f"{TRIGGER_COMMAND} clear" or lower == f"{TRIGGER_COMMAND} off":
        tags.clear()
        await unload_current_item(ws)
        print("  Tags cleared.")
        return

    if not arg:
        return

    tags.append(arg)
    print(f"  Tags: {', '.join(tags)}")
    await display_tags(ws)


async def main():
    print(f"  Connecting to VTube Studio at {API_URL}...")
    try:
        async with websockets.connect(API_URL) as ws:
            await authenticate(ws)

            # No Twitch integration for standalone — keyboard input
            print(f"\n  Type tags and press Enter. 'clear' to reset. Ctrl+C to quit.\n")

            loop = asyncio.get_event_loop()
            while True:
                line = await loop.run_in_executor(None, input, "  > ")
                line = line.strip()
                if not line:
                    continue
                if line.lower() in ("clear", "off"):
                    line = f"{TRIGGER_COMMAND} {line}"
                elif not line.lower().startswith(TRIGGER_COMMAND):
                    line = f"{TRIGGER_COMMAND} {line}"
                await handle_command(ws, line)
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
