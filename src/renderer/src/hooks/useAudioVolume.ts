import { useEffect, useState, useRef } from 'react';

interface UseAudioVolumeOptions {
  stream: MediaStream | null;
  threshold?: number;
  intervalMs?: number;
}

export function useAudioVolume({
  stream,
  threshold = 10,
  intervalMs = 150, // reduced from 50ms → 150ms to lower CPU usage
}: UseAudioVolumeOptions) {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);

  useEffect(() => {
    if (!stream || stream.getAudioTracks().length === 0) {
      setIsSpeaking(false);
      return;
    }

    // Try to create AudioContext (might fail if no user interaction yet, but we usually have it here)
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64; // reduced from 256 → 64 (4× less FFT work per frame)
      analyser.smoothingTimeConstant = 0.6;

      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);

      audioContextRef.current = audioCtx;
      analyserRef.current = analyser;
      sourceRef.current = source;
    } catch (e) {
      console.warn('Failed to initialize AudioContext for volume detection:', e);
      return;
    }

    const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
    let intervalId: number;

    const checkVolume = () => {
      if (!analyserRef.current) return;
      // Skip analysis when page is hidden (Electron background) to save CPU
      if (document.hidden) return;

      analyserRef.current.getByteFrequencyData(dataArray);
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i];
      }
      const average = sum / dataArray.length;

      setIsSpeaking(average > threshold);
    };

    intervalId = window.setInterval(checkVolume, intervalMs);

    return () => {
      window.clearInterval(intervalId);
      if (sourceRef.current) {
        sourceRef.current.disconnect();
      }
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close().catch(() => {});
      }
    };
  }, [stream, threshold, intervalMs]);

  return isSpeaking;
}
