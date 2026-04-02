import asyncio
import json
import random
import math
import sys
import os
import websockets

API_URL = "ws://localhost:8004"
PLUGIN_NAME = "RandomMovementGenerator"
PLUGIN_DEVELOPER = "Sarxina"
FPS = 30
FRAME_INTERVAL = 1.0 / FPS


# --- Terminal UI helpers ---

def clear_screen():
    os.system("cls" if os.name == "nt" else "clear")


def print_header():
    print("\033[1;36m" + "=" * 50)
    print("  GetDown - Random Movement Generator")
    print("=" * 50 + "\033[0m")
    print()
    print("  Press \033[1;33mCtrl+C\033[0m to stop")
    print()


def print_params(param_values, frame):
    """Print a live view of current parameter values."""
    # Move cursor to line 7 (after header)
    print(f"\033[7;0H", end="")
    print(f"  \033[1mFrame {frame}\033[0m")
    print(f"  {'─' * 46}")

    for pv in param_values:
        name = pv["id"]
        val = pv["value"]

        # Color based on value magnitude
        if abs(val) > 50:
            color = "\033[1;31m"  # red
        elif abs(val) > 10:
            color = "\033[1;33m"  # yellow
        else:
            color = "\033[0;37m"  # white

        # Simple bar visualization
        bar_width = 20
        bar_center = bar_width // 2
        # Normalize to -1..1 range roughly
        norm = max(-1, min(1, val / max(abs(pv.get("min", 100)), 1)))
        bar_pos = int(bar_center + norm * bar_center)
        bar_pos = max(0, min(bar_width - 1, bar_pos))

        bar = list("·" * bar_width)
        bar[bar_center] = "│"
        bar[bar_pos] = "█"
        bar_str = "".join(bar)

        print(f"  {color}{name:<22}\033[0m [{bar_str}] {color}{val:>8.2f}\033[0m")

    # Pad remaining lines to avoid leftover text
    print("\033[J", end="", flush=True)


# --- VTube Studio API ---

async def send_request(ws, msg_type, data=None):
    request = {
        "apiName": "VTubeStudioPublicAPI",
        "apiVersion": "1.0",
        "requestID": str(random.randint(1000, 9999)),
        "messageType": msg_type,
    }
    if data:
        request["data"] = data
    await ws.send(json.dumps(request))
    response = json.loads(await ws.recv())
    return response


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


async def get_model_parameters(ws):
    """Query the model's actual input parameters and their ranges."""
    resp = await send_request(ws, "InputParameterListRequest")
    if resp.get("messageType") == "APIError":
        return None
    data = resp["data"]
    params = data.get("modelParameters") or data.get("defaultParameters") or data.get("customParameters")
    if not params:
        all_params = []
        for key, val in data.items():
            if isinstance(val, list):
                all_params.extend(val)
        if all_params:
            params = all_params
        else:
            return None
    return params


# --- Movement logic ---

async def run_random_movements(ws):
    model_params = await get_model_parameters(ws)
    if not model_params:
        print("  Could not get model parameters. Exiting.")
        sys.exit(1)

    param_info = {}
    for p in model_params:
        param_info[p["name"]] = {"min": p["min"], "max": p["max"]}

    # Find left/right pairs for desync
    left_right_pairs = []
    seen = set()
    for name in param_info:
        nl = name.lower()
        if "left" in nl:
            right_name = name.replace("Left", "Right").replace("left", "right")
            if right_name in param_info and name not in seen:
                left_right_pairs.append((name, right_name))
                seen.add(name)
                seen.add(right_name)

    clear_screen()
    print_header()

    frame = 0
    elapsed = 0.0

    while True:
        frame_start = asyncio.get_event_loop().time()
        frame += 1

        param_values = []

        for name, info in param_info.items():
            lo, hi = info["min"], info["max"]
            mid = (lo + hi) / 2.0
            rng = hi - lo
            if rng == 0:
                rng = 1

            technique = random.choice(["snap", "oscillate", "sine_stack", "hold_extreme"])

            if technique == "snap":
                val = lo if random.random() < 0.5 else hi
            elif technique == "oscillate":
                freq = random.uniform(8, 40)
                val = mid + (rng / 2) * math.sin(elapsed * freq * 2 * math.pi)
            elif technique == "sine_stack":
                val = mid
                for i in range(4):
                    freq = random.uniform(3, 25)
                    val += (rng / 4) * math.sin(elapsed * freq + i * 1.7)
                val = max(lo, min(hi, val))
            else:
                val = lo if frame % 7 < 3 else hi

            param_values.append({"id": name, "value": val, "min": lo, "max": hi})

        # Desync left/right pairs
        for left_name, right_name in left_right_pairs:
            lo_l, hi_l = param_info[left_name]["min"], param_info[left_name]["max"]
            lo_r, hi_r = param_info[right_name]["min"], param_info[right_name]["max"]

            phase = math.sin(elapsed * random.uniform(5, 15))
            if phase > 0:
                left_val, right_val = hi_l, lo_r
            else:
                left_val, right_val = lo_l, hi_r

            if random.random() < 0.2:
                left_val = right_val = hi_l

            for pv in param_values:
                if pv["id"] == left_name:
                    pv["value"] = left_val
                elif pv["id"] == right_name:
                    pv["value"] = right_val

        # Send to VTube Studio
        request = {
            "apiName": "VTubeStudioPublicAPI",
            "apiVersion": "1.0",
            "requestID": str(frame),
            "messageType": "InjectParameterDataRequest",
            "data": {
                "faceFound": True,
                "mode": "set",
                "parameterValues": [{"id": pv["id"], "value": pv["value"]} for pv in param_values],
            },
        }
        await ws.send(json.dumps(request))
        try:
            await asyncio.wait_for(ws.recv(), timeout=0.005)
        except asyncio.TimeoutError:
            pass

        # Update terminal display
        print_params(param_values, frame)

        elapsed += FRAME_INTERVAL
        frame_time = asyncio.get_event_loop().time() - frame_start
        sleep_time = max(0, FRAME_INTERVAL - frame_time)
        await asyncio.sleep(sleep_time)


async def main():
    print(f"  Connecting to VTube Studio at {API_URL}...")
    try:
        async with websockets.connect(API_URL) as ws:
            await authenticate(ws)
            await asyncio.sleep(1)
            await run_random_movements(ws)
    except ConnectionRefusedError:
        print("  Could not connect to VTube Studio.")
        print("  Make sure VTube Studio is running and the API is enabled.")
        print(f"  Settings > General Settings > Start API (check port matches {API_URL})")
        sys.exit(1)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        clear_screen()
        print("\n  Stopped.\n")
