import { memo, useEffect, useRef, useState, useCallback, MouseEvent } from 'react';
import { X, Stamp, Eraser, Shuffle, Trash2, ZoomIn, ZoomOut } from 'lucide-react';
import { loadImageElement } from '../../lib/tilemap/tileSlicer';
import { TilemapMode } from '../../types/tilemap';
import { RuleTileRole, pickRoleCell } from '../../lib/tilemap/ruleTileLayout';

interface TilePreviewCanvasProps {
  tiles: string[]; // 슬롯 타일 dataURL (null 제거된 배열)
  mode: TilemapMode;
  roles?: RuleTileRole[]; // mode==='ruletile'일 때 getRuleTileRoles(grid) 결과
  onClose: () => void;
}

const MAP_COLS = 12;
const MAP_ROWS = 8;
const CELL_PX = 64;

type Tool = 'stamp' | 'eraser';

/** 전부 null인 초기 맵 셀 배열 생성 */
function createEmptyMap(): (number | null)[][] {
  return Array.from({ length: MAP_ROWS }, () => Array<number | null>(MAP_COLS).fill(null));
}

/**
 * 룰타일 오토타일 선택: 4방(N/E/S/W) 이웃의 오버레이 여부로 역할을 정하고,
 * 4방이 모두 오버레이인데 대각이 비면 해당 방향 오목 코너를 쓴다 (없으면 fill 폴백).
 * variant는 (row*31+col*17)로 결정적 순환 — 같은 맵은 항상 같은 그림.
 */
function resolveRuleTileCell(
  map: (number | null)[][], row: number, col: number,
  roles: RuleTileRole[],
): number {
  const isOverlay = (r: number, c: number): boolean =>
    r >= 0 && r < map.length && c >= 0 && c < map[0].length && map[r][c] !== null;

  const n = isOverlay(row - 1, col), s = isOverlay(row + 1, col);
  const w = isOverlay(row, col - 1), e = isOverlay(row, col + 1);
  const variant = row * 31 + col * 17;
  const pick = (role: RuleTileRole): number => {
    const idx = pickRoleCell(roles, role, variant);
    return idx >= 0 ? idx : pickRoleCell(roles, 'fill', variant);
  };

  // base가 보이는 방향 조합으로 역할 결정 (base = 오버레이 아닌 쪽)
  if (!n && !w && s && e) return pick('corner_nw');
  if (!n && !e && s && w) return pick('corner_ne');
  if (!s && !w && n && e) return pick('corner_sw');
  if (!s && !e && n && w) return pick('corner_se');
  if (!n && s) return pick('edge_n');
  if (!s && n) return pick('edge_s');
  if (!w && e) return pick('edge_w');
  if (!e && w) return pick('edge_e');
  if (n && s && w && e) {
    // 대각 검사: 비어 있는 대각 방향의 오목 코너
    // (concave_nw는 Task 1 라벨 정의상 "base가 NW 대각에 보이는 타일"이며, NW 대각이 비었을 때 선택하는 이 매핑과 일치한다)
    if (!isOverlay(row - 1, col - 1)) return pick('concave_nw');
    if (!isOverlay(row - 1, col + 1)) return pick('concave_ne');
    if (!isOverlay(row + 1, col - 1)) return pick('concave_sw');
    if (!isOverlay(row + 1, col + 1)) return pick('concave_se');
    return pick('fill');
  }
  // 고립/한 줄 등 세트에 없는 형태는 fill로 폴백
  return pick('fill');
}

/**
 * 타일 배치 미리보기 캔버스 — plain canvas 기반 스탬프/랜덤 채우기/줌 모달.
 * 맵 상태는 저장하지 않는 휘발성 편집 도구다 (스펙 §6).
 * mode==='ruletile'일 때는 셀 상태 의미가 바뀐다: null=베이스, 1=오버레이.
 */
function TilePreviewCanvasComponent({ tiles, mode, roles, onClose }: TilePreviewCanvasProps) {
  const isRuleTile = mode === 'ruletile';
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imagesRef = useRef<HTMLImageElement[]>([]);
  const [imagesLoaded, setImagesLoaded] = useState(false);

  const [mapCells, setMapCells] = useState<(number | null)[][]>(createEmptyMap);
  const [selectedTile, setSelectedTile] = useState(0);
  const [tool, setTool] = useState<Tool>('stamp');
  const [zoom, setZoom] = useState<1 | 2>(1);
  const [isDrawing, setIsDrawing] = useState(false);

  // 타일 이미지 프리로드
  useEffect(() => {
    let cancelled = false;
    setImagesLoaded(false);
    Promise.all(tiles.map((t) => loadImageElement(t)))
      .then((imgs) => {
        if (cancelled) return;
        imagesRef.current = imgs;
        setImagesLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        imagesRef.current = [];
        setImagesLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [tiles]);

  // 캔버스 렌더링
  useEffect(() => {
    if (!imagesLoaded) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const cellSize = CELL_PX * zoom;
    canvas.width = MAP_COLS * cellSize;
    canvas.height = MAP_ROWS * cellSize;

    for (let r = 0; r < MAP_ROWS; r++) {
      for (let c = 0; c < MAP_COLS; c++) {
        const x = c * cellSize;
        const y = r * cellSize;

        let tileIndex: number | null;
        if (isRuleTile && roles) {
          tileIndex = mapCells[r][c] !== null
            ? resolveRuleTileCell(mapCells, r, c, roles)
            : pickRoleCell(roles, 'base', r * 31 + c * 17);
          if (tileIndex < 0) tileIndex = null;
        } else {
          tileIndex = mapCells[r][c];
        }
        const img = tileIndex !== null ? imagesRef.current[tileIndex] : undefined;

        if (img) {
          ctx.drawImage(img, x, y, cellSize, cellSize);
        } else {
          ctx.fillStyle = '#e5e7eb';
          ctx.fillRect(x, y, cellSize, cellSize);
        }

        ctx.strokeStyle = '#d1d5db';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, cellSize - 1, cellSize - 1);
      }
    }
  }, [mapCells, zoom, imagesLoaded, isRuleTile, roles]);

  // Esc 키로 닫기
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const applyAt = useCallback(
    (offsetX: number, offsetY: number) => {
      const cellSize = CELL_PX * zoom;
      const col = Math.floor(offsetX / cellSize);
      const row = Math.floor(offsetY / cellSize);
      if (col < 0 || col >= MAP_COLS || row < 0 || row >= MAP_ROWS) return;

      const value = tool === 'stamp' ? (isRuleTile ? 1 : selectedTile) : null;
      setMapCells((prev) => {
        if (prev[row][col] === value) return prev;
        const next = prev.map((rowCells) => [...rowCells]);
        next[row][col] = value;
        return next;
      });
    },
    [tool, selectedTile, zoom, isRuleTile]
  );

  const handleMouseDown = (e: MouseEvent<HTMLCanvasElement>) => {
    setIsDrawing(true);
    applyAt(e.nativeEvent.offsetX, e.nativeEvent.offsetY);
  };

  const handleMouseMove = (e: MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    applyAt(e.nativeEvent.offsetX, e.nativeEvent.offsetY);
  };

  const stopDrawing = () => setIsDrawing(false);

  const handleRandomFill = () => {
    if (tiles.length === 0) return;
    setMapCells(
      Array.from({ length: MAP_ROWS }, () =>
        Array.from({ length: MAP_COLS }, () => Math.floor(Math.random() * tiles.length))
      )
    );
  };

  const handleClearAll = () => setMapCells(createEmptyMap());

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* 상단 툴바 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-800">타일 배치 미리보기</h2>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
              <button
                onClick={() => setTool('stamp')}
                title={isRuleTile ? '오버레이 칠하기' : '스탬프'}
                className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  tool === 'stamp' ? 'bg-white shadow text-purple-700' : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <Stamp size={14} />
                {isRuleTile ? '오버레이 칠하기' : '스탬프'}
              </button>
              <button
                onClick={() => setTool('eraser')}
                title="지우개"
                className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  tool === 'eraser' ? 'bg-white shadow text-purple-700' : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <Eraser size={14} />
                지우개
              </button>
            </div>

            {!isRuleTile && (
              <button
                onClick={handleRandomFill}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors"
              >
                <Shuffle size={14} />
                랜덤 채우기
              </button>
            )}
            <button
              onClick={handleClearAll}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors"
            >
              <Trash2 size={14} />
              전체 지우기
            </button>

            <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
              <button
                onClick={() => setZoom(1)}
                title="1x 배율"
                className={`flex items-center px-2 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  zoom === 1 ? 'bg-white shadow text-purple-700' : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <ZoomOut size={14} />
              </button>
              <button
                onClick={() => setZoom(2)}
                title="2x 배율"
                className={`flex items-center px-2 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  zoom === 2 ? 'bg-white shadow text-purple-700' : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <ZoomIn size={14} />
              </button>
            </div>

            <button
              onClick={onClose}
              title="닫기"
              className="p-2 text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* 본문: 좌측 팔레트 + 캔버스 */}
        <div className="flex-1 flex overflow-hidden">
          {!isRuleTile && (
            <div className="w-20 border-r border-gray-200 overflow-y-auto p-2 flex flex-col items-center gap-2">
              {tiles.map((tile, index) => (
                <button
                  key={index}
                  onClick={() => setSelectedTile(index)}
                  title={`타일 ${index}`}
                  className={`w-12 h-12 rounded overflow-hidden border border-gray-200 flex-shrink-0 ${
                    selectedTile === index ? 'ring-2 ring-lime-500' : ''
                  }`}
                >
                  <img src={tile} alt={`타일 ${index}`} className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}

          <div className="flex-1 overflow-auto bg-gray-50 p-4">
            {imagesLoaded ? (
              <canvas
                ref={canvasRef}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={stopDrawing}
                onMouseLeave={stopDrawing}
                className="cursor-crosshair border border-gray-300"
              />
            ) : (
              <div className="flex items-center justify-center h-full text-gray-400 text-sm">
                타일 이미지 로딩 중...
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export const TilePreviewCanvas = memo(TilePreviewCanvasComponent);
