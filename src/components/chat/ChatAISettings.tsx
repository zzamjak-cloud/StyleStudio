import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { ChatGenerationSettings } from '../../types/chat';
import { PixelArtGridLayout } from '../../types/pixelart';
import { getAvailableImageModels } from '../../hooks/api/imageModels';
import { ReferenceDocument } from '../../types/referenceDocument';
import { DocumentManager } from '../generator/DocumentManager';

interface ChatAISettingsProps {
  settings: ChatGenerationSettings;
  onSettingsChange: (settings: Partial<ChatGenerationSettings>) => void;
  attachedDocuments: ReferenceDocument[];
  documentApiKey: string;
  onDocumentAdd: (doc: ReferenceDocument) => void;
  onDocumentDelete: (documentId: string) => void;
}

type ImageSize = ChatGenerationSettings['imageSize'];
type AspectRatio = ChatGenerationSettings['aspectRatio'];

/** 채팅 세션 우측 AI 설정 패널 */
export function ChatAISettings({
  settings,
  onSettingsChange,
  attachedDocuments,
  documentApiKey,
  onDocumentAdd,
  onDocumentDelete,
}: ChatAISettingsProps) {
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
  const availableModels = getAvailableImageModels();
  const selectedModel = availableModels.find((model) => model.id === settings.imageModel) ?? availableModels[0];
  const aspectRatios = selectedModel.supports.aspectRatios as AspectRatio[];
  const supportedSizes = selectedModel.supports.imageSizes;

  return (
    <div className="w-80 border-l border-gray-200 bg-white flex flex-col min-h-0 h-full">
      {/* 설정 영역 */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-6">
        {/* 기획 문서 */}
        <div>
          <DocumentManager
            documents={attachedDocuments}
            apiKey={documentApiKey}
            onAdd={onDocumentAdd}
            onDelete={onDocumentDelete}
            showPersistentBadge={true}
            persistentBadgeText="대화 참조중"
          />
        </div>

        {/* 그리드 설정 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-3">
            그리드
          </label>
          <div className="grid grid-cols-4 gap-2">
            {gridLayouts.map((grid) => (
              <button
                key={grid}
                onClick={() => onSettingsChange({ pixelArtGrid: grid })}
                className={`px-2 py-2 text-xs font-medium rounded-lg border transition-colors ${
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

        {/* 모델 선택 */}
        <div>
          <div className="flex items-center gap-3">
            <label className="w-14 flex-shrink-0 text-sm font-medium text-gray-700">
              모델
            </label>
            <select
              value={settings.imageModel}
              onChange={(e) =>
                onSettingsChange({ imageModel: e.target.value as ChatGenerationSettings['imageModel'] })
              }
              className="flex-1 min-w-0 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            >
              {availableModels.map(({ id, label }) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* 비율 선택 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            이미지 비율
          </label>
          <div className="flex flex-nowrap gap-1">
            {aspectRatios.map((ratio) => (
              <button
                key={ratio}
                onClick={() => onSettingsChange({ aspectRatio: ratio })}
                className={`min-w-0 flex-1 px-1 py-1.5 text-[11px] rounded-md border transition-colors ${
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
            이미지 크기(1K 권장)
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
          {settings.imageModel === 'openai/gpt-image-2' && (
            <p className="text-xs text-gray-500 mt-1">
              덕테이프는 1K 규격으로 처리되며 품질 옵션으로 세부 묘사를 조절합니다.
            </p>
          )}
        </div>

        {/* 품질 선택 (덕테이프 전용) */}
        {settings.imageModel === 'openai/gpt-image-2' && (
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
      </div>

      {/* 비용 경고 팝업 (2K=amber, 4K=red 위험 등급 분리) */}
      {costWarning && (
        (() => {
          const is4K = costWarning.size === '4K';
          const accent = is4K
            ? { bg: 'bg-red-100', icon: 'text-red-600', heading: 'text-red-700', boxBg: 'bg-red-50', boxBorder: 'border-red-200', bullet: 'text-red-600', btnBg: 'bg-red-600 hover:bg-red-700' }
            : { bg: 'bg-amber-100', icon: 'text-amber-600', heading: 'text-amber-700', boxBg: 'bg-amber-50', boxBorder: 'border-amber-200', bullet: 'text-amber-600', btnBg: 'bg-amber-500 hover:bg-amber-600' };
          return (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-xl shadow-2xl max-w-md w-full">
                <div className="p-6">
                  <div className="flex items-center gap-3 mb-4">
                    <div className={`p-3 ${accent.bg} rounded-full`}>
                      <AlertTriangle size={28} className={accent.icon} />
                    </div>
                    <h3 className="text-xl font-bold text-gray-800">{is4K ? '🔴 매우 높은 비용 경고' : '비용 경고'}</h3>
                  </div>
                  <div className="space-y-3 text-gray-700">
                    <p className={`font-semibold text-lg ${accent.heading}`}>
                      ⚠️ {costWarning.size} 이미지는 비용이 크게 증가합니다!
                    </p>
                    <div className={`${accent.boxBg} border ${accent.boxBorder} rounded-lg p-4`}>
                      <ul className="space-y-2 text-sm">
                        <li className="flex items-start gap-2">
                          <span className={accent.bullet}>•</span>
                          <span>
                            <span className="font-medium">일반적인 용도</span>에서는{' '}
                            <span className="text-green-600 font-bold">1K 이미지로 충분</span>합니다.
                          </span>
                        </li>
                        <li className="flex items-start gap-2">
                          <span className={accent.bullet}>•</span>
                          <span>
                            {is4K ? '4K는 1K 대비 약 16배' : '2K는 1K 대비 약 4배'}의 비용이 발생할 수 있습니다.
                          </span>
                        </li>
                        {is4K && (
                          <li className="flex items-start gap-2">
                            <span className={accent.bullet}>•</span>
                            <span>
                              <span className="font-medium">모바일 게임 자산</span> 용도에서는 거의 필요하지 않습니다.
                            </span>
                          </li>
                        )}
                        <li className="flex items-start gap-2">
                          <span className={accent.bullet}>•</span>
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
                    className={`flex-1 px-4 py-2.5 ${accent.btnBg} text-white rounded-lg font-medium transition-colors`}
                  >
                    {costWarning.size} 사용
                  </button>
                </div>
              </div>
            </div>
          );
        })()
      )}
    </div>
  );
}
