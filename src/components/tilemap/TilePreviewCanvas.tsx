import { memo, useEffect, useMemo, useRef, useState, useCallback, MouseEvent } from 'react';
import { X, Stamp, Eraser, Shuffle, Trash2, ZoomIn, ZoomOut, Hand } from 'lucide-react';
import { loadImageElement } from '../../lib/tilemap/tileSlicer';
import { TilemapGridLayout, TilemapMode } from '../../types/tilemap';
import { signatureFromMap } from '../../lib/tilemap/edgeProfile';
import { buildSignatureIndex, buildSlotTable, signatureToSlot } from '../../lib/tilemap/autotileSignature';

interface TilePreviewCanvasProps {
  tiles: string[]; // 슬롯 타일 dataURL (null 제거된 배열)
  mode: TilemapMode;
  grid: TilemapGridLayout; // 룰타일 signature 축약 방식 결정 (4x4=4비트, 8x8=blob)
  baseTiles?: string[]; // 룰타일: 순수 베이스 지형 타일 변형들 (슬롯 밖의 별도 타일)
  /** 룰타일: 베이스 지형이 투명인지. 회색 "타일 없음" 박스와 구별해 체커보드로 그린다 */
  baseTransparent?: boolean;
  onClose: () => void;
}

/**
 * 맵 크기. 전체 화면 모달에서 실제로 지형을 설계할 수 있을 만큼 넓게 잡는다
 * (24x16 x 64px = 1536x1024 → 대개 화면보다 크므로 패닝이 필요하다).
 */
const MAP_COLS = 24;
const MAP_ROWS = 16;
const CELL_PX = 64;

/** 줌 단계 — 0.5x는 전체 조망, 2x는 경계 디테일 확인용 */
const ZOOM_LEVELS = [0.5, 1, 2] as const;
type Zoom = (typeof ZOOM_LEVELS)[number];

type Tool = 'stamp' | 'eraser';

/** 투명 영역을 나타내는 체커보드 셀 (회색 "타일 없음" 박스와 구별하기 위한 표시) */
function drawCheckerCell(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number
): void {
  const q = size / 2;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x, y, size, size);
  ctx.fillStyle = '#e5e7eb';
  ctx.fillRect(x, y, q, q);
  ctx.fillRect(x + q, y + q, q, q);
}

/** 전부 null인 초기 맵 셀 배열 생성 */
function createEmptyMap(): (number | null)[][] {
  return Array.from({ length: MAP_ROWS }, () => Array<number | null>(MAP_COLS).fill(null));
}

/**
 * 룰타일 오토타일 선택.
 *
 * 셀의 8방향 이웃에서 signature를 계산하고, 생성 단계와 **동일한** 슬롯 테이블
 * (`autotileSignature.ts`)로 타일을 조회한다. 미리보기와 유니티 Rule Tile이 같은 표를
 * 참조하므로 둘의 동작이 구조적으로 일치한다 — v2처럼 별도 규칙을 손으로 짜지 않는다.
 *
 * 변형 타일이 여럿이면 (row*31+col*17)로 결정적 선택 — 같은 맵은 항상 같은 그림.
 */
function resolveRuleTileCell(
  map: (number | null)[][],
  row: number,
  col: number,
  grid: TilemapGridLayout,
  index: Map<number, number[]>
): number {
  const isOverlay = (r: number, c: number): boolean =>
    r >= 0 && r < map.length && c >= 0 && c < map[0].length && map[r][c] !== null;

  const signature = signatureFromMap(isOverlay, row, col);
  return signatureToSlot(signature, grid, index, row * 31 + col * 17);
}

/**
 * 타일 배치 미리보기 캔버스 — 전체 화면 모달의 plain canvas 도구.
 * 맵 상태는 저장하지 않는 휘발성 편집 도구다 (스펙 §6).
 * mode==='ruletile'일 때는 셀 상태 의미가 바뀐다: null=베이스, 1=오버레이.
 *
 * 조작:
 * - 좌클릭 드래그: 현재 도구(칠하기/지우개)
 * - **Alt + 드래그**: 도구와 무관하게 즉시 지우기
 * - **가운데 클릭 드래그** 또는 **스페이스바 + 드래그**: 패닝
 */
function TilePreviewCanvasComponent({ tiles, mode, grid, baseTiles = [], baseTransparent = false, onClose }: TilePreviewCanvasProps) {
  const isRuleTile = mode === 'ruletile';
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const imagesRef = useRef<HTMLImageElement[]>([]);
  // 베이스 타일 변형들은 슬롯 배열 뒤에 이어 붙여 로드한다 (인덱스 = tiles.length + v)
  const baseTileOffset = tiles.length;
  // 배열 정체성이 매 렌더 바뀌어도 이펙트가 재실행되지 않도록 내용 기반 키를 쓴다
  const baseTilesKey = baseTiles.map((t) => t.length).join(',');
  const [imagesLoaded, setImagesLoaded] = useState(false);

  // signature → 슬롯 조회표 (그리드가 바뀔 때만 재생성)
  const signatureIndex = useMemo(
    () => buildSignatureIndex(buildSlotTable(grid)),
    [grid]
  );

  const [mapCells, setMapCells] = useState<(number | null)[][]>(createEmptyMap);
  const [selectedTile, setSelectedTile] = useState(0);
  const [tool, setTool] = useState<Tool>('stamp');
  const [zoom, setZoom] = useState<Zoom>(1);
  /**
   * 드래그/패닝 진행 플래그는 **ref**로 둔다.
   * state로 두면 mousedown 직후 첫 mousemove가 아직 이전 렌더의 값(false)을 읽어
   * 한 프레임 동안 의도와 다르게 동작한다(패닝 대신 칠하기). 커서 표시용으로만
   * 별도 state를 둔다.
   */
  const isDrawingRef = useRef(false);
  const isPanningRef = useRef(false);
  const isSpaceHeldRef = useRef(false);
  /** 커서 모양 갱신용 (렌더에만 쓰인다) */
  const [cursorMode, setCursorMode] = useState<'draw' | 'panReady' | 'panning'>('draw');
  /** 패닝 시작 시점의 포인터·스크롤 위치 */
  const panStartRef = useRef({ x: 0, y: 0, left: 0, top: 0 });

  // 타일 이미지 프리로드
  useEffect(() => {
    let cancelled = false;
    setImagesLoaded(false);
    const sources = [...tiles, ...baseTiles];
    Promise.all(sources.map((t) => loadImageElement(t)))
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tiles, baseTilesKey]);

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
        if (isRuleTile) {
          // 오버레이 셀은 signature로, 베이스 셀은 전용 베이스 타일로 그린다.
          // (v2에서는 4x4에 'base' 역할이 없어 배경이 통째로 회색 박스로 나왔다)
          // 베이스 셀은 변형 중 하나를 결정적으로 고른다 — 한 장만 쓰면 바닥이 통째로
          // 같은 무늬로 반복돼 실제 유니티 화면(Random Tile 사용)과 인상이 달라진다
          tileIndex = mapCells[r][c] !== null
            ? resolveRuleTileCell(mapCells, r, c, grid, signatureIndex)
            : (baseTiles.length > 0
                ? baseTileOffset + ((r * 31 + c * 17) % baseTiles.length)
                : -1);
          if (tileIndex < 0) tileIndex = null;
        } else {
          tileIndex = mapCells[r][c];
        }
        const img = tileIndex !== null ? imagesRef.current[tileIndex] : undefined;

        if (img) {
          ctx.drawImage(img, x, y, cellSize, cellSize);
        } else if (isRuleTile && baseTransparent && mapCells[r][c] === null) {
          // 베이스가 투명인 세트: 바닥 셀은 "타일 없음"이 아니라 **의도된 투명**이다.
          // 회색 박스로 그리면 오류처럼 보이므로 체커보드로 구분해 그린다
          drawCheckerCell(ctx, x, y, cellSize);
        } else {
          ctx.fillStyle = '#e5e7eb';
          ctx.fillRect(x, y, cellSize, cellSize);
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapCells, zoom, imagesLoaded, isRuleTile, grid, signatureIndex, baseTilesKey, baseTileOffset, baseTransparent]);

  // Esc 닫기 / 스페이스바 패닝 토글
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.code === 'Space') {
        // 스페이스로 페이지가 스크롤되거나 포커스된 버튼이 눌리는 것을 막는다
        e.preventDefault();
        isSpaceHeldRef.current = true;
        if (!isPanningRef.current) setCursorMode('panReady');
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        isSpaceHeldRef.current = false;
        isPanningRef.current = false;
        setCursorMode('draw');
      }
    };
    // 창 포커스를 잃으면 keyup을 놓치므로 상태를 풀어준다
    const handleBlur = () => {
      isSpaceHeldRef.current = false;
      isPanningRef.current = false;
      isDrawingRef.current = false;
      setCursorMode('draw');
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, [onClose]);

  /** 셀 하나에 도구를 적용한다. alt가 true면 도구와 무관하게 지운다 */
  const applyAt = useCallback(
    (offsetX: number, offsetY: number, alt: boolean) => {
      const cellSize = CELL_PX * zoom;
      const col = Math.floor(offsetX / cellSize);
      const row = Math.floor(offsetY / cellSize);
      if (col < 0 || col >= MAP_COLS || row < 0 || row >= MAP_ROWS) return;

      const erasing = alt || tool === 'eraser';
      const value = erasing ? null : (isRuleTile ? 1 : selectedTile);
      setMapCells((prev) => {
        if (prev[row][col] === value) return prev;
        const next = prev.map((rowCells) => [...rowCells]);
        next[row][col] = value;
        return next;
      });
    },
    [tool, selectedTile, zoom, isRuleTile]
  );

  /** 패닝 시작 (가운데 클릭 또는 스페이스+좌클릭) */
  const beginPan = (clientX: number, clientY: number) => {
    const vp = viewportRef.current;
    if (!vp) return;
    panStartRef.current = { x: clientX, y: clientY, left: vp.scrollLeft, top: vp.scrollTop };
    isPanningRef.current = true;
    setCursorMode('panning');
  };

  const handleMouseDown = (e: MouseEvent<HTMLCanvasElement>) => {
    // 가운데 클릭: 브라우저 자동 스크롤을 막고 패닝으로 쓴다
    if (e.button === 1 || (e.button === 0 && isSpaceHeldRef.current)) {
      e.preventDefault();
      beginPan(e.clientX, e.clientY);
      return;
    }
    if (e.button !== 0) return;
    isDrawingRef.current = true;
    applyAt(e.nativeEvent.offsetX, e.nativeEvent.offsetY, e.altKey);
  };

  const handleMouseMove = (e: MouseEvent<HTMLCanvasElement>) => {
    if (isPanningRef.current) {
      const vp = viewportRef.current;
      if (!vp) return;
      vp.scrollLeft = panStartRef.current.left - (e.clientX - panStartRef.current.x);
      vp.scrollTop = panStartRef.current.top - (e.clientY - panStartRef.current.y);
      return;
    }
    if (!isDrawingRef.current) return;
    applyAt(e.nativeEvent.offsetX, e.nativeEvent.offsetY, e.altKey);
  };

  const stopInteraction = () => {
    isDrawingRef.current = false;
    isPanningRef.current = false;
    setCursorMode(isSpaceHeldRef.current ? 'panReady' : 'draw');
  };

  const handleRandomFill = () => {
    if (tiles.length === 0) return;
    setMapCells(
      Array.from({ length: MAP_ROWS }, () =>
        Array.from({ length: MAP_COLS }, () => Math.floor(Math.random() * tiles.length))
      )
    );
  };

  const handleClearAll = () => setMapCells(createEmptyMap());

  const panCursor = cursorMode === 'panning' ? 'grabbing' : cursorMode === 'panReady' ? 'grab' : 'crosshair';

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-2">
      <div className="bg-white rounded-xl shadow-2xl w-[97vw] h-[95vh] flex flex-col overflow-hidden">
        {/* 상단 툴바 */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-200 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <h2 className="text-base font-semibold text-gray-800 shrink-0">타일 배치 미리보기</h2>
            <span className="text-[11px] text-gray-500 truncate hidden lg:inline">
              가운데 클릭 또는 Space+드래그 = 이동 · Alt+드래그 = 지우기
            </span>
          </div>
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
                title="지우개 (Alt+드래그로도 지울 수 있습니다)"
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
              {ZOOM_LEVELS.map((level) => (
                <button
                  key={level}
                  onClick={() => setZoom(level)}
                  title={`${level}x 배율`}
                  className={`flex items-center gap-1 px-2 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    zoom === level ? 'bg-white shadow text-purple-700' : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  {level === 0.5 ? <ZoomOut size={14} /> : level === 2 ? <ZoomIn size={14} /> : null}
                  {level}x
                </button>
              ))}
            </div>

            <button
              onClick={onClose}
              className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
              title="닫기 (Esc)"
            >
              <X size={18} className="text-gray-600" />
            </button>
          </div>
        </div>

        {/* 캔버스 뷰포트 — 스크롤 컨테이너이자 패닝 대상 */}
        <div
          ref={viewportRef}
          className="flex-1 overflow-auto bg-gray-100 min-h-0"
        >
          <canvas
            ref={canvasRef}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={stopInteraction}
            onMouseLeave={stopInteraction}
            // 가운데 클릭의 브라우저 기본 자동 스크롤 억제
            onAuxClick={(e) => e.preventDefault()}
            onContextMenu={(e) => e.preventDefault()}
            className="block"
            style={{ cursor: panCursor, imageRendering: zoom >= 2 ? 'pixelated' : 'auto' }}
          />
        </div>

        {/* 하단: 변형 모드 타일 팔레트 */}
        {!isRuleTile && (
          <div className="shrink-0 border-t border-gray-200 px-4 py-2.5 overflow-x-auto">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-gray-600 shrink-0">스탬프 타일</span>
              {tiles.map((tile, i) => (
                <button
                  key={i}
                  onClick={() => setSelectedTile(i)}
                  className={`w-11 h-11 shrink-0 rounded overflow-hidden border-2 transition-all ${
                    selectedTile === i ? 'border-purple-500' : 'border-gray-200 hover:border-gray-400'
                  }`}
                  title={`타일 ${i}`}
                >
                  <img src={tile} alt={`타일 ${i}`} className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 룰타일 모드 안내 */}
        {isRuleTile && (
          <div className="shrink-0 border-t border-gray-200 px-4 py-2 flex items-center gap-2 text-[11px] text-gray-500">
            <Hand size={12} className="shrink-0" />
            <span>
              칠한 영역이 오버레이 지형이 되고, 주변 이웃에 맞는 타일이 자동으로 선택됩니다
              (유니티 Rule Tile과 같은 표를 조회).
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export const TilePreviewCanvas = memo(TilePreviewCanvasComponent);
