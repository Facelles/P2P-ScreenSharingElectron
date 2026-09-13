import { useState, useEffect } from 'react';

interface WidgetState {
  micOn: boolean;
  allowMouse: boolean;
  allowKeyboard: boolean;
  sharing: boolean;
}

export default function Widget() {
  const [state, setState] = useState<WidgetState>({
    micOn: false,
    allowMouse: true,
    allowKeyboard: false,
    sharing: false,
  });

  useEffect(() => {
    // @ts-ignore
    const ipc = window.electron?.ipcRenderer;
    if (!ipc) return;

    // Receive state updates from the host window
    ipc.on('widget-state', (_: unknown, newState: Partial<WidgetState>) => {
      setState(prev => ({ ...prev, ...newState }));
    });

    return () => {
      ipc.removeAllListeners('widget-state');
    };
  }, []);

  const send = (action: string, payload?: unknown) => {
    // @ts-ignore
    window.electron?.ipcRenderer.send('widget-action', { action, payload });
  };

  return (
    <div
      style={{
        background: 'rgba(15, 15, 20, 0.88)',
        backdropFilter: 'blur(30px)',
        WebkitBackdropFilter: 'blur(30px)',
        WebkitAppRegion: 'drag',
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: '16px',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        padding: '0 16px',
      } as React.CSSProperties}
    >
      {/* Status dot */}
      <div className="flex items-center gap-1.5 shrink-0">
        <span
          style={{
            width: 8, height: 8, borderRadius: '50%',
            background: '#34d399',
            boxShadow: '0 0 8px rgba(52,211,153,0.8)',
            animation: 'pulse 2s infinite',
            display: 'inline-block',
            flexShrink: 0,
          }}
        />
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)', fontWeight: 600, letterSpacing: '0.02em', whiteSpace: 'nowrap' }}>
          На лінії
        </span>
      </div>

      {/* Divider */}
      <div style={{ width: 1, height: 28, background: 'rgba(255,255,255,0.12)', flexShrink: 0 }} />

      {/* Mic toggle */}
      <button
        onClick={() => send('toggle-mic')}
        title={state.micOn ? 'Вимкнути мікрофон' : 'Увімкнути мікрофон'}
        style={{
          WebkitAppRegion: 'no-drag',
          padding: '5px 10px',
          borderRadius: 8,
          border: `1px solid ${state.micOn ? 'rgba(52,211,153,0.4)' : 'rgba(255,255,255,0.12)'}`,
          background: state.micOn ? 'rgba(52,211,153,0.15)' : 'rgba(255,255,255,0.06)',
          color: state.micOn ? '#34d399' : 'rgba(255,255,255,0.5)',
          cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 5,
          fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap',
          transition: 'all 0.15s',
        } as React.CSSProperties}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          {state.micOn ? (
            <>
              <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
              <path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8" />
            </>
          ) : (
            <>
              <line x1="2" y1="2" x2="22" y2="22" />
              <path d="M18.89 13.23A7.12 7.12 0 0019 12v-2M5 10v2a7 7 0 007 7M15 9.34V4a3 3 0 00-5.68-1.33" />
            </>
          )}
        </svg>
        Мік
      </button>

      {/* Mouse toggle */}
      <button
        onClick={() => send('toggle-mouse')}
        title={state.allowMouse ? 'Заборонити керування мишею' : 'Дозволити керування мишею'}
        style={{
          WebkitAppRegion: 'no-drag',
          padding: '5px 10px',
          borderRadius: 8,
          border: `1px solid ${state.allowMouse ? 'rgba(139,92,246,0.4)' : 'rgba(255,255,255,0.12)'}`,
          background: state.allowMouse ? 'rgba(139,92,246,0.15)' : 'rgba(255,255,255,0.06)',
          color: state.allowMouse ? '#a78bfa' : 'rgba(255,255,255,0.5)',
          cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 5,
          fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap',
          transition: 'all 0.15s',
        } as React.CSSProperties}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="5" y="2" width="14" height="20" rx="7" />
          <line x1="12" y1="6" x2="12" y2="12" />
        </svg>
        Миша
      </button>

      {/* Keyboard toggle */}
      <button
        onClick={() => send('toggle-keyboard')}
        title={state.allowKeyboard ? 'Заборонити клавіатуру' : 'Дозволити клавіатуру'}
        style={{
          WebkitAppRegion: 'no-drag',
          padding: '5px 10px',
          borderRadius: 8,
          border: `1px solid ${state.allowKeyboard ? 'rgba(251,191,36,0.4)' : 'rgba(255,255,255,0.12)'}`,
          background: state.allowKeyboard ? 'rgba(251,191,36,0.12)' : 'rgba(255,255,255,0.06)',
          color: state.allowKeyboard ? '#fbbf24' : 'rgba(255,255,255,0.5)',
          cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 5,
          fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap',
          transition: 'all 0.15s',
        } as React.CSSProperties}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="2" y="5" width="20" height="14" rx="2" />
          <line x1="6" y1="9" x2="6" y2="9" strokeLinecap="round" strokeWidth="2.5" />
          <line x1="10" y1="9" x2="10" y2="9" strokeLinecap="round" strokeWidth="2.5" />
          <line x1="14" y1="9" x2="14" y2="9" strokeLinecap="round" strokeWidth="2.5" />
          <line x1="18" y1="9" x2="18" y2="9" strokeLinecap="round" strokeWidth="2.5" />
          <line x1="8" y1="14" x2="16" y2="14" strokeLinecap="round" strokeWidth="2.5" />
        </svg>
        Клав
      </button>

      {/* Divider */}
      <div style={{ width: 1, height: 28, background: 'rgba(255,255,255,0.12)', flexShrink: 0 }} />

      {/* Stop button */}
      <button
        onClick={() => send('stop')}
        style={{
          WebkitAppRegion: 'no-drag',
          padding: '5px 12px',
          borderRadius: 8,
          border: '1px solid rgba(239,68,68,0.4)',
          background: 'rgba(239,68,68,0.18)',
          color: '#f87171',
          cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 5,
          fontSize: 11, fontWeight: 700,
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
          whiteSpace: 'nowrap',
          transition: 'all 0.15s',
        } as React.CSSProperties}
      >
        ■ Стоп
      </button>
    </div>
  );
}
