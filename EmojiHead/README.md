# EmojiHead

Replaces your VTuber model's face with an emote image. Hides the face artmeshes and pins the emote to the head so it tracks with movement.

## Standalone (TypeScript)

Connects to VTube Studio and Twitch chat. Chat sends a command, the face gets replaced.

### Requirements

- Node.js 18+
- VTube Studio with API enabled
- Twitch app credentials (for chat integration)

### Setup

1. `cd` into the `EmojiHead/standalone` folder
2. `npm install`
3. Copy `.env.example` to `.env` and fill in your credentials
4. Put your emote PNG in the `emotes/` folder

### Running It

```
npm start
```

Without Twitch credentials set, it runs in local mode — press Enter to toggle.

With Twitch credentials, it listens for `!emojihead` in chat to toggle.

Press **Ctrl+C** to stop.

### Configuration

Edit `src/config.ts`:

- **`PIN_ARTMESH`** — which artmesh to pin the emote to (default: `"FaceColorMain"`)
- **`DEFAULT_EMOTE_PATH`** — path to the emote image (default: `"./emotes/brainded.png"`)
- **`EMOTE_SIZE`** — size of the emote (0-1, default: `0.4`)
- **`TRIGGER_COMMAND`** — chat command to toggle (default: `"!emojihead"`)
- **`FACE_HIDE_PATTERNS`** — list of artmesh name patterns to hide (see comments in file)

## Streamer.bot Extension

See the [streamerbot/](streamerbot/) folder for setup instructions.
