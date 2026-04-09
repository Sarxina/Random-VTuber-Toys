# EmojiHead - Streamer.bot Extension

## Setup

1. Open **Streamer.bot**
2. Make sure VTube Studio integration is connected:
   - Go to **Integrations** (left sidebar) > **VTube Studio**
   - Set the **Port** to match VTube Studio's API port (default `8004`)
   - Click **Connect** — Connection Status should show connected
3. Click **Import** in the top menu bar
4. Copy the contents of [`Import This to Streamerbot`](Import%20This%20to%20Streamerbot) and paste into the import box, then click **Import**
5. The action comes with a `!emojihead` chat command trigger by default

## Usage

Send `!emojihead` followed by a Twitch emote in chat. The emote replaces the model's face.

- `!emojihead <emote>` — replaces the face with that emote (or swaps to a new one if already active)
- `!emojihead off` — restores the face

The plugin automatically detects face artmeshes (eyes, nose, mouth, etc.) and hides them while keeping hair, ears, and accessories visible.

## Configuration

Edit the constants at the top of the code:

- **`EMOTE_SIZE`** — size of the emote (0-1, default: `0.62`)

## Notes

VTube Studio must be running with the API enabled.
