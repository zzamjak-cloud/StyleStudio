import { Settings } from 'lucide-react';
import { getVersion } from '@tauri-apps/api/app';
import { useEffect, useState } from 'react';

interface HeaderProps {
  onSettingsClick: () => void;
}

export function Header({ onSettingsClick }: HeaderProps) {
  const [version, setVersion] = useState<string>('');

  useEffect(() => {
    getVersion().then(setVersion).catch(() => setVersion('0.0.0'));
  }, []);

  return (
    <header className="h-14 bg-gradient-to-r from-purple-600 to-blue-600 flex items-center justify-between px-6 shadow-lg">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center">
          <span className="text-xl">🎨</span>
        </div>
        <div>
          <h1 className="text-white text-xl font-bold">Style Studio</h1>
          {version && (
            <span className="text-white/70 text-xs">v{version}</span>
          )}
        </div>
      </div>

      <button
        onClick={onSettingsClick}
        className="p-2 text-white hover:bg-white/20 rounded-lg transition-colors"
        title="설정"
      >
        <Settings size={20} />
      </button>
    </header>
  );
}
