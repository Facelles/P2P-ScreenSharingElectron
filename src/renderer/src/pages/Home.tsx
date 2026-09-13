import { useCallback, useState, useEffect } from 'react';
import { navigate } from '../App';
import { ACCESS_PASSWORD } from '../config';

export default function Home() {
  const [tokenInput, setTokenInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [joinError, setJoinError] = useState('');
  const [tab, setTab] = useState<'host' | 'join'>('host');

  // Load saved password from session storage if not in env
  useEffect(() => {
    if (!ACCESS_PASSWORD) {
      const saved = sessionStorage.getItem('app_password');
      if (saved) setPasswordInput(saved);
    }
  }, []);

  const handleSavePassword = (pwd: string) => {
    setPasswordInput(pwd);
    sessionStorage.setItem('app_password', pwd);
  };

  const handleJoin = useCallback(() => {
    if (!tokenInput.trim()) return;
    setJoinError('');

    const token = encodeURIComponent(tokenInput.trim());
    navigate(`?page=viewer&token=${token}`);
  }, [tokenInput]);

  return (
    <div className="flex items-center justify-center min-h-screen bg-transparent mac-drag-region">
      
      {/* Background styling for macOS vibrancy */}
      <div className="absolute inset-0 bg-[#1e1e1e]/60 backdrop-blur-3xl -z-10" />

      <div className="w-[420px] bg-white/10 border border-white/20 rounded-2xl shadow-2xl overflow-hidden no-drag backdrop-blur-md">
        
        {/* Header / Tabs */}
        <div className="flex border-b border-white/10 bg-white/5">
          <button
            onClick={() => setTab('host')}
            className={`flex-1 py-3 text-sm font-medium text-center transition-all ${
              tab === 'host' ? 'text-white bg-white/10 shadow-sm' : 'text-white/50 hover:text-white/80 hover:bg-white/5'
            }`}
          >
            Транслювати екран
          </button>
          <div className="w-px bg-white/10" />
          <button
            onClick={() => setTab('join')}
            className={`flex-1 py-3 text-sm font-medium text-center transition-all ${
              tab === 'join' ? 'text-white bg-white/10 shadow-sm' : 'text-white/50 hover:text-white/80 hover:bg-white/5'
            }`}
          >
            Підключитися
          </button>
        </div>

        {/* Content */}
        <div className="p-8">
          {tab === 'host' ? (
            <div className="flex flex-col items-center gap-6 page-enter">
              <div className="w-16 h-16 rounded-full bg-blue-500/20 flex items-center justify-center border border-blue-500/30 shadow-[0_0_20px_rgba(59,130,246,0.3)]">
                <svg className="w-8 h-8 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                  <line x1="8" y1="21" x2="16" y2="21" />
                  <line x1="12" y1="17" x2="12" y2="21" />
                </svg>
              </div>
              
              <div className="text-center space-y-2">
                <h2 className="text-xl font-bold tracking-tight text-white/90">Почати трансляцію</h2>
                <p className="text-sm text-white/50 leading-relaxed">
                  Поділіться своїм екраном і дозвольте дистанційне керування мишею.
                </p>
              </div>

              <button
                onClick={() => navigate('?page=host')}
                className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white rounded-xl font-medium transition-all shadow-lg active:scale-95 border border-white/10"
              >
                Почати
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-5 page-enter">
              <div className="text-center space-y-2 mb-2">
                <h2 className="text-xl font-bold tracking-tight text-white/90">Підключитися</h2>
                <p className="text-sm text-white/50">Введіть токен для доступу.</p>
              </div>

              {joinError && (
                <div className="p-3 bg-red-500/20 border border-red-500/30 rounded-lg text-sm text-red-200 text-center">
                  {joinError}
                </div>
              )}

              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-white/50 uppercase tracking-wider pl-1">Токен підключення</label>
                  <input
                    type="text"
                    placeholder="Вставте токен тут..."
                    value={tokenInput}
                    onChange={(e) => {
                      setTokenInput(e.target.value);
                      setJoinError('');
                    }}
                    className="w-full px-4 py-2.5 bg-black/40 border border-white/10 rounded-xl outline-none focus:border-blue-500/50 focus:ring-2 focus:ring-blue-500/20 text-white placeholder-white/30 transition-all font-mono text-sm"
                  />
                </div>
                
                {!ACCESS_PASSWORD && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-white/50 uppercase tracking-wider pl-1">Пароль сервера</label>
                    <input
                      type="password"
                      placeholder="Якщо вимагається"
                      value={passwordInput}
                      onChange={(e) => handleSavePassword(e.target.value)}
                      className="w-full px-4 py-2.5 bg-black/40 border border-white/10 rounded-xl outline-none focus:border-blue-500/50 focus:ring-2 focus:ring-blue-500/20 text-white placeholder-white/30 transition-all text-sm"
                    />
                  </div>
                )}
              </div>

              <button
                onClick={handleJoin}
                disabled={!tokenInput.trim()}
                className="w-full mt-2 py-3 px-4 bg-white/10 hover:bg-white/20 active:bg-white/30 text-white rounded-xl font-medium transition-all shadow-md active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 border border-white/10"
              >
                Підключитися
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
