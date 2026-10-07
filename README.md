# P2PLovers — Electron Host

Native macOS Host application for the P2PLovers screen sharing platform. Runs as a standalone Electron app that captures screen + system audio and streams it peer-to-peer via WebRTC to a remote Viewer.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        MONOREPO                             │
│                  video-trlanslator/                         │
│                                                             │
│  ┌──────────────────┐   WebRTC (P2P)   ┌─────────────────┐ │
│  │    P2PLovers     │ ◄──────────────► │   frontend/     │ │
│  │  (this package)  │                  │  (React Viewer) │ │
│  │                  │                  └─────────────────┘ │
│  │  Electron + Vite │         ▲                 ▲          │
│  │  React + NutJS   │         │   Socket.io     │          │
│  └──────────────────┘         │   signaling     │          │
│                               ▼                 │          │
│                    ┌─────────────────┐          │          │
│                    │    backend/     │──────────┘          │
│                    │  Node.js +      │                      │
│                    │  Socket.io      │                      │
│                    │  (Render.com)   │                      │
│                    └─────────────────┘                      │
└─────────────────────────────────────────────────────────────┘
```

### Components

| Package | Role | Deploy |
|---|---|---|
| `P2PLovers` | Native macOS app — captures screen, relays inputs | Distributed as `.dmg` |
| `backend/` | WebRTC signaling server (Socket.io) | [Render.com](https://render.com) |
| `frontend/` | Web Viewer — watches stream, sends inputs | Vercel |

---

## P2PLovers — Internal Structure

```
src/
├── main/
│   └── index.ts          # Main process: BrowserWindow, IPC handlers,
│                         # NutJS (mouse/keyboard), overlay subprocess,
│                         # getDisplayMedia permissions
├── preload/
│   └── index.ts          # Secure bridge between main ↔ renderer (contextBridge)
└── renderer/src/
    ├── pages/
    │   ├── Home.tsx       # Password entry / room join
    │   ├── Host.tsx       # Screen capture, WebRTC offer, remote input relay
    │   ├── Viewer.tsx     # WebRTC answer, mic boost pipeline, stats HUD
    │   └── Widget.tsx     # Floating mic-control overlay (Python subprocess)
    ├── hooks/
    │   └── useAudioVolume.ts  # Mic volume analyser (speaking indicator)
    ├── config.ts          # Runtime env vars (SERVER_URL, VIEWER_URL)
    └── App.tsx            # Router
```

### Audio Pipeline (Viewer → Host)

```
getUserMedia()
    │  (raw mic, autoGainControl=false)
    ▼
AudioContext
    ├─ GainNode (×2.0)          ← volume boost
    └─ DynamicsCompressor       ← -24dB threshold, 4:1 ratio, soft knee
           │
           ▼
    MediaStreamDestination
           │
    ┌──────┴─────────────────┐
    │  addTrack() → WebRTC   │  ← what the Host receives
    └────────────────────────┘
           │
    useAudioVolume()           ← same boosted stream → speaking indicator
```

---

## Environment Variables

Copy `.env.example` → `.env` and fill in:

```env
VITE_SERVER_URL=https://your-backend.onrender.com   # Socket.io signaling server
VITE_ACCESS_PASSWORD=your_secure_password_here       # Room access password
VITE_VIEWER_URL=https://your-frontend.vercel.app     # Viewer web app URL
```

---

## Requirements

- **macOS** (primary target; Windows/Linux experimental)
- **Node.js** v18+
- **Python 3** — for the native overlay widget
- **Xcode Command Line Tools** — required to build NutJS native bindings

---

## Setup & Run

```bash
# 1. Install dependencies (also rebuilds native modules via postinstall)
npm install

# 2. Development mode (hot reload)
npm run dev

# 3. Type check only
npm run typecheck

# 4. Production build (typecheck → vite build)
npm run build

# 5. Package as .dmg for macOS distribution
npm run build:mac
```

Build output:
- `out/` — compiled JS bundles (main, preload, renderer)
- `dist/` — packaged `.dmg` installer

---

## Deployment

### Backend (Render.com)

Defined in `render.yaml` at the monorepo root:

```yaml
services:
  - type: web
    name: screenshare-backend
    runtime: node
    rootDir: backend
    buildCommand: npm install && npm run build
    startCommand: node dist/server.js
    envVars:
      - key: CLIENT_ORIGIN      # Vercel frontend URL (for CORS)
      - key: NODE_ENV
        value: production
```

### Frontend (Vercel)

Deploy the `frontend/` directory. Set env vars:
```env
VITE_SERVER_URL=https://screenshare-backend.onrender.com
VITE_ACCESS_PASSWORD=...
```

### Electron Host (manual)

1. Build: `npm run build:mac` → produces `dist/p2p-lovers-1.0.0.dmg`
2. Transfer to target Mac (zip before transfer to avoid Gatekeeper issues)
3. After extracting on target Mac:
   ```bash
   xattr -cr /Applications/P2PLovers.app
   ```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop shell | Electron 39 |
| Bundler | electron-vite + Vite 7 |
| UI | React 19 + TypeScript |
| Styling | Tailwind CSS 4 |
| Screen capture | `desktopCapturer` + `getDisplayMedia` |
| Remote input | `@nut-tree-fork/nut-js` (NutJS) |
| P2P streaming | WebRTC (`RTCPeerConnection`) |
| Signaling | Socket.io 4 |
| Audio processing | Web Audio API (`GainNode`, `DynamicsCompressor`) |
| Native overlay | Python 3 subprocess (macOS-native widget) |
