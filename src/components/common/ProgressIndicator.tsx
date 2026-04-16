/**
 * 진행 상태 표시 컴포넌트
 * 세션 저장 중 실시간 진행 상태를 표시합니다
 */

interface ProgressIndicatorProps {
  stage: 'idle' | 'translating' | 'saving' | 'complete';
  message: string;
  percentage: number;
  estimatedSecondsLeft: number;
}

export function ProgressIndicator(props: ProgressIndicatorProps) {
  // idle 상태일 때는 표시하지 않음
  if (props.stage === 'idle') {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 bg-white rounded-xl shadow-2xl p-4 border-2 border-purple-200 min-w-[320px] animate-slide-up z-50">
      {/* 헤더 */}
      <div className="flex items-center gap-3 mb-3">
        {/* 아이콘 */}
        {props.stage === 'complete' ? (
          <div className="flex-shrink-0 w-6 h-6 bg-green-500 rounded-full flex items-center justify-center">
            <svg
              className="w-4 h-4 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
        ) : (
          <div className="animate-spin rounded-full h-6 w-6 border-3 border-purple-500 border-t-transparent flex-shrink-0" />
        )}

        {/* 메시지 */}
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <p className="font-bold text-gray-800">{props.message}</p>
            {props.stage !== 'complete' && (
              <div className="flex gap-1">
                <span className="animate-bounce-delay-0 text-purple-600">.</span>
                <span className="animate-bounce-delay-1 text-purple-600">.</span>
                <span className="animate-bounce-delay-2 text-purple-600">.</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 진행 바 */}
      <div className="w-full bg-gray-200 rounded-full h-2.5 overflow-hidden">
        <div
          className="bg-gradient-to-r from-purple-500 to-blue-500 h-full transition-all duration-300 ease-out"
          style={{ width: `${props.percentage}%` }}
        />
      </div>

      <style>{`
        @keyframes bounce-dot {
          0%, 80%, 100% {
            transform: translateY(0);
            opacity: 0.4;
          }
          40% {
            transform: translateY(-8px);
            opacity: 1;
          }
        }

        .animate-bounce-delay-0 {
          animation: bounce-dot 1.4s infinite;
          animation-delay: 0s;
          display: inline-block;
          font-size: 1.5rem;
          font-weight: bold;
        }

        .animate-bounce-delay-1 {
          animation: bounce-dot 1.4s infinite;
          animation-delay: 0.2s;
          display: inline-block;
          font-size: 1.5rem;
          font-weight: bold;
        }

        .animate-bounce-delay-2 {
          animation: bounce-dot 1.4s infinite;
          animation-delay: 0.4s;
          display: inline-block;
          font-size: 1.5rem;
          font-weight: bold;
        }
      `}</style>
    </div>
  );
}
