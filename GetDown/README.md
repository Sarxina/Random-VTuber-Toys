# GetDown

VTube Studio plugin that triggers erratic random movement.

![GetDown demo](demo.gif)

## Using with Sarxina Plugin Manager

Install and toggle it on from the Plugins tab. Your model starts flailing immediately. Toggle off to stop.

## Standalone

A Node.js script that connects directly to VTube Studio.

### Setup

1. `cd` into `GetDown/standalone`
2. `npm install`
3. Copy `.env.example` to `.env` and fill in your VTS port if it's not `8004`

### Running

```
npm start
```

VTube Studio will ask you to allow the plugin the first time. Press Ctrl+C to stop.

## Break Model (Advanced)

`break_model.ts` modifies your model's physics file to remove damping and crank all physics values up.

**WARNING:** This edits your model's files directly. It creates a backup automatically, but make sure you understand what it does before running it.

```
npm run break
```

To restore:
```
npm run break -- --restore
```
