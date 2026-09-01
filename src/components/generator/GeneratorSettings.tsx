import { memo, useState, useRef, useEffect } from 'react';
import { Languages, Wand2, HelpCircle, X, AlertTriangle, Camera, ChevronDown } from 'lucide-react';
import { SessionType } from '../../types/session';
import { PixelArtGridLayout } from '../../types/pixelart';
import { ReferenceDocument } from '../../types/referenceDocument';
import { CAMERA_ANGLES } from '../../types/cameraAngle';
import { CAMERA_LENSES } from '../../types/cameraLens';
import {
  TILEMAP_GRID_LAYOUTS,
  TILEMAP_RULETILE_GRID,
  TilemapEdgeStyle,
  TilemapMode,
  TilemapOutline,
  TilemapOutlineSide,
} from '../../types/tilemap';
import { EdgeStylePicker } from '../tilemap/EdgeStylePicker';
import { DocumentManager } from './DocumentManager';
import {
  AspectRatioOption,
  ImageGenerationModel,
  ImageModelDefinition,
  ImageQualityOption,
  ImageSizeOption,
} from '../../hooks/api/imageModels';
import {
  getGridButtonStyle,
  getPromptPlaceholder,
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
  aspectRatio: AspectRatioOption;
  imageSize: ImageSizeOption;
  useReferenceImages: boolean;
  pixelArtGrid: PixelArtGridLayout;
  tilemapMode: TilemapMode;
  tilemapEdgeStyle: TilemapEdgeStyle;
  tilemapOutline: TilemapOutline;
  tilemapOutline2: TilemapOutline;
  tilemapOutlineSide: TilemapOutlineSide;
  tilemapBaseTerrain: string;
  tilemapOverlayTerrain: string;
  showHelp: boolean;
  imageModel: ImageGenerationModel;
  imageQuality: ImageQualityOption;
  availableModels: ImageModelDefinition[];
  supportedAspectRatios: AspectRatioOption[];
  supportedImageSizes: ImageSizeOption[];

  // 참조 문서 (UI 세션용)
  referenceDocuments: ReferenceDocument[];

  // 카메라 앵글 및 렌즈 (CHARACTER, BACKGROUND, ILLUSTRATION 세션용)
  cameraAngle: string;
  cameraLens: string;

  // 콜백
  onGenerate: () => void;
  onAdditionalPromptChange: (value: string) => void;
  onAspectRatioChange: (value: AspectRatioOption) => void;
  onImageSizeChange: (value: ImageSizeOption) => void;
  onUseReferenceImagesChange: (value: boolean) => void;
  onPixelArtGridChange: (value: PixelArtGridLayout) => void;
  onTilemapModeChange: (value: TilemapMode) => void;
  onTilemapEdgeStyleChange: (value: TilemapEdgeStyle) => void;
  onTilemapOutlineChange: (value: TilemapOutline) => void;
  onTilemapOutline2Change: (value: TilemapOutline) => void;
  onTilemapOutlineSideChange: (value: TilemapOutlineSide) => void;
  onTilemapBaseTerrainChange: (value: string) => void;
  onTilemapOverlayTerrainChange: (value: string) => void;
  onShowHelpChange: (value: boolean) => void;
  onImageModelChange: (value: ImageGenerationModel) => void;
  onImageQualityChange: (value: ImageQualityOption) => void;
  onCameraAngleChange: (value: string) => void;
  onCameraLensChange: (value: string) => void;
  onDocumentAdd?: (document: ReferenceDocument) => void;
  onDocumentDelete?: (documentId: string) => void;
}

function GeneratorSettingsComponent({
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
  tilemapMode,
  tilemapEdgeStyle,
  tilemapOutline,
  tilemapOutline2,
  tilemapOutlineSide,
  tilemapBaseTerrain,
  tilemapOverlayTerrain,
  showHelp,
  imageModel,
  imageQuality,
  availableModels,
  supportedAspectRatios,
  supportedImageSizes,
  cameraAngle,
  cameraLens,
  referenceDocuments,
  onGenerate,
  onAdditionalPromptChange,
  onAspectRatioChange,
  onImageSizeChange,
  onUseReferenceImagesChange,
  onPixelArtGridChange,
  onTilemapModeChange,
  onTilemapEdgeStyleChange,
  onTilemapOutlineChange,
  onTilemapOutline2Change,
  onTilemapOutlineSideChange,
  onTilemapBaseTerrainChange,
  onTilemapOverlayTerrainChange,
  onShowHelpChange,
  onImageModelChange,
  onImageQualityChange,
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
  const handleImageSizeClick = (size: ImageSizeOption) => {
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
    <div className="w-96 bg-white border-l border-gray-200 flex flex-col">
      {/* 고정 영역: 프롬프트 + 생성 버튼 */}
      <div className="p-6 pb-4 border-b border-gray-200 bg-white space-y-4">
        {/* 프롬프트 입력 - 고정 영역 */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-semibold text-gray-700">
              프롬프트
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
            <div className="space-y-2">
              <DocumentManager
                documents={referenceDocuments}
                apiKey={apiKey}
                onAdd={onDocumentAdd || (() => {})}
                onDelete={onDocumentDelete || (() => {})}
              />
            </div>
          )}

          {/* 타일맵 모드 선택 */}
          {sessionType === 'TILEMAP' && (
            <div className={getGridSectionStyle(sessionType)}>
              <label className="block text-sm font-semibold text-gray-700 mb-3">타일셋 모드</label>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => onTilemapModeChange('variation')} className={`p-2 rounded-md text-xs font-medium border-2 transition-all ${getGridButtonStyle(sessionType, tilemapMode === 'variation')}`}>
                  <div className="font-bold">변형 세트</div>
                  <div className="text-[10px] opacity-75">한 지형의 다양한 바리에이션</div>
                </button>
                <button onClick={() => onTilemapModeChange('ruletile')} className={`p-2 rounded-md text-xs font-medium border-2 transition-all ${getGridButtonStyle(sessionType, tilemapMode === 'ruletile')}`}>
                  <div className="font-bold">룰타일 세트</div>
                  <div className="text-[10px] opacity-75">지형 전환 (유니티 Rule Tile)</div>
                </button>
              </div>
              {tilemapMode === 'ruletile' && (
                <div className="mt-3 space-y-2">
                  <input value={tilemapBaseTerrain} onChange={(e) => onTilemapBaseTerrainChange(e.target.value)} placeholder="베이스 지형 (예: 잔디) · 입력하지 않으면 투명하게 표시됩니다" className="w-full p-2 border border-gray-300 rounded-lg text-sm" />
                  <input value={tilemapOverlayTerrain} onChange={(e) => onTilemapOverlayTerrainChange(e.target.value)} placeholder="오버레이 지형 (예: 흙길) · 입력하지 않으면 투명하게 표시됩니다" className="w-full p-2 border border-gray-300 rounded-lg text-sm" />
                  {/* 한쪽을 비우면 그 지형이 투명해진다 — 어떤 바닥 타일 위에도 얹을 수 있는 길을 만들 때 쓴다 */}
                  <p className="text-[11px] text-gray-500 leading-relaxed">
                    지형을 <span className="font-medium text-gray-600">입력하지 않으면 투명하게 표시됩니다.</span>{' '}
                    한쪽을 비우고 아웃라인을 켜면 <span className="font-medium text-gray-600">어떤 바닥 타일 위에도 얹을 수 있는 길</span>이 됩니다.
                    (둘 다 비울 수는 없습니다)
                  </p>
                  <p className="text-[11px] text-gray-500">
                    룰타일은 {TILEMAP_RULETILE_GRID}(64타일) 고정입니다 — 오목 코너·1칸 통로·고립 셀까지
                    포함한 완전한 Rule Tile 세트. 4x4(16타일)는 대각을 구분하지 못해 완전한 룰타일이
                    되지 않습니다.
                  </p>

                  {/* 경계선 모양·아웃라인 — 지형 경계는 코드가 만들므로 재질과 독립적으로 고를 수 있다 */}
                  <EdgeStylePicker
                    value={tilemapEdgeStyle}
                    outline={tilemapOutline}
                    outline2={tilemapOutline2}
                    outlineSide={tilemapOutlineSide}
                    onChange={onTilemapEdgeStyleChange}
                    onOutlineChange={onTilemapOutlineChange}
                    onOutline2Change={onTilemapOutline2Change}
                    onOutlineSideChange={onTilemapOutlineSideChange}
                  />
                </div>
              )}

              {/* 화풍은 프리셋이 아니라 참조 이미지로 지정한다 — 프리셋은 재질 스와치에서
                  형태 기반 스타일(벡터·셀 등)을 표현할 수 없어 제거했다 */}
              <p className="mt-3 text-[11px] text-gray-500 leading-relaxed">
                원하는 화풍은 <span className="font-medium text-gray-600">참조 이미지</span>로 지정하세요.
                레퍼런스를 올리면 붓터치·팔레트·경계 부드러움·광원 방향을 분석해 프롬프트에 반영합니다.
              </p>
            </div>
          )}

          {/* 타일맵 전용 그리드 (4x4/8x8만 지원). 룰타일은 8x8 고정이라 선택지를 노출하지 않는다 */}
          {sessionType === 'TILEMAP' && (
            <div className={getGridSectionStyle(sessionType)}>
              <label className="block text-sm font-semibold text-gray-700 mb-3">
                그리드
              </label>
              {tilemapMode === 'ruletile' ? (
                <div className="px-3 py-2.5 border border-gray-200 rounded-lg text-sm bg-gray-50 text-gray-700">
                  {TILEMAP_RULETILE_GRID} <span className="text-xs text-gray-500">(룰타일 고정 · 64타일 · 128px)</span>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {TILEMAP_GRID_LAYOUTS.map((grid) => (
                    <button
                      key={grid}
                      onClick={() => onPixelArtGridChange(grid)}
                      className={`p-2 rounded-md text-xs font-medium border-2 transition-all ${getGridButtonStyle(
                        sessionType,
                        pixelArtGrid === grid
                      )}`}
                    >
                      <div className="font-bold">{grid}</div>
                      <div className="text-[10px] opacity-75">
                        {grid === '4x4' ? '16타일 · 256px' : '64타일 · 128px'}
                      </div>
                    </button>
                  ))}
                </div>
              )}
              <p className="mt-2 text-[11px] text-gray-500">
                타일맵은 1:1 비율 · 1K 해상도로 고정됩니다
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
                그리드
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
            </div>
          )}

          {/* 카메라 앵글 선택 */}
          {(sessionType === 'BACKGROUND' ||
            sessionType === 'ILLUSTRATION' ||
            sessionType === 'PIXELART_BACKGROUND') && (
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
          {(sessionType === 'BACKGROUND' ||
            sessionType === 'ILLUSTRATION' ||
            sessionType === 'PIXELART_BACKGROUND') && (
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

          {/* 모델 — TILEMAP은 덕테이프 고정이라 선택지도 표시도 하지 않는다.
              (나노바나나 계열은 타일맵이 요구하는 레이아웃을 지키지 못한다)
              바꿀 수 없는 값을 사이드바에 남겨둘 이유가 없어 제거했고,
              키가 없을 때의 경고만 남긴다 — 없으면 생성이 그냥 실패한다 */}
          {sessionType === 'TILEMAP' ? (
            !apiKey.trim() ? (
              <p className="text-xs text-amber-600">
                이미지 생성에는 OpenRouter API Key가 필요합니다. 헤더의 설정 아이콘에서 입력해 주세요.
              </p>
            ) : null
          ) : (
          <div>
            <div className="flex items-center gap-3">
              <label className="w-20 flex-shrink-0 text-sm font-semibold text-gray-700">모델</label>
              <div className="relative flex-1">
                <select
                  value={imageModel}
                  onChange={(e) => onImageModelChange(e.target.value as ImageGenerationModel)}
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-purple-500 focus:border-transparent appearance-none cursor-pointer pr-10"
                >
                  {availableModels.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.label}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={16}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
                />
              </div>
            </div>
          </div>
          )}

          {/* 이미지 비율 선택 */}
          {sessionType !== 'TILEMAP' && (
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">이미지 비율</label>
              <div className="flex flex-nowrap gap-1">
                {supportedAspectRatios.map((ratio) => (
                  <button
                    key={ratio}
                    onClick={() => onAspectRatioChange(ratio)}
                    className={`min-w-0 flex-1 px-1 py-1.5 rounded-md text-[11px] font-medium border transition-all ${
                      aspectRatio === ratio
                        ? 'bg-purple-600 text-white border-purple-700 shadow-sm'
                        : 'bg-white text-gray-700 border-gray-200 hover:border-purple-400'
                    }`}
                  >
                    {ratio}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 이미지 크기 선택 */}
          {sessionType !== 'TILEMAP' && (
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">이미지 크기(1K 권장)</label>
              <div className="grid grid-cols-3 gap-2">
                {(['1K', '2K', '4K'] as const).map((size) => (
                  <button
                    key={size}
                    onClick={() => handleImageSizeClick(size)}
                    disabled={!supportedImageSizes.includes(size)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium border-2 transition-all ${
                      imageSize === size
                        ? 'bg-purple-600 text-white border-purple-700 shadow-lg'
                        : 'bg-white text-gray-700 border-gray-200 hover:border-purple-400'
                    } disabled:bg-gray-100 disabled:text-gray-400 disabled:border-gray-200 disabled:cursor-not-allowed`}
                  >
                    {size}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 이미지 품질 (덕테이프 전용).
              TILEMAP은 medium 고정이므로 노출하지 않는다 — 재질 스와치는 균질한 필드라
              high로 올려도 얻는 게 없고 비용·시간만 늘어난다 */}
          {imageModel === 'openai/gpt-image-2' && sessionType !== 'TILEMAP' && (
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">이미지 품질</label>
              <div className="grid grid-cols-3 gap-2">
                {(['low', 'medium', 'high'] as const).map((quality) => (
                  <button
                    key={quality}
                    onClick={() => onImageQualityChange(quality)}
                    className={`px-3 py-2 rounded-lg text-sm font-medium border-2 transition-all ${
                      imageQuality === quality
                        ? 'bg-purple-600 text-white border-purple-700 shadow-lg'
                        : 'bg-white text-gray-700 border-gray-200 hover:border-purple-400'
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

          {/* 도움말 (OpenRouter Image API는 Seed/Temperature/Top-K/Top-P를 지원하지 않아 고급 설정을 제거) */}
          <button
            onClick={() => onShowHelpChange(true)}
            className="w-full flex items-center justify-center gap-2 p-3 bg-gray-50 hover:bg-purple-100 rounded-lg transition-colors"
            title="이미지 생성 도움말"
          >
            <HelpCircle size={16} className="text-purple-600" />
            <span className="text-sm font-semibold text-gray-700">이미지 생성 도움말</span>
          </button>

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
                    onClick={confirmImageSizeChange}
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

export const GeneratorSettings = memo(GeneratorSettingsComponent);
