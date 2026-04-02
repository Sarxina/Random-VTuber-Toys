# GetDown - Streamer.bot Extension

## Setup

1. Open **Streamer.bot**
2. Make sure VTube Studio integration is connected:
   - Go to **Integrations** (left sidebar) > **VTube Studio**
   - Set the **Port** to match VTube Studio's API port (default `8004`)
   - Click **Connect** — Connection Status should show connected
3. Click **Import** in the top menu bar
4. Paste the import string below into the import box and click **Import**
5. The action comes with an **F5** hotkey trigger by default — you can change this to whatever you want (chat command, channel point redeem, etc.)

## Import String

Copy the contents of [`import.txt`](import.txt) and paste it into Streamer.bot's Import dialog.

## Manual Setup (if import doesn't work)

1. Create a new **Action** called "GetDown"
2. In the Sub-Actions panel, right-click > **Core** > **C#** > **Execute C# Code**
3. Paste the contents of `RandomMovement.cs`
4. Click **Compile** — make sure it says "Compiled successfully"
5. Click **Save and Close**
6. Add a trigger (right-click in the Triggers panel > Add > Core > Inputs > Hotkey, or a chat command, etc.)

## Usage

This is a toggle. Trigger it once to start, trigger it again to stop. Bind it to a single command/redeem/hotkey and it handles both states.

**Important:** Put this action in its own action queue. While running, it blocks the queue it's in — other actions in the same queue won't run until it stops.

## Configuration

Edit the constants inside the `Execute()` method:

- `fps` — frames per second (default: 20)
- Parameter names and ranges can be adjusted in the `paramNames`, `paramMin`, and `paramMax` arrays

## Notes

- VTube Studio must be running with the API enabled.
- Streamer.bot handles VTube Studio authentication automatically.
- The toggle state is stored in a global variable (`GetDown_Active`). If something goes wrong and it gets stuck, you can manually set that variable to `false` in Streamer.bot under Global Variables > Non-Persisted Globals.
