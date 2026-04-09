# AO3Tagger

Tag your VTuber model with AO3-style tags. Chat sends `!ao3tag <tag>` and the tags pile up on the model's forehead like a real AO3 listing.

![AO3Tagger demo](demo.gif)

## Usage

- `!ao3tag <tag>` — adds a tag to the list (e.g. `!ao3tag Slow Burn`)
- `!ao3tag clear` — removes all tags

Tags accumulate and wrap like real AO3 comma-separated tag lists, rendered in the same font and colors.

Available as a **standalone Python script** or a **Streamer.bot extension**.

## Streamer.bot Extension

A ready-to-import Streamer.bot action. See the [streamerbot/](streamerbot/) folder for setup instructions.

## Standalone (Python)

Connects to VTube Studio directly. Tags are entered via keyboard (no Twitch integration in standalone mode).

### Requirements

- Python 3.8+
- VTube Studio with API enabled

### Setup

1. `cd` into the `AO3Tagger/standalone` folder
2. `pip install -r requirements.txt`

### Running It

```
python ao3tagger.py
```

Type tags and press Enter. Type `clear` to reset. Press **Ctrl+C** to stop.

### Configuration

Edit the constants at the top of `ao3tagger.py`:

- **`API_URL`** — VTube Studio WebSocket URL (default: `ws://localhost:8001`)
- **`FONT_SIZE`** — tag text size in pixels (default: `13`)
- **`MAX_WIDTH`** — max image width before wrapping (default: `500`)
- **`ITEM_SIZE`** — VTS item size, 0-1 (default: `0.32`)
