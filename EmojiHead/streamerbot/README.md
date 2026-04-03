# EmojiHead - Streamer.bot Extension

## Setup

1. Open **Streamer.bot**
2. Make sure VTube Studio integration is connected:
   - Go to **Integrations** (left sidebar) > **VTube Studio**
   - Set the **Port** to match VTube Studio's API port (default `8004`)
   - Click **Connect**
3. Create a new **Action** called "EmojiHead"
4. In the Sub-Actions panel, right-click > **Core** > **C#** > **Execute C# Code**
5. Paste the contents of `EmojiHead.cs`
6. Click **Compile** — make sure it says "Compiled successfully"
7. Click **Save and Close**
8. Add a trigger (chat command, hotkey, channel point redeem, etc.)

## Usage

This is a toggle. Trigger it once to replace the face with the emote, trigger again to restore.

## Configuration

Edit the constants at the top of the C# code:

- **`PIN_ARTMESH`** — which artmesh to pin the emote to (default: `"FaceColorMain"`)
- **`EMOTE_PATH`** — full path to the emote PNG file (you must update this)
- **`EMOTE_SIZE`** — size of the emote (0-1, default: `0.4`)
- The face hide patterns are in the `Enable()` and `Disable()` methods in the `nameContains` arrays

## Notes

- VTube Studio must be running with the API enabled.
- The first time you trigger it, VTube Studio may ask you to approve loading custom images.
- The emote and face state are stored in global variables (`EmojiHead_Active`, `EmojiHead_ItemID`).
- The emote auto-unloads if Streamer.bot disconnects from VTS.
