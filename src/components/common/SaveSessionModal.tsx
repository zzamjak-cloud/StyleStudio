import { useState, useEffect } from 'react';
import { X, Save, Palette, User, Mountain, Box, Gamepad2, Grid3x3, Sparkles, Monitor, Award } from 'lucide-react';
import { Session, SessionType } from '../../types/session';
import { logger } from '../../lib/logger';

interface SaveSessionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (name: string, type: SessionType) => void;
  currentSession?: Session | null; // 기존 세션 (업데이트 모드용)
}

export function SaveSessionModal({ isOpen, onClose, onSave, currentSession }: SaveSessionModalProps) {
  const [sessionName, setSessionName] = useState('');
  const [sessionType, setSessionType] = useState<SessionType>('STYLE');

  // 모달이 열릴 때 currentSession이 있으면 기본값 설정
  useEffect(() => {
    if (isOpen && currentSession) {
      setSessionName(currentSession.name);
      setSessionType(currentSession.type);
      logger.debug('📝 기존 세션 정보로 초기화:', currentSession.name, currentSession.type);
    } else if (isOpen && !currentSession) {
      setSessionName('');
      setSessionType('STYLE');
    }
  }, [isOpen, currentSession]);

  const handleSave = () => {
    if (sessionName.trim()) {
      onSave(sessionName.trim(), sessionType);
      setSessionName('');
      setSessionType('STYLE');
      onClose();
    } else {
      alert('세션 이름을 입력해주세요');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full">
        {/* 헤더 */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-xl font-bold text-gray-800">
            {currentSession ? '세션 업데이트' : '세션 저장'}
          </h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X size={20} className="text-gray-500" />
          </button>
        </div>

        {/* 본문 */}
        <div className="p-6 space-y-4">
          {/* 세션 이름 */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              세션 이름
            </label>
            <input
              type="text"
              value={sessionName}
              onChange={(e) => setSessionName(e.target.value)}
              placeholder="예: 애니메이션 스타일, 캐릭터 A"
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              autoFocus
            />
          </div>

          {/* 세션 타입 */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              세션 타입
            </label>
            <div className="grid grid-cols-3 gap-3">
              <button
                onClick={() => setSessionType('CHARACTER')}
                className={`flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-semibold transition-all ${
                  sessionType === 'CHARACTER'
                    ? 'bg-blue-600 text-white shadow-lg'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                <User size={20} />
                <span>캐릭터</span>
              </button>

              <button
                onClick={() => setSessionType('BACKGROUND')}
                className={`flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-semibold transition-all ${
                  sessionType === 'BACKGROUND'
                    ? 'bg-green-600 text-white shadow-lg'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                <Mountain size={20} />
                <span>배경</span>
              </button>

              <button
                onClick={() => setSessionType('ICON')}
                className={`flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-semibold transition-all ${
                  sessionType === 'ICON'
                    ? 'bg-amber-600 text-white shadow-lg'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                <Box size={20} />
                <span>아이콘</span>
              </button>

              <button
                onClick={() => setSessionType('PIXELART_CHARACTER')}
                className={`flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-semibold transition-all ${
                  sessionType === 'PIXELART_CHARACTER'
                    ? 'bg-cyan-600 text-white shadow-lg'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                <Gamepad2 size={20} />
                <span>픽셀 캐릭터</span>
              </button>

              <button
                onClick={() => setSessionType('PIXELART_BACKGROUND')}
                className={`flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-semibold transition-all ${
                  sessionType === 'PIXELART_BACKGROUND'
                    ? 'bg-teal-600 text-white shadow-lg'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                <Grid3x3 size={20} />
                <span>픽셀 배경</span>
              </button>

              <button
                onClick={() => setSessionType('PIXELART_ICON')}
                className={`flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-semibold transition-all ${
                  sessionType === 'PIXELART_ICON'
                    ? 'bg-indigo-600 text-white shadow-lg'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                <Sparkles size={20} />
                <span>픽셀 아이콘</span>
              </button>

              <button
                onClick={() => setSessionType('STYLE')}
                className={`flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-semibold transition-all ${
                  sessionType === 'STYLE'
                    ? 'bg-purple-600 text-white shadow-lg'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                <Palette size={20} />
                <span>스타일</span>
              </button>

              <button
                onClick={() => setSessionType('UI')}
                className={`flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-semibold transition-all ${
                  sessionType === 'UI'
                    ? 'bg-pink-600 text-white shadow-lg'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                <Monitor size={20} />
                <span>UI 디자인</span>
              </button>

              <button
                onClick={() => setSessionType('LOGO')}
                className={`flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-semibold transition-all ${
                  sessionType === 'LOGO'
                    ? 'bg-red-600 text-white shadow-lg'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                <Award size={20} />
                <span>로고</span>
              </button>
            </div>
          </div>
        </div>

        {/* 푸터 */}
        <div className="flex items-center justify-end gap-3 p-6 border-t border-gray-200">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          >
            취소
          </button>
          <button
            onClick={handleSave}
            className="flex items-center gap-2 px-6 py-2 bg-gradient-to-r from-green-600 to-teal-600 hover:from-green-700 hover:to-teal-700 text-white rounded-lg font-semibold transition-all shadow-lg hover:shadow-xl"
          >
            <Save size={18} />
            <span>{currentSession ? '업데이트' : '저장'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
