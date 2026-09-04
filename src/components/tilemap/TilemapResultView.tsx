import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Image as ImageIcon, Download, Lock, LockOpen, Grid3x3, LayoutGrid, Eye, Upload } from 'lucide-react';
import { LazyImage } from '../common/LazyImage';
import { TilePreviewCanvas } from './TilePreviewCanvas';
import { TilemapGridLayout, TileSlotAssignment, TilemapMode } from '../../types/tilemap';
import { buildSlotTable, describeSlot } from '../../lib/tilemap/autotileSignature';

/**
 * 투명 영역 표시용 체커보드.
 *
 * 흰 배경 위에 투명 타일을 그대로 얹으면 "흰 재질"과 구별이 안 된다.
 * 시트/타일 셀 뒤에 깔아 투명임을 눈으로 알 수 있게 한다.
 */
const CHECKER_BG: React.CSSProperties = {
  backgroundImage:
    'linear-gradient(45deg, #e5e7eb 25%, transparent 25%), ' +
    'linear-gradient(-45deg, #e5e7eb 25%, transparent 25%), ' +
    'linear-gradient(45deg, transparent 75%, #e5e7eb 75%), ' +
    'linear-gradient(-45deg, transparent 75%, #e5e7eb 75%)',
  backgroundSize: '12px 12px',
  backgroundPosition: '0 0, 0 6px, 6px -6px, -6px 0',
  backgroundColor: '#ffffff',
};

interface TilemapResultViewProps {
  isGenerating: boolean;
  progressMessage: string;
  generatedImage: string | null; // AI 원본 시트 (룰타일에서는 머티리얼 시트)
  /**
   * 내보내기와 동일한 합성 시트 (`tilesheet.png`와 같은 이미지).
   * 시트 보기는 이 값을 우선 표시한다 — AI 원본을 띄우면 실제 산출물과 달라 혼란을 준다.
   */
  composedSheet?: string | null;
  /** 생성 직후 자동 내보내기된 폴더 경로 (있으면 상단에 안내 표시) */
  autoExportFolder?: string | null;
  /** 경계 설정 변경으로 타일을 재합성 중인지 */
  isRecomposing?: boolean;
  /**
   * 보유 세트가 예전 합성 알고리즘 결과인지.
   * 특히 변형 v1 세트는 AI 시트를 잘라 만든 것이라 **임의 배치 접합 보장이 없다** —
   * 화면만 봐서는 알 수 없으므로 재생성을 안내한다.
   */
  needsRecompose?: boolean;
  grid: TilemapGridLayout;
  mode: TilemapMode;
  currentTiles: (string | null)[];
  baseTiles?: string[]; // 룰타일: 순수 베이스 지형 타일 변형들 (슬롯 밖의 별도 타일)
  baseTransparent?: boolean; // 룰타일: 베이스 지형이 투명인지 (미리보기 배경 표현용)
  slotAssignments: TileSlotAssignment[];
  onToggleLock: (slotIndex: number) => void;
  /** 선택 슬롯을 같은 스와치의 다른 변형으로 다시 뽑는다 (즉시 반영, 생성 호출 없음) */
  onReshuffleSelected: (slotIndexes: number[]) => void;
  onExport: () => void; // Task 9에서 구현, 이 태스크에서는 prop만
  onManualSave: () => void; // 시트 보기의 수동 저장 (기존 handleManualSave)
}

type ViewMode = 'sheet' | 'tiles';

function TilemapResultViewComponent({
  isGenerating,
  progressMessage,
  generatedImage,
  composedSheet,
  autoExportFolder,
  isRecomposing,
  needsRecompose,
  grid,
  mode,
  currentTiles,
  baseTiles,
  baseTransparent,
  slotAssignments,
  onToggleLock,
  onReshuffleSelected,
  onExport,
  onManualSave,
}: TilemapResultViewProps) {
  const hasTileData = slotAssignments.length > 0;
  // 시트 보기에 띄울 이미지 — 합성 시트가 있으면 그것(=내보내기 결과), 없으면 AI 원본
  const sheetImage = composedSheet ?? generatedImage;
  const hasSheet = sheetImage !== null;
  const isRuleTile = mode === 'ruletile';
  // 룰타일 슬롯 배치표 — 뱃지 라벨은 signature에서 파생한다(v2의 고정 14종 열거형 대체)
  const ruleTileSlots = useMemo(() => (isRuleTile ? buildSlotTable(grid) : null), [isRuleTile, grid]);

  const [viewMode, setViewMode] = useState<ViewMode>(hasTileData ? 'tiles' : 'sheet');
  const [selectedSlots, setSelectedSlots] = useState<Set<number>>(new Set());
  const [showPreviewCanvas, setShowPreviewCanvas] = useState(false);
  const hasEmptySlot = currentTiles.some((t) => t === null);

  // 첫 생성으로 타일 데이터가 생기는 전이 시점에만 타일 보기로 자동 전환 (이후 사용자가 시트 보기로 바꾼 것은 유지)
  const prevHasTileDataRef = useRef(hasTileData);
  useEffect(() => {
    if (!prevHasTileDataRef.current && hasTileData) {
      setViewMode('tiles');
    }
    prevHasTileDataRef.current = hasTileData;
  }, [hasTileData]);

  const previewTiles = useMemo(
    () => currentTiles.filter((t): t is string => t !== null),
    [currentTiles]
  );

  const toggleSelect = (slotIndex: number) => {
    setSelectedSlots((prev) => {
      const next = new Set(prev);
      if (next.has(slotIndex)) next.delete(slotIndex);
      else next.add(slotIndex);
      return next;
    });
  };

  const handleReshuffleClick = () => {
    onReshuffleSelected([...selectedSlots]);
    setSelectedSlots(new Set());
  };

  const gridColsClass = grid === '8x8' ? 'grid-cols-8' : 'grid-cols-4';

  if (isGenerating) {
    return (
      <div className="flex-1 p-8 overflow-y-auto">
        <div className="flex items-center justify-center min-h-full">
          <div className="flex flex-col items-center">
            <div className="animate-spin rounded-full h-16 w-16 border-4 border-purple-500 border-t-transparent mb-4"></div>
            <p className="text-gray-600 font-semibold">{progressMessage}</p>
          </div>
        </div>
      </div>
    );
  }

  if (!hasTileData && !hasSheet) {
    return (
      <div className="flex-1 p-8 overflow-y-auto">
        <div className="flex items-center justify-center min-h-full">
          <div className="text-center text-gray-400">
            <ImageIcon size={64} className="mx-auto mb-4 opacity-30" />
            <p className="text-lg font-semibold">이미지 생성 버튼을 눌러 타일 세트를 만들어 보세요</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex-1 flex flex-col overflow-hidden">
      {/* 상단 토글 바 */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-gray-200 bg-white">
        <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
          <button
            onClick={() => setViewMode('sheet')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              viewMode === 'sheet' ? 'bg-white shadow text-purple-700' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <LayoutGrid size={16} />
            시트 보기
          </button>
          <button
            onClick={() => setViewMode('tiles')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              viewMode === 'tiles' ? 'bg-white shadow text-purple-700' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <Grid3x3 size={16} />
            타일 보기
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            disabled={hasEmptySlot}
            onClick={() => setShowPreviewCanvas(true)}
            aria-pressed={showPreviewCanvas}
            title={hasEmptySlot ? '모든 슬롯이 채워져야 미리보기를 열 수 있습니다' : '미리보기 캔버스'}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg transition-colors ${
              hasEmptySlot
                ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            <Eye size={16} />
            <span className="text-sm font-medium">미리보기 캔버스</span>
          </button>
          <button
            onClick={onExport}
            className="flex items-center gap-1.5 px-3 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors"
          >
            <Upload size={16} />
            <span className="text-sm font-medium">유니티 내보내기</span>
          </button>
        </div>
      </div>

      {/*
        경계 설정 재합성 중 표시 — 생성 API 호출이 아니라 로컬 재합성이다.

        **레이아웃에 영향을 주지 않는 떠 있는 토스트여야 한다.** 인라인 배너로 두면
        경계선 프리셋·아웃라인을 만질 때마다 배너가 생겼다 사라지며 아래 보기 영역이
        그만큼 밀려 화면이 위아래로 출렁인다. 아웃라인을 조금씩 바꿔가며 결과를 눈으로
        비교하는 것이 이 기능의 사용 흐름인데, 그때마다 화면이 흔들리면 비교가 불가능하다.
        (`absolute` + `pointer-events-none` 이라 스크롤 위치도 클릭도 방해하지 않는다)
      */}
      {isRecomposing && (
        <div className="pointer-events-none absolute top-16 left-1/2 -translate-x-1/2 z-20">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-purple-600/95 text-white text-[12px] shadow-lg">
            <span className="inline-block w-3 h-3 border-2 border-white/80 border-t-transparent rounded-full animate-spin shrink-0" />
            <span className="whitespace-nowrap">경계 설정 적용 중… (재생성 아님)</span>
          </div>
        </div>
      )}

      {/*
        레거시 세트 안내 — 예전 알고리즘으로 만든 세트는 접합 보장이 없다.
        화면만 봐서는 구분할 수 없으므로 명시적으로 알린다 (자동 마이그레이션은 불가능하다 —
        보장을 얻으려면 재질 스와치를 새로 생성해야 한다).
      */}
      {needsRecompose && (
        <div className="px-6 py-2 border-b border-amber-200 bg-amber-50 text-[12px] text-amber-900 flex items-center gap-2">
          <span className="shrink-0">⚠</span>
          <span>
            예전 방식(AI 시트를 잘라 만든 세트)입니다 — <b>임의 배치에서 이음새가 어긋날 수 있습니다.</b>
            다시 생성하면 변 픽셀을 공유하는 현재 방식으로 만들어져 접합이 보장됩니다.
          </span>
        </div>
      )}

      {/* 자동 내보내기 안내 */}
      {autoExportFolder && (
        <div className="px-6 py-2 border-b border-emerald-200 bg-emerald-50 text-[12px] text-emerald-800 flex items-center gap-2">
          <Upload size={13} className="shrink-0" />
          <span className="shrink-0 font-medium">유니티용으로 자동 내보냄:</span>
          <span className="font-mono truncate" title={autoExportFolder}>{autoExportFolder}</span>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {viewMode === 'sheet' ? (
          <div className="p-8">
            <div className="flex items-center justify-center min-h-full">
              {hasSheet ? (
                <div className="max-w-5xl w-full">
                  <div className="relative bg-white rounded-xl shadow-2xl p-6 overflow-auto" style={{ maxHeight: '70vh' }}>
                    {/* 시트에 투명 영역이 있을 수 있으므로 체커보드 위에 얹는다 */}
                    <button
                      onClick={onManualSave}
                      className="absolute top-4 left-4 z-10 p-3 bg-white/90 hover:bg-white border border-gray-200 rounded-lg shadow-lg transition-all hover:shadow-xl group"
                      title="이미지 저장"
                    >
                      <Download size={20} className="text-gray-700 group-hover:text-purple-600 transition-colors" />
                    </button>
                    <div className="flex items-center justify-center">
                      <LazyImage
                        src={sheetImage as string}
                        alt="타일 시트"
                        className="rounded-lg"
                        style={{ ...CHECKER_BG, maxWidth: '100%', maxHeight: '100%', width: 'auto', height: 'auto', objectFit: 'contain' }}
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center text-gray-400">
                  <ImageIcon size={64} className="mx-auto mb-4 opacity-30" />
                  <p className="text-lg font-semibold">아직 생성된 시트가 없습니다</p>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="p-6">
            <div className={`grid ${gridColsClass} gap-2`}>
              {currentTiles.map((tile, slotIndex) => {
                const assignment = slotAssignments[slotIndex];
                const locked = assignment?.locked ?? false;
                const isSelected = selectedSlots.has(slotIndex);

                return (
                  <div
                    key={slotIndex}
                    className={`relative aspect-square rounded-lg overflow-hidden border border-gray-200 ${
                      isSelected ? 'ring-2 ring-lime-500' : ''
                    }`}
                    style={CHECKER_BG}
                  >
                    {tile ? (
                      <img src={tile} alt={`타일 ${slotIndex}`} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full bg-gray-200" />
                    )}

                    {!isRuleTile && (
                      <>
                        {/* 좌상단 선택 체크박스 */}
                        <label className="absolute top-1 left-1 z-10">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelect(slotIndex)}
                            className="w-4 h-4 accent-lime-500 cursor-pointer"
                          />
                        </label>

                        {/* 좌하단 락 토글 */}
                        <button
                          onClick={() => onToggleLock(slotIndex)}
                          className="absolute bottom-1 left-1 z-10 p-1 bg-black/50 hover:bg-black/70 rounded transition-colors"
                          title={locked ? '잠금 해제' : '잠금 (변형 교체에서 보호)'}
                        >
                          {locked ? (
                            <Lock size={12} className="text-white" />
                          ) : (
                            <LockOpen size={12} className="text-white/70" />
                          )}
                        </button>
                      </>
                    )}

                    {/*
                      우상단 역할 뱃지 — 룰타일만.
                      변형 모드에는 예전에 seam 점수 뱃지가 있었지만, 접합이 구성으로
                      보장되는 지금은 잴 것이 없다(점수 자체가 휴리스틱이라 눈에 보이는
                      이음새를 통과시키기도 했다). 뱃지를 없애는 편이 정직하다.
                    */}
                    {isRuleTile && (
                      <div className="absolute top-1 right-1 z-10 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-sky-600 text-white">
                        {describeSlot(ruleTileSlots![slotIndex])}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* 하단 액션 바 */}
      {viewMode === 'tiles' && isRuleTile ? (
        <div className="flex items-center justify-center px-6 py-3 border-t border-gray-200 bg-white">
          <p className="text-sm text-gray-500">
            룰타일 세트는 역할이 고정되어 슬롯 교체가 없습니다 — 마음에 안 들면 다시 생성하세요.
          </p>
        </div>
      ) : viewMode === 'tiles' ? (
        <div className="flex items-center justify-between px-6 py-3 border-t border-gray-200 bg-white">
          {/*
            레거시 세트는 변형 풀이 없다(슬롯과 1:1인 분할 결과다). 재배치해도 접합이
            개선되지 않으므로 보장 문구를 걸지 않고 버튼도 막는다 — 대신 재생성을 안내한다.
          */}
          <p className="text-sm text-gray-500">
            {needsRecompose
              ? '예전 방식 세트는 변형 교체를 쓸 수 없습니다 — 다시 생성해 주세요.'
              : '선택한 슬롯을 같은 재질의 다른 변형으로 바꿉니다 — 생성 호출 없이 즉시 반영되고, 접합은 그대로 유지됩니다.'}
          </p>
          <button
            onClick={handleReshuffleClick}
            disabled={selectedSlots.size === 0 || needsRecompose}
            className="px-4 py-1.5 text-sm font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            다른 변형으로 교체 ({selectedSlots.size})
          </button>
        </div>
      ) : null}

      {showPreviewCanvas && (
        <TilePreviewCanvas
          tiles={previewTiles}
          mode={mode}
          grid={grid}
          baseTiles={baseTiles}
          baseTransparent={baseTransparent}
          onClose={() => setShowPreviewCanvas(false)}
        />
      )}
    </div>
  );
}

export const TilemapResultView = memo(TilemapResultViewComponent);
