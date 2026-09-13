import React from 'react';

interface HostHudProps {
  micOn: boolean;
  status: 'init' | 'waiting' | 'connected' | 'viewer_left' | 'error' | 'stopped';
  remoteMicStream: MediaStream | null;
  isHostSpeaking: boolean;
  isViewerSpeaking: boolean;
  isViewerMuted: boolean;
  setIsViewerMuted: (muted: boolean) => void;
  handleToggleMic: () => void;
  fps: number;
  kbps: number;
  sharing: boolean;
  handleStartShare: () => void;
  stopSharing: () => void;
  allowMouse?: boolean;
  setAllowMouse?: (val: boolean) => void;
  allowKeyboard?: boolean;
  setAllowKeyboard?: (val: boolean) => void;
}

export const HostHud: React.FC<HostHudProps> = ({
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
}) => {
  return (
    <div className="flex flex-col gap-4 w-full">
      {/* Speaking Indicators Overlay */}
      {(micOn || (status === 'connected' && remoteMicStream)) && (
        <div className="flex justify-between items-center bg-white/5 p-3 rounded-2xl border border-white/10 shadow-lg">
          <div className="flex items-center gap-3">
            {micOn && (
              <div className={`flex items-center gap-2 bg-black/40 pr-3 rounded-full border ${isHostSpeaking ? 'border-violet-500' : 'border-transparent'}`}>
                <div className={`w-9 h-9 rounded-full flex items-center justify-center bg-violet-600 transition-all ${isHostSpeaking ? 'scale-110 shadow-[0_0_15px_rgba(139,92,246,0.6)]' : ''}`}>
                   <span className="text-[10px] font-bold tracking-wider">ВИ</span>
                </div>
              </div>
            )}
            {status === 'connected' && remoteMicStream && (
              <div className={`flex items-center gap-2 bg-black/40 pr-3 rounded-full border ${isViewerSpeaking ? 'border-blue-500' : 'border-transparent'}`}>
                <div className={`w-9 h-9 rounded-full flex items-center justify-center bg-blue-600 transition-all ${isViewerSpeaking ? 'scale-110 shadow-[0_0_15px_rgba(59,130,246,0.6)]' : ''}`}>
                   <span className="text-[10px] font-bold tracking-wider">ГЛ</span>
                </div>
              </div>
            )}
          </div>
          
          {/* Mute Viewer */}
          {status === 'connected' && remoteMicStream && (
             <button onClick={() => setIsViewerMuted(!isViewerMuted)}
                  title={isViewerMuted ? 'Увімкнути звук глядача' : 'Заглушити глядача'}
                  className={`p-2 rounded-xl transition-all shadow-md ${isViewerMuted ? 'bg-red-500 text-white' : 'bg-white/10 hover:bg-white/20 text-white/90'}`}>
                {isViewerMuted ? (
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>
                  ) : (
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>
                )}
             </button>
          )}
        </div>
      )}

      {/* Main Controls */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
        {!sharing ? (
          <button onClick={handleStartShare} disabled={status === 'init' || status === 'error'}
            className="flex-1 py-3 px-6 rounded-xl bg-gradient-to-r from-violet-600 to-purple-500
              text-white font-semibold text-sm cursor-pointer shadow-lg
              hover:shadow-violet-500/50 hover:-translate-y-0.5
              active:scale-95 transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed">
            ▶ Почати трансляцію
          </button>
        ) : (
          <button onClick={stopSharing}
            className="flex-1 py-3 px-6 rounded-xl bg-red-600 border border-red-500/40
              text-white font-semibold text-sm cursor-pointer shadow-lg
              hover:bg-red-500 hover:shadow-red-500/50 hover:-translate-y-0.5
              transition-all duration-200 active:scale-95">
            ■ Зупинити трансляцію
          </button>
        )}

        {/* Mic button */}
        {(status === 'connected' || status === 'waiting') && (
          <button onClick={handleToggleMic}
            className={`flex-1 flex items-center justify-center gap-2 py-3 px-5 rounded-xl border text-sm font-medium cursor-pointer shadow-lg
              transition-all duration-200 active:scale-95
              ${micOn
                ? 'bg-emerald-500 border-emerald-400 text-white shadow-emerald-500/30 hover:bg-emerald-400'
                : 'bg-white/10 border-white/10 text-white/70 hover:text-white hover:bg-white/20'
              }`}>
            {micOn ? (
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
                <path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8" />
              </svg>
            ) : (
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="2" y1="2" x2="22" y2="22" />
                <path d="M18.89 13.23A7.12 7.12 0 0019 12v-2M5 10v2a7 7 0 007 7M15 9.34V4a3 3 0 00-5.68-1.33" />
                <path d="M9 9v3a3 3 0 005.12 2.12M12 19v4M8 23h8" />
              </svg>
            )}
            {micOn ? 'Мікрофон увімк.' : 'Мікрофон вимк.'}
          </button>
        )}
      </div>

      {/* Stats */}
      {status === 'connected' && (
        <div className="flex gap-4 p-4 border-b border-white/10 bg-black/20">
          <div className="flex-1 space-y-2">
            <div className="text-xs text-white/50 uppercase tracking-wider font-semibold">Quality</div>
            <div className="flex items-center gap-3">
              <span className="text-sm font-mono text-white/90">{fps || '—'} fps</span>
              <span className="text-sm font-mono text-white/90">{kbps || '—'} kbps</span>
            </div>
          </div>
          {setAllowMouse && setAllowKeyboard && (
            <div className="flex-1 space-y-3 border-l border-white/10 pl-4">
              <div className="text-xs text-white/50 uppercase tracking-wider font-semibold">Permissions</div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-white/90">Керування мишею</span>
                <input type="checkbox" className="mac-toggle" 
                  checked={allowMouse} onChange={(e) => setAllowMouse(e.target.checked)} />
              </div>
              <div className="flex items-center justify-between opacity-50 cursor-not-allowed" title="В розробці">
                <span className="text-sm text-white/90">Клавіатура</span>
                <input type="checkbox" className="mac-toggle" disabled
                  checked={allowKeyboard} onChange={(e) => setAllowKeyboard(e.target.checked)} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
