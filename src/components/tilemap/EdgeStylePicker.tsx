import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import {
  TilemapEdgeStyle,
  TilemapOutline,
  TilemapOutlineSide,
  TILEMAP_OUTLINE_THICKNESS_RANGE,
  outlineOpacity,
} from '../../types/tilemap';
import { TILEMAP_EDGE_STYLES, getEdgeStyle } from '../../lib/tilemap/edgeStyles';
import { NEIGHBOR, resolveMaskOptions, warpedTerrainSDFResolved } from '../../lib/tilemap/edgeProfile';
import {
  OutlineSample,
  resolveOutlineBands,
  sampleOutline,
} from '../../lib/tilemap/ruleTileComposer';

interface EdgeStylePickerProps {
  value: TilemapEdgeStyle;
  outline: TilemapOutline;
  outline2: TilemapOutline;
  outlineSide: TilemapOutlineSide;
  onChange: (value: TilemapEdgeStyle) => void;
  onOutlineChange: (value: TilemapOutline) => void;
  onOutline2Change: (value: TilemapOutline) => void;
  onOutlineSideChange: (value: TilemapOutlineSide) => void;
}

/** 썸네일 한 변 (px). 셀 128px 기준 비율을 유지하려면 실제 타일 크기와 같게 두는 게 정확하다 */
const THUMB_SIZE = 64;

/**
 * 썸네일에 쓸 signature.
 * 남/동/남동이 오버레이 = 오버레이 영역의 북서 볼록 코너 → 곡선과 맞물림이 한눈에 보인다.
 */
const THUMB_SIGNATURE = NEIGHBOR.S | NEIGHBOR.E | NEIGHBOR.SE;

/** 썸네일용 대표색 (실제 재질이 아니라 모양 확인용) */
const THUMB_BASE: [number, number, number] = [92, 138, 78];
const THUMB_OVERLAY: [number, number, number] = [206, 172, 116];

/**
 * 경계선 모양 썸네일.
 *
 * **합성기와 같은 `warpedTerrainSDF`로 그린다** — 썸네일이 실제 결과와 어긋나면
 * 프리셋을 눈으로 고르는 의미가 없어지므로, 색만 대표색으로 바꾸고 기하는 동일하게 쓴다.
 */
const StyleThumb = memo(function StyleThumb({
  style,
  outline,
  outline2,
  outlineSide,
  size = THUMB_SIZE,
}: {
  style: TilemapEdgeStyle;
  outline: TilemapOutline;
  outline2: TilemapOutline;
  outlineSide: TilemapOutlineSide;
  size?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const mask = resolveMaskOptions(size, getEdgeStyle(style).mask);
    // 아웃라인 해석·샘플링 모두 합성기의 함수를 그대로 쓴다 — 썸네일이 실제 결과와 어긋나면 안 된다
    const bands = resolveOutlineBands(size, [outline, outline2], outlineSide);
    const sample: OutlineSample = { a: 0, r: 0, g: 0, b: 0 };

    const img = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        const d = warpedTerrainSDFResolved(THUMB_SIGNATURE, x + 0.5, y + 0.5, size, mask);
        const w = Math.max(0, Math.min(1, d + 0.5));
        let r = THUMB_BASE[0] * (1 - w) + THUMB_OVERLAY[0] * w;
        let g = THUMB_BASE[1] * (1 - w) + THUMB_OVERLAY[1] * w;
        let b = THUMB_BASE[2] * (1 - w) + THUMB_OVERLAY[2] * w;
        sampleOutline(bands, d, sample);
        if (sample.a > 0) {
          const keep = 1 - sample.a;
          r = sample.r + r * keep;
          g = sample.g + g * keep;
          b = sample.b + b * keep;
        }
        img.data[i] = r;
        img.data[i + 1] = g;
        img.data[i + 2] = b;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [style, outline, outline2, outlineSide, size]);

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      className="rounded border border-gray-300"
      style={{ width: size, height: size, imageRendering: 'pixelated' }}
    />
  );
});


/** 아웃라인 한 벌(두께·색·투명도) 편집 행 */
const OutlineFields = memo(function OutlineFields({
  outline,
  onChange,
}: {
  outline: TilemapOutline;
  onChange: (value: TilemapOutline) => void;
}) {
  const { min, max } = TILEMAP_OUTLINE_THICKNESS_RANGE;
  const opacityPct = Math.round(outlineOpacity(outline) * 100);
  return (
    <div className="space-y-2 pl-6">
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-gray-600 w-12 shrink-0">폭</span>
        <input
          type="range"
          min={min}
          max={max}
          step={1}
          value={outline.thicknessPx}
          onChange={(e) => onChange({ ...outline, thicknessPx: Number(e.target.value) })}
          className="flex-1 accent-purple-600"
        />
        <span className="text-[11px] font-mono text-gray-700 w-10 text-right shrink-0">
          {outline.thicknessPx}px
        </span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-gray-600 w-12 shrink-0">색</span>
        <input
          type="color"
          value={outline.color}
          onChange={(e) => onChange({ ...outline, color: e.target.value })}
          className="h-7 w-12 rounded border border-gray-300 bg-white cursor-pointer"
        />
        <span className="text-[11px] font-mono text-gray-600">{outline.color.toUpperCase()}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-gray-600 w-12 shrink-0">투명도</span>
        <input
          type="range"
          min={5}
          max={100}
          step={5}
          value={opacityPct}
          onChange={(e) => onChange({ ...outline, opacity: Number(e.target.value) / 100 })}
          className="flex-1 accent-purple-600"
        />
        <span className="text-[11px] font-mono text-gray-700 w-10 text-right shrink-0">
          {opacityPct}%
        </span>
      </div>
    </div>
  );
});

/**
 * 경계선 모양 프리셋 선택 드롭다운 + 아웃라인 설정.
 *
 * 프리셋을 텍스트가 아니라 **썸네일로** 고르게 한다 — 경계 모양은 말로 구분하기 어렵고,
 * 매 생성마다 바뀌는 선택이라 눈으로 비교하는 편이 실용적이다.
 */
function EdgeStylePickerComponent({
  value,
  outline,
  outline2,
  outlineSide,
  onChange,
  onOutlineChange,
  onOutline2Change,
  onOutlineSideChange,
}: EdgeStylePickerProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = useMemo(() => getEdgeStyle(value), [value]);

  // 바깥 클릭으로 닫기
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="mt-3 space-y-3">
      {/* 경계선 모양 */}
      <div ref={rootRef} className="relative">
        <label className="block text-xs font-semibold text-gray-600 mb-1.5">경계선 모양</label>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="w-full flex items-center gap-2.5 p-2 border border-gray-300 rounded-lg bg-white hover:bg-gray-50 transition-colors text-left"
        >
          <StyleThumb style={value} outline={outline} outline2={outline2} outlineSide={outlineSide} size={40} />
          <span className="flex-1 min-w-0">
            <span className="block text-sm font-medium text-gray-800 truncate">{selected.label}</span>
            <span className="block text-[11px] text-gray-500 truncate">{selected.hint}</span>
          </span>
          <ChevronDown size={16} className={`shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>

        {open && (
          <div className="absolute z-30 mt-1 w-full p-2 bg-white border border-gray-200 rounded-lg shadow-xl max-h-72 overflow-y-auto">
            <div className="grid grid-cols-2 gap-2">
              {TILEMAP_EDGE_STYLES.map((style) => (
                <button
                  key={style.id}
                  type="button"
                  onClick={() => {
                    onChange(style.id);
                    setOpen(false);
                  }}
                  className={`flex flex-col items-center gap-1 p-2 rounded-md border-2 transition-all ${
                    style.id === value
                      ? 'border-purple-500 bg-purple-50'
                      : 'border-transparent hover:bg-gray-50'
                  }`}
                >
                  <StyleThumb style={style.id} outline={outline} outline2={outline2} outlineSide={outlineSide} size={THUMB_SIZE} />
                  <span className="text-[11px] font-medium text-gray-800 text-center leading-tight">
                    {style.label}
                  </span>
                  <span className="text-[10px] text-gray-500 text-center leading-tight">
                    {style.hint}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 아웃라인 — 경계선에서 한쪽으로만 뻗는 계단식 띠 (감싸지 않는다) */}
      <div className="p-2.5 bg-gray-50 rounded-lg space-y-2">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={outline.enabled}
            onChange={(e) => onOutlineChange({ ...outline, enabled: e.target.checked })}
            className="w-4 h-4 accent-purple-600"
          />
          <span className="text-xs font-semibold text-gray-700">경계 아웃라인</span>
        </label>

        {outline.enabled && (
          <>
            {/* 방향 — 경계선을 중심으로 퍼지지 않고 이쪽으로만 뻗는다 */}
            <div className="pl-6 space-y-1">
              <span className="block text-[11px] text-gray-600">방향</span>
              <div className="grid grid-cols-2 gap-1.5">
                {([
                  { id: 'outer' as const, label: '바깥쪽', hint: '지형 밖으로' },
                  { id: 'inner' as const, label: '안쪽', hint: '지형 안으로' },
                ]).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => onOutlineSideChange(opt.id)}
                    className={`px-2 py-1.5 rounded-md text-[11px] font-medium border-2 transition-all ${
                      outlineSide === opt.id
                        ? 'bg-purple-600 text-white border-purple-700'
                        : 'bg-white text-gray-700 border-gray-200 hover:border-purple-400'
                    }`}
                  >
                    <span className="block font-bold">{opt.label}</span>
                    <span className="block text-[10px] opacity-75">{opt.hint}</span>
                  </button>
                ))}
              </div>
            </div>

            <span className="block pl-6 text-[11px] font-medium text-gray-600">1단계 띠</span>
            <OutlineFields outline={outline} onChange={onOutlineChange} />

            <label className="flex items-center gap-2 cursor-pointer pt-1 border-t border-gray-200">
              <input
                type="checkbox"
                checked={outline2.enabled}
                onChange={(e) => onOutline2Change({ ...outline2, enabled: e.target.checked })}
                className="w-4 h-4 accent-purple-600"
              />
              <span className="text-xs font-semibold text-gray-700">2단계 띠 (이중 아웃라인)</span>
            </label>
            {outline2.enabled && (
              <OutlineFields outline={outline2} onChange={onOutline2Change} />
            )}

            <p className="text-[10px] text-gray-500 leading-relaxed">
              아웃라인은 경계선을 가운데 두지 않고 <span className="font-medium text-gray-600">한쪽으로만</span> 뻗습니다.
              2단계 띠는 1단계가 끝나는 지점에서 이어서 시작하므로, 두 색이 서로를 감싸지 않고
              계단처럼 단계별로 놓입니다. 폭은 셀 128px 기준이며 4x4(셀 256px)에서는 자동으로 2배 환산해,
              유니티에서 PPU 128로 임포트했을 때 같은 두께로 보입니다.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

export const EdgeStylePicker = memo(EdgeStylePickerComponent);
