import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { io, Socket } from 'socket.io-client';
import { navigate } from '../App';
import { HostHud } from '../components/host/HostHud';
import { SERVER_URL, STUN_SERVERS, VIDEO_MAX_BITRATE, VIDEO_START_BITRATE, ACCESS_PASSWORD } from '../config';
import { useAudioVolume } from '../hooks/useAudioVolume';

type Status = 'init' | 'waiting' | 'connected' | 'viewer_left' | 'error' | 'stopped';

function preferVP9(sdp: string): string {
  const match = sdp.match(/a=rtpmap:(\d+) VP9/);
  if (!match) return sdp;
  const pt = match[1];
  return sdp.replace(/m=video (\S+ \S+ )(.+)/, (_m, prefix, pts) => {
    const list = pts.split(' ').filter((p: string) => p !== pt);
    return `m=video ${prefix}${pt} ${list.join(' ')}`;
  });
}

async function applyBitrate(pc: RTCPeerConnection, start: number, max: number) {
  const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
  if (!sender) return;
  const params = sender.getParameters();
  if (!params.encodings?.length) params.encodings = [{}];
  params.encodings[0].maxBitrate = max;
  params.encodings[0].maxFramerate = 60;
  (params.encodings[0] as Record<string, unknown>)['startBitrate'] = start;
  await sender.setParameters(params);
}

const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  },
  video: false,
};

export default function Host() {
  const viewerJoinedRef = useRef(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const viewerAudioRef = useRef<HTMLAudioElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const socketRef = useRef<Socket | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const micSenderRef = useRef<RTCRtpSender | null>(null);

  const [status, setStatus] = useState<Status>('init');
  const [sharing, setSharing] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [shareLink, setShareLink] = useState('');
  const tokenRef = useRef<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pipWindow, setPipWindow] = useState<Window | null>(null);

  // Permission Controls
  const [allowMouse, setAllowMouseState] = useState(true);
  const allowMouseRef = useRef(true);
  const setAllowMouse = useCallback((val: boolean | ((prev: boolean) => boolean)) => {
    setAllowMouseState(prev => {
      const newVal = typeof val === 'function' ? val(prev) : val;
      allowMouseRef.current = newVal;
      return newVal;
    });
  }, []);

  const [allowKeyboard, setAllowKeyboardState] = useState(false);
  const allowKeyboardRef = useRef(false);
  const setAllowKeyboard = useCallback((val: boolean | ((prev: boolean) => boolean)) => {
    setAllowKeyboardState(prev => {
      const newVal = typeof val === 'function' ? val(prev) : val;
      allowKeyboardRef.current = newVal;
      return newVal;
    });
  }, []);

  const togglePip = useCallback(async () => {
    if (pipWindow) {
      pipWindow.close();
      return;
    }

    // Check if Document PiP is supported (Chrome/Edge)
    if ('documentPictureInPicture' in window) {
      try {
        const pipWin = await (window as any).documentPictureInPicture.requestWindow({ width: 340, height: 280 });
        [...document.styleSheets].forEach((styleSheet) => {
          try {
            const cssRules = [...styleSheet.cssRules].map((rule) => rule.cssText).join('');
            const style = document.createElement('style');
            style.textContent = cssRules;
            pipWin.document.head.appendChild(style);
          } catch (e) {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.type = styleSheet.type;
            link.media = styleSheet.media.mediaText;
            if (styleSheet.href) link.href = styleSheet.href;
            pipWin.document.head.appendChild(link);
          }
        });
        pipWin.document.body.className = 'bg-[#09090f] text-white overflow-hidden p-5 flex flex-col gap-4 font-sans';
        pipWin.addEventListener('pagehide', () => setPipWindow(null));
        setPipWindow(pipWin);
      } catch (e) {
        console.error('Document PiP error:', e);
      }
    }
    // Fallback to standard Video PiP (Firefox, Safari)
    else if (document.pictureInPictureEnabled && videoRef.current) {
      try {
        if (document.pictureInPictureElement) {
          await document.exitPictureInPicture();
        } else {
          await videoRef.current.requestPictureInPicture();
        }
      } catch (e) {
        console.error('Video PiP error:', e);
      }
    }
    else {
      alert('Ваш браузер не підтримує жоден з форматів Міні-вікна (PiP).');
    }
  }, [pipWindow]);

  const [error, setError] = useState('');
  const [fps, setFps] = useState(0);
  const [kbps, setKbps] = useState(0);

  // Expose local mic stream to state for volume hook
  const [localMicStream, setLocalMicStream] = useState<MediaStream | null>(null);
  const [isViewerMuted, setIsViewerMuted] = useState(false);

  // Audio analyzer for Host's own microphone
  const isHostSpeaking = useAudioVolume({ stream: localMicStream, threshold: 12 });

  // Expose remote viewer mic stream to state for volume hook
  const [remoteMicStream, setRemoteMicStream] = useState<MediaStream | null>(null);
  const isViewerSpeaking = useAudioVolume({ stream: remoteMicStream, threshold: 12 });

  // Web Audio API refs for volume boosting
  const audioCtxRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);

  // ── Boost Viewer Volume (Підсилення звуку Глядача) ─────────────────────
  useEffect(() => {
    if (!remoteMicStream) return;

    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }

    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume();
    }

    const ctx = audioCtxRef.current;
    gainNodeRef.current = ctx.createGain();
    gainNodeRef.current.gain.value = isViewerMuted ? 0 : 1.8; // 180% boost!

    sourceNodeRef.current = ctx.createMediaStreamSource(remoteMicStream);
    sourceNodeRef.current.connect(gainNodeRef.current);
    gainNodeRef.current.connect(ctx.destination);

    return () => {
      sourceNodeRef.current?.disconnect();
      gainNodeRef.current?.disconnect();
    };
  }, [remoteMicStream]);

  const stopSharing = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    pcRef.current?.close();
    pcRef.current = null;
    setSharing(false);
    setStatus('stopped');
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  // Handle Widget Actions moved below handleToggleMic

  // Manage Widget Window lifecycle
  useEffect(() => {
    if (status === 'connected' || status === 'waiting') {
      // @ts-ignore
      window.electron?.ipcRenderer.send('create-widget');
    } else {
      // @ts-ignore
      window.electron?.ipcRenderer.send('close-widget');
    }
  }, [status]);

  // Sync current state to Widget so it reflects mic/mouse/keyboard toggles
  useEffect(() => {
    if (status === 'connected') {
      // @ts-ignore
      window.electron?.ipcRenderer.send('widget-state-update', {
        micOn, allowMouse, allowKeyboard, sharing,
      });
    }
  }, [status, micOn, allowMouse, allowKeyboard, sharing]);

  // Handle Mute state change for the boosted audio
  useEffect(() => {
    if (gainNodeRef.current) {
      // Smoothly transition volume to avoid popping sounds
      gainNodeRef.current.gain.setTargetAtTime(isViewerMuted ? 0 : 1.8, audioCtxRef.current!.currentTime, 0.1);
    }
  }, [isViewerMuted]);

  // ── Stats ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (status !== 'connected') return;
    let lastBytes = 0;
    const id = setInterval(async () => {
      const stats = await pcRef.current?.getStats();
      stats?.forEach((r) => {
        if (r.type === 'outbound-rtp' && r.kind === 'video') {
          const bytes = (r as RTCOutboundRtpStreamStats).bytesSent ?? 0;
          const fr = (r as RTCOutboundRtpStreamStats & { framesPerSecond?: number }).framesPerSecond;
          setKbps(Math.round(((bytes - lastBytes) * 8) / 1000));
          lastBytes = bytes;
          if (fr) setFps(Math.round(fr));
        }
      });
    }, 1000);
    return () => clearInterval(id);
  }, [status]);

  async function startOffer(socket: Socket) {
    if (!streamRef.current) return;

    if (pcRef.current) {
      pcRef.current.close();
    }
    const pc = new RTCPeerConnection({ iceServers: STUN_SERVERS });
    pcRef.current = pc;

    // DataChannel for remote control
    const controlChannel = pc.createDataChannel('control');
    controlChannel.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.action === 'mouse-move') {
          // @ts-ignore
          if (allowMouseRef.current) window.electron?.ipcRenderer.send('mouse-move', data.payload);
        } else if (data.action === 'mouse-click') {
          // @ts-ignore
          if (allowMouseRef.current) window.electron?.ipcRenderer.send('mouse-click', data.payload);
        } else if (data.action === 'scroll') {
          // @ts-ignore
          if (allowMouseRef.current) window.electron?.ipcRenderer.send('scroll', data.payload);
        } else if (data.action === 'keyboard' && allowKeyboardRef.current) {
          // @ts-ignore
          window.electron?.ipcRenderer.send('keyboard', data.payload);
        }
      } catch (e) {
        console.error('DataChannel error:', e);
      }
    };

    streamRef.current.getTracks().forEach((t) => pc.addTrack(t, streamRef.current!));

    if (micStreamRef.current) {
      const micTrack = micStreamRef.current.getAudioTracks()[0];
      if (micTrack) micSenderRef.current = pc.addTrack(micTrack, micStreamRef.current);
    }

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) socket.emit('ice_candidate', { candidate });
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        setStatus('viewer_left');
        setRemoteMicStream(null);
      }
    };

    pc.ontrack = ({ track }) => {
      if (track.kind === 'audio' && viewerAudioRef.current) {
        const stream = new MediaStream([track]);
        viewerAudioRef.current.srcObject = stream;
        viewerAudioRef.current.play().catch(() => { });
        setRemoteMicStream(stream);
      }
    };

    const offer = await pc.createOffer();
    const sdp = preferVP9(offer.sdp ?? '');
    await pc.setLocalDescription({ type: 'offer', sdp });
    socket.emit('offer', { sdp: pc.localDescription });
  }

  // ── Socket setup ───────────────────────────────────────────────────────
  useEffect(() => {
    const pwd = ACCESS_PASSWORD || sessionStorage.getItem('app_password');
    const socket: Socket = io(SERVER_URL, {
      transports: ['websocket'],
      auth: { password: pwd }
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      if (tokenRef.current) {
        socket.emit('rejoin_room_as_host', { token: tokenRef.current });
      } else {
        socket.emit('create_room');
      }
    });

    socket.on('room_created', ({ token }: { token: string }) => {
      tokenRef.current = token;
      const viewerBase = import.meta.env.VITE_VIEWER_URL ?? window.location.origin;
      setShareLink(`${viewerBase}/?page=viewer&token=${token}`);
      setStatus('waiting');
    });

    socket.on('viewer_joined', async () => {
      viewerJoinedRef.current = true;
      setStatus('connected');
      if (streamRef.current) await startOffer(socket);
    });

    socket.on('answer', async ({ sdp }: { sdp: RTCSessionDescriptionInit }) => {
      await pcRef.current?.setRemoteDescription(sdp);
      await applyBitrate(pcRef.current!, VIDEO_START_BITRATE, VIDEO_MAX_BITRATE);
    });

    socket.on('ice_candidate', async ({ candidate }: { candidate: RTCIceCandidateInit }) => {
      await pcRef.current?.addIceCandidate(candidate);
    });

    socket.on('viewer_offer', async ({ sdp }: { sdp: RTCSessionDescriptionInit }) => {
      if (!pcRef.current) return;
      await pcRef.current.setRemoteDescription(sdp);
      const answer = await pcRef.current.createAnswer();
      await pcRef.current.setLocalDescription(answer);
      socket.emit('host_answer', { sdp: pcRef.current.localDescription });
    });

    socket.on('viewer_left', () => {
      viewerJoinedRef.current = false;
      setStatus('viewer_left');
      setRemoteMicStream(null);
    });

    socket.on('connect_error', (err) => {
      setError(`Помилка підключення: ${err.message}`);
      setStatus('error');
    });

    return () => {
      socketRef.current?.disconnect();
      stopSharing();
    };
  }, [stopSharing]);

  // ── Screen share ───────────────────────────────────────────────────────
  const handleStartShare = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { 
          frameRate: { ideal: 60, max: 60 },
          // @ts-ignore
          resizeMode: 'none',
        },
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      streamRef.current = stream;

      if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.muted = true; }
      stream.getVideoTracks()[0].onended = stopSharing;
      stream.getVideoTracks()[0].contentHint = 'motion'; // Prioritize framerate for WebRTC
      setSharing(true);
      setStatus(viewerJoinedRef.current ? 'connected' : 'waiting');

      if (viewerJoinedRef.current) await startOffer(socketRef.current!);
    } catch (err) {
      if ((err as { name?: string }).name !== 'NotAllowedError') setError('Не вдалося захопити екран.');
    }
  }, [stopSharing]);

  // ── Mic toggle ────────────────────────────────────────────────────────
  const handleToggleMic = useCallback(async () => {
    if (micOn) {
      if (micStreamRef.current) {
        micStreamRef.current.getAudioTracks().forEach(t => t.enabled = false);
      }
      setMicOn(false);
    } else {
      setError('');
      if (micStreamRef.current) {
        micStreamRef.current.getAudioTracks().forEach(t => t.enabled = true);
        setMicOn(true);
      } else {
        try {
          const micStream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
          micStreamRef.current = micStream;
          setLocalMicStream(micStream);
          const micTrack = micStream.getAudioTracks()[0];

          if (pcRef.current) {
            micSenderRef.current = pcRef.current.addTrack(micTrack, micStream);
            const offer = await pcRef.current.createOffer();
            await pcRef.current.setLocalDescription(offer);
            socketRef.current?.emit('offer', { sdp: pcRef.current.localDescription });
          }
          setMicOn(true);
        } catch {
          setError('Немає доступу до мікрофона.');
        }
      }
    }
  }, [micOn]);

  // Handle Widget Actions
  useEffect(() => {
    // @ts-ignore
    const handleWidgetAction = (_, payload) => {
      if (!payload) return;
      if (payload.action === 'stop') {
        stopSharing();
      } else if (payload.action === 'toggle-mouse') {
        setAllowMouse((prev: boolean) => !prev);
      } else if (payload.action === 'toggle-keyboard') {
        setAllowKeyboard((prev: boolean) => !prev);
      } else if (payload.action === 'toggle-mic') {
        handleToggleMic();
      }
    };
    // @ts-ignore
    if (window.electron && window.electron.ipcRenderer) {
      // @ts-ignore
      window.electron.ipcRenderer.removeAllListeners('widget-action');
      // @ts-ignore
      window.electron.ipcRenderer.on('widget-action', handleWidgetAction);

      return () => {
        // @ts-ignore
        window.electron.ipcRenderer.removeAllListeners('widget-action');
      };
    }
    return undefined;
  }, [stopSharing, handleToggleMic]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(shareLink).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 2000);
    });
  }, [shareLink]);

  const sc = {
    init: { label: 'Підключення...', dot: 'bg-white/30', text: 'text-white/40' },
    waiting: { label: 'Очікування глядача', dot: 'bg-amber-400', text: 'text-amber-400' },
    connected: { label: 'Глядач підключений', dot: 'bg-emerald-400', text: 'text-emerald-400' },
    viewer_left: { label: 'Глядач відключився', dot: 'bg-white/40', text: 'text-white/40' },
    error: { label: 'Помилка', dot: 'bg-red-400', text: 'text-red-400' },
    stopped: { label: 'Зупинено', dot: 'bg-white/40', text: 'text-white/40' },
  }[status] || { label: 'Зупинено', dot: 'bg-white/40', text: 'text-white/40' };

  const hudProps = {
    micOn,
    status,
    remoteMicStream,
    isHostSpeaking,
    isViewerSpeaking,
    isViewerMuted,
    setIsViewerMuted,
    handleToggleMic,
    fps,
    kbps,
    sharing,
    handleStartShare,
    stopSharing,
    allowMouse,
    setAllowMouse,
    allowKeyboard,
    setAllowKeyboard,
  };

  return (
    <div className="relative z-10 min-h-screen flex flex-col items-center justify-center p-6 gap-5 mac-drag-region">
      {/* We mute the audio element because we are playing it via Web Audio API GainNode instead */}
      <audio ref={viewerAudioRef} autoPlay playsInline muted={true} />

      {/* Auto-hiding Top Header (Settings & Permissions) when waiting or connected */}
      {(status === 'connected' || status === 'waiting' || status === 'viewer_left') && !pipWindow && (
        <div className="absolute top-0 inset-x-0 z-50 h-24 group no-drag">
          <div className="absolute top-0 inset-x-0 transform -translate-y-full opacity-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all duration-300 ease-out pt-6 px-4 flex justify-center">
            <div className="w-full max-w-3xl glass rounded-2xl shadow-2xl overflow-hidden border border-white/20">
              <HostHud {...hudProps} />
            </div>
          </div>
          {/* Hover hit area visual hint ALWAYS visible when header is hidden */}
          <div className="absolute top-0 inset-x-0 h-4 flex justify-center items-start opacity-30 group-hover:opacity-0 transition-opacity">
            <div className="w-20 h-1 rounded-b-md bg-white/50 shadow-md" />
          </div>
        </div>
      )}

      <div className={`glass rounded-2xl p-6 md:p-8 w-full max-w-xl page-enter space-y-6 no-drag ${status === 'connected' ? 'opacity-30 hover:opacity-100 transition-opacity' : ''}`}>

        {/* Header */}
        <div className="flex flex-col relative gap-1">
          <h2 className="text-xl font-bold tracking-tight">🖥 Трансляція хоста</h2>
          <span className={`flex items-center gap-2 text-sm font-medium ${sc.text}`}>
            <span className={`w-2 h-2 rounded-full ${sc.dot} pulse-dot`} />
            {sc.label}
          </span>
        </div>

        {/* Share link & Code */}
        {shareLink && (
          <div className="space-y-4">
            <div>
              <p className="text-xs uppercase tracking-widest text-white/40 font-semibold mb-2">Код для підключення</p>
              <div className="flex items-center gap-2 px-4 py-3 bg-white/5 border border-white/10 rounded-xl shadow-inner">
                <span className="flex-1 text-emerald-400 text-lg font-mono text-center tracking-widest font-bold">{shareLink.split('token=')[1]}</span>
                <button onClick={() => {
                  navigator.clipboard.writeText(shareLink.split('token=')[1]).then(() => {
                    setCopied(true); setTimeout(() => setCopied(false), 2000);
                  });
                }} className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-all cursor-pointer">
                  {copied
                    ? <svg className="w-4 h-4 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    : <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></svg>
                  }
                </button>
              </div>
            </div>

            <div>
              <p className="text-xs uppercase tracking-widest text-white/40 font-semibold mb-2">Або повне посилання</p>
              <div className="flex items-center gap-2 px-4 py-3 bg-white/5 border border-white/10 rounded-xl shadow-inner opacity-75 hover:opacity-100 transition-opacity">
                <span className="flex-1 text-violet-300 text-sm font-mono truncate">{shareLink}</span>
                <button onClick={handleCopy} className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-all cursor-pointer">
                  {copied
                    ? <svg className="w-4 h-4 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    : <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></svg>
                  }
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Start Share button in main card (since top menu auto-hides) */}
        {!sharing && (
          <button onClick={handleStartShare} disabled={status === 'init' || status === 'error'}
            className="w-full py-3 px-6 rounded-xl bg-gradient-to-r from-violet-600 to-purple-500
              text-white font-semibold text-sm cursor-pointer shadow-lg
              hover:shadow-violet-500/50 hover:-translate-y-0.5
              active:scale-95 transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed">
            ▶ Почати трансляцію
          </button>
        )}

        {/* Preview */}
        <div className="relative w-full aspect-video bg-black rounded-2xl overflow-hidden shadow-2xl ring-1 ring-white/10 group">
          <video ref={videoRef} id="host-video" autoPlay playsInline muted className="w-full h-full object-cover" />

          {!sharing && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white/30 bg-black/40">
              <svg className="w-12 h-12 opacity-50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" />
              </svg>
              <span className="text-sm font-medium">Екран не транслюється</span>
            </div>
          )}
        </div>

        {/* PiP Button */}
        {(status === 'connected' || status === 'waiting') && (
          <button onClick={togglePip} className="w-full flex items-center justify-center gap-2 py-3 mb-2 bg-blue-500/20 text-blue-300 rounded-xl text-sm font-medium hover:bg-blue-500/30 transition-all cursor-pointer border border-blue-500/20 shadow-lg hidden">
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><rect x="12" y="12" width="7" height="5"></rect></svg>
            {pipWindow ? 'Закрити міні-вікно' : 'Відкрити міні-вікно (PiP)'}
          </button>
        )}

        {pipWindow && createPortal(<HostHud {...hudProps} />, pipWindow.document.body)}

        {error && (
          <div className="flex flex-col gap-3 px-4 py-3 bg-red-500/10 border border-red-500/25 rounded-xl text-red-400 text-sm">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
              {error}
            </div>
            <button onClick={() => window.location.reload()} 
              className="px-4 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-200 rounded-lg text-sm font-medium transition-all active:scale-95 border border-red-500/20 w-fit">
              Перезапустити трансляцію
            </button>
          </div>
        )}
      </div>
      <button onClick={() => { stopSharing(); navigate('?page=home'); }}
        className="absolute top-6 left-6 z-50 flex items-center gap-1.5 px-3 py-1.5 bg-white/10 hover:bg-white/20 transition-colors rounded-xl text-white/90 text-xs font-medium border border-white/20 backdrop-blur-md cursor-pointer active:scale-95 shadow-xl">
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M19 12H5M12 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" /></svg>
        На головну
      </button>
    </div>
  );
}
