# GetDown - Streamer.bot Extension

## Setup

1. Open **Streamer.bot**
2. Make sure VTube Studio integration is connected:
   - Go to **Integrations** (left sidebar) > **VTube Studio**
   - Set the **Port** to match VTube Studio's API port (default `8004`)
   - Click **Connect** — Connection Status should show connected
3. Click **Import** in the top menu bar
4. Copy the contents of [`Import This to Streamerbot`](Import%20This%20to%20Streamerbot) and paste into the import box, then click **Import**
5. The action comes with an **F5** hotkey trigger by default — you can change this to whatever you want (chat command, channel point redeem, etc.)

## Usage

This is a toggle. Trigger it once to start, trigger it again to stop. Bind it to a single command/redeem/hotkey and it handles both states.

**Important:** Put this action in its own action queue. While running, it blocks the queue it's in — other actions in the same queue won't run until it stops.

## Configuration

Edit the constants inside the `Execute()` method:

- `fps` — frames per second (default: 20)
- Parameter names and ranges can be adjusted in the `paramNames`, `paramMin`, and `paramMax` arrays

## Notes

VTube Studio must be running with the API enabled.
