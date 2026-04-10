# AO3Tagger - Streamer.bot Extension

A ready-to-import Streamer.bot action. Renders AO3-style tags as an image and pins them to your model's forehead.

## Setup

1. Open **Streamer.bot**
2. Make sure VTube Studio integration is connected:
   - **Integrations** (left sidebar) > **VTube Studio**
   - Set the **Port** to match VTube Studio's API port (default `8001`)
   - Click **Connect**
3. Click **Import** in the top menu bar
4. Paste the contents of [`Import This to Streamerbot`](Import%20This%20to%20Streamerbot) into the import box and click **Import**
5. In **VTube Studio → Settings → API → Streamer.bot**, enable **`Allow loading of custom images as items`**.

## Troubleshooting

**Command runs but nothing appears on the model:** Check that **`Allow loading of custom images as items`** is enabled for the Streamer.bot plugin in VTube Studio's API settings. This is the most common cause.

## Configuration

Edit the constants at the top of the code:

- **`FONT_SIZE`** — tag text size in pixels (default: `13`)
- **`MAX_WIDTH`** — max image width before wrapping (default: `500`)
- **`ITEM_SIZE`** — VTS item size (0-1, default: `0.42`)

## Notes

VTube Studio must be running with the API enabled.
