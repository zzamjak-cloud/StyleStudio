import { memo, useState } from 'react';
import { Image as ImageIcon, Download, Lock, LockOpen, Grid3x3, LayoutGrid, Eye, Upload } from 'lucide-react';
import { LazyImage } from '../common/LazyImage';
import { TilePreviewCanvas } from './TilePreviewCanvas';
import { TilemapGridLayout, TileSlotAssignment, TILEMAP_SEAM_WARNING_THRESHOLD } from '../../types/tilemap';
import { TilemapReplacementProposal } from '../../hooks/useTilemapProcessing';

interface TilemapResultViewProps {
  isGenerating: boolean;
  progressMessage: string;
  generatedImage: string | null; // 최근 생성 시트 (시트 보기용)
  grid: TilemapGridLayout;
  currentTiles: (string | null)[];
  slotAssignments: TileSlotAssignment[];
  proposal: TilemapReplacementProposal | null;
  onToggleLock: (slotIndex: number) => void;
  onRegenerateSelected: (slotIndexes: number[]) => void;
  onConfirmProposal: () => void;
  onDiscardProposal: () => void;
  onExport: () => void; // Task 9에서 구현, 이 태스크에서는 prop만
  onManualSave: () => void; // 시트 보기의 수동 저장 (기존 handleManualSave)
}

type ViewMode = 'sheet' | 'tiles';

function TilemapResultViewComponent({
  isGenerating,
  progressMessage,
  generatedImage,
  grid,
  currentTiles,
  slotAssignments,
  proposal,
  onToggleLock,
  onRegenerateSelected,
  onConfirmProposal,
  onDiscardProposal,
  onExport,
  onManualSave,
}: TilemapResultViewProps) {
  const hasTileData = slotAssignments.length > 0;
  const hasSheet = generatedImage !== null;

  const [viewMode, setViewMode] = useState<ViewMode>(hasTileData ? 'tiles' : 'sheet');
  const [selectedSlots, setSelectedSlots] = useState<Set<number>>(new Set());
  const [showPreviewCanvas, setShowPreviewCanvas] = useState(false);
  const hasEmptySlot = currentTiles.some((t) => t === null);

  const toggleSelect = (slotIndex: number) => {
    setSelectedSlots((prev) => {
      const next = new Set(prev);
      if (next.has(slotIndex)) next.delete(slotIndex);
      else next.add(slotIndex);
      return next;
    });
  };

  const handleRegenerateClick = () => {
    onRegenerateSelected([...selectedSlots]);
    setSelectedSlots(new Set());
  };

  // 제안 모드: 슬롯 인덱스 → 교체 정보 맵
  const proposalBySlot = new Map(
    (proposal?.replacements ?? []).map((r) => [r.slotIndex, r])
  );

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
    <div className="flex-1 flex flex-col overflow-hidden">
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

      <div className="flex-1 overflow-y-auto">
        {viewMode === 'sheet' ? (
          <div className="p-8">
            <div className="flex items-center justify-center min-h-full">
              {hasSheet ? (
                <div className="max-w-5xl w-full">
                  <div className="relative bg-white rounded-xl shadow-2xl p-6 overflow-auto" style={{ maxHeight: '70vh' }}>
                    <button
                      onClick={onManualSave}
                      className="absolute top-4 left-4 z-10 p-3 bg-white/90 hover:bg-white border border-gray-200 rounded-lg shadow-lg transition-all hover:shadow-xl group"
                      title="이미지 저장"
                    >
                      <Download size={20} className="text-gray-700 group-hover:text-purple-600 transition-colors" />
                    </button>
                    <div className="flex items-center justify-center">
                      <LazyImage
                        src={generatedImage as string}
                        alt="타일 시트"
                        className="rounded-lg"
                        style={{ maxWidth: '100%', maxHeight: '100%', width: 'auto', height: 'auto', objectFit: 'contain' }}
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
                const seamScore = assignment?.seamScore;
                const locked = assignment?.locked ?? false;
                const isSelected = selectedSlots.has(slotIndex);
                const replacement = proposalBySlot.get(slotIndex);
                const isProposed = replacement !== undefined;
                const displayTile = isProposed ? proposal!.sheetTiles[replacement.cellIndex] : tile;

                return (
                  <div
                    key={slotIndex}
                    className={`relative aspect-square rounded-lg overflow-hidden border border-gray-200 ${
                      isProposed ? 'ring-2 ring-blue-500' : isSelected ? 'ring-2 ring-lime-500' : ''
                    }`}
                  >
                    {displayTile ? (
                      <img src={displayTile} alt={`타일 ${slotIndex}`} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full bg-gray-200" />
                    )}

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
                      title={locked ? '잠금 해제' : '잠금 (교체 재생성에서 보호)'}
                    >
                      {locked ? (
                        <Lock size={12} className="text-white" />
                      ) : (
                        <LockOpen size={12} className="text-white/70" />
                      )}
                    </button>

                    {/* 우상단 seam 점수 뱃지 / 교체 예정 뱃지 */}
                    {isProposed ? (
                      <div className="absolute top-1 right-1 z-10 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-500 text-white">
                        교체 예정
                      </div>
                    ) : seamScore !== undefined ? (
                      <div
                        className={`absolute top-1 right-1 z-10 px-1.5 py-0.5 rounded text-[10px] font-semibold flex items-center gap-0.5 ${
                          seamScore >= TILEMAP_SEAM_WARNING_THRESHOLD
                            ? 'bg-emerald-500 text-white'
                            : 'bg-amber-500 text-white'
                        }`}
                      >
                        {seamScore < TILEMAP_SEAM_WARNING_THRESHOLD && <span>⚠</span>}
                        {seamScore}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* 하단 액션 바 */}
      {proposal ? (
        <div className="flex items-center justify-between px-6 py-3 border-t border-blue-200 bg-blue-50">
          <span className="text-sm font-medium text-blue-800">
            제안된 교체 {proposal.replacements.length}건
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={onDiscardProposal}
              className="px-4 py-1.5 text-sm font-medium text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              취소
            </button>
            <button
              onClick={onConfirmProposal}
              className="px-4 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
            >
              확정
            </button>
          </div>
        </div>
      ) : viewMode === 'tiles' ? (
        <div className="flex items-center justify-end px-6 py-3 border-t border-gray-200 bg-white">
          <button
            onClick={handleRegenerateClick}
            disabled={selectedSlots.size === 0 || isGenerating}
            className="px-4 py-1.5 text-sm font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            선택 재생성 ({selectedSlots.size})
          </button>
        </div>
      ) : null}

      {showPreviewCanvas && (
        <TilePreviewCanvas
          tiles={currentTiles.filter((t): t is string => t !== null)}
          onClose={() => setShowPreviewCanvas(false)}
        />
      )}
    </div>
  );
}

export const TilemapResultView = memo(TilemapResultViewComponent);
