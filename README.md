# Screenshare Electron Host

This is the native macOS Host application for the Video Translator & Screen Share platform. It runs as a background process using Electron, capturing the screen and system audio, and sharing it securely via WebRTC.

## Key Features

- **Screen & Audio Capture**: High-quality WebRTC streaming (`getDisplayMedia`).
- **Remote Control**: Uses NutJS to simulate mouse movements, clicks, scrolling, and keyboard events forwarded from the Viewer.
- **Native macOS Overlay**: Spawns a Python script via `subprocess` to display a native translucent microphone control widget on top of all windows.
- **Microphone Sync**: Connects WebRTC audio tracks natively and toggles them seamlessly.

## Requirements

- macOS
- Node.js (v18+)
- Python 3 (for the native overlay script)
- Xcode Command Line Tools (for building native dependencies like NutJS)

## Setup & Run

1. Install dependencies:
   ```bash
   npm install
   ```

2. Run in development mode:
   ```bash
   npm run dev
   ```

3. Build for macOS (produces `.dmg` inside `dist/`):
   ```bash
   npm run build:mac
   ```

### Troubleshooting Gatekeeper

If the `.dmg` or `.app` shows a "File is damaged" error on another Mac (due to Apple Gatekeeper quarantining unsigned apps downloaded from the internet):
1. Zip the `.dmg` before transferring.
2. After extracting on the target Mac, run this in Terminal:
   ```bash
   xattr -cr /Path/To/App.app
   ```
