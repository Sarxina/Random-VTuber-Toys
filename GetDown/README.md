# GetDown

Generates chaotic random movements for VTuber models in VTube Studio. Every parameter on your model gets randomized every frame — face, eyes, mouth, body, everything.

## Options

### Standalone (Python)

A Python script that connects directly to VTube Studio's API. Run it, watch the chaos.

**Requirements:** Python 3.8+, VTube Studio with API enabled

```bash
cd standalone
pip install -r requirements.txt
python random_movement.py
```

### Streamer.bot Extension

A C# action for Streamer.bot that does the same thing — no separate program needed. Import it and bind to a hotkey, channel point redeem, or chat command.

See [`streamerbot/`](streamerbot/) for setup instructions.

**Requirements:** Streamer.bot with VTube Studio integration connected

## Configuration

Both versions support adjusting:
- **Duration** — how long the chaos lasts
- **FPS** — how fast parameters update
- **Parameter ranges** — which parameters to randomize and how far
