# FoxyJumpscare

A VTube Studio plugin where every second, theres a 1 in 10,000 chance Withered Foxy jumpscares you through your model.

## Usage

Available as a **standalone Python script** or a **Streamer.bot extension**.

## Streamer.bot Extension (Easy Mode)

See the [streamerbot/](streamerbot/) folder for setup instructions.

## Standalone App (Python)

### Requirements

- Python 3.8+
- VTube Studio with API enabled
- Windows (uses `winsound`; non-Windows falls back to `ffplay` if installed)

### Setup

1. `cd` into the `FoxyJumpscare/standalone` folder
2. `pip install -r requirements.txt`

### Running It

```
python jumpscare.py
```

Press **Ctrl+C** to stop.

### Configuration

Edit the constants at the top of `jumpscare.py`:

- **`API_URL`** — VTube Studio WebSocket URL (default: `ws://localhost:8001`)
- **`CHANCE_DENOM`** — 1 in N chance per tick (default: `10000`)
- **`TICK_INTERVAL`** — seconds between rolls (default: `1.0`)
- **`ITEM_SIZE`** — VTS item size, 0-1 (default: `1.0` = fullscreen)
- **`ITEM_DURATION`** — seconds to keep the jumpscare on screen (default: `1.2`)
