import { memo, useState, useEffect } from 'react';
import { X, Palette, User, Mountain, Box, Gamepad2, Grid3x3, Sparkles, Monitor, Award, Images, MessageCircle, Lightbulb } from 'lucide-react';
import { Session, SessionType } from '../../types/session';
import { SESSION_CONFIG } from '../../lib/config/sessionConfig';

interface NewSessionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (name: string, type: SessionType) => void;
  existingSessions: Session[];
}

/**
 * 세션 타입별 자동 이름 생성.
 * 동일 타입 내 최대 인덱스 기준으로 증가 — 삭제된 번호 재사용 없음.
 */
function generateSessionName(type: SessionType, existingSessions: Session[]): string {
  const label = SESSION_CONFIG[type].label;
  const sameType = existingSessions.filter((s) => s.type === type);
  const pattern = new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_(\\d+)$`);
  let maxIndex = 0;
  for (const s of sameType) {
    const m = s.name.match(pattern);
    if (m) maxIndex = Math.max(maxIndex, parseInt(m[1], 10));
  }
  return `${label}_${Math.max(maxIndex, sameType.length) + 1}`;
}

export const NewSessionModal = memo(function NewSessionModal({ isOpen, onClose, onCreate, existingSessions }: NewSessionModalProps) {
  const [sessionType, setSessionType] = useState<SessionType>('BASIC');

  // 모달이 열릴 때마다 초기화
  useEffect(() => {
    if (isOpen) {
      setSessionType('BASIC');
    }
  }, [isOpen]);

  const handleCreate = () => {
    const name = generateSessionName(sessionType, existingSessions);
    onCreate(name, sessionType);
    setSessionType('BASIC');
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full">
        {/* 헤더 */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-xl font-bold text-gray-800">새 세션 시작</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X size={20} className="text-gray-500" />
          </button>
        </div>

        {/* 본문 */}
        <div className="p-6 space-y-6">
          {/* 세션 타입 */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-3">
              세션 타입
            </label>
            <div className="grid grid-cols-3 gap-4">
              {/* BASIC */}
              <button
                onClick={() => setSessionType('BASIC')}
                className={`flex flex-col items-start gap-2 p-4 rounded-lg font-semibold transition-all border-2 ${
                  sessionType === 'BASIC'
                    ? 'bg-slate-50 border-slate-600 shadow-lg'
                    : 'bg-white border-gray-200 hover:border-slate-300 hover:bg-slate-50/50'
                }`}
              >
                <div className="flex items-center gap-2">
                  <MessageCircle size={20} className={sessionType === 'BASIC' ? 'text-slate-600' : 'text-gray-600'} />
                  <span className={sessionType === 'BASIC' ? 'text-slate-900' : 'text-gray-700'}>기본 (채팅)</span>
                </div>
                <p className="text-xs text-left text-gray-600">
                  프롬프트로 이미지를 생성하고 대화하며 수정합니다
                </p>
              </button>

              {/* CHARACTER */}
              <button
                onClick={() => setSessionType('CHARACTER')}
                className={`flex flex-col items-start gap-2 p-4 rounded-lg font-semibold transition-all border-2 ${
                  sessionType === 'CHARACTER'
                    ? 'bg-blue-50 border-blue-600 shadow-lg'
                    : 'bg-white border-gray-200 hover:border-blue-300 hover:bg-blue-50/50'
                }`}
              >
                <div className="flex items-center gap-2">
                  <User size={20} className={sessionType === 'CHARACTER' ? 'text-blue-600' : 'text-gray-600'} />
                  <span className={sessionType === 'CHARACTER' ? 'text-blue-900' : 'text-gray-700'}>캐릭터</span>
                </div>
                <p className="text-xs text-left text-gray-600">
                  캐릭터의 외형을 학습하여 일관성을 유지합니다
                </p>
              </button>

              {/* BACKGROUND */}
              <button
                onClick={() => setSessionType('BACKGROUND')}
                className={`flex flex-col items-start gap-2 p-4 rounded-lg font-semibold transition-all border-2 ${
                  sessionType === 'BACKGROUND'
                    ? 'bg-green-50 border-green-600 shadow-lg'
                    : 'bg-white border-gray-200 hover:border-green-300 hover:bg-green-50/50'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Mountain size={20} className={sessionType === 'BACKGROUND' ? 'text-green-600' : 'text-gray-600'} />
                  <span className={sessionType === 'BACKGROUND' ? 'text-green-900' : 'text-gray-700'}>배경</span>
                </div>
                <p className="text-xs text-left text-gray-600">
                  배경 이미지 스타일을 학습하여 다양한 환경을 생성합니다
                </p>
              </button>

              {/* ICON */}
              <button
                onClick={() => setSessionType('ICON')}
                className={`flex flex-col items-start gap-2 p-4 rounded-lg font-semibold transition-all border-2 ${
                  sessionType === 'ICON'
                    ? 'bg-amber-50 border-amber-600 shadow-lg'
                    : 'bg-white border-gray-200 hover:border-amber-300 hover:bg-amber-50/50'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Box size={20} className={sessionType === 'ICON' ? 'text-amber-600' : 'text-gray-600'} />
                  <span className={sessionType === 'ICON' ? 'text-amber-900' : 'text-gray-700'}>아이콘</span>
                </div>
                <p className="text-xs text-left text-gray-600">
                  아이템/아이콘 스타일을 학습하여 다양한 오브젝트를 생성합니다
                </p>
              </button>

              {/* PIXELART_CHARACTER */}
              <button
                onClick={() => setSessionType('PIXELART_CHARACTER')}
                className={`flex flex-col items-start gap-2 p-4 rounded-lg font-semibold transition-all border-2 ${
                  sessionType === 'PIXELART_CHARACTER'
                    ? 'bg-cyan-50 border-cyan-600 shadow-lg'
                    : 'bg-white border-gray-200 hover:border-cyan-300 hover:bg-cyan-50/50'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Gamepad2 size={20} className={sessionType === 'PIXELART_CHARACTER' ? 'text-cyan-600' : 'text-gray-600'} />
                  <span className={sessionType === 'PIXELART_CHARACTER' ? 'text-cyan-900' : 'text-gray-700'}>픽셀 캐릭터</span>
                </div>
                <p className="text-xs text-left text-gray-600">
                  픽셀아트 캐릭터를 학습하여 게임 스프라이트를 생성합니다
                </p>
              </button>

              {/* PIXELART_BACKGROUND */}
              <button
                onClick={() => setSessionType('PIXELART_BACKGROUND')}
                className={`flex flex-col items-start gap-2 p-4 rounded-lg font-semibold transition-all border-2 ${
                  sessionType === 'PIXELART_BACKGROUND'
                    ? 'bg-teal-50 border-teal-600 shadow-lg'
                    : 'bg-white border-gray-200 hover:border-teal-300 hover:bg-teal-50/50'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Grid3x3 size={20} className={sessionType === 'PIXELART_BACKGROUND' ? 'text-teal-600' : 'text-gray-600'} />
                  <span className={sessionType === 'PIXELART_BACKGROUND' ? 'text-teal-900' : 'text-gray-700'}>픽셀 배경</span>
                </div>
                <p className="text-xs text-left text-gray-600">
                  픽셀아트 배경을 학습하여 게임 씬을 생성합니다
                </p>
              </button>

              {/* PIXELART_ICON */}
              <button
                onClick={() => setSessionType('PIXELART_ICON')}
                className={`flex flex-col items-start gap-2 p-4 rounded-lg font-semibold transition-all border-2 ${
                  sessionType === 'PIXELART_ICON'
                    ? 'bg-indigo-50 border-indigo-600 shadow-lg'
                    : 'bg-white border-gray-200 hover:border-indigo-300 hover:bg-indigo-50/50'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Sparkles size={20} className={sessionType === 'PIXELART_ICON' ? 'text-indigo-600' : 'text-gray-600'} />
                  <span className={sessionType === 'PIXELART_ICON' ? 'text-indigo-900' : 'text-gray-700'}>픽셀 아이콘</span>
                </div>
                <p className="text-xs text-left text-gray-600">
                  픽셀아트 아이콘을 학습하여 게임 UI 요소를 생성합니다
                </p>
              </button>

              {/* STYLE */}
              <button
                onClick={() => setSessionType('STYLE')}
                className={`flex flex-col items-start gap-2 p-4 rounded-lg font-semibold transition-all border-2 ${
                  sessionType === 'STYLE'
                    ? 'bg-purple-50 border-purple-600 shadow-lg'
                    : 'bg-white border-gray-200 hover:border-purple-300 hover:bg-purple-50/50'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Palette size={20} className={sessionType === 'STYLE' ? 'text-purple-600' : 'text-gray-600'} />
                  <span className={sessionType === 'STYLE' ? 'text-purple-900' : 'text-gray-700'}>스타일</span>
                </div>
                <p className="text-xs text-left text-gray-600">
                  특정 화풍이나 아트 스타일을 학습하여 재현합니다
                </p>
              </button>

              {/* UI */}
              <button
                onClick={() => setSessionType('UI')}
                className={`flex flex-col items-start gap-2 p-4 rounded-lg font-semibold transition-all border-2 ${
                  sessionType === 'UI'
                    ? 'bg-pink-50 border-pink-600 shadow-lg'
                    : 'bg-white border-gray-200 hover:border-pink-300 hover:bg-pink-50/50'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Monitor size={20} className={sessionType === 'UI' ? 'text-pink-600' : 'text-gray-600'} />
                  <span className={sessionType === 'UI' ? 'text-pink-900' : 'text-gray-700'}>UI 디자인</span>
                </div>
                <p className="text-xs text-left text-gray-600">
                  UI/UX 디자인 스타일을 학습하여 화면을 생성합니다
                </p>
              </button>

              {/* LOGO */}
              <button
                onClick={() => setSessionType('LOGO')}
                className={`flex flex-col items-start gap-2 p-4 rounded-lg font-semibold transition-all border-2 ${
                  sessionType === 'LOGO'
                    ? 'bg-red-50 border-red-600 shadow-lg'
                    : 'bg-white border-gray-200 hover:border-red-300 hover:bg-red-50/50'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Award size={20} className={sessionType === 'LOGO' ? 'text-red-600' : 'text-gray-600'} />
                  <span className={sessionType === 'LOGO' ? 'text-red-900' : 'text-gray-700'}>로고</span>
                </div>
                <p className="text-xs text-left text-gray-600">
                  게임 타이틀 로고 스타일을 학습하여 브랜드 로고를 생성합니다
                </p>
              </button>

              {/* ILLUSTRATION */}
              <button
                onClick={() => setSessionType('ILLUSTRATION')}
                className={`flex flex-col items-start gap-2 p-4 rounded-lg font-semibold transition-all border-2 ${
                  sessionType === 'ILLUSTRATION'
                    ? 'bg-violet-50 border-violet-600 shadow-lg'
                    : 'bg-white border-gray-200 hover:border-violet-300 hover:bg-violet-50/50'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Images size={20} className={sessionType === 'ILLUSTRATION' ? 'text-violet-600' : 'text-gray-600'} />
                  <span className={sessionType === 'ILLUSTRATION' ? 'text-violet-900' : 'text-gray-700'}>일러스트</span>
                </div>
                <p className="text-xs text-left text-gray-600">
                  여러 캐릭터를 등록하고 배경과 함께 씬을 구성합니다
                </p>
              </button>

              {/* CONCEPT */}
              <button
                onClick={() => setSessionType('CONCEPT')}
                className={`flex flex-col items-start gap-2 p-4 rounded-lg font-semibold transition-all border-2 ${
                  sessionType === 'CONCEPT'
                    ? 'bg-orange-50 border-orange-600 shadow-lg'
                    : 'bg-white border-gray-200 hover:border-orange-300 hover:bg-orange-50/50'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Lightbulb size={20} className={sessionType === 'CONCEPT' ? 'text-orange-600' : 'text-gray-600'} />
                  <span className={sessionType === 'CONCEPT' ? 'text-orange-900' : 'text-gray-700'}>컨셉</span>
                </div>
                <p className="text-xs text-left text-gray-600">
                  모바일 게임 컨셉 아트를 생성하고 베리에이션을 만듭니다
                </p>
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
            onClick={handleCreate}
            className="px-6 py-2 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white rounded-lg font-semibold transition-all shadow-lg hover:shadow-xl"
          >
            시작하기
          </button>
        </div>
      </div>
    </div>
  );
});
