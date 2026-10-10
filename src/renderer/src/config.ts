export const SERVER_URL =
  import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3001';
export const ACCESS_PASSWORD = import.meta.env.VITE_ACCESS_PASSWORD ?? '';

export const STUN_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  // Open Relay / Free TURN
  {
    urls: 'turn:openrelay.metered.ca:80',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
  {
    urls: 'turn:openrelay.metered.ca:443',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  }
];

/** Target start bitrate for video sender (bits/s) */
export const VIDEO_START_BITRATE = 6_000_000;   // 6 Mbps
export const VIDEO_MAX_BITRATE   = 12_000_000;  // 12 Mbps
