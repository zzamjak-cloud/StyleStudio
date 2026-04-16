import { PlusCircle } from 'lucide-react';

interface EmptyStateProps {
  onNewSession: () => void;
}

/**
 * 세션이 없을 때 표시되는 빈 상태 컴포넌트
 */
export function EmptyState({ onNewSession }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full bg-background px-8">
      <div className="max-w-md text-center space-y-6">
        {/* 아이콘 */}
        <div className="flex justify-center">
          <div className="p-4 bg-primary/10 rounded-full">
            <PlusCircle size={64} className="text-primary" />
          </div>
        </div>

        {/* 제목 */}
        <h2 className="text-2xl font-bold text-foreground">
          세션을 시작하세요
        </h2>

        {/* 설명 */}
        <p className="text-muted-foreground text-base leading-relaxed">
          StyleStudio를 사용하려면 새 세션을 생성해야 합니다.<br />
          세션 타입을 선택하고, 참조 이미지를 업로드하여 AI 분석을 시작하세요.
        </p>

        {/* 버튼 */}
        <button
          onClick={onNewSession}
          className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-lg font-semibold hover:bg-primary/90 transition-colors shadow-lg hover:shadow-xl"
        >
          <PlusCircle size={20} />
          <span>새 세션 만들기</span>
        </button>

        {/* 추가 안내 */}
        <div className="pt-4 border-t border-border">
          <p className="text-xs text-muted-foreground">
            💡 <strong>Tip:</strong> 왼쪽 사이드바의 "+" 버튼으로도 언제든지 세션을 생성할 수 있습니다.
          </p>
        </div>
      </div>
    </div>
  );
}
