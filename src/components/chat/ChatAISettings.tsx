import { useState } from 'react';
import { Settings, Palette, AlertTriangle, ChevronDown } from 'lucide-react';
import { ChatGenerationSettings } from '../../types/chat';
import { ART_STYLE_PRESETS } from '../../types/concept';
import { PixelArtGridLayout } from '../../types/pixelart';
import { getAvailableImageModels } from '../../hooks/api/imageModels';

interface ChatAISettingsProps {
  settings: ChatGenerationSettings;
  hasOpenAIApiKey: boolean;
  onSettingsChange: (settings: Partial<ChatGenerationSettings>) => void;
}

type ImageSize = ChatGenerationSettings['imageSize'];
type AspectRatio = ChatGenerationSettings['aspectRatio'];

/** 채팅 세션 우측 AI 설정 패널 */
export function ChatAISettings({ settings, hasOpenAIApiKey, onSettingsChange }: ChatAISettingsProps) {
  // 비용 경고 팝업 상태 (2K 이상은 비용 증가 경고)
  const [costWarning, setCostWarning] = useState<{ size: '2K' | '4K' } | null>(null);

  // 이미지 크기 변경 핸들러 (1K는 바로 적용, 2K/4K는 경고 후 적용)
  const handleSizeClick = (size: ImageSize) => {
    if (size === '2K' || size === '4K') {
      setCostWarning({ size });
    } else {
      onSettingsChange({ imageSize: size });
    }
  };

  // 비용 경고 확인 후 크기 변경
  const confirmSizeChange = () => {
    if (costWarning) {
      onSettingsChange({ imageSize: costWarning.size });
      setCostWarning(null);
    }
  };

  const imageSizes: ImageSize[] = ['1K', '2K', '4K'];
  const gridLayouts: PixelArtGridLayout[] = ['1x1', '2x2', '3x3', '4x4'];
  const availableModels = getAvailableImageModels(hasOpenAIApiKey);
  const selectedModel = availableModels.find((model) => model.id === settings.imageModel) ?? availableModels[0];
  const aspectRatios = selectedModel.supports.aspectRatios as AspectRatio[];
  const supportedSizes = selectedModel.supports.imageSizes;

  return (
    <div className="w-80 border-l border-gray-200 bg-white flex flex-col">
      {/* 헤더 */}
      <div className="px-4 py-3 border-b border-gray-200">
        <div className="flex items-center gap-2">
          <Settings className="w-5 h-5 text-gray-600" />
          <h3 className="font-semibold text-gray-800">AI 설정</h3>
        </div>
      </div>

      {/* 설정 영역 */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6">
        {/* 모델 선택 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            모델 선택
          </label>
          <select
            value={settings.imageModel}
            onChange={(e) =>
              onSettingsChange({ imageModel: e.target.value as ChatGenerationSettings['imageModel'] })
            }
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
          >
            {availableModels.map(({ id, label }) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
          {!hasOpenAIApiKey && (
            <p className="text-xs text-amber-600 mt-2">ChatGPT API Key를 입력하면 덕테이프 모델이 활성화됩니다.</p>
          )}
        </div>

        {/* 비율 선택 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            이미지 비율
          </label>
          <div className={`grid gap-1 ${aspectRatios.length <= 3 ? 'grid-cols-3' : 'grid-cols-5'}`}>
            {aspectRatios.map((ratio) => (
              <button
                key={ratio}
                onClick={() => onSettingsChange({ aspectRatio: ratio })}
                className={`px-1 py-1.5 text-xs rounded-md border transition-colors ${
                  settings.aspectRatio === ratio
                    ? 'bg-purple-500 text-white border-purple-500'
                    : 'bg-white text-gray-700 border-gray-300 hover:border-purple-300'
                }`}
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
          <div className="grid grid-cols-3 gap-2">
            {imageSizes.map((size) => (
              <button
                key={size}
                onClick={() => handleSizeClick(size)}
                disabled={!supportedSizes.includes(size)}
                className={`px-3 py-2 text-sm rounded-lg border transition-colors ${
                  settings.imageSize === size
                    ? 'bg-purple-500 text-white border-purple-500'
                    : 'bg-white text-gray-700 border-gray-300 hover:border-purple-300'
                } disabled:bg-gray-100 disabled:text-gray-400 disabled:border-gray-200 disabled:cursor-not-allowed`}
              >
                {size}
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-500 mt-1">
            <span className="text-green-600 font-medium">1K 권장</span> · 2K/4K는 비용이 크게 증가합니다
          </p>
          {settings.imageModel === 'gpt-image-2' && (
            <p className="text-xs text-gray-500 mt-1">
              덕테이프는 내부적으로 1024x1024, 1792x1024, 1024x1792 규격으로 처리됩니다.
            </p>
          )}
        </div>

        {/* 품질 선택 (덕테이프 전용) */}
        {settings.imageModel === 'gpt-image-2' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">이미지 품질</label>
            <div className="grid grid-cols-3 gap-2">
              {(['low', 'medium', 'high'] as const).map((quality) => (
                <button
                  key={quality}
                  onClick={() => onSettingsChange({ imageQuality: quality })}
                  className={`px-3 py-2 text-sm rounded-lg border transition-colors ${
                    (settings.imageQuality ?? 'medium') === quality
                      ? 'bg-purple-500 text-white border-purple-500'
                      : 'bg-white text-gray-700 border-gray-300 hover:border-purple-300'
                  }`}
                >
                  {quality}
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-500 mt-1">
              품질이 높을수록 처리 시간과 생성 비용이 증가할 수 있습니다.
            </p>
          </div>
        )}

        {/* 그리드 설정 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            그리드 레이아웃
          </label>
          <div className="grid grid-cols-2 gap-2">
            {gridLayouts.map((grid) => (
              <button
                key={grid}
                onClick={() => onSettingsChange({ pixelArtGrid: grid })}
                className={`px-3 py-2 text-sm rounded-lg border transition-colors ${
                  settings.pixelArtGrid === grid
                    ? 'bg-purple-500 text-white border-purple-500'
                    : 'bg-white text-gray-700 border-gray-300 hover:border-purple-300'
                }`}
              >
                {grid}
              </button>
            ))}
          </div>
        </div>

        {/* 스타일 프리셋 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            <div className="flex items-center gap-2">
              <Palette className="w-4 h-4" />
              <span>스타일 프리셋</span>
            </div>
          </label>
          <div className="relative">
            <select
              value={settings.stylePreset ?? ''}
              onChange={(e) => {
                const value = e.target.value;
                if (value === '') {
                  onSettingsChange({ stylePreset: undefined, customStyle: undefined });
                } else if (value === 'custom') {
                  onSettingsChange({ stylePreset: 'custom', customStyle: '' });
                } else {
                  onSettingsChange({ stylePreset: value, customStyle: undefined });
                }
              }}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent appearance-none pr-10"
            >
              <option value="">스타일 선택...</option>
              {ART_STYLE_PRESETS.map((preset) => (
                <option key={preset} value={preset}>
                  {preset}
                </option>
              ))}
              <option value="custom">직접 입력</option>
            </select>
            <ChevronDown
              size={16}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
            />
          </div>
          {settings.stylePreset === 'custom' && (
            <input
              type="text"
              value={settings.customStyle ?? ''}
              onChange={(e) => onSettingsChange({ customStyle: e.target.value })}
              placeholder="스타일을 직접 입력하세요..."
              className="w-full mt-2 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            />
          )}
        </div>
      </div>

      {/* 하단 정보 */}
      <div className="px-4 py-3 border-t border-gray-200 bg-gray-50">
        <p className="text-xs text-gray-500">
          설정은 다음 이미지 생성부터 적용됩니다
        </p>
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
                  ⚠️ {costWarning.size} 이미지는 비용이 크게 증가합니다!
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
                        {costWarning.size === '2K' ? '2K는 1K 대비 약 4배' : '4K는 1K 대비 약 16배'}의 비용이 발생할 수 있습니다.
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
                {costWarning.size} 사용
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
