# FoxyJumpscare - Streamer.bot Extension

A ready-to-import Streamer.bot action fired by a 1-second Timed Action. Rolls 1/10,000 each tick — on hit, loads the jumpscare GIF into VTube Studio and plays the sound.

## One-time global variable setup

All Sarxina VTuber Toys share a single global variable pointing at the repo root. If you've already set it up for another toy, skip this section.

1. In Streamer.bot, go to **Servers/Clients** (left sidebar) > **Globals** (or **Variables** depending on version)
2. Under **Persisted Globals**, click **Add**
3. Name: `SARXINA_TOYS`
4. Value: full path to where you cloned this repo (e.g. `C:\Users\you\Documents\Random VTuber Toys`)
5. Save

## Setup

1. Open **Streamer.bot**
2. Make sure VTube Studio integration is connected:
   - **Integrations** (left sidebar) > **VTube Studio**
   - Set the **Port** to match VTube Studio's API port (default `8001`)
   - Click **Connect** — Connection Status should show connected
3. Click **Import** in the top menu bar
4. Paste the contents of [`Import This to Streamerbot`](Import%20This%20to%20Streamerbot) into the import box and click **Import**
5. The action comes with a 1-second Timed Action trigger by default

## Configuration

Edit the constants at the top of the code:

- **`CHANCE_DENOM`** — 1 in N chance per tick (default: `10000`)
- **`ITEM_SIZE`** — VTS item size (0-1, default: `0.5`)
- **`ITEM_DURATION_MS`** — how long the jumpscare stays on screen (default: `1200`)

## Notes

VTube Studio must be running with the API enabled.
