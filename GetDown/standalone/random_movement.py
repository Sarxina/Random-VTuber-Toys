import asyncio
import json
import random
import math
import sys
import websockets

API_URL = "ws://localhost:8004"
PLUGIN_NAME = "RandomMovementGenerator"
PLUGIN_DEVELOPER = "User"
DURATION = 5.0
FPS = 30
FRAME_INTERVAL = 1.0 / FPS

# Parameters to randomize and their ranges
PARAMS = [
    # (parameter_id, min_val, max_val, speed_factor)
    # speed_factor controls how fast the parameter changes (lower = smoother)
    # Cranked WAY beyond normal ranges for maximum distortion
    ("FaceAngleX", -180, 180, 10.0),
    ("FaceAngleY", -180, 180, 10.0),
    ("FaceAngleZ", -180, 180, 10.0),
    ("FacePositionX", -50, 50, 10.0),
    ("FacePositionY", -50, 50, 10.0),
    ("EyeOpenLeft", -5, 5, 15.0),
    ("EyeOpenRight", -5, 5, 15.0),
    ("EyeLeftX", -10, 10, 15.0),
    ("EyeLeftY", -10, 10, 15.0),
    ("EyeRightX", -10, 10, 15.0),
    ("EyeRightY", -10, 10, 15.0),
    ("MouthOpen", -3, 5, 15.0),
    ("MouthSmile", -10, 10, 10.0),
    ("MouthForm", -10, 10, 10.0),
    ("BrowLeftY", -10, 10, 10.0),
    ("BrowRightY", -10, 10, 10.0),
    ("BodyAngleX", -90, 90, 8.0),
    ("BodyAngleY", -90, 90, 8.0),
    ("BodyAngleZ", -90, 90, 8.0),
    # Extra params that many models support
    ("CheekPuff", -5, 5, 10.0),
    ("TongueOut", -3, 5, 10.0),
    ("EyeSquintLeft", -5, 5, 10.0),
    ("EyeSquintRight", -5, 5, 10.0),
]

# How often to pick new random targets (seconds) — lower = more erratic
TARGET_CHANGE_INTERVAL = 0.03
# No smoothing — jump straight to random values for maximum horror
NO_LERP = True


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
    # Request auth token
    print("Requesting authentication token...")
    resp = await send_request(ws, "AuthenticationTokenRequest", {
        "pluginName": PLUGIN_NAME,
        "pluginDeveloper": PLUGIN_DEVELOPER,
    })

    if resp.get("messageType") == "APIError":
        print(f"Error: {resp['data']['message']}")
        sys.exit(1)

    token = resp["data"]["authenticationToken"]
    print("Got token. Please APPROVE the plugin in VTube Studio if prompted...")
    await asyncio.sleep(2)

    # Authenticate with token
    resp = await send_request(ws, "AuthenticationRequest", {
        "pluginName": PLUGIN_NAME,
        "pluginDeveloper": PLUGIN_DEVELOPER,
        "authenticationToken": token,
    })

    if not resp["data"].get("authenticated"):
        print("Authentication failed. Did you approve the plugin in VTube Studio?")
        sys.exit(1)

    print("Authenticated!")


def lerp(a, b, t):
    return a + (b - a) * t


async def get_model_parameters(ws):
    """Query the model's actual input parameters and their ranges."""
    print("Querying model parameters...")
    resp = await send_request(ws, "InputParameterListRequest")
    if resp.get("messageType") == "APIError":
        print(f"Warning: Could not get parameters: {resp['data']['message']}")
        return None
    data = resp["data"]
    # Find the right key for parameters
    params = data.get("modelParameters") or data.get("defaultParameters") or data.get("customParameters")
    if not params:
        print(f"Response keys: {list(data.keys())}")
        # Try combining all parameter lists we can find
        all_params = []
        for key, val in data.items():
            if isinstance(val, list):
                all_params.extend(val)
        if all_params:
            params = all_params
        else:
            print("Could not find parameters in response. Falling back to hardcoded list.")
            return None
    print(f"Model has {len(params)} input parameters:")
    for p in params:
        print(f"  {p['name']}: {p['min']} to {p['max']} (default {p['defaultValue']})")
    return params


async def run_random_movements(ws):
    model_params = await get_model_parameters(ws)
    if not model_params:
        print("Could not get model parameters. Exiting.")
        sys.exit(1)

    # Build a dict of param name -> {min, max}
    param_info = {}
    for p in model_params:
        param_info[p["name"]] = {"min": p["min"], "max": p["max"]}

    print(f"\nUsing {len(param_info)} parameters from model")
    print(f"Starting UNNATURAL movements for {DURATION} seconds at {FPS} FPS...")
    print("Make sure OBS is recording!\n")

    # Identify paired parameters for desync (left vs right)
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

    print(f"Found {len(left_right_pairs)} left/right pairs to desync:")
    for l, r in left_right_pairs:
        print(f"  {l} <-> {r}")

    elapsed = 0.0
    frame = 0
    total_frames = int(DURATION * FPS)

    while elapsed < DURATION:
        frame_start = asyncio.get_event_loop().time()
        t = elapsed / DURATION  # 0..1 progress
        frame += 1

        param_values = []

        for name, info in param_info.items():
            lo, hi = info["min"], info["max"]
            mid = (lo + hi) / 2.0
            rng = hi - lo
            if rng == 0:
                rng = 1

            # Different chaos techniques applied simultaneously
            technique = random.choice(["snap", "oscillate", "sine_stack", "hold_extreme"])

            if technique == "snap":
                # Snap between min and max with no in-between
                val = lo if random.random() < 0.5 else hi
            elif technique == "oscillate":
                # High-frequency oscillation at different rates per param
                freq = random.uniform(8, 40)
                val = mid + (rng / 2) * math.sin(elapsed * freq * 2 * math.pi)
            elif technique == "sine_stack":
                # Stack multiple sine waves for organic-but-wrong movement
                val = mid
                for i in range(4):
                    freq = random.uniform(3, 25)
                    val += (rng / 4) * math.sin(elapsed * freq + i * 1.7)
                val = max(lo, min(hi, val))
            else:
                # Hold at extreme value
                val = lo if frame % 7 < 3 else hi

            param_values.append({"id": name, "value": val})

        # DESYNC: Force left/right pairs to opposite extremes
        for left_name, right_name in left_right_pairs:
            lo_l, hi_l = param_info[left_name]["min"], param_info[left_name]["max"]
            lo_r, hi_r = param_info[right_name]["min"], param_info[right_name]["max"]

            # Alternate which side is at which extreme, at different rates
            phase = math.sin(elapsed * random.uniform(5, 15))
            if phase > 0:
                left_val, right_val = hi_l, lo_r
            else:
                left_val, right_val = lo_l, hi_r

            # Sometimes make them both slam to the same extreme (also uncanny)
            if random.random() < 0.2:
                left_val = right_val = hi_l

            # Overwrite the values for these params
            for pv in param_values:
                if pv["id"] == left_name:
                    pv["value"] = left_val
                elif pv["id"] == right_name:
                    pv["value"] = right_val

        # Send WITHOUT waiting for response (fire-and-forget for speed)
        request = {
            "apiName": "VTubeStudioPublicAPI",
            "apiVersion": "1.0",
            "requestID": str(frame),
            "messageType": "InjectParameterDataRequest",
            "data": {
                "faceFound": True,
                "mode": "set",
                "parameterValues": param_values,
            },
        }
        await ws.send(json.dumps(request))
        # Drain response without blocking
        try:
            await asyncio.wait_for(ws.recv(), timeout=0.005)
        except asyncio.TimeoutError:
            pass

        elapsed += FRAME_INTERVAL
        progress = int((elapsed / DURATION) * 50)
        bar = "=" * progress + " " * (50 - progress)
        print(f"\r  [{bar}] {elapsed:.1f}s / {DURATION:.1f}s", end="", flush=True)

        frame_time = asyncio.get_event_loop().time() - frame_start
        sleep_time = max(0, FRAME_INTERVAL - frame_time)
        await asyncio.sleep(sleep_time)

    print("\nDone!")


async def main():
    print(f"Connecting to VTube Studio at {API_URL}...")
    try:
        async with websockets.connect(API_URL) as ws:
            await authenticate(ws)
            await asyncio.sleep(1)
            await run_random_movements(ws)
    except ConnectionRefusedError:
        print("Could not connect to VTube Studio.")
        print("Make sure VTube Studio is running and the API is enabled:")
        print("  Settings > General Settings > Start API (Port 8004)")
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
