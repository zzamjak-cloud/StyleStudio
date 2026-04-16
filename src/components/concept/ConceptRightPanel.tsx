import { useState, useCallback, useEffect, useRef, memo } from 'react';
import { Sparkles, Loader2, AlertTriangle } from 'lucide-react';
import { ConceptSessionData } from '../../types/concept';

interface ConceptRightPanelProps {
  settings: ConceptSessionData['generationSettings'];
  onSettingsChange: (settings: ConceptSessionData['generationSettings']) => void;
  onGenerate: (prompt: string) => void;
  isGenerating: boolean;
  disabled?: boolean;
  errorMessage?: string | null;
  promptValue?: string;
}

/** 컨셉 세션 우측 생성 패널 */
export const ConceptRightPanel = memo(({
  settings,
  onSettingsChange,
  onGenerate,
  isGenerating,
  disabled,
  errorMessage,
  promptValue,
}: ConceptRightPanelProps) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [costWarning, setCostWarning] = useState<{ size: '2k' | '3k' } | null>(null);

  // textarea 높이 자동 조절
  const adjustTextareaHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const minHeight = 24 * 3;
    const maxHeight = 24 * 10;

    textarea.style.height = 'auto';
    const newHeight = Math.max(minHeight, Math.min(textarea.scrollHeight, maxHeight));
    textarea.style.height = `${newHeight}px`;

    if (textarea.scrollHeight > maxHeight) {
      textarea.style.overflowY = 'auto';
    } else {
      textarea.style.overflowY = 'hidden';
    }
  }, []);

  useEffect(() => {
    const frameId = requestAnimationFrame(() => adjustTextareaHeight());
    return () => cancelAnimationFrame(frameId);
  }, [adjustTextareaHeight]);

  // 히스토리 선택 시 외부 프롬프트를 입력창에 반영
  useEffect(() => {
    if (!textareaRef.current || promptValue === undefined) return;
    textareaRef.current.value = promptValue;
    adjustTextareaHeight();
  }, [promptValue, adjustTextareaHeight]);

  // 이미지 크기 변경 핸들러 (비용 경고 포함)
  const handleSizeClick = useCallback((size: '1k' | '2k' | '3k') => {
    if (size === '2k' || size === '3k') {
      setCostWarning({ size });
    } else {
      onSettingsChange({ ...settings, size });
    }
  }, [settings, onSettingsChange]);

  // 비용 경고 확인 후 크기 변경
  const confirmSizeChange = useCallback(() => {
    if (costWarning) {
      onSettingsChange({ ...settings, size: costWarning.size });
      setCostWarning(null);
    }
  }, [costWarning, settings, onSettingsChange]);

  // 생성 실행
  const handleGenerate = useCallback(() => {
    if (!isGenerating && !disabled) {
      onGenerate(textareaRef.current?.value || '');
    }
  }, [isGenerating, disabled, onGenerate]);

  return (
    <div className="flex-[3] bg-white flex flex-col">
      {/* 헤더 */}
      <div className="px-4 py-3 border-b border-gray-200">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-purple-600" />
          <h3 className="font-semibold text-gray-800">이미지 생성</h3>
        </div>
      </div>

      {/* 컨텐츠 영역 */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {/* 프롬프트 입력 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            프롬프트 (선택사항)
          </label>
          <textarea
            ref={textareaRef}
            defaultValue=""
            onInput={adjustTextareaHeight}
            placeholder="비워두면 입력된 정보를 기반으로 자동 생성합니다..."
            rows={3}
            disabled={disabled}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:bg-gray-50 disabled:text-gray-400 min-h-[72px]"
          />
          <p className="mt-1 text-xs text-gray-500">
            좌측의 게임 정보와 참조 이미지를 바탕으로 AI가 컨셉을 생성합니다
          </p>
        </div>

        {/* 생성 버튼 */}
        <button
          onClick={handleGenerate}
          disabled={isGenerating || disabled}
          className="w-full py-3 bg-gradient-to-r from-purple-500 to-purple-600 text-white rounded-lg hover:from-purple-600 hover:to-purple-700 disabled:from-gray-300 disabled:to-gray-400 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 font-medium"
        >
          {isGenerating ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              <span>생성 중...</span>
            </>
          ) : (
            <>
              <Sparkles className="w-5 h-5" />
              <span>이미지 생성하기</span>
            </>
          )}
        </button>

        {errorMessage && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {errorMessage}
          </div>
        )}

        {/* 구분선 */}
        <div className="border-t border-gray-200 pt-4 space-y-4">
          {/* 모델 선택 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              모델 선택
            </label>
            <select
              value={settings.model}
              onChange={(e) => onSettingsChange({ ...settings, model: e.target.value as any })}
              disabled={disabled}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:bg-gray-50"
            >
              <option value="nanobanana-pro">나노바나나 프로</option>
              <option value="nanobanana-2">나노바나나 2</option>
            </select>
          </div>

          {/* 비율 선택 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              이미지 비율
            </label>
            <div className="grid grid-cols-5 gap-1">
              {['1:1', '16:9', '9:16', '4:3', '3:4'].map((ratio) => (
                <button
                  key={ratio}
                  onClick={() => onSettingsChange({ ...settings, ratio: ratio as any })}
                  disabled={disabled}
                  className={`px-1 py-1.5 text-xs rounded-md border transition-colors ${
                    settings.ratio === ratio
                      ? 'bg-purple-500 text-white border-purple-500'
                      : 'bg-white text-gray-700 border-gray-300 hover:border-purple-300'
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  {ratio}
                </button>
              ))}
            </div>
          </div>

          {/* 크기 선택 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              이미지 크기
            </label>
            <div className="grid grid-cols-3 gap-1">
              {['1k', '2k', '3k'].map((size) => (
                <button
                  key={size}
                  onClick={() => handleSizeClick(size as '1k' | '2k' | '3k')}
                  disabled={disabled}
                  className={`px-1 py-1.5 text-xs rounded-md border transition-colors uppercase ${
                    settings.size === size
                      ? 'bg-purple-500 text-white border-purple-500'
                      : 'bg-white text-gray-700 border-gray-300 hover:border-purple-300'
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  {size.toUpperCase()}
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-500 mt-1">
              <span className="text-green-600 font-medium">1K 권장</span> · 2K/3K는 비용이 크게 증가합니다
            </p>
          </div>

          {/* 그리드 설정 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              그리드 레이아웃
            </label>
            <div className="grid grid-cols-4 gap-1">
              {['1x1', '2x2', '3x3', '4x4'].map((grid) => (
                <button
                  key={grid}
                  onClick={() => onSettingsChange({ ...settings, grid: grid as any })}
                  disabled={disabled}
                  className={`px-1 py-1.5 text-xs rounded-md border transition-colors ${
                    settings.grid === grid
                      ? 'bg-purple-500 text-white border-purple-500'
                      : 'bg-white text-gray-700 border-gray-300 hover:border-purple-300'
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  {grid}
                </button>
              ))}
            </div>
            <p className="mt-1 text-xs text-gray-500">
              그리드로 여러 베리에이션을 한 번에 생성합니다
            </p>
          </div>
        </div>
      </div>

      {/* 비용 경고 팝업 */}
      {costWarning && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full">
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-3 bg-amber-100 rounded-full">
                  <AlertTriangle size={28} className="text-amber-600" />
                </div>
                <h3 className="text-xl font-bold text-gray-800">비용 경고</h3>
              </div>
              <div className="space-y-3 text-gray-700">
                <p className="font-semibold text-lg text-amber-700">
                  ⚠️ {costWarning.size.toUpperCase()} 이미지는 비용이 크게 증가합니다!
                </p>
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                  <ul className="space-y-2 text-sm">
                    <li className="flex items-start gap-2">
                      <span className="text-amber-600">•</span>
                      <span>
                        <span className="font-medium">일반적인 용도</span>에서는{' '}
                        <span className="text-green-600 font-bold">1K 이미지로 충분</span>합니다.
                      </span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-amber-600">•</span>
                      <span>
                        {costWarning.size === '2k' ? '2K는 1K 대비 약 4배' : '3K는 1K 대비 약 9배'}의 비용이 발생할 수 있습니다.
                      </span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-amber-600">•</span>
                      <span>
                        <span className="font-medium">실제로 고화질이 필요한 경우</span>에만 선택적으로 사용하세요.
                      </span>
                    </li>
                  </ul>
                </div>
                <p className="text-sm text-gray-600 mt-2">
                  💡 먼저 1K로 테스트하고, 마음에 드는 결과물만 고화질로 다시 생성하는 것을 권장합니다.
                </p>
              </div>
            </div>
            <div className="flex gap-3 p-4 bg-gray-50 rounded-b-xl border-t border-gray-200">
              <button
                onClick={() => setCostWarning(null)}
                className="flex-1 px-4 py-2.5 bg-white border border-gray-300 hover:bg-gray-100 rounded-lg font-medium transition-colors text-gray-700"
              >
                취소 (1K 유지)
              </button>
              <button
                onClick={confirmSizeChange}
                className="flex-1 px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg font-medium transition-colors"
              >
                {costWarning.size.toUpperCase()} 사용
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

ConceptRightPanel.displayName = 'ConceptRightPanel';