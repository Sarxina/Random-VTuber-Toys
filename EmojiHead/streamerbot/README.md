# EmojiHead - Streamer.bot Extension

## Setup

1. Open **Streamer.bot**
2. Make sure VTube Studio integration is connected:
   - Go to **Integrations** (left sidebar) > **VTube Studio**
   - Set the **Port** to match VTube Studio's API port (default `8004`)
   - Click **Connect** — Connection Status should show connected
3. Click **Import** in the top menu bar
4. Paste the import string below into the import box and click **Import**
5. The action comes with a `!emojihead` chat command trigger by default

## Import String

Copy the contents of [`Import This to Streamerbot`](Import%20This%20to%20Streamerbot) and paste it into Streamer.bot's Import dialog.

## Manual Setup (if import doesn't work)

1. Create a new **Action** called "EmojiHead"
2. In the Sub-Actions panel, right-click > **Core** > **C#** > **Execute C# Code**
3. Paste the contents of `EmojiHead.cs`
4. Click **Compile** — make sure it says "Compiled successfully"
5. Click **Save and Close**
6. Add a trigger — set it to fire on chat messages so emotes can be parsed

## Usage

Send `!emojihead` followed by a Twitch emote in chat. The emote replaces the model's face.

- `!emojihead <emote>` — replaces the face with that emote (or swaps to a new one if already active)
- `!emojihead off` — restores the face

The plugin automatically detects face artmeshes (eyes, nose, mouth, etc.) and hides them while keeping hair, ears, and accessories visible.

## Configuration

Edit the constants at the top of the C# code:

- **`EMOTE_SIZE`** — size of the emote (0-1, default: `0.62`)

## Notes

- VTube Studio must be running with the API enabled.
- The first time you trigger it, VTube Studio may ask you to approve loading custom images — click Allow.
- EmojiHead guesses which artmeshes are "face" based on common naming patterns (e.g. names containing "face", "eye", "mouth", "nose", etc.). If your model uses unusual mesh names, some parts may not be hidden correctly. You can adjust the patterns in `FindFaceMeshes()` and `FindPinMesh()` in the C# code.
- The emote and face state are stored in global variables (`EmojiHead_Active`, `EmojiHead_ItemID`, `EmojiHead_FaceMesh`). If something goes wrong, you can manually clear these in Streamer.bot under Global Variables > Non-Persisted Globals.
- The emote auto-unloads if Streamer.bot disconnects from VTS.
