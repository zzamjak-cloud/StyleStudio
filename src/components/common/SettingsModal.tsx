import { memo, useState, useEffect } from 'react';
import { X, Key, FolderOpen, LogOut, User, Info, ChevronDown, ChevronRight } from 'lucide-react';
import { openPath, openUrl } from '@tauri-apps/plugin-opener';
import { getVersion } from '@tauri-apps/api/app';
import { getAiGenRoot } from '../../lib/config/paths';
import { useAuth } from '../../hooks/useAuth';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentApiKey: string;
  onSave: (apiKey: string) => void;
}

export const SettingsModal = memo(function SettingsModal({
  isOpen,
  onClose,
  currentApiKey,
  onSave,
}: SettingsModalProps) {
  const [apiKey, setApiKey] = useState(currentApiKey);
  const [saveNotification, setSaveNotification] = useState<string | null>(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [version, setVersion] = useState('');
  const [showAbout, setShowAbout] = useState(false);
  const { user, logout } = useAuth();

  useEffect(() => {
    setApiKey(currentApiKey);
  }, [currentApiKey]);

  useEffect(() => {
    getVersion().then(setVersion).catch(() => setVersion('0.0.0'));
  }, []);

  // 로그아웃 처리
  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      console.log('[Settings] 로그아웃 시작');
      await logout();
      console.log('[Settings] 로그아웃 완료');
      // 강제로 페이지 새로고침하여 로그인 화면으로 전환
      window.location.reload();
    } catch (error) {
      console.error('[Settings] 로그아웃 실패:', error);
      alert('로그아웃에 실패했습니다.');
      setIsLoggingOut(false);
    }
  };

  const handleSave = () => {
    if (apiKey.trim()) {
      onSave(apiKey.trim());
      setSaveNotification('설정이 저장되었습니다');
      setTimeout(() => {
        setSaveNotification(null);
        onClose();
      }, 1500);
    } else {
      alert('API Key를 입력해주세요');
    }
  };

  // AI_Gen 루트 폴더 열기
  const handleOpenFolder = async () => {
    try {
      const root = await getAiGenRoot();
      await openPath(root);
    } catch (error) {
      console.error('폴더 열기 실패:', error);
      alert('폴더를 열지 못했습니다.');
    }
  };

  // 외부 링크를 기본 브라우저로 열기
  const handleOpenUrl = async (url: string) => {
    try {
      await openUrl(url);
    } catch (error) {
      console.error('링크 열기 실패:', error);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full">
        {/* 헤더 */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-100 rounded-lg">
              <Key size={20} className="text-purple-600" />
            </div>
            <h2 className="text-xl font-bold text-gray-800">설정</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X size={20} className="text-gray-500" />
          </button>
        </div>

        {/* 본문 */}
        <div className="p-6 space-y-6 max-h-[65vh] overflow-y-auto">
          {/* API Key 설정 */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              OpenRouter API Key
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-or-..."
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            />
            <p className="text-xs text-gray-500 mt-2">
              <a
                href="https://openrouter.ai/settings/keys"
                target="_blank"
                rel="noopener noreferrer"
                className="text-purple-600 hover:underline"
              >
                OpenRouter
              </a>
              에서 발급한 통합 키 하나로 Gemini/OpenAI 모델을 모두 사용합니다.
            </p>
          </div>

          {/* 생성 이미지 저장 위치 안내 (v0.4.4) */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              생성 이미지 저장 위치
            </label>
            <div className="flex items-center justify-between p-3 bg-gray-50 border border-gray-200 rounded-lg">
              <div>
                <p className="text-sm text-gray-700">
                  <code className="text-xs bg-white px-1 py-0.5 rounded">~/Downloads/AI_Gen/</code>
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  세션별 하위 폴더에 자동 저장됩니다
                </p>
              </div>
              <button
                onClick={handleOpenFolder}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md bg-purple-600 text-white hover:bg-purple-700"
              >
                <FolderOpen size={14} />
                폴더 열기
              </button>
            </div>
          </div>

          {/* 계정 정보 및 로그아웃 */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              <div className="flex items-center gap-2">
                <User size={16} />
                로그인 계정
              </div>
            </label>
            <div className="flex items-center justify-between p-3 border border-gray-300 rounded-lg bg-gray-50">
              <div className="flex items-center gap-3">
                {user?.picture && (
                  <img
                    src={user.picture}
                    alt={user.name}
                    className="w-8 h-8 rounded-full"
                  />
                )}
                <div>
                  <p className="text-sm font-medium text-gray-800">{user?.name || '알 수 없음'}</p>
                  <p className="text-xs text-gray-500">{user?.email || ''}</p>
                </div>
              </div>
              <button
                onClick={handleLogout}
                disabled={isLoggingOut}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
              >
                <LogOut size={16} />
                {isLoggingOut ? '로그아웃 중...' : '로그아웃'}
              </button>
            </div>
          </div>

          {/* 정보 및 라이선스 (GPL-3.0 §5d 고지) */}
          <div>
            <button
              onClick={() => setShowAbout((prev) => !prev)}
              className="flex items-center gap-2 text-sm font-semibold text-gray-700 hover:text-purple-600 transition-colors"
            >
              <Info size={16} />
              정보 및 라이선스
              {showAbout ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>

            {showAbout && (
              <div className="mt-2 p-3 bg-gray-50 border border-gray-200 rounded-lg space-y-2">
                <p className="text-sm font-medium text-gray-800">
                  StyleStudio <span className="text-gray-500 font-normal">v{version}</span>
                </p>
                <p className="text-xs text-gray-600">
                  Copyright &copy; 2026 최진평 (Jinpyoung Choi)
                </p>
                <p className="text-xs text-gray-600 leading-relaxed">
                  이 프로그램은 자유 소프트웨어이며 <strong>GNU General Public License v3.0 이상</strong>
                  조건으로 배포됩니다. 이 프로그램에는 <strong>어떠한 보증도 없습니다.</strong> 라이선스
                  조건에 따라 재배포하거나 수정할 수 있습니다.
                </p>
                <div className="flex flex-col gap-1 pt-1">
                  <button
                    onClick={() => handleOpenUrl('https://www.gnu.org/licenses/gpl-3.0.html')}
                    className="text-xs text-purple-600 hover:underline text-left"
                  >
                    GNU GPL v3.0 전문 보기
                  </button>
                  <button
                    onClick={() => handleOpenUrl('https://github.com/zzamjak-cloud/StyleStudio')}
                    className="text-xs text-purple-600 hover:underline text-left"
                  >
                    소스 코드 (GitHub)
                  </button>
                  <button
                    onClick={() =>
                      handleOpenUrl(
                        'https://github.com/zzamjak-cloud/StyleStudio/blob/main/THIRD-PARTY-NOTICES.md'
                      )
                    }
                    className="text-xs text-purple-600 hover:underline text-left"
                  >
                    서드파티 라이선스 고지
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 저장 알림 */}
        {saveNotification && (
          <div className="mx-6 mb-4 px-4 py-2 bg-green-100 text-green-700 rounded-lg text-sm text-center">
            {saveNotification}
          </div>
        )}

        {/* 푸터 */}
        <div className="flex items-center justify-between p-6 border-t border-gray-200">
          <span className="text-xs text-gray-400">v{version}</span>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            >
              취소
            </button>
            <button
              onClick={handleSave}
              className="px-6 py-2 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white rounded-lg font-semibold transition-all shadow-lg hover:shadow-xl"
            >
              저장
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});
