# Random Movement Generator - Streamer.bot Extension

## Setup

1. Open **Streamer.bot**
2. Make sure VTube Studio integration is connected (Settings > Integrations > VTube Studio)
3. Click **Import** in the top menu
4. Drag and drop the `.sb` file, or paste the import string from below
5. Assign a trigger (hotkey, channel point redeem, chat command, etc.)

## Import String

> TODO: Export from Streamer.bot after creating the action

## Manual Setup (if import doesn't work)

1. Create a new **Action** called "Random Movement"
2. Add a **Sub-Action** > **Core** > **C#** > **Execute C# Code**
3. Paste the contents of `RandomMovement.cs`
4. Compile and save
5. Assign a trigger

## Configuration

Edit the constants at the top of the C# code:

- `FPS` — frames per second (default: 30)
- `DURATION_MS` — how long the chaos lasts in milliseconds (default: 5000)
- Parameter ranges can be adjusted in the `Params` array

## Notes

- This blocks the action queue for the duration (5 seconds). Put it in its own queue if you need other actions to run simultaneously.
- VTube Studio must be running with the API enabled.
- Streamer.bot handles authentication automatically.
