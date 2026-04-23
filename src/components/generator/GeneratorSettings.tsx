import { useState, useRef, useEffect } from 'react';
import { Languages, Wand2, Dices, HelpCircle, X, Award, AlertTriangle, Camera, ChevronDown } from 'lucide-react';
import { SessionType } from '../../types/session';
import { PixelArtGridLayout } from '../../types/pixelart';
import { ReferenceDocument } from '../../types/referenceDocument';
import { CAMERA_ANGLES } from '../../types/cameraAngle';
import { CAMERA_LENSES } from '../../types/cameraLens';
import { DocumentManager } from './DocumentManager';
import {
  getGridButtonStyle,
  getGridDescription,
  getPromptPlaceholder,
  getGridLabel,
  getGridSectionStyle,
} from '../../lib/config/sessionConfig';

interface GeneratorSettingsProps {
  // 기본 정보
  apiKey: string;
  sessionType: SessionType;
  // 상태
  additionalPrompt: string;
  isGenerating: boolean;
  isTranslating: boolean;
  progressMessage: string;
  aspectRatio: '1:1' | '16:9' | '9:16' | '4:3' | '3:4';
  imageSize: '1K' | '2K' | '4K';
  useReferenceImages: boolean;
  pixelArtGrid: PixelArtGridLayout;
  showAdvanced: boolean;
  showHelp: boolean;
  seed: number | undefined;
  temperature: number;
  topK: number;
  topP: number;

  // 참조 문서 (UI 세션용)
  referenceDocuments: ReferenceDocument[];

  // 카메라 앵글 및 렌즈 (CHARACTER, BACKGROUND, ILLUSTRATION 세션용)
  cameraAngle: string;
  cameraLens: string;

  // 콜백
  onGenerate: () => void;
  onAdditionalPromptChange: (value: string) => void;
  onAspectRatioChange: (value: '1:1' | '16:9' | '9:16' | '4:3' | '3:4') => void;
  onImageSizeChange: (value: '1K' | '2K' | '4K') => void;
  onUseReferenceImagesChange: (value: boolean) => void;
  onPixelArtGridChange: (value: PixelArtGridLayout) => void;
  onShowAdvancedChange: (value: boolean) => void;
  onShowHelpChange: (value: boolean) => void;
  onSeedChange: (value: number | undefined) => void;
  onTemperatureChange: (value: number) => void;
  onTopKChange: (value: number) => void;
  onTopPChange: (value: number) => void;
  onCameraAngleChange: (value: string) => void;
  onCameraLensChange: (value: string) => void;
  onDocumentAdd?: (document: ReferenceDocument) => void;
  onDocumentDelete?: (documentId: string) => void;
}

export function GeneratorSettings({
  apiKey,
  sessionType,
  additionalPrompt,
  isGenerating,
  isTranslating,
  progressMessage,
  aspectRatio,
  imageSize,
  useReferenceImages,
  pixelArtGrid,
  showAdvanced,
  showHelp,
  seed,
  temperature,
  topK,
  topP,
  cameraAngle,
  cameraLens,
  referenceDocuments,
  onGenerate,
  onAdditionalPromptChange,
  onAspectRatioChange,
  onImageSizeChange,
  onUseReferenceImagesChange,
  onPixelArtGridChange,
  onShowAdvancedChange,
  onShowHelpChange,
  onSeedChange,
  onTemperatureChange,
  onTopKChange,
  onTopPChange,
  onCameraAngleChange,
  onCameraLensChange,
  onDocumentAdd,
  onDocumentDelete,
}: GeneratorSettingsProps) {
  // textarea 자동 확장을 위한 ref
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // textarea 높이 자동 조절
  useEffect(() => {
    if (textareaRef.current) {
      // 높이 초기화 후 scrollHeight 기반으로 재조절
      textareaRef.current.style.height = 'auto';
      const scrollHeight = textareaRef.current.scrollHeight;
      // 최소 3줄(약 72px), 최대 200px
      const newHeight = Math.min(Math.max(scrollHeight, 72), 200);
      textareaRef.current.style.height = `${newHeight}px`;
    }
  }, [additionalPrompt]);
  // 비용 경고 팝업 상태
  const [costWarning, setCostWarning] = useState<{ size: '2K' | '4K' } | null>(null);

  // 이미지 크기 변경 핸들러 (비용 경고 포함)
  const handleImageSizeClick = (size: '1K' | '2K' | '4K') => {
    if (size === '2K' || size === '4K') {
      setCostWarning({ size });
    } else {
      onImageSizeChange(size);
    }
  };

  // 비용 경고 확인 후 크기 변경
  const confirmImageSizeChange = () => {
    if (costWarning) {
      onImageSizeChange(costWarning.size);
      setCostWarning(null);
    }
  };

  return (
    <div className="w-96 bg-white border-r border-gray-200 flex flex-col">
      {/* 고정 영역: 추가 프롬프트 + 생성 버튼 */}
      <div className="p-6 pb-4 border-b border-gray-200 bg-white space-y-4">
        {/* 추가 프롬프트 입력 (선택사항) - 고정 영역 */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-semibold text-gray-700">
              추가 프롬프트 (선택)
            </label>
          </div>
          <textarea
            ref={textareaRef}
            value={additionalPrompt}
            onChange={(e) => onAdditionalPromptChange(e.target.value)}
            placeholder={getPromptPlaceholder(sessionType)}
            rows={3}
            className="w-full p-3 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none overflow-y-auto"
            style={{ minHeight: '72px', maxHeight: '200px' }}
          />
          <p className="text-xs text-gray-500 mt-1">
            한글/영어 모두 입력 가능 (한글은 생성 시 자동으로 영어 변환)
          </p>
        </div>


        {/* 이미지 생성 버튼 */}
        <button
          onClick={onGenerate}
          disabled={isGenerating}
          className={`w-full flex items-center justify-center gap-2 px-6 py-3 rounded-lg font-semibold transition-all shadow-lg ${
            isGenerating
              ? 'bg-gray-400 cursor-not-allowed'
              : 'bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white hover:shadow-xl'
          }`}
        >
          <Wand2 size={20} />
          <span>{isGenerating ? '생성 중...' : '이미지 생성'}</span>
        </button>
      </div>

      {/* 스크롤 가능 영역: 설정들 */}
      <div className="flex-1 overflow-y-auto p-6 pt-6">
        <div className="space-y-6">

          {/* UI 세션 전용: 참조 문서 */}
          {sessionType === 'UI' && (
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                참조 문서 (UI 기획서 등)
              </label>
              <DocumentManager
                documents={referenceDocuments}
                apiKey={apiKey}
                onAdd={onDocumentAdd || (() => {})}
                onDelete={onDocumentDelete || (() => {})}
              />
              <p className="text-xs text-gray-500 mt-2">
                UI 기획서나 설명 문서를 업로드하면 내용이 자동으로 프롬프트에 반영됩니다.
              </p>
            </div>
          )}

          {/* 그리드 레이아웃 선택 */}
          {(sessionType === 'PIXELART_CHARACTER' ||
            sessionType === 'PIXELART_BACKGROUND' ||
            sessionType === 'PIXELART_ICON' ||
            sessionType === 'CHARACTER' ||
            sessionType === 'BACKGROUND' ||
            sessionType === 'ICON' ||
            sessionType === 'STYLE' ||
            sessionType === 'UI' ||
            sessionType === 'LOGO' ||
            sessionType === 'ILLUSTRATION') && (
            <div className={getGridSectionStyle(sessionType)}>
              <label className="block text-sm font-semibold text-gray-700 mb-3">
                {getGridLabel(sessionType)}
              </label>
              <div className="grid grid-cols-4 gap-2">
                <button
                  onClick={() => onPixelArtGridChange('1x1')}
                  className={`p-2 rounded-md text-xs font-medium border-2 transition-all ${getGridButtonStyle(
                    sessionType,
                    pixelArtGrid === '1x1'
                  )}`}
                >
                  <div className="font-bold">1x1</div>
                  <div className="text-[10px] opacity-75">단일</div>
                </button>
                <button
                  onClick={() => onPixelArtGridChange('2x2')}
                  className={`p-2 rounded-md text-xs font-medium border-2 transition-all ${getGridButtonStyle(
                    sessionType,
                    pixelArtGrid === '2x2'
                  )}`}
                >
                  <div className="font-bold">2x2</div>
                  <div className="text-[10px] opacity-75">4개</div>
                </button>
                <button
                  onClick={() => onPixelArtGridChange('3x3')}
                  className={`p-2 rounded-md text-xs font-medium border-2 transition-all ${getGridButtonStyle(
                    sessionType,
                    pixelArtGrid === '3x3'
                  )}`}
                >
                  <div className="font-bold">3x3</div>
                  <div className="text-[10px] opacity-75">9개</div>
                </button>
                <button
                  onClick={() => onPixelArtGridChange('4x4')}
                  className={`p-2 rounded-md text-xs font-medium border-2 transition-all ${getGridButtonStyle(
                    sessionType,
                    pixelArtGrid === '4x4'
                  )}`}
                >
                  <div className="font-bold">4x4</div>
                  <div className="text-[10px] opacity-75">16개</div>
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-2">{getGridDescription(sessionType, pixelArtGrid)}</p>
            </div>
          )}

          {/* 카메라 앵글 선택 */}
          {(sessionType === 'CHARACTER' ||
            sessionType === 'BACKGROUND' ||
            sessionType === 'ILLUSTRATION' ||
            sessionType === 'STYLE' ||
            sessionType === 'ICON' ||
            sessionType === 'PIXELART_BACKGROUND' ||
            sessionType === 'PIXELART_ICON') && (
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                <div className="flex items-center gap-2">
                  <Camera size={16} className="text-purple-600" />
                  <span>카메라 앵글</span>
                </div>
              </label>
              <div className="relative">
                <select
                  value={cameraAngle}
                  onChange={(e) => onCameraAngleChange(e.target.value)}
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-purple-500 focus:border-transparent appearance-none cursor-pointer pr-10"
                >
                  {CAMERA_ANGLES.map((angle) => (
                    <option key={angle.id} value={angle.id}>
                      {angle.id === 'none' ? angle.label : `${angle.label} : ${angle.description}`}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={16}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
                />
              </div>
            </div>
          )}

          {/* 카메라 렌즈/화각 선택 */}
          {(sessionType === 'CHARACTER' ||
            sessionType === 'BACKGROUND' ||
            sessionType === 'ILLUSTRATION' ||
            sessionType === 'STYLE' ||
            sessionType === 'ICON' ||
            sessionType === 'PIXELART_BACKGROUND' ||
            sessionType === 'PIXELART_ICON') && (
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-purple-600">🔭</span>
                  <span>렌즈 / 화각</span>
                </div>
              </label>
              <div className="relative">
                <select
                  value={cameraLens}
                  onChange={(e) => onCameraLensChange(e.target.value)}
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-purple-500 focus:border-transparent appearance-none cursor-pointer pr-10"
                >
                  {CAMERA_LENSES.map((lens) => (
                    <option key={lens.id} value={lens.id}>
                      {lens.id === 'none' ? lens.label : `${lens.label} : ${lens.description}`}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={16}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
                />
              </div>
            </div>
          )}

          {/* 이미지 비율 선택 */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">이미지 비율</label>
            <div className="grid grid-cols-5 gap-2">
              {(['1:1', '16:9', '9:16', '4:3', '3:4'] as const).map((ratio) => (
                <button
                  key={ratio}
                  onClick={() => onAspectRatioChange(ratio)}
                  className={`px-3 py-2 rounded-lg text-sm font-medium border-2 transition-all ${
                    aspectRatio === ratio
                      ? 'bg-purple-600 text-white border-purple-700 shadow-lg'
                      : 'bg-white text-gray-700 border-gray-200 hover:border-purple-400'
                  }`}
                >
                  {ratio}
                </button>
              ))}
            </div>
          </div>

          {/* 이미지 크기 선택 */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">이미지 크기</label>
            <div className="grid grid-cols-3 gap-2">
              {(['1K', '2K', '4K'] as const).map((size) => (
                <button
                  key={size}
                  onClick={() => handleImageSizeClick(size)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium border-2 transition-all ${
                    imageSize === size
                      ? 'bg-purple-600 text-white border-purple-700 shadow-lg'
                      : 'bg-white text-gray-700 border-gray-200 hover:border-purple-400'
                  }`}
                >
                  {size}
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-500 mt-1">
              <span className="text-green-600 font-medium">1K 권장</span> · 2K/4K는 비용이 크게 증가합니다
            </p>
          </div>

          {/* 참조 이미지 사용 여부 (스타일 세션에서만) */}
          {sessionType !== 'CHARACTER' && (
            <div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={useReferenceImages}
                  onChange={(e) => onUseReferenceImagesChange(e.target.checked)}
                  className="w-4 h-4 text-purple-600 rounded focus:ring-purple-500"
                />
                <span className="text-sm font-semibold text-gray-700">참조 이미지 사용</span>
              </label>
              <p className="text-xs text-gray-500 mt-1">
                체크 해제 시 분석 결과만으로 새로운 이미지 생성 (더 다양한 결과)
              </p>
            </div>
          )}

          {/* 고급 설정 */}
          <div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => onShowAdvancedChange(!showAdvanced)}
                className="flex-1 flex items-center justify-between p-3 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Award size={16} className="text-gray-600" />
                  <span className="text-sm font-semibold text-gray-700">고급 설정</span>
                </div>
                <span className="text-xs text-gray-500">{showAdvanced ? '▲ 접기' : '▼ 펼치기'}</span>
              </button>
              <button
                onClick={() => onShowHelpChange(true)}
                className="p-3 bg-gray-50 hover:bg-purple-100 rounded-lg transition-colors"
                title="고급 설정 도움말"
              >
                <HelpCircle size={16} className="text-purple-600" />
              </button>
            </div>

            {showAdvanced && (
              <div className="mt-3 space-y-4 p-4 bg-gray-50 rounded-lg">
                {/* Seed */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-semibold text-gray-700">Seed (재현성)</label>
                    <button
                      onClick={() => onSeedChange(Math.floor(Math.random() * 1000000))}
                      className="flex items-center gap-1 px-2 py-1 text-xs bg-white border border-gray-300 rounded hover:bg-gray-100 transition-colors"
                      title="랜덤 Seed 생성"
                    >
                      <Dices size={14} />
                      <span>랜덤</span>
                    </button>
                  </div>
                  <input
                    type="number"
                    value={seed ?? ''}
                    onChange={(e) => onSeedChange(e.target.value ? parseInt(e.target.value) : undefined)}
                    placeholder="비어있음 (랜덤)"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  />
                  <p className="text-xs text-gray-500 mt-1">동일한 Seed는 동일한 결과를 보장합니다</p>
                </div>

                {/* Temperature */}
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Temperature: {temperature.toFixed(2)}
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="2"
                    step="0.1"
                    value={temperature}
                    onChange={(e) => onTemperatureChange(parseFloat(e.target.value))}
                    className="w-full"
                  />
                  <div className="flex justify-between text-xs text-gray-500 mt-1">
                    <span>일관성 (0.0)</span>
                    <span>창의성 (2.0)</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    낮을수록 일관적이고 예측 가능한 결과, 높을수록 창의적이고 다양한 결과
                  </p>
                </div>

                {/* Top-K */}
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Top-K: {topK}</label>
                  <input
                    type="range"
                    min="1"
                    max="100"
                    step="1"
                    value={topK}
                    onChange={(e) => onTopKChange(parseInt(e.target.value))}
                    className="w-full"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    샘플링할 상위 K개의 토큰 수 (낮을수록 보수적, 높을수록 다양함)
                  </p>
                </div>

                {/* Top-P */}
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Top-P: {topP.toFixed(2)}
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={topP}
                    onChange={(e) => onTopPChange(parseFloat(e.target.value))}
                    className="w-full"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    누적 확률 임계값 (낮을수록 보수적, 높을수록 다양함)
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* 진행 상태 */}
          {progressMessage && (
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="flex items-center gap-2">
                {isTranslating && <Languages size={16} className="text-blue-600 animate-pulse" />}
                <p className="text-sm text-blue-800">{progressMessage}</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 도움말 모달 */}
      {showHelp && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[80vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-purple-100 rounded-lg">
                  <HelpCircle size={24} className="text-purple-600" />
                </div>
                <h3 className="text-xl font-bold text-gray-800">이미지 생성 도움말</h3>
              </div>
              <button
                onClick={() => onShowHelpChange(false)}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X size={20} className="text-gray-600" />
              </button>
            </div>
            <div className="p-6 space-y-6">
              <div>
                <h4 className="font-semibold text-gray-800 mb-2">📝 프롬프트 입력 팁</h4>
                <ul className="text-sm text-gray-600 space-y-1 list-disc list-inside">
                  <li>한글과 영어 모두 입력 가능 (한글은 자동으로 영어로 번역됩니다)</li>
                  <li>구체적이고 명확한 표현이 더 좋은 결과를 만듭니다</li>
                  <li>포즈, 표정, 동작을 상세하게 설명하세요</li>
                </ul>
              </div>
              <div>
                <h4 className="font-semibold text-gray-800 mb-2">🎨 이미지 비율</h4>
                <ul className="text-sm text-gray-600 space-y-1 list-disc list-inside">
                  <li>1:1 - 정사각형 (SNS 프로필, 아이콘)</li>
                  <li>16:9 - 가로형 와이드 (배경, 배너)</li>
                  <li>9:16 - 세로형 (모바일 배경, 스토리)</li>
                  <li>4:3 - 가로형 (일반 사진)</li>
                  <li>3:4 - 세로형 (인물 사진)</li>
                </ul>
              </div>
              <div>
                <h4 className="font-semibold text-gray-800 mb-2">📐 이미지 크기</h4>
                <ul className="text-sm text-gray-600 space-y-1 list-disc list-inside">
                  <li><span className="text-green-600 font-medium">1K - 일반 생성에 권장 (비용 효율적)</span></li>
                  <li>2K - 고화질 필요 시 (비용 증가)</li>
                  <li>4K - 최고 품질 (비용 크게 증가, 신중히 선택)</li>
                </ul>
              </div>
              <div>
                <h4 className="font-semibold text-gray-800 mb-2">⚙️ 고급 설정</h4>
                <ul className="text-sm text-gray-600 space-y-1 list-disc list-inside">
                  <li><span className="font-medium">Seed</span> - 동일한 값으로 같은 결과 재현 가능</li>
                  <li><span className="font-medium">Temperature</span> - 낮을수록 일관적, 높을수록 창의적 (기본: 1.0)</li>
                  <li><span className="font-medium">Top-K</span> - 샘플링할 토큰 수 (기본: 40)</li>
                  <li><span className="font-medium">Top-P</span> - 누적 확률 임계값 (기본: 0.95)</li>
                </ul>
                <p className="text-xs text-gray-500 mt-2">
                  💡 일반적으로 기본값을 사용하는 것을 권장합니다. 결과가 너무 비슷하면 Temperature를 높이고, 너무 다양하면 낮추세요.
                </p>
              </div>
            </div>
            <div className="sticky bottom-0 bg-gray-50 px-6 py-4 border-t border-gray-200">
              <button
                onClick={() => onShowHelpChange(false)}
                className="w-full px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition-colors"
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}

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
                onClick={confirmImageSizeChange}
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
