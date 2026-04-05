# FoxyJumpscare

Every second, rolls 1 in 10,000. If it hits, Withered Foxy jumps your model.

That's it. That's the plugin.

## Usage

Just run it and stream. Over a 1-hour stream, that's roughly a 30% chance of seeing it. Good luck.

Available as a **standalone Python script** or a **Streamer.bot extension**.

## Streamer.bot Extension

A C# action driven by a 1-second Timed Action — no separate programs needed. See the [streamerbot/](streamerbot/) folder for setup instructions.

## Standalone (Python)

Connects to VTube Studio and runs the dice-roll loop.

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

## Assets

The `assets/` folder holds:
- `jumpscare_source.mp4` — the original green-screen clip
- `jumpscare.gif` — transparent GIF (green keyed out) shown in VTube Studio
- `jumpscare.wav` — audio track extracted from the video

If you want to tweak the chromakey or swap the video, regenerate the GIF + WAV with ffmpeg:

```
ffmpeg -y -i jumpscare_source.mp4 -vn -acodec pcm_s16le -ar 44100 jumpscare.wav
ffmpeg -y -i jumpscare_source.mp4 -filter_complex "[0:v]chromakey=0x00FF00:0.18:0.05,split[a][b];[a]palettegen=reserve_transparent=1[p];[b][p]paletteuse=alpha_threshold=128" jumpscare.gif
```
