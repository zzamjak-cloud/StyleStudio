import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Stage, Layer, Image as KonvaImage, Line } from 'react-konva';
import Konva from 'konva';
import { X, Pencil, Eraser, Undo2, Send, ZoomIn, ZoomOut, Maximize } from 'lucide-react';
import { AnnotationResult, AnnotationStroke, ANNOTATION_COLORS, ColorRegion, getColorLabel } from '../../../types/annotation';
import { exportNodeToDataUrl, normalizeMaskToOpenAI } from '../../../lib/utils/annotationExport';
import { logger } from '../../../lib/logger';

interface ImageAnnotatorProps {
  open: boolean;
  imageBase64: string;
  originalImageRef: string;
  onClose: () => void;
  onSubmit: (result: AnnotationResult) => Promise<void> | void;
}

const WIDTHS = [2, 4, 8, 16];
const MAX_CANVAS_DIM = 1280;
// 줌 배율 한계 (화면 맞춤 크기 기준 상대 배율)
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;

export function ImageAnnotator({ open, imageBase64, originalImageRef, onClose, onSubmit }: ImageAnnotatorProps) {
  const stageRef = useRef<Konva.Stage>(null);
  const paintLayerRef = useRef<Konva.Layer>(null);
  const maskLayerRef = useRef<Konva.Layer>(null);
  const canvasWrapRef = useRef<HTMLDivElement>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  // stageSize는 논리 좌표계(원본 해상도, 최대 1280 다운스케일). 화면 표시는 viewScale로 별도 배율 적용.
  const [stageSize, setStageSize] = useState({ width: 800, height: 600 });
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1); // 화면 맞춤 크기 대비 사용자 줌 배율
  const [strokes, setStrokes] = useState<AnnotationStroke[]>([]);
  const [tool, setTool] = useState<'pen' | 'eraser'>('pen');
  const [color, setColor] = useState(ANNOTATION_COLORS[0].hex);
  const [strokeWidth, setStrokeWidth] = useState(WIDTHS[1]);
  const [colorInstructions, setColorInstructions] = useState<Record<string, string>>({});
  const [globalInstructions, setGlobalInstructions] = useState('');
  const [isDrawing, setIsDrawing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 캔버스에서 실제로 사용된 색상 추적 (지시문 입력란을 활성화/포커싱하기 위함)
  const usedColors = useMemo(() => {
    const set = new Set<string>();
    for (const s of strokes) {
      if (s.tool !== 'eraser') set.add(s.color.toLowerCase());
    }
    return Array.from(set);
  }, [strokes]);

  useEffect(() => {
    if (!open) return;
    const src = imageBase64.startsWith('data:') ? imageBase64 : `data:image/jpeg;base64,${imageBase64}`;
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      const scale = Math.min(1, MAX_CANVAS_DIM / Math.max(w, h));
      setStageSize({ width: Math.round(w * scale), height: Math.round(h * scale) });
      setImage(img);
    };
    img.onerror = () => logger.error('어노테이션: 이미지 로드 실패');
    img.src = src;
  }, [open, imageBase64]);

  // 모달 닫힐 때 상태 초기화
  useEffect(() => {
    if (!open) {
      setStrokes([]);
      setColorInstructions({});
      setGlobalInstructions('');
      setIsSubmitting(false);
      setZoom(1);
    }
  }, [open]);

  // 캔버스 컨테이너 크기 추적 → 이미지가 항상 화면 안에 들어오도록 fit 배율 계산의 기준으로 사용
  useEffect(() => {
    if (!open) return;
    const el = canvasWrapRef.current;
    if (!el) return;
    const update = () => setContainerSize({ width: el.clientWidth, height: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open]);

  // 화면 맞춤 배율: 컨테이너(패딩 제외) 안에 이미지 전체가 들어가는 최대 배율 (원본보다 확대하지는 않음)
  const fitScale = useMemo(() => {
    if (!containerSize.width || !containerSize.height) return 1;
    const availW = Math.max(50, containerSize.width - 32);
    const availH = Math.max(50, containerSize.height - 32);
    return Math.min(availW / stageSize.width, availH / stageSize.height, 1);
  }, [containerSize, stageSize]);

  // 실제 표시 배율 = 화면 맞춤 배율 × 사용자 줌
  const viewScale = fitScale * zoom;

  // Ctrl(또는 Cmd)+휠로 캔버스 확대/축소. React onWheel은 passive라 preventDefault가 안 먹혀 네이티브 리스너 사용
  useEffect(() => {
    if (!open) return;
    const el = canvasWrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      setZoom((z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z * factor)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        setStrokes((s) => s.slice(0, -1));
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const handlePointerDown = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
      const stage = e.target.getStage();
      if (!stage) return;
      // 스테이지에 표시 배율(scale)이 적용되어 있으므로 논리 좌표계로 역변환된 위치를 사용
      const pos = stage.getRelativePointerPosition();
      if (!pos) return;
      const newStroke: AnnotationStroke = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        tool: tool === 'eraser' ? 'eraser' : 'pen',
        points: [pos.x, pos.y],
        color: tool === 'eraser' ? '#000000' : color,
        strokeWidth: tool === 'eraser' ? strokeWidth * 2 : strokeWidth,
        // 색상별 지시문 모드에서는 모든 펜 stroke가 잠재적 마스크 영역으로 간주됨 (OpenAI 전용 정밀 편집 시 활용)
        isMaskingStroke: tool !== 'eraser',
      };
      setStrokes((s) => [...s, newStroke]);
      setIsDrawing(true);
    },
    [color, strokeWidth, tool]
  );

  const handlePointerMove = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
      if (!isDrawing) return;
      const stage = e.target.getStage();
      if (!stage) return;
      const pos = stage.getRelativePointerPosition();
      if (!pos) return;
      setStrokes((s) => {
        if (s.length === 0) return s;
        const last = s[s.length - 1];
        return [...s.slice(0, -1), { ...last, points: [...last.points, pos.x, pos.y] }];
      });
    },
    [isDrawing]
  );

  const handlePointerUp = useCallback(() => setIsDrawing(false), []);

  const handleSubmit = useCallback(async () => {
    if (!stageRef.current || !maskLayerRef.current || isSubmitting) return;
    if (strokes.length === 0 && !globalInstructions.trim() && Object.values(colorInstructions).every((v) => !v?.trim())) {
      alert('색상 표시 후 해당 색상의 지시문을 입력하거나, 공통 지시문을 입력해주세요.');
      return;
    }
    setIsSubmitting(true);
    try {
      // 스테이지는 viewScale로 축소/확대 표시 중이므로, 역배율 pixelRatio로 논리 해상도(stageSize) 그대로 추출
      const displayWidth = Math.max(1, Math.round(stageSize.width * viewScale));
      const exportRatio = stageSize.width / displayWidth;
      const compositePng = exportNodeToDataUrl(
        stageRef.current as unknown as { toDataURL: Konva.Stage['toDataURL'] },
        { mimeType: 'image/jpeg', quality: 0.85, pixelRatio: exportRatio }
      );
      const rawMask = exportNodeToDataUrl(
        maskLayerRef.current as unknown as { toDataURL: Konva.Layer['toDataURL'] },
        { pixelRatio: exportRatio }
      );
      const maskPng = await normalizeMaskToOpenAI(rawMask);

      // OpenAI 전송용: stage 크기로 다운스케일된 깨끗한 원본
      const baseCanvas = document.createElement('canvas');
      baseCanvas.width = stageSize.width;
      baseCanvas.height = stageSize.height;
      const baseCtx = baseCanvas.getContext('2d');
      let downscaledOriginal: string;
      if (image && baseCtx) {
        baseCtx.fillStyle = '#ffffff';
        baseCtx.fillRect(0, 0, baseCanvas.width, baseCanvas.height);
        baseCtx.drawImage(image, 0, 0, stageSize.width, stageSize.height);
        downscaledOriginal = baseCanvas.toDataURL('image/jpeg', 0.9);
      } else {
        downscaledOriginal = imageBase64.startsWith('data:')
          ? imageBase64
          : `data:image/jpeg;base64,${imageBase64}`;
      }

      // 색상별 stroke의 bounding box 계산 → prompt에 영역 좌표 텍스트로 직렬화 (모델에 합성본을 안 주기 위함)
      const boxes: Record<string, { minX: number; minY: number; maxX: number; maxY: number }> = {};
      for (const s of strokes) {
        if (s.tool === 'eraser') continue;
        const c = s.color.toLowerCase();
        let box = boxes[c];
        for (let i = 0; i < s.points.length; i += 2) {
          const x = s.points[i];
          const y = s.points[i + 1];
          if (!box) {
            box = boxes[c] = { minX: x, minY: y, maxX: x, maxY: y };
          } else {
            if (x < box.minX) box.minX = x;
            if (y < box.minY) box.minY = y;
            if (x > box.maxX) box.maxX = x;
            if (y > box.maxY) box.maxY = y;
          }
        }
      }
      const colorRegions: Record<string, ColorRegion> = {};
      for (const [c, b] of Object.entries(boxes)) {
        colorRegions[c] = {
          x: Math.max(0, Math.min(1, b.minX / stageSize.width)),
          y: Math.max(0, Math.min(1, b.minY / stageSize.height)),
          w: Math.max(0, Math.min(1, (b.maxX - b.minX) / stageSize.width)),
          h: Math.max(0, Math.min(1, (b.maxY - b.minY) / stageSize.height)),
        };
      }

      const result: AnnotationResult = {
        compositePng,
        maskPng,
        textAnnotations: [],
        originalImageRef,
        originalImage: downscaledOriginal,
        colorInstructions,
        usedColors,
        colorRegions,
        globalInstructions: globalInstructions.trim(),
      };
      await onSubmit(result);
      onClose();
    } catch (error) {
      logger.error('❌ 어노테이션 전송 실패:', error);
      alert(`어노테이션 전송 실패: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsSubmitting(false);
    }
  }, [
    colorInstructions,
    globalInstructions,
    image,
    imageBase64,
    isSubmitting,
    onClose,
    onSubmit,
    originalImageRef,
    stageSize,
    strokes.length,
    usedColors,
    viewScale,
  ]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-7xl w-full h-[95vh] flex flex-col overflow-hidden">
        <div className="flex-shrink-0 flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <Pencil size={18} className="text-purple-600" />
            <h3 className="font-semibold text-gray-800">이미지 어노테이션 (색상별 부분 편집)</h3>
            <span className="text-xs text-gray-500">— 색상으로 영역을 표시하고, 각 색상에 대한 지시문을 입력하세요</span>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg" title="닫기 (Esc)">
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 flex min-h-0">
          {/* 좌측 툴바 */}
          <div className="flex-shrink-0 w-44 border-r border-gray-200 p-3 space-y-4 overflow-y-auto bg-gray-50">
            <div>
              <p className="text-xs font-medium text-gray-600 mb-2">도구</p>
              <div className="grid grid-cols-2 gap-1">
                <button
                  onClick={() => setTool('pen')}
                  className={`p-2 rounded-md border ${tool === 'pen' ? 'bg-purple-500 text-white border-purple-500' : 'bg-white border-gray-300'}`}
                  title="펜"
                >
                  <Pencil size={16} className="mx-auto" />
                </button>
                <button
                  onClick={() => setTool('eraser')}
                  className={`p-2 rounded-md border ${tool === 'eraser' ? 'bg-purple-500 text-white border-purple-500' : 'bg-white border-gray-300'}`}
                  title="지우개"
                >
                  <Eraser size={16} className="mx-auto" />
                </button>
              </div>
            </div>

            <div>
              <p className="text-xs font-medium text-gray-600 mb-2">색상 (선택 후 그리기)</p>
              <div className="space-y-1">
                {ANNOTATION_COLORS.map((c) => {
                  const isUsed = usedColors.includes(c.hex);
                  const isSelected = color === c.hex;
                  return (
                    <button
                      key={c.hex}
                      onClick={() => setColor(c.hex)}
                      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md border-2 text-xs ${
                        isSelected ? 'border-gray-800 bg-white' : 'border-gray-300 bg-white hover:border-gray-500'
                      }`}
                    >
                      <span
                        className="inline-block w-4 h-4 rounded border border-gray-300"
                        style={{ backgroundColor: c.hex }}
                      />
                      <span className="flex-1 text-left text-gray-700">{c.emoji} {c.label}</span>
                      {isUsed && <span className="text-[10px] text-green-600">●</span>}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <p className="text-xs font-medium text-gray-600 mb-2">굵기</p>
              <div className="grid grid-cols-4 gap-1">
                {WIDTHS.map((w) => (
                  <button
                    key={w}
                    onClick={() => setStrokeWidth(w)}
                    className={`h-7 flex items-center justify-center rounded-md border ${strokeWidth === w ? 'bg-purple-500 text-white border-purple-500' : 'bg-white border-gray-300 text-gray-700'}`}
                  >
                    <span style={{ display: 'inline-block', width: w, height: w, borderRadius: '50%', backgroundColor: 'currentColor' }} />
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={() => setStrokes((s) => s.slice(0, -1))}
              disabled={strokes.length === 0}
              className="w-full flex items-center justify-center gap-1 px-2 py-2 bg-white border border-gray-300 rounded-md text-sm hover:bg-gray-100 disabled:opacity-40"
            >
              <Undo2 size={14} /> 되돌리기
            </button>
            <button
              onClick={() => setStrokes([])}
              disabled={strokes.length === 0}
              className="w-full px-2 py-2 bg-white border border-gray-300 rounded-md text-sm hover:bg-gray-100 disabled:opacity-40"
            >
              모두 지우기
            </button>
          </div>

          {/* 캔버스 + 우측 색상별 지시문 */}
          <div className="flex-1 flex min-w-0">
            <div className="flex-1 relative min-w-0 bg-gray-100">
              {/* 줌 컨트롤 (캔버스 위 오버레이) */}
              <div className="absolute top-2 right-2 z-10 flex items-center gap-1 bg-white/95 border border-gray-300 rounded-lg shadow-sm px-1.5 py-1">
                <button
                  onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z / 1.25))}
                  className="p-1 rounded hover:bg-gray-100 text-gray-700"
                  title="축소 (Ctrl+휠 아래)"
                >
                  <ZoomOut size={15} />
                </button>
                <span className="text-[11px] text-gray-600 w-11 text-center tabular-nums">
                  {Math.round(viewScale * 100)}%
                </span>
                <button
                  onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z * 1.25))}
                  className="p-1 rounded hover:bg-gray-100 text-gray-700"
                  title="확대 (Ctrl+휠 위)"
                >
                  <ZoomIn size={15} />
                </button>
                <button
                  onClick={() => setZoom(1)}
                  className="p-1 rounded hover:bg-gray-100 text-gray-700"
                  title="화면 맞춤"
                >
                  <Maximize size={15} />
                </button>
              </div>
              {/* 이미지 전체가 항상 보이도록 fit 배율로 표시. 확대 시에는 스크롤로 이동.
                  (주의: flex 중앙정렬 + overflow 조합은 넘친 위/왼쪽이 잘려 스크롤 불가 → 자식 m-auto 방식 사용) */}
              <div ref={canvasWrapRef} className="absolute inset-0 overflow-auto flex">
                {image && (
                  <div className="m-auto p-4">
                    <Stage
                      ref={stageRef}
                      width={Math.max(1, Math.round(stageSize.width * viewScale))}
                      height={Math.max(1, Math.round(stageSize.height * viewScale))}
                      scaleX={viewScale}
                      scaleY={viewScale}
                      onMouseDown={handlePointerDown}
                      onMouseMove={handlePointerMove}
                      onMouseUp={handlePointerUp}
                      onMouseLeave={handlePointerUp}
                      onTouchStart={handlePointerDown}
                      onTouchMove={handlePointerMove}
                      onTouchEnd={handlePointerUp}
                      style={{ cursor: tool === 'eraser' ? 'cell' : 'crosshair', backgroundColor: '#fff' }}
                    >
                      <Layer listening={false}>
                        <KonvaImage image={image} width={stageSize.width} height={stageSize.height} />
                      </Layer>
                      <Layer ref={paintLayerRef}>
                        {strokes.map((s) => (
                          <Line
                            key={s.id}
                            points={s.points}
                            stroke={s.color}
                            strokeWidth={s.strokeWidth}
                            lineCap="round"
                            lineJoin="round"
                            tension={0.3}
                            globalCompositeOperation={s.tool === 'eraser' ? 'destination-out' : 'source-over'}
                          />
                        ))}
                      </Layer>
                      {/* 마스크 추출용 (OpenAI 정밀 편집 시 활용) */}
                      <Layer ref={maskLayerRef} opacity={0.0001}>
                        {strokes
                          .filter((s) => s.isMaskingStroke)
                          .map((s) => (
                            <Line
                              key={`mask-${s.id}`}
                              points={s.points}
                              stroke="#ffffff"
                              strokeWidth={s.strokeWidth}
                              lineCap="round"
                              lineJoin="round"
                              tension={0.3}
                            />
                          ))}
                      </Layer>
                    </Stage>
                  </div>
                )}
              </div>
            </div>

            <div className="flex-shrink-0 w-72 border-l border-gray-200 p-3 overflow-y-auto bg-white">
              <h4 className="text-xs font-semibold text-gray-700 mb-2">색상별 지시문</h4>
              <p className="text-[11px] text-gray-500 mb-3">
                캔버스에 사용한 색상에만 지시문을 입력하세요. 색상이 없는 영역은 원본을 유지합니다.
              </p>
              <div className="space-y-3">
                {ANNOTATION_COLORS.map((c) => {
                  const isUsed = usedColors.includes(c.hex);
                  const meta = getColorLabel(c.hex);
                  return (
                    <div
                      key={c.hex}
                      className={`p-2 rounded-md border ${isUsed ? 'border-gray-300 bg-white' : 'border-gray-200 bg-gray-50 opacity-60'}`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span
                          className="inline-block w-4 h-4 rounded border border-gray-300"
                          style={{ backgroundColor: c.hex }}
                        />
                        <span className="text-xs font-medium text-gray-700">
                          {meta.emoji} {meta.label} 표시 영역 {!isUsed && <span className="text-[10px] text-gray-400">(미사용)</span>}
                        </span>
                      </div>
                      <textarea
                        disabled={!isUsed}
                        value={colorInstructions[c.hex] ?? ''}
                        onChange={(e) =>
                          setColorInstructions((prev) => ({ ...prev, [c.hex]: e.target.value }))
                        }
                        placeholder={isUsed ? '예: 표정을 미소로 바꿔줘' : '색상을 사용하면 활성화됩니다'}
                        rows={2}
                        className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-purple-400 resize-none disabled:bg-gray-50 disabled:text-gray-400"
                      />
                    </div>
                  );
                })}
                <div className="pt-2 border-t border-gray-200">
                  <p className="text-xs font-medium text-gray-700 mb-1">공통 지시문 (선택)</p>
                  <textarea
                    value={globalInstructions}
                    onChange={(e) => setGlobalInstructions(e.target.value)}
                    placeholder="모든 색상에 공통으로 적용할 지시 (예: 전체적으로 따뜻한 색감으로)"
                    rows={2}
                    className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-purple-400 resize-none"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex-shrink-0 border-t border-gray-200 p-3 bg-gray-50 flex items-center justify-between gap-3">
          <p className="text-[11px] text-gray-500">
            💡 단축키: Esc(닫기) · Ctrl+Z(되돌리기) · 사용한 색상 옆 ●는 지시문 입력 가능 표시
          </p>
          <button
            onClick={handleSubmit}
            disabled={isSubmitting || !image}
            className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white rounded-lg font-medium text-sm"
          >
            <Send size={14} />
            {isSubmitting ? '전송 중...' : 'AI에게 전송'}
          </button>
        </div>
      </div>
    </div>
  );
}
