import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { ChatGenerationSettings } from '../../types/chat';
import { PixelArtGridLayout } from '../../types/pixelart';
import { PaletteSizeOption, PixelateSizeOption } from '../../lib/pixelart/pixelate';
import { getAvailableImageModels, getImageModelDefinition, isOpenAIModel } from '../../hooks/api/imageModels';
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
  /*
    드롭다운 목록(`availableModels`)에서 찾지 않고 카탈로그 전체에서 찾는다 — 세션에 저장된
    모델이 목록에 없을 때(예: 등재됐다가 다시 `pending`으로 내린 2.5 계열) 첫 모델의 능력치를
    보여주면 실제 전송 모델과 UI가 어긋난다.
  */
  const selectedModel = getImageModelDefinition(settings.imageModel);
  const aspectRatios = selectedModel.supports.aspectRatios as AspectRatio[];
  const supportedSizes = selectedModel.supports.imageSizes;
  const supportedQualities = selectedModel.supports.qualities;

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

        {/* 픽셀아트 모드.
            채팅은 범용 세션이라 세션 타입으로 픽셀아트 의도를 알 수 없어 명시적 토글로 판정한다.
            켜면 픽셀아트 세션과 동일한 기준(최신 채색 규칙 프롬프트 + 생성 후 픽셀 정규화)이 걸린다. */}
        <div>
          <label className="flex items-center justify-between gap-2 cursor-pointer">
            <span className="text-sm font-medium text-gray-700">픽셀아트 모드</span>
            <input
              type="checkbox"
              checked={settings.pixelArtMode ?? false}
              onChange={(e) => onSettingsChange({ pixelArtMode: e.target.checked })}
              className="w-4 h-4 accent-purple-500 cursor-pointer"
            />
          </label>
          <p className="mt-1.5 text-[11px] text-gray-500 leading-relaxed">
            픽셀아트 세션과 같은 기준을 적용합니다 — 디더링·그라데이션을 금지하고,
            생성물의 픽셀 격자를 찾아 <span className="font-medium text-gray-600">딱 떨어지는 픽셀</span>로
            재구성합니다(PNG로 저장).
          </p>

          {settings.pixelArtMode && (
            <div className="mt-3 space-y-3">
              {/* 논리 해상도 */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">
                  픽셀 해상도
                  {settings.pixelArtGrid !== '1x1' && (
                    <span className="text-gray-400"> (프레임당)</span>
                  )}
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {(['auto', 32, 64, 128] as PixelateSizeOption[]).map((option) => (
                    <button
                      key={String(option)}
                      onClick={() => onSettingsChange({ pixelateSize: option })}
                      className={`px-2 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                        (settings.pixelateSize ?? 'auto') === option
                          ? 'bg-purple-500 text-white border-purple-500'
                          : 'bg-white text-gray-700 border-gray-300 hover:border-purple-300'
                      }`}
                    >
                      {option === 'auto' ? '자동' : `${option}px`}
                    </button>
                  ))}
                </div>
              </div>

              {/* 팔레트 색 수 */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">팔레트 색 수</label>
                <div className="grid grid-cols-5 gap-2">
                  {(['auto', 8, 16, 32, 48] as PaletteSizeOption[]).map((option) => (
                    <button
                      key={String(option)}
                      onClick={() => onSettingsChange({ pixelatePaletteSize: option })}
                      className={`px-1.5 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                        (settings.pixelatePaletteSize ?? 'auto') === option
                          ? 'bg-purple-500 text-white border-purple-500'
                          : 'bg-white text-gray-700 border-gray-300 hover:border-purple-300'
                      }`}
                    >
                      {option === 'auto' ? '자동' : `${option}색`}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
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
          {/* 모델당 8~10종이라 한 줄에 안 들어간다 — 5열 그리드로 넘긴다 */}
          <div className="grid grid-cols-5 gap-1">
            {aspectRatios.map((ratio) => (
              <button
                key={ratio}
                onClick={() => onSettingsChange({ aspectRatio: ratio })}
                className={`min-w-0 px-1 py-1.5 text-[11px] rounded-md border transition-colors ${
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
          {isOpenAIModel(settings.imageModel) && (
            <p className="text-xs text-gray-500 mt-1">
              덕테이프 계열은 1K 규격으로 처리되며 품질 옵션으로 세부 묘사를 조절합니다.
            </p>
          )}
        </div>

        {/* 품질 선택 — 티어가 2개 이상인 모델에서만. 모델 ID를 직접 비교하지 않는다 */}
        {supportedQualities.length > 1 && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">이미지 품질</label>
            <div className="grid grid-cols-3 gap-2">
              {supportedQualities.map((quality) => (
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
