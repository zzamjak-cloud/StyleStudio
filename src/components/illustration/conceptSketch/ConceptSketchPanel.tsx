import { useEffect, useRef, useState, useCallback } from 'react';
import { Stage, Layer, Line, Group, Rect, Circle, Image as KonvaImage, Text as KonvaText } from 'react-konva';
import Konva from 'konva';
import { Pencil, X, Eraser, Undo2, Send, Sparkles, Loader2 } from 'lucide-react';
import {
  ConceptSketch,
  CompositionAnalysis,
  IllustrationCharacter,
  SketchLabel,
} from '../../../types/illustration';
import { exportNodeToDataUrl } from '../../../lib/utils/annotationExport';
import { analyzeCompositionSketch, formatCompositionForPrompt } from '../../../lib/sketch/analyzeSketch';
import { logger } from '../../../lib/logger';

interface ConceptSketchPanelProps {
  open: boolean;
  geminiApiKey: string;
  characters: IllustrationCharacter[];
  initial?: ConceptSketch;
  onClose: () => void;
  onSave: (sketch: ConceptSketch) => void;
}

const COLORS = ['#1F2937', '#FF3B30', '#0A84FF', '#34C759'];
const WIDTHS = [2, 4, 8];
const STAGE_W = 960;
const STAGE_H = 600;

interface SketchStroke {
  id: string;
  points: number[];
  color: string;
  width: number;
  isErase: boolean;
}

// 라벨 시각 디자인 상수
const LABEL_FONT_SIZE = 16;
const LABEL_PADDING_X = 8;
const LABEL_PADDING_Y = 5;
// 한글/영문 혼합 텍스트의 대략적 폭 계산 (정확 측정은 ref 필요하나 단순화 추정)
function estimateTextWidth(text: string, fontSize: number): number {
  let w = 0;
  for (const ch of text) {
    // 한글/CJK 범위
    if (/[　-鿿가-힯]/.test(ch)) w += fontSize;
    else w += fontSize * 0.55;
  }
  return Math.max(w, fontSize * 1.5);
}

export function ConceptSketchPanel({
  open,
  geminiApiKey,
  characters,
  initial,
  onClose,
  onSave,
}: ConceptSketchPanelProps) {
  const stageRef = useRef<Konva.Stage>(null);
  const sketchLayerRef = useRef<Konva.Layer>(null); // 라벨 제외, 저장용 export 대상
  const [strokes, setStrokes] = useState<SketchStroke[]>([]);
  const [labels, setLabels] = useState<SketchLabel[]>(initial?.labels ?? []);
  const [color, setColor] = useState(COLORS[0]);
  const [width, setWidth] = useState(WIDTHS[1]);
  const [tool, setTool] = useState<'pen' | 'eraser'>('pen');
  const [isDrawing, setIsDrawing] = useState(false);
  const [analysis, setAnalysis] = useState<CompositionAnalysis | undefined>(initial?.analysis);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // 편집 진입 시 기존 스케치 PNG를 캔버스 배경에 복원 (펜 선/도형은 PNG로만 보존되므로 추가 편집은 그 위에 누적)
  const [baseSketchImage, setBaseSketchImage] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!open) return;
    if (initial?.sketchPng) {
      const img = new Image();
      img.onload = () => setBaseSketchImage(img);
      img.onerror = () => logger.warn('이전 구도 스케치 PNG 로드 실패');
      img.src = initial.sketchPng;
    } else {
      setBaseSketchImage(null);
    }
  }, [open, initial?.sketchPng]);

  // 모달 닫힐 때 상태 초기화
  useEffect(() => {
    if (!open) {
      setStrokes([]);
      setBaseSketchImage(null);
    }
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
      // 라벨(Group) 위에서 시작한 클릭은 stroke로 처리하지 않음 — 라벨 드래그/X 클릭 우선
      const target = e.target;
      if (target && target !== target.getStage()) {
        const isOnLabel = target.findAncestor('.sketch-label', true);
        if (isOnLabel) return;
      }
      const stage = e.target.getStage();
      if (!stage) return;
      const pos = stage.getPointerPosition();
      if (!pos) return;
      const newStroke: SketchStroke = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        points: [pos.x, pos.y],
        color: tool === 'eraser' ? '#ffffff' : color,
        width: tool === 'eraser' ? width * 2 : width,
        isErase: tool === 'eraser',
      };
      setStrokes((s) => [...s, newStroke]);
      setIsDrawing(true);
    },
    [color, width, tool]
  );

  const handlePointerMove = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
      if (!isDrawing) return;
      const stage = e.target.getStage();
      if (!stage) return;
      const pos = stage.getPointerPosition();
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

  const addCharacterLabel = useCallback((c: IllustrationCharacter) => {
    // 별도 입력 없이 캐릭터 이름 그대로 라벨 추가. 위치는 캔버스 가운데 + 약간씩 오프셋하여 겹침 방지
    setLabels((ls) => {
      const offset = ls.length * 0.04;
      const newLabel: SketchLabel = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        characterId: c.id,
        text: c.name,
        x: Math.max(0.05, Math.min(0.85, 0.4 + offset)),
        y: Math.max(0.05, Math.min(0.85, 0.45 + offset)),
      };
      return [...ls, newLabel];
    });
  }, []);

  const removeLabel = useCallback((id: string) => {
    setLabels((ls) => ls.filter((l) => l.id !== id));
  }, []);

  const handleAnalyze = useCallback(async () => {
    if (!stageRef.current) return;
    if (!geminiApiKey) {
      alert('Gemini API Key가 필요합니다.');
      return;
    }
    setIsAnalyzing(true);
    try {
      const sketchPng = exportNodeToDataUrl(
        stageRef.current as unknown as { toDataURL: Konva.Stage['toDataURL'] }
      );
      const result = await analyzeCompositionSketch({
        apiKey: geminiApiKey,
        sketchPng,
        labels,
        characters,
      });
      setAnalysis(result);
    } catch (error) {
      logger.error('스케치 분석 실패:', error);
      alert(`분석 실패: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsAnalyzing(false);
    }
  }, [characters, geminiApiKey, labels]);

  const handleSave = useCallback(() => {
    if (!sketchLayerRef.current) return;
    // 라벨을 제외한 sketch 레이어(배경 PNG + 펜 stroke)만 export.
    // 라벨은 데이터(labels)로만 저장되어 재진입 시 별도 객체로 다시 렌더링되므로 드래그/제거 가능.
    const sketchPng = exportNodeToDataUrl(
      sketchLayerRef.current as unknown as { toDataURL: Konva.Layer['toDataURL'] }
    );
    onSave({ sketchPng, labels, analysis });
    onClose();
  }, [analysis, labels, onClose, onSave]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-7xl w-full max-h-[95vh] flex flex-col overflow-hidden">
        <div className="flex-shrink-0 flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <Pencil size={18} className="text-purple-600" />
            <h3 className="font-semibold text-gray-800">구도 스케치</h3>
            <span className="text-xs text-gray-500">— 거친 도형으로 인물 위치를 잡고, 좌측 캐릭터 버튼으로 이름 라벨을 추가하세요 (드래그로 이동, ✕로 제거)</span>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg" title="닫기 (Esc)">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 flex min-h-0">
          {/* 좌측 도구 + 캐릭터 팔레트 */}
          <div className="flex-shrink-0 w-52 border-r border-gray-200 p-3 space-y-4 overflow-y-auto bg-gray-50">
            <div>
              <p className="text-xs font-medium text-gray-600 mb-2">도구</p>
              <div className="grid grid-cols-2 gap-1">
                <button
                  onClick={() => setTool('pen')}
                  className={`p-2 rounded-md border ${tool === 'pen' ? 'bg-purple-500 text-white border-purple-500' : 'bg-white border-gray-300'}`}
                  title="펜"
                >
                  <Pencil size={14} className="mx-auto" />
                </button>
                <button
                  onClick={() => setTool('eraser')}
                  className={`p-2 rounded-md border ${tool === 'eraser' ? 'bg-purple-500 text-white border-purple-500' : 'bg-white border-gray-300'}`}
                  title="지우개"
                >
                  <Eraser size={14} className="mx-auto" />
                </button>
              </div>
            </div>
            <div>
              <p className="text-xs font-medium text-gray-600 mb-2">색상</p>
              <div className="grid grid-cols-4 gap-1">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setColor(c)}
                    className={`h-7 rounded-md border-2 ${color === c ? 'border-gray-800' : 'border-gray-300'}`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs font-medium text-gray-600 mb-2">굵기</p>
              <div className="grid grid-cols-3 gap-1">
                {WIDTHS.map((w) => (
                  <button
                    key={w}
                    onClick={() => setWidth(w)}
                    className={`h-7 flex items-center justify-center rounded-md border ${width === w ? 'bg-purple-500 text-white border-purple-500' : 'bg-white border-gray-300 text-gray-700'}`}
                  >
                    <span style={{ display: 'inline-block', width: w, height: w, borderRadius: '50%', backgroundColor: 'currentColor' }} />
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs font-medium text-gray-600 mb-2">캐릭터 라벨 추가</p>
              <p className="text-[10px] text-gray-500 mb-2">버튼을 누르면 캐릭터 이름이 캔버스에 추가됩니다. 라벨은 드래그로 이동, ✕ 버튼으로 제거할 수 있습니다.</p>
              <div className="space-y-1">
                {characters.length === 0 && <p className="text-xs text-gray-400">등록된 캐릭터 없음</p>}
                {characters.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => addCharacterLabel(c)}
                    className="w-full text-left text-xs px-2 py-1 bg-white border border-gray-300 rounded hover:bg-purple-50 hover:border-purple-300"
                  >
                    + {c.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1">
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
                새 펜 지우기
              </button>
              {baseSketchImage && (
                <button
                  onClick={() => {
                    if (confirm('기존 스케치를 모두 비우고 새로 그릴까요?')) {
                      setBaseSketchImage(null);
                      setStrokes([]);
                    }
                  }}
                  className="w-full px-2 py-2 bg-white border border-amber-300 text-amber-700 rounded-md text-sm hover:bg-amber-50"
                >
                  스케치 새로 그리기
                </button>
              )}
              <button
                onClick={() => setLabels([])}
                disabled={labels.length === 0}
                className="w-full px-2 py-2 bg-white border border-gray-300 rounded-md text-sm hover:bg-gray-100 disabled:opacity-40"
              >
                라벨 지우기
              </button>
            </div>
          </div>

          {/* 캔버스 */}
          <div className="flex-1 flex flex-col bg-gray-100 overflow-hidden">
            <div className="flex-1 flex items-center justify-center p-4 overflow-auto">
              <Stage
                ref={stageRef}
                width={STAGE_W}
                height={STAGE_H}
                onMouseDown={handlePointerDown}
                onMouseMove={handlePointerMove}
                onMouseUp={handlePointerUp}
                onMouseLeave={handlePointerUp}
                onTouchStart={handlePointerDown}
                onTouchMove={handlePointerMove}
                onTouchEnd={handlePointerUp}
                style={{ backgroundColor: '#ffffff', cursor: 'crosshair' }}
              >
                {/* 스케치 레이어 (저장 export 대상): 배경 PNG + 펜 stroke만 포함 */}
                <Layer ref={sketchLayerRef}>
                  {baseSketchImage && (
                    <KonvaImage
                      image={baseSketchImage}
                      width={STAGE_W}
                      height={STAGE_H}
                      listening={false}
                    />
                  )}
                  {strokes.map((s) => (
                    <Line
                      key={s.id}
                      points={s.points}
                      stroke={s.color}
                      strokeWidth={s.width}
                      lineCap="round"
                      lineJoin="round"
                      tension={0.3}
                      globalCompositeOperation={s.isErase ? 'destination-out' : 'source-over'}
                    />
                  ))}
                </Layer>
                {/* 라벨 레이어 (저장 export 제외): 라벨은 labels 데이터로만 저장되어 재진입 시 인터랙션 가능 */}
                <Layer>
                  {labels.map((l) => {
                    const textWidth = estimateTextWidth(l.text, LABEL_FONT_SIZE);
                    const boxW = textWidth + LABEL_PADDING_X * 2;
                    const boxH = LABEL_FONT_SIZE + LABEL_PADDING_Y * 2;
                    const closeR = 9;
                    return (
                      <Group
                        key={l.id}
                        name="sketch-label"
                        x={l.x * STAGE_W}
                        y={l.y * STAGE_H}
                        draggable
                        onDragEnd={(e) => {
                          const node = e.target;
                          // 캔버스 경계 내로 클램프
                          const newX = Math.max(0, Math.min(STAGE_W - boxW, node.x())) / STAGE_W;
                          const newY = Math.max(0, Math.min(STAGE_H - boxH, node.y())) / STAGE_H;
                          setLabels((ls) => ls.map((it) => (it.id === l.id ? { ...it, x: newX, y: newY } : it)));
                        }}
                        onMouseEnter={(e) => {
                          const stage = e.target.getStage();
                          if (stage) stage.container().style.cursor = 'grab';
                        }}
                        onMouseLeave={(e) => {
                          const stage = e.target.getStage();
                          if (stage) stage.container().style.cursor = 'crosshair';
                        }}
                      >
                        <Rect
                          width={boxW}
                          height={boxH}
                          fill="#ffffff"
                          stroke="#7c3aed"
                          strokeWidth={1.5}
                          cornerRadius={4}
                          shadowColor="#000000"
                          shadowBlur={4}
                          shadowOpacity={0.15}
                        />
                        <KonvaText
                          text={l.text}
                          x={LABEL_PADDING_X}
                          y={LABEL_PADDING_Y}
                          fontSize={LABEL_FONT_SIZE}
                          fontStyle="bold"
                          fill="#7c3aed"
                        />
                        {/* X 제거 버튼 (우측 상단) */}
                        <Group
                          x={boxW - closeR}
                          y={-closeR}
                          onClick={(e) => {
                            e.cancelBubble = true;
                            removeLabel(l.id);
                          }}
                          onTap={(e) => {
                            e.cancelBubble = true;
                            removeLabel(l.id);
                          }}
                          onMouseEnter={(e) => {
                            const stage = e.target.getStage();
                            if (stage) stage.container().style.cursor = 'pointer';
                          }}
                          onMouseLeave={(e) => {
                            const stage = e.target.getStage();
                            if (stage) stage.container().style.cursor = 'grab';
                          }}
                        >
                          <Circle
                            radius={closeR}
                            fill="#ef4444"
                            stroke="#ffffff"
                            strokeWidth={1.5}
                          />
                          <KonvaText
                            text="✕"
                            x={-closeR}
                            y={-closeR}
                            width={closeR * 2}
                            height={closeR * 2}
                            align="center"
                            verticalAlign="middle"
                            fill="#ffffff"
                            fontSize={11}
                            fontStyle="bold"
                          />
                        </Group>
                      </Group>
                    );
                  })}
                </Layer>
              </Stage>
            </div>

            {analysis && (
              <div className="flex-shrink-0 border-t border-gray-200 bg-white p-3 max-h-48 overflow-y-auto">
                <p className="text-xs font-semibold text-gray-700 mb-1">📐 분석 결과 (수정 가능)</p>
                <pre className="text-[11px] text-gray-700 whitespace-pre-wrap font-mono">
                  {formatCompositionForPrompt(analysis)}
                </pre>
              </div>
            )}
          </div>
        </div>

        <div className="flex-shrink-0 border-t border-gray-200 p-3 bg-gray-50 flex items-center justify-between gap-3">
          <p className="text-[11px] text-gray-500">
            💡 단축키: Esc(닫기) · Ctrl+Z(되돌리기) · 라벨은 드래그로 이동, 우상단 ✕로 제거
          </p>
          <div className="flex gap-2">
            <button
              onClick={handleAnalyze}
              disabled={isAnalyzing || !geminiApiKey}
              className="flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white rounded-lg font-medium text-sm"
              title={!geminiApiKey ? 'Gemini API Key가 필요합니다' : '스케치를 분석하여 layout/perspective/placements 추출'}
            >
              {isAnalyzing ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              {isAnalyzing ? '분석 중...' : 'AI로 분석'}
            </button>
            <button
              onClick={handleSave}
              disabled={!stageRef.current}
              className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white rounded-lg font-medium text-sm"
            >
              <Send size={14} /> 저장 후 닫기
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
