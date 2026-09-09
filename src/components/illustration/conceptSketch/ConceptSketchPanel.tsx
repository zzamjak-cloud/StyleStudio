import { useEffect, useRef, useState, useCallback, type ReactElement } from 'react';
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
  apiKey: string;
  /**
   * 출력 비율('1:1'·'16:9' 등). 넘기면 캔버스가 **그 비율로** 뜬다 — 그린 프레이밍이 결과
   * 프레이밍과 같아진다. 안 넘기면 기존 960x600.
   */
  aspectRatio?: string;
  /**
   * 라벨 버튼으로 이름을 꽂을 등록 캐릭터. **ILLUSTRATION 세션에서만 채워진다.**
   * 비어 있으면(배경·픽셀아트 등 일반 세션) 캐릭터 버튼 대신 자유 라벨 입력이 뜬다 —
   * 그쪽에서는 표시할 대상이 캐릭터가 아니라 "여기 폭포", "여기 성" 같은 요소이기 때문.
   */
  characters?: IllustrationCharacter[];
  initial?: ConceptSketch;
  onClose: () => void;
  onSave: (sketch: ConceptSketch) => void;
}

const COLORS = ['#1F2937', '#FF3B30', '#0A84FF', '#34C759'];
/** 사이드바 빠른 선택 버튼에 노출할 굵기 */
const WIDTHS = [2, 4, 8];
/**
 * `[` `]` 단축키가 오르내리는 굵기 사다리.
 *
 * 버튼(2·4·8)만으로 오르내리면 3단계라 너무 성기다. 버튼은 자주 쓰는 값으로 두고,
 * 단축키는 이 촘촘한 사다리를 걷는다 — 값이 사다리에 없으면 가장 가까운 칸에서 출발한다.
 */
const WIDTH_STEPS = [1, 2, 3, 4, 6, 8, 12, 16, 24];

/**
 * 필압 → 굵기 배율의 하한.
 *
 * 0으로 두면 약하게 그은 획이 사실상 사라져 스케치가 끊겨 보인다. 하한을 두면
 * 0.25~1.0배(4배 폭)로 변해 손그림 느낌은 나면서 선이 끊기지 않는다.
 */
const PRESSURE_MIN_SCALE = 0.25;
/**
 * 필압을 몇 단계로 양자화할지.
 *
 * Konva `Line`은 획 하나에 **굵기 하나**만 줄 수 있다. 그래서 필압이 있는 획은 여러
 * 개의 `Line`으로 쪼개 그리는데, 점마다 쪼개면 획 하나가 수백 노드가 된다. 단계로
 * 묶으면 보통 획당 몇 개면 끝나고, 6단계면 눈으로는 연속으로 보인다.
 */
const PRESSURE_LEVELS = 6;

/** 필압(0~1) → 굵기 배율 */
function pressureScaleOf(level: number): number {
  return PRESSURE_MIN_SCALE + (1 - PRESSURE_MIN_SCALE) * (level / (PRESSURE_LEVELS - 1));
}

/** 필압(0~1) → 양자화 단계 */
function pressureLevelOf(pressure: number): number {
  const clamped = Math.max(0, Math.min(1, pressure));
  return Math.round(clamped * (PRESSURE_LEVELS - 1));
}
/**
 * 캔버스가 들어갈 최대 상자. 실제 크기는 `aspectRatio`에 맞춰 이 안에 맞춰진다.
 *
 * **스케치 프레임이 실제 출력 비율과 같아야 한다.** 그래야 "대상이 화면에서 얼마나 크게,
 * 어디까지 보이는지"를 그린 대로 얻는다 — 16:10 고정 캔버스에 그려 놓고 1:1로 생성하면
 * 프레이밍 의도가 그대로 깨진다. 비율을 안 넘기면(ILLUSTRATION) 기존 960x600을 그대로 쓴다.
 */
const STAGE_MAX_W = 960;
const STAGE_MAX_H = 620;
const STAGE_DEFAULT_W = 960;
const STAGE_DEFAULT_H = 600;

/** 'W:H' 비율을 최대 상자 안에 맞춘 캔버스 크기로 바꾼다 */
function resolveStageSize(aspectRatio?: string): { w: number; h: number } {
  if (!aspectRatio) return { w: STAGE_DEFAULT_W, h: STAGE_DEFAULT_H };
  const [rw, rh] = aspectRatio.split(':').map(Number);
  if (!Number.isFinite(rw) || !Number.isFinite(rh) || rw <= 0 || rh <= 0) {
    return { w: STAGE_DEFAULT_W, h: STAGE_DEFAULT_H };
  }
  const scale = Math.min(STAGE_MAX_W / rw, STAGE_MAX_H / rh);
  return { w: Math.round(rw * scale), h: Math.round(rh * scale) };
}

interface SketchStroke {
  id: string;
  points: number[];
  color: string;
  width: number;
  isErase: boolean;
  /**
   * 점별 필압(0~1). **타블렛 펜으로 그린 획에만** 채워진다.
   *
   * 마우스는 누르고 있는 동안 `pressure`가 0.5로 고정돼 들어오는데, 그걸 그대로 쓰면
   * 마우스로 그린 선이 이유 없이 절반 굵기가 된다. 그래서 `pointerType === 'pen'`일 때만
   * 기록하고, 없으면 균일 굵기로 그린다.
   */
  pressures?: number[];
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

/**
 * 획 하나를 Konva 노드로 그린다.
 *
 * 필압이 없으면 `Line` 한 개. 있으면 **양자화 단계가 바뀌는 지점에서 잘라** 여러 개의
 * `Line`으로 그린다 — Konva `Line`은 획 하나에 굵기 하나만 줄 수 있기 때문이다.
 * 인접한 조각은 **경계 점을 공유**하므로(`end + 1`까지 포함) 사이가 벌어지지 않고,
 * `lineCap="round"`가 이음매를 덮는다.
 */
function renderStroke(s: SketchStroke) {
  const common = {
    stroke: s.color,
    lineCap: 'round' as const,
    lineJoin: 'round' as const,
    tension: 0.3,
    globalCompositeOperation: (s.isErase ? 'destination-out' : 'source-over') as GlobalCompositeOperation,
  };
  const pointCount = s.points.length / 2;
  if (!s.pressures || s.pressures.length !== pointCount || pointCount < 2) {
    return [<Line key={s.id} points={s.points} strokeWidth={s.width} {...common} />];
  }

  const nodes: ReactElement[] = [];
  let runStart = 0;
  let runLevel = pressureLevelOf((s.pressures[0] + s.pressures[1]) / 2);
  const flush = (end: number) => {
    // end 다음 점까지 포함해야 다음 조각과 맞닿는다
    const slice = s.points.slice(runStart * 2, (end + 2) * 2);
    if (slice.length >= 4) {
      nodes.push(
        <Line
          key={`${s.id}-${runStart}`}
          points={slice}
          strokeWidth={s.width * pressureScaleOf(runLevel)}
          {...common}
        />
      );
    }
  };
  for (let i = 1; i < pointCount - 1; i++) {
    const level = pressureLevelOf((s.pressures[i] + s.pressures[i + 1]) / 2);
    if (level !== runLevel) {
      flush(i - 1);
      runStart = i;
      runLevel = level;
    }
  }
  flush(pointCount - 2);
  return nodes;
}

export function ConceptSketchPanel({
  open,
  apiKey,
  aspectRatio,
  characters = [],
  initial,
  onClose,
  onSave,
}: ConceptSketchPanelProps) {
  const { w: STAGE_W, h: STAGE_H } = resolveStageSize(aspectRatio);
  const stageRef = useRef<Konva.Stage>(null);
  const sketchLayerRef = useRef<Konva.Layer>(null); // 라벨 제외, 저장용 export 대상
  const [strokes, setStrokes] = useState<SketchStroke[]>([]);
  const [labels, setLabels] = useState<SketchLabel[]>(initial?.labels ?? []);
  const [color, setColor] = useState(COLORS[0]);
  const [width, setWidth] = useState(WIDTHS[1]);
  const [tool, setTool] = useState<'pen' | 'eraser'>('pen');
  const [isDrawing, setIsDrawing] = useState(false);
  const [analysis, setAnalysis] = useState<CompositionAnalysis | undefined>(initial?.analysis);
  const [freeLabelText, setFreeLabelText] = useState('');
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
      setFreeLabelText('');
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        setStrokes((s) => s.slice(0, -1));
        return;
      }

      /*
        도구 단축키. 아래 두 가지를 지켜야 오작동하지 않는다:

        1. **입력란에 타이핑 중이면 무시한다.** 라벨 입력에 "b"를 치는 순간 브러시로
           바뀌면 안 된다.
        2. **`e.key`가 아니라 `e.code`로 판정한다.** 이 앱은 한글 사용자를 전제로 하는데,
           한글 입력 상태에서 B를 누르면 `e.key`는 'ㅠ'로 온다. `e.code`는 자판 배열과
           무관하게 'KeyB'라 IME가 켜져 있어도 그대로 동작한다.
      */
      if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;

      if (e.code === 'KeyB') {
        e.preventDefault();
        setTool('pen');
      } else if (e.code === 'KeyE') {
        e.preventDefault();
        setTool('eraser');
      } else if (e.code === 'BracketLeft' || e.code === 'BracketRight') {
        e.preventDefault();
        const delta = e.code === 'BracketRight' ? 1 : -1;
        setWidth((w) => {
          // 현재 값이 사다리에 없을 수도 있으므로(버튼 값과 사다리가 다를 수 있다)
          // 가장 가까운 칸을 찾아 거기서 이동한다
          let nearest = 0;
          for (let i = 1; i < WIDTH_STEPS.length; i += 1) {
            if (Math.abs(WIDTH_STEPS[i] - w) < Math.abs(WIDTH_STEPS[nearest] - w)) nearest = i;
          }
          const next = Math.max(0, Math.min(WIDTH_STEPS.length - 1, nearest + delta));
          return WIDTH_STEPS[next];
        });
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  /**
   * 네이티브 포인터 이벤트에서 필압을 뽑는다. 펜이 아니면 `undefined`.
   *
   * 마우스는 버튼을 누른 동안 `pressure`가 0.5로 고정이고 터치는 기기마다 제각각이라,
   * `pointerType === 'pen'`인 경우에만 신뢰한다. 펜인데 0으로 오는 경우(일부 드라이버)는
   * 최소값으로 올려 선이 사라지지 않게 한다.
   */
  const readPressure = (evt: unknown): number | undefined => {
    const pe = evt as PointerEvent | undefined;
    if (!pe || pe.pointerType !== 'pen') return undefined;
    return typeof pe.pressure === 'number' && pe.pressure > 0 ? pe.pressure : 0.05;
  };

  const handlePointerDown = useCallback(
    (e: Konva.KonvaEventObject<PointerEvent>) => {
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
      // 지우개는 필압을 쓰지 않는다 — 지워지는 폭이 손 힘에 따라 변하면 예측이 안 된다
      const pressure = tool === 'eraser' ? undefined : readPressure(e.evt);
      const newStroke: SketchStroke = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        points: [pos.x, pos.y],
        color: tool === 'eraser' ? '#ffffff' : color,
        width: tool === 'eraser' ? width * 2 : width,
        isErase: tool === 'eraser',
        ...(pressure === undefined ? {} : { pressures: [pressure] }),
      };
      setStrokes((s) => [...s, newStroke]);
      setIsDrawing(true);
    },
    [color, width, tool]
  );

  const handlePointerMove = useCallback(
    (e: Konva.KonvaEventObject<PointerEvent>) => {
      if (!isDrawing) return;
      const stage = e.target.getStage();
      if (!stage) return;
      const pos = stage.getPointerPosition();
      if (!pos) return;
      const pressure = readPressure(e.evt);
      setStrokes((s) => {
        if (s.length === 0) return s;
        const last = s[s.length - 1];
        return [
          ...s.slice(0, -1),
          {
            ...last,
            points: [...last.points, pos.x, pos.y],
            // 획을 시작할 때 필압이 있었으면 계속 채운다 (중간에 배열 길이가 어긋나면 안 된다)
            ...(last.pressures
              ? { pressures: [...last.pressures, pressure ?? last.pressures[last.pressures.length - 1]] }
              : {}),
          },
        ];
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

  /** 캐릭터가 없는 세션용 — 임의 텍스트 라벨. `characterId` 없이 텍스트만 갖는다 */
  const addFreeLabel = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setLabels((ls) => {
      const offset = ls.length * 0.04;
      return [
        ...ls,
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          text: trimmed,
          x: Math.max(0.05, Math.min(0.85, 0.4 + offset)),
          y: Math.max(0.05, Math.min(0.85, 0.45 + offset)),
        },
      ];
    });
    setFreeLabelText('');
  }, []);

  const removeLabel = useCallback((id: string) => {
    setLabels((ls) => ls.filter((l) => l.id !== id));
  }, []);

  const handleAnalyze = useCallback(async () => {
    if (!stageRef.current) return;
    if (!apiKey) {
      alert('Gemini API Key가 필요합니다.');
      return;
    }
    setIsAnalyzing(true);
    try {
      const sketchPng = exportNodeToDataUrl(
        stageRef.current as unknown as { toDataURL: Konva.Stage['toDataURL'] }
      );
      const result = await analyzeCompositionSketch({
        apiKey: apiKey,
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
  }, [characters, apiKey, labels]);

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
            <span className="text-xs text-gray-500">
              {characters.length > 0
                ? '— 거친 도형으로 인물 위치를 잡고, 좌측 캐릭터 버튼으로 이름 라벨을 추가하세요 (드래그로 이동, ✕로 제거)'
                : '— 거친 도형으로 화면 구도를 잡고, 좌측에서 요소 라벨을 추가하세요 (드래그로 이동, ✕로 제거)'}
            </span>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg" title="닫기 (Esc)">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 flex min-h-0">
          {/* 좌측 도구 + 캐릭터 팔레트 */}
          <div className="flex-shrink-0 w-52 border-r border-gray-200 p-3 space-y-4 overflow-y-auto bg-gray-50">
            <div>
              <p className="text-xs font-medium text-gray-600 mb-2">도구 <span className="text-gray-400 font-normal">B / E</span></p>
              <div className="grid grid-cols-2 gap-1">
                <button
                  onClick={() => setTool('pen')}
                  className={`p-2 rounded-md border ${tool === 'pen' ? 'bg-purple-500 text-white border-purple-500' : 'bg-white border-gray-300'}`}
                  title="펜 (B)"
                >
                  <Pencil size={14} className="mx-auto" />
                </button>
                <button
                  onClick={() => setTool('eraser')}
                  className={`p-2 rounded-md border ${tool === 'eraser' ? 'bg-purple-500 text-white border-purple-500' : 'bg-white border-gray-300'}`}
                  title="지우개 (E)"
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
              {/* `[` `]` 로 버튼에 없는 값도 고를 수 있으므로 현재 굵기를 숫자로 보여준다 */}
              <p className="text-xs font-medium text-gray-600 mb-2">
                굵기 <span className="text-gray-400 font-normal">{width}px · [ ]</span>
              </p>
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
              <p className="text-[10px] text-gray-500 mt-1.5">
                타블렛 펜은 필압에 따라 굵기가 변합니다(설정한 굵기의 {Math.round(PRESSURE_MIN_SCALE * 100)}~100%).
              </p>
            </div>

            <div>
              <p className="text-xs font-medium text-gray-600 mb-2">
                {characters.length > 0 ? '캐릭터 라벨 추가' : '요소 라벨 추가'}
              </p>
              <p className="text-[10px] text-gray-500 mb-2">
                {characters.length > 0
                  ? '버튼을 누르면 캐릭터 이름이 캔버스에 추가됩니다. 라벨은 드래그로 이동, ✕ 버튼으로 제거할 수 있습니다.'
                  : '"폭포", "성문"처럼 무엇을 그릴지 적어 캔버스에 꽂으세요. 드래그로 이동, ✕로 제거합니다.'}
              </p>
              {characters.length > 0 ? (
                <div className="space-y-1">
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
              ) : (
                <div className="flex gap-1">
                  <input
                    value={freeLabelText}
                    onChange={(e) => setFreeLabelText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addFreeLabel(freeLabelText);
                      }
                    }}
                    placeholder="예: 폭포"
                    className="flex-1 min-w-0 px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-purple-400"
                  />
                  <button
                    onClick={() => addFreeLabel(freeLabelText)}
                    disabled={!freeLabelText.trim()}
                    className="px-2 py-1 text-xs bg-white border border-gray-300 rounded hover:bg-purple-50 hover:border-purple-300 disabled:opacity-40"
                  >
                    +
                  </button>
                </div>
              )}
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
                /* 마우스·터치 이벤트를 각각 걸지 않고 포인터 이벤트 하나로 받는다 —
                   마우스/터치/펜을 모두 커버하면서 **필압(evt.pressure)** 까지 함께 온다.
                   둘 다 걸면 마우스에서 핸들러가 두 번 돈다 */
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerLeave={handlePointerUp}
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
                  {strokes.flatMap((s) => renderStroke(s))}
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
            💡 단축키: B(펜) · E(지우개) · [ ](굵기) · Ctrl+Z(되돌리기) · Esc(닫기) · 라벨은 드래그로 이동, 우상단 ✕로 제거
          </p>
          <div className="flex gap-2">
            <button
              onClick={handleAnalyze}
              disabled={isAnalyzing || !apiKey}
              className="flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white rounded-lg font-medium text-sm"
              title={!apiKey ? 'OpenRouter API Key가 필요합니다' : '스케치를 분석하여 layout/perspective/placements 추출'}
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
