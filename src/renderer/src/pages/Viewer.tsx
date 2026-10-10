import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { navigate } from '../App';
import { SERVER_URL, STUN_SERVERS, ACCESS_PASSWORD } from '../config';
import { useAudioVolume } from '../hooks/useAudioVolume';

interface Props { token: string; }

type Status = 'connecting' | 'waiting_offer' | 'playing' | 'host_left' | 'error';

const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: false, // вимкнено — конфліктує з GainNode і створює білий шум
  },
  video: false,
};

export default function Viewer({ token }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const micSenderRef = useRef<RTCRtpSender | null>(null);
  const micAudioCtxRef = useRef<AudioContext | null>(null);
  // Keep reference to the boosted track so it can be re-added to a new PC
  // when the host reconnects and sends a fresh offer.
  const boostedTrackRef = useRef<MediaStreamTrack | null>(null);
  const boostedStreamRef = useRef<MediaStream | null>(null);

  const [status, setStatus] = useState<Status>('connecting');
  const [errorMsg, setErrorMsg] = useState('');
  const [micOn, setMicOn] = useState(false);
  const [micError, setMicError] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showHud, setShowHud] = useState(false);
  const hudTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [fps, setFps] = useState(0);
  const [kbps, setKbps] = useState(0);
  const [latencyMs, setLatencyMs] = useState(0);

  // Audio streams for volume detection
  const [localMicStream, setLocalMicStream] = useState<MediaStream | null>(null);
  const isViewerSpeaking = useAudioVolume({ stream: localMicStream, threshold: 12 });

  const [remoteMicStream, setRemoteMicStream] = useState<MediaStream | null>(null);
  const isHostSpeaking = useAudioVolume({ stream: remoteMicStream, threshold: 12 });
  
  // Audio Ducking state
  const videoStreamIdRef = useRef<string | null>(null);
  const [remoteAudioTracks, setRemoteAudioTracks] = useState<{ track: MediaStreamTrack, streamId: string }[]>([]);
  const systemAudioRef = useRef<HTMLAudioElement>(null);
  const hostMicAudioRef = useRef<HTMLAudioElement>(null);

  const revealHud = useCallback(() => {
    setShowHud(true);
    if (hudTimerRef.current) clearTimeout(hudTimerRef.current);
    hudTimerRef.current = setTimeout(() => setShowHud(false), 3000);
  }, []);

  // ── Audio Ducking (Приглушення звуку) ──────────────────────────────────
  useEffect(() => {
    if (systemAudioRef.current) {
      const shouldDuck = isHostSpeaking || isViewerSpeaking;
      // Smoothly adjust volume would be nice, but instant is fine for now
      systemAudioRef.current.volume = shouldDuck ? 0.15 : 1.0;
    }
  }, [isHostSpeaking, isViewerSpeaking]);

  // ── Stats ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (status !== 'playing') return;
    let lastBytes = 0;
    const id = setInterval(async () => {
      // Skip heavy getStats() calls when the window is hidden / minimized
      if (document.hidden) return;

      const stats = await pcRef.current?.getStats();
      stats?.forEach((r) => {
        if (r.type === 'inbound-rtp' && r.kind === 'video') {
          const bytes = (r as RTCInboundRtpStreamStats).bytesReceived ?? 0;
          const fr = (r as RTCInboundRtpStreamStats & { framesPerSecond?: number }).framesPerSecond;
          setKbps(Math.round(((bytes - lastBytes) * 8) / 1000));
          lastBytes = bytes;
          if (fr) setFps(Math.round(fr));
        }
        if (r.type === 'candidate-pair' && (r as RTCIceCandidatePairStats).state === 'succeeded') {
          const rtt = (r as RTCIceCandidatePairStats).currentRoundTripTime;
          if (rtt != null) setLatencyMs(Math.round(rtt * 1000));
        }
      });
    }, 2000); // 2s is enough for a display-only HUD, was 1000ms
    return () => clearInterval(id);
  }, [status]);

  // ── Socket + WebRTC ────────────────────────────────────────────────────
  useEffect(() => {
    if (!token) {
      setStatus('error');
      setErrorMsg('Токен не знайдений. Перевірте посилання.');
      return;
    }

    const pwd = ACCESS_PASSWORD || sessionStorage.getItem('app_password');
    const socket: Socket = io(SERVER_URL, {
      transports: ['websocket'],
      auth: { password: pwd }
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('join_room', { token });
      setStatus('waiting_offer');
    });

    socket.on('join_error', ({ message }: { message: string }) => {
      setStatus('error');
      setErrorMsg(message);
    });

    socket.on('offer', async ({ sdp }: { sdp: RTCSessionDescriptionInit }) => {
      // Close the old PeerConnection and create a fresh one
      if (pcRef.current) pcRef.current.close();
      const pc = new RTCPeerConnection({ iceServers: STUN_SERVERS });
      pcRef.current = pc;

      pc.ondatachannel = (event) => {
        dataChannelRef.current = event.channel;
      };

      pc.ontrack = (event) => {
        const streamId = event.streams[0]?.id || '';
        if (event.track.kind === 'video') {
          videoStreamIdRef.current = streamId;
          const stream = new MediaStream([event.track]);
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            setStatus('playing');
          }
        } else if (event.track.kind === 'audio') {
          setRemoteAudioTracks(prev => [...prev, { track: event.track, streamId }]);
        }
      };

      pc.onicecandidate = ({ candidate }) => {
        if (candidate) socket.emit('ice_candidate', { candidate });
      };

      pc.onconnectionstatechange = () => {
        if (!pc) return;
        if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
          setStatus('host_left');
          setRemoteMicStream(null);
          setRemoteAudioTracks([]);
          // Auto-reconnect WebRTC after a short delay
          setTimeout(() => {
            if (socketRef.current?.connected) {
              console.log('[viewer] Attempting WebRTC auto-reconnect...');
              socketRef.current.emit('join_room', { token });
            }
          }, 2500);
        }
      };

      await pc.setRemoteDescription(sdp);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('answer', { sdp: pc.localDescription });

      // ── FIX: Re-attach viewer mic to the new PC after host reconnect ────
      // If the viewer had their mic on before the host reconnected, the old
      // sender was on the closed PC. We must add the track to the new PC and
      // trigger a new renegotiation so the host can hear the viewer again.
      if (boostedTrackRef.current && boostedStreamRef.current) {
        try {
          micSenderRef.current = pc.addTrack(boostedTrackRef.current, boostedStreamRef.current);
          const micOffer = await pc.createOffer();
          await pc.setLocalDescription(micOffer);
          socket.emit('viewer_offer', { sdp: pc.localDescription });
          console.log('[viewer] re-attached mic track to new PC after host reconnect');
        } catch (e) {
          console.error('[viewer] failed to re-attach mic track:', e);
        }
      }
    });

    socket.on('ice_candidate', async ({ candidate }: { candidate: RTCIceCandidateInit }) => {
      await pcRef.current?.addIceCandidate(candidate);
    });

    socket.on('host_answer', async ({ sdp }: { sdp: RTCSessionDescriptionInit }) => {
      await pcRef.current?.setRemoteDescription(sdp);
    });

    socket.on('host_left', () => {
      setStatus('host_left');
      setRemoteMicStream(null);
    });

    socket.on('connect_error', (err) => {
      setStatus('error');
      setErrorMsg(`Не вдалося підключитися до сигнального сервера: ${err.message}`);
    });

    return () => {
      socket.disconnect();
      pcRef.current?.close();
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
      micAudioCtxRef.current?.close().catch(() => {});
    };
  }, [token]);

  // Process incoming audio tracks to distinguish System Audio vs Host Mic
  useEffect(() => {
    const systemTrack = remoteAudioTracks.find(t => t.streamId === videoStreamIdRef.current)?.track;
    const micTrack = remoteAudioTracks.find(t => t.streamId !== videoStreamIdRef.current)?.track;

    if (systemTrack && systemAudioRef.current) {
      systemAudioRef.current.srcObject = new MediaStream([systemTrack]);
    }
    if (micTrack && hostMicAudioRef.current) {
      const micStream = new MediaStream([micTrack]);
      hostMicAudioRef.current.srcObject = micStream;
      setRemoteMicStream(micStream);
    }
  }, [remoteAudioTracks]);

  // ── Mic toggle ────────────────────────────────────────────────────────
  const handleToggleMic = useCallback(async () => {
    if (micOn) {
      if (micStreamRef.current) {
        micStreamRef.current.getAudioTracks().forEach(t => t.enabled = false);
      }
      setMicOn(false);
    } else {
      setMicError('');
      if (micStreamRef.current) {
        // Stream already exists, just enable the track
        micStreamRef.current.getAudioTracks().forEach(t => t.enabled = true);
        setMicOn(true);
      } else {
        try {
          const micStream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
          micStreamRef.current = micStream;

          // ── Boost mic volume via GainNode + Compressor ───────────────
          const audioCtx = new AudioContext();
          micAudioCtxRef.current = audioCtx;
          const source = audioCtx.createMediaStreamSource(micStream);

          const gainNode = audioCtx.createGain();
          gainNode.gain.value = 2.0; // 2× boost — підніми до 2.5 якщо тихо

          // Компресор прибирає піки і не дає спотворень після підсилення
          const compressor = audioCtx.createDynamicsCompressor();
          compressor.threshold.value = -24; // дБ — починаємо стискати з -24dB
          compressor.knee.value = 10;       // м'який перехід
          compressor.ratio.value = 4;       // 4:1 — помірне стискання
          compressor.attack.value = 0.005;  // 5ms — швидка реакція
          compressor.release.value = 0.15;  // 150ms — плавне відпускання

          const destination = audioCtx.createMediaStreamDestination();
          source.connect(gainNode);
          gainNode.connect(compressor);
          compressor.connect(destination);
          const boostedTrack = destination.stream.getAudioTracks()[0];
          // ──────────────────────────────────────────────────────────────
          // Store refs so the track can be re-added to a new PC on reconnect
          boostedTrackRef.current  = boostedTrack;
          boostedStreamRef.current = destination.stream;
          // Pass boosted stream to indicator so it reflects real TX volume
          setLocalMicStream(destination.stream);

          if (pcRef.current) {
            micSenderRef.current = pcRef.current.addTrack(boostedTrack, destination.stream);
            try {
              const offer = await pcRef.current.createOffer();
              await pcRef.current.setLocalDescription(offer);
              // Server buffers this offer if host is temporarily offline
              socketRef.current?.emit('viewer_offer', { sdp: pcRef.current.localDescription });
            } catch {}
          }
          setMicOn(true);
        } catch {
          setMicError('Немає доступу до мікрофона.');
        }
      }
    }
  }, [micOn]);

  // ── Fullscreen ─────────────────────────────────────────────────────────
  const toggleFullscreen = useCallback(async () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      await containerRef.current.requestFullscreen();
    } else {
      await document.exitFullscreen();
    }
  }, []);

  useEffect(() => {
    const fn = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', fn);
    return () => document.removeEventListener('fullscreenchange', fn);
  }, []);

  const togglePip = useCallback(async () => {
    if (!videoRef.current) return;
    if (document.pictureInPictureElement) await document.exitPictureInPicture();
    else await videoRef.current.requestPictureInPicture();
  }, []);

  // Early returns removed because overlays are now integrated into the main view.

  // ── Remote Control ───────────────────────────────────────────────────────
  const getNormalizedCoordinates = (e: React.MouseEvent<HTMLVideoElement>) => {
    const video = e.currentTarget;
    const rect = video.getBoundingClientRect();
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return null;

    const videoRatio = vw / vh;
    const containerRatio = rect.width / rect.height;

    let actualWidth, actualHeight, offsetX, offsetY;

    if (videoRatio > containerRatio) {
      // Video is wider: black bars on top and bottom
      actualWidth = rect.width;
      actualHeight = rect.width / videoRatio;
      offsetX = 0;
      offsetY = (rect.height - actualHeight) / 2;
    } else {
      // Video is taller: black bars on left and right
      actualHeight = rect.height;
      actualWidth = rect.height * videoRatio;
      offsetX = (rect.width - actualWidth) / 2;
      offsetY = 0;
    }

    const x = e.clientX - rect.left - offsetX;
    const y = e.clientY - rect.top - offsetY;

    // Ignore clicks/moves on the black bars
    if (x < 0 || x > actualWidth || y < 0 || y > actualHeight) {
      return null;
    }

    return { x: x / actualWidth, y: y / actualHeight };
  };

  const lastMouseMoveTime = useRef(0);

  const handleRemoteMouseMove = useCallback((e: React.MouseEvent<HTMLVideoElement>) => {
    if (!dataChannelRef.current || dataChannelRef.current.readyState !== 'open') return;

    // Throttle to ~30fps (33ms) to prevent WebRTC flooding
    const now = Date.now();
    if (now - lastMouseMoveTime.current < 33) return;
    lastMouseMoveTime.current = now;

    const coords = getNormalizedCoordinates(e);
    if (!coords) return;

    dataChannelRef.current.send(JSON.stringify({ action: 'mouse-move', payload: coords }));
  }, []);

  const handleRemoteMouseClick = useCallback((e: React.MouseEvent<HTMLVideoElement>) => {
    if (!dataChannelRef.current || dataChannelRef.current.readyState !== 'open') return;
    
    const coords = getNormalizedCoordinates(e);
    if (!coords) return;

    const button = e.button === 2 ? 'right' : 'left';
    dataChannelRef.current.send(JSON.stringify({ action: 'mouse-click', payload: button }));
  }, []);

  const handleRemoteScroll = useCallback((e: React.WheelEvent<HTMLVideoElement>) => {
    if (!dataChannelRef.current || dataChannelRef.current.readyState !== 'open') return;
    dataChannelRef.current.send(JSON.stringify({ action: 'scroll', payload: { deltaX: e.deltaX, deltaY: e.deltaY } }));
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!dataChannelRef.current || dataChannelRef.current.readyState !== 'open') return;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      dataChannelRef.current.send(JSON.stringify({ action: 'keyboard', payload: { type: 'keydown', code: e.code } }));
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (!dataChannelRef.current || dataChannelRef.current.readyState !== 'open') return;
      dataChannelRef.current.send(JSON.stringify({ action: 'keyboard', payload: { type: 'keyup', code: e.code } }));
    };

    window.addEventListener('keydown', onKeyDown, { passive: false });
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  return (
    <div ref={containerRef} className="relative w-full h-screen bg-black overflow-hidden group"
      onMouseMove={revealHud} onClick={revealHud} onTouchStart={revealHud}>

      {/* Audio tags for separate streams to apply ducking */}
      <audio ref={systemAudioRef} autoPlay playsInline />
      <audio ref={hostMicAudioRef} autoPlay playsInline />

      <video 
        ref={videoRef} 
        id="viewer-video" 
        autoPlay 
        playsInline 
        className="w-full h-full object-contain" 
        onMouseMove={handleRemoteMouseMove}
        onMouseDown={handleRemoteMouseClick}
        onWheel={handleRemoteScroll}
        onContextMenu={(e) => e.preventDefault()}
      />

      {(status === 'connecting' || status === 'waiting_offer' || status === 'host_left' || status === 'error') && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/80 backdrop-blur-md z-10 text-white/60">
          {(status === 'connecting' || status === 'waiting_offer') && <div className="spinner" />}
          {status === 'host_left' && <svg className="w-12 h-12 text-white/30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /><path d="M9 12l2 2 4-4" /></svg>}
          {status === 'error' && <svg className="w-12 h-12 text-red-400/50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>}
          
          <p className="text-sm font-medium tracking-wide text-center px-6">
            {status === 'connecting' && 'Підключення до сервера...'}
            {status === 'waiting_offer' && 'Очікування трансляції від хоста...'}
            {status === 'host_left' && 'Втрачено зв\'язок з хостом (можливо, проблеми з інтернетом).'}
            {status === 'error' && (errorMsg || 'Сталася помилка з\'єднання.')}
          </p>

          {(status === 'host_left' || status === 'error') && (
            <button onClick={() => window.location.reload()} 
              className="mt-4 px-6 py-2.5 bg-white/10 hover:bg-white/20 text-white rounded-xl text-sm font-medium transition-all active:scale-95 border border-white/10">
              Спробувати перепідключитись
            </button>
          )}
        </div>
      )}

      {/* Top Bar: Stats & Avatars */}
      <div className={`absolute top-0 left-0 right-0 flex items-start justify-between px-4 sm:px-6 py-4
        bg-gradient-to-b from-black/70 to-transparent pointer-events-none
        transition-opacity duration-500 z-20 ${showHud || status !== 'playing' ? 'opacity-100' : 'opacity-0'}`}>

        {/* Top Left: Stats */}
        <div className="flex flex-col gap-2 pointer-events-auto items-start">

          {status === 'playing' && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-full w-fit">
              <span className="w-2 h-2 rounded-full bg-emerald-400 pulse-dot" />
              <span className="text-[10px] uppercase tracking-wider text-emerald-400 font-bold">Live</span>
            </div>
          )}
          {status === 'playing' && (
            <div className="flex gap-3 text-[11px] text-white/60 font-mono bg-black/40 px-3 py-1.5 rounded-xl border border-white/5 backdrop-blur-sm">
              <span>{fps ? `${fps} fps` : '—'}</span>
              <span>{kbps ? `${kbps} kbps` : '—'}</span>
              {latencyMs > 0 && <span className="hidden sm:inline">{latencyMs}ms ping</span>}
            </div>
          )}
        </div>

        {/* Top Right: Avatars */}
        {status === 'playing' && (
          <div className="flex flex-col gap-2 pointer-events-auto">
            {remoteMicStream && (
              <div className="flex items-center justify-end gap-2 bg-black/40 backdrop-blur-md pl-2 pr-3 py-1.5 rounded-full border border-white/5 shadow-lg">
                <span className="text-xs font-medium text-white/80">Хост</span>
                <div className={`w-7 h-7 rounded-full bg-violet-600 flex items-center justify-center avatar-base border-2 ${isHostSpeaking ? 'avatar-speaking' : 'border-transparent'}`}>
                  <svg className="w-3.5 h-3.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                </div>
              </div>
            )}
            {micOn && (
              <div className="flex items-center justify-end gap-2 bg-black/40 backdrop-blur-md pl-2 pr-3 py-1.5 rounded-full border border-white/5 shadow-lg">
                <span className="text-xs font-medium text-white/80">Ви</span>
                <div className={`w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center avatar-base border-2 ${isViewerSpeaking ? 'avatar-speaking' : 'border-transparent'}`}>
                  <svg className="w-3.5 h-3.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" /><path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8" /></svg>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bottom Control Bar (Prominent & Mobile Friendly) */}
      {status === 'playing' && (
        <div className={`absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 sm:gap-4 px-4 sm:px-6 py-3
          bg-black/60 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl z-30
          transition-all duration-500 ${showHud ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>

          <button onClick={handleToggleMic}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold cursor-pointer transition-all shadow-md active:scale-95
              ${micOn
                ? 'bg-emerald-500 text-white shadow-emerald-500/20 hover:bg-emerald-400'
                : 'bg-white/10 text-white hover:bg-white/20'}`}>
            {micOn ? (
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" /><path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8" /></svg>
            ) : (
              <svg className="w-5 h-5 text-white/70" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="2" y1="2" x2="22" y2="22" /><path d="M18.89 13.23A7.12 7.12 0 0019 12v-2M5 10v2a7 7 0 007 7M15 9.34V4a3 3 0 00-5.68-1.33" /><path d="M9 9v3a3 3 0 005.12 2.12M12 19v4M8 23h8" /></svg>
            )}
            <span>{micOn ? 'Мікрофон' : 'Увімкнути'}</span>
          </button>

          <div className="w-px h-8 bg-white/10 mx-1"></div>

          {'pictureInPictureEnabled' in document && (
            <button onClick={togglePip} title="Picture-in-Picture"
              className="p-3 rounded-xl bg-white/5 hover:bg-white/15 text-white/80 hover:text-white transition-all cursor-pointer active:scale-95">
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="2" y="4" width="20" height="16" rx="2" /><rect x="12" y="11" width="9" height="7" rx="1.5" fill="currentColor" stroke="none" />
              </svg>
            </button>
          )}

          <button onClick={toggleFullscreen} title="На весь екран"
            className="p-3 rounded-xl bg-white/5 hover:bg-white/15 text-white/80 hover:text-white transition-all cursor-pointer active:scale-95">
            {isFullscreen
              ? <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3v3a2 2 0 01-2 2H3m18 0h-3a2 2 0 01-2-2V3m0 18v-3a2 2 0 012-2h3M3 16h3a2 2 0 012 2v3" /></svg>
              : <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 3h6m0 0v6m0-6l-7 7M9 21H3m0 0v-6m0 6l7-7" /></svg>
            }
          </button>
        </div>
      )}

      {micError && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-30
          px-4 py-2.5 bg-red-500/20 backdrop-blur-md border border-red-500/40 rounded-xl text-red-200 text-sm shadow-xl flex items-center gap-2">
          <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
          {micError}
        </div>
      )}
      {/* Global Back Button */}
      <button onClick={() => {
          if (pcRef.current) pcRef.current.close();
          if (socketRef.current) socketRef.current.disconnect();
          navigate('?page=home');
        }}
        className="absolute top-6 left-6 z-50 flex items-center gap-1.5 px-3 py-1.5 bg-white/10 hover:bg-white/20 transition-colors rounded-xl text-white/90 text-xs font-medium border border-white/20 backdrop-blur-md cursor-pointer active:scale-95 shadow-xl">
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M19 12H5M12 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round"/></svg>
        На головну
      </button>
    </div>
  );
}
