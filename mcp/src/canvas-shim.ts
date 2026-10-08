/**
 * MCP 전용 순수 JS canvas shim — 앱 타일맵 합성기(`src/lib/tilemap/*`)를 Node 에서 그대로 돌리기 위한 것.
 *
 * 앱 합성기는 브라우저 canvas 2D 를 쓴다. 합성 알고리즘을 MCP 에 복제하면 한쪽만 고쳤을 때 결과가
 * 조용히 어긋나므로, 대신 **타일맵 경로가 실제로 쓰는 API 부분집합만** 구현해 `document`·`Image` 로
 * 제공한다. 네이티브 모듈(@napi-rs/canvas 등)은 단일 JS 번들 배포를 깨므로 쓰지 않는다.
 *
 * 구현 범위 (앱 코드를 grep 으로 전수 확인한 것):
 * - `document.createElement('canvas' | 'img')`, `new Image()`(src = data URL, onload/onerror), `new ImageData()`
 * - canvas: width/height(설정 시 초기화), `getContext('2d')`, `toDataURL('image/png' | 'image/jpeg', q)`
 * - 2d: drawImage(3·5·9 인자), getImageData, putImageData, createImageData, createLinearGradient(+addColorStop),
 *   fillRect, clearRect, fillStyle, globalAlpha, globalCompositeOperation(source-over·destination-in·
 *   destination-out·source-in·copy), imageSmoothingEnabled/Quality, save/restore
 *
 * Chrome 과의 차이 (게이트 허용 오차 안):
 * - 픽셀은 스트레이트 알파 8비트로 들고 있다. Chrome 은 프리멀티플라이드 8비트라 반투명 픽셀의 색이 ±1 다를 수 있다.
 * - 그라디언트 알파는 8비트로 양자화하되 디더링은 하지 않는다.
 * - 스무딩 확대는 쌍선형, 2배 넘는 축소는 박스 평균이다(Chrome 'high' 는 밉맵·큐빅). 타일맵 경로의
 *   drawImage 는 전부 1:1 이라 이 차이는 모델이 규격 미만 이미지를 준 폴백에서만 나타난다.
 * - 변환 행렬·경로·텍스트는 없다 (타일맵 경로가 쓰지 않는다).
 */

import { decodeImage, encodeJpegOnWhite, encodePng, type RgbaImage } from './imageio';

/** drawImage 소스가 픽셀을 내주는 내부 키 */
const PIXELS = Symbol('ss-canvas-pixels');

interface PixelSource {
  [PIXELS](): RgbaImage | null;
}

/** 색 (0~255 정수 RGB, 0~1 알파) */
type Color = [number, number, number, number];

const NAMED_COLORS: Record<string, Color> = {
  transparent: [0, 0, 0, 0],
  black: [0, 0, 0, 1],
  white: [255, 255, 255, 1],
  red: [255, 0, 0, 1],
  green: [0, 128, 0, 1],
  blue: [0, 0, 255, 1],
};

/** CSS 색 문자열 → Color. 해석 못 하면 null (Chrome 처럼 대입을 무시한다) */
export function parseCssColor(input: string): Color | null {
  const s = input.trim().toLowerCase();
  if (NAMED_COLORS[s]) return [...NAMED_COLORS[s]] as Color;
  const hex = /^#([0-9a-f]{3,8})$/.exec(s);
  if (hex) {
    const h = hex[1];
    if (h.length === 3 || h.length === 4) {
      const v = [...h].map((c) => parseInt(c + c, 16));
      return [v[0], v[1], v[2], h.length === 4 ? v[3] / 255 : 1];
    }
    if (h.length === 6 || h.length === 8) {
      const v = [0, 2, 4, 6].map((o) => parseInt(h.slice(o, o + 2), 16));
      return [v[0], v[1], v[2], h.length === 8 ? v[3] / 255 : 1];
    }
    return null;
  }
  const fn = /^rgba?\(([^)]*)\)$/.exec(s);
  if (fn) {
    const parts = fn[1].split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const channel = (p: string) => (p.endsWith('%') ? (parseFloat(p) / 100) * 255 : parseFloat(p));
    const rgb = parts.slice(0, 3).map((p) => Math.round(Math.max(0, Math.min(255, channel(p)))));
    const a = parts[3] === undefined ? 1 : parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
    if (rgb.some(Number.isNaN) || Number.isNaN(a)) return null;
    return [rgb[0], rgb[1], rgb[2], Math.max(0, Math.min(1, a))];
  }
  return null;
}

// ───────────────────────── ImageData ─────────────────────────

export class ShimImageData {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
  readonly colorSpace = 'srgb';

  constructor(dataOrWidth: Uint8ClampedArray | number, widthOrHeight: number, height?: number) {
    if (typeof dataOrWidth === 'number') {
      this.width = dataOrWidth;
      this.height = widthOrHeight;
      this.data = new Uint8ClampedArray(this.width * this.height * 4);
    } else {
      this.data = dataOrWidth;
      this.width = widthOrHeight;
      this.height = height ?? dataOrWidth.length / 4 / widthOrHeight;
    }
  }
}

// ───────────────────────── 그라디언트 ─────────────────────────

export class ShimLinearGradient {
  private stops: { offset: number; color: Color }[] = [];

  constructor(
    readonly x0: number,
    readonly y0: number,
    readonly x1: number,
    readonly y1: number
  ) {}

  addColorStop(offset: number, color: string): void {
    if (!(offset >= 0 && offset <= 1)) throw new RangeError(`addColorStop: offset 범위 밖 (${offset})`);
    const parsed = parseCssColor(color);
    if (!parsed) throw new SyntaxError(`addColorStop: 해석할 수 없는 색 (${color})`);
    // 같은 offset 은 추가 순서를 지킨다 (안정 정렬)
    this.stops.push({ offset, color: parsed });
    this.stops.sort((a, b) => a.offset - b.offset);
  }

  /** 점 (px,py) 의 색. 축이 0 길이면 null (스펙상 아무것도 칠하지 않는다) */
  colorAt(px: number, py: number): Color | null {
    const dx = this.x1 - this.x0;
    const dy = this.y1 - this.y0;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0 || this.stops.length === 0) return null;
    const t = ((px - this.x0) * dx + (py - this.y0) * dy) / len2;
    const stops = this.stops;
    if (t <= stops[0].offset) return stops[0].color;
    const last = stops[stops.length - 1];
    if (t >= last.offset) return last.color;
    let k = 1;
    while (stops[k].offset < t) k++;
    const a = stops[k - 1];
    const b = stops[k];
    const span = b.offset - a.offset;
    const f = span > 0 ? (t - a.offset) / span : 1;
    // 스트레이트 알파 보간 (Skia 캔버스 그라디언트 기본값)
    return [
      a.color[0] + (b.color[0] - a.color[0]) * f,
      a.color[1] + (b.color[1] - a.color[1]) * f,
      a.color[2] + (b.color[2] - a.color[2]) * f,
      a.color[3] + (b.color[3] - a.color[3]) * f,
    ];
  }
}

// ───────────────────────── 합성 ─────────────────────────

type CompositeOp = 'source-over' | 'destination-in' | 'destination-out' | 'source-in' | 'copy';
const SUPPORTED_OPS = new Set<string>(['source-over', 'destination-in', 'destination-out', 'source-in', 'copy']);
/** 그린 영역 밖의 대상 픽셀도 바꾸는(소스 알파 0 으로 보는) 연산 — Chrome 의 unbounded 합성 */
const UNBOUNDED_OPS = new Set<string>(['destination-in', 'source-in', 'copy']);

/**
 * 대상 픽셀 1개에 소스 (스트레이트 RGB 0~255, 알파 0~1) 를 합성한다.
 * 내부 계산은 프리멀티플라이드, 저장은 스트레이트 8비트.
 */
function blend(d: Uint8ClampedArray, i: number, sr: number, sg: number, sb: number, sa: number, op: CompositeOp): void {
  const da = d[i + 3] / 255;
  let oa: number;
  let or: number;
  let og: number;
  let ob: number;
  switch (op) {
    case 'source-over': {
      if (sa <= 0) return;
      if (sa >= 1) {
        d[i] = sr;
        d[i + 1] = sg;
        d[i + 2] = sb;
        d[i + 3] = 255;
        return;
      }
      const keep = da * (1 - sa);
      oa = sa + keep;
      or = sr * sa + d[i] * keep;
      og = sg * sa + d[i + 1] * keep;
      ob = sb * sa + d[i + 2] * keep;
      break;
    }
    case 'destination-in':
      // 색은 그대로, 알파만 소스 알파로 곱한다
      oa = da * sa;
      or = d[i] * oa;
      og = d[i + 1] * oa;
      ob = d[i + 2] * oa;
      break;
    case 'destination-out':
      oa = da * (1 - sa);
      or = d[i] * oa;
      og = d[i + 1] * oa;
      ob = d[i + 2] * oa;
      break;
    case 'source-in':
      oa = sa * da;
      or = sr * oa;
      og = sg * oa;
      ob = sb * oa;
      break;
    case 'copy':
      oa = sa;
      or = sr * oa;
      og = sg * oa;
      ob = sb * oa;
      break;
  }
  if (oa <= 0) {
    d[i] = 0;
    d[i + 1] = 0;
    d[i + 2] = 0;
    d[i + 3] = 0;
    return;
  }
  // Uint8ClampedArray 대입은 반올림(ties-to-even)·클램프를 한다
  d[i] = or / oa;
  d[i + 1] = og / oa;
  d[i + 2] = ob / oa;
  d[i + 3] = oa * 255;
}

// ───────────────────────── Canvas / Context ─────────────────────────

interface ContextState {
  fillStyle: string | ShimLinearGradient;
  fillColor: Color;
  globalAlpha: number;
  globalCompositeOperation: CompositeOp;
  imageSmoothingEnabled: boolean;
  imageSmoothingQuality: 'low' | 'medium' | 'high';
}

const defaultState = (): ContextState => ({
  fillStyle: '#000000',
  fillColor: [0, 0, 0, 1],
  globalAlpha: 1,
  globalCompositeOperation: 'source-over',
  imageSmoothingEnabled: true,
  imageSmoothingQuality: 'low',
});

export class ShimCanvasRenderingContext2D {
  private state: ContextState = defaultState();
  private stack: ContextState[] = [];

  constructor(readonly canvas: ShimCanvas) {}

  /** canvas 크기 설정 시 상태 초기화 (스펙) */
  reset(): void {
    this.state = defaultState();
    this.stack = [];
  }

  get fillStyle(): string | ShimLinearGradient {
    return this.state.fillStyle;
  }
  set fillStyle(value: string | ShimLinearGradient) {
    if (value instanceof ShimLinearGradient) {
      this.state.fillStyle = value;
      return;
    }
    const parsed = typeof value === 'string' ? parseCssColor(value) : null;
    if (!parsed) return; // 해석 못 하면 무시 (브라우저와 동일)
    this.state.fillStyle = value;
    this.state.fillColor = parsed;
  }

  get globalAlpha(): number {
    return this.state.globalAlpha;
  }
  set globalAlpha(value: number) {
    if (Number.isFinite(value) && value >= 0 && value <= 1) this.state.globalAlpha = value;
  }

  get globalCompositeOperation(): string {
    return this.state.globalCompositeOperation;
  }
  set globalCompositeOperation(value: string) {
    if (!SUPPORTED_OPS.has(value)) {
      throw new Error(`canvas-shim: 지원하지 않는 globalCompositeOperation "${value}" — 필요하면 shim 에 구현할 것`);
    }
    this.state.globalCompositeOperation = value as CompositeOp;
  }

  get imageSmoothingEnabled(): boolean {
    return this.state.imageSmoothingEnabled;
  }
  set imageSmoothingEnabled(value: boolean) {
    this.state.imageSmoothingEnabled = !!value;
  }

  get imageSmoothingQuality(): string {
    return this.state.imageSmoothingQuality;
  }
  set imageSmoothingQuality(value: string) {
    if (value === 'low' || value === 'medium' || value === 'high') this.state.imageSmoothingQuality = value;
  }

  save(): void {
    this.stack.push({ ...this.state });
  }

  restore(): void {
    const prev = this.stack.pop();
    if (prev) this.state = prev;
  }

  createImageData(widthOrData: number | ShimImageData, height?: number): ShimImageData {
    if (typeof widthOrData === 'number') return new ShimImageData(Math.abs(widthOrData), Math.abs(height ?? 0));
    return new ShimImageData(widthOrData.width, widthOrData.height);
  }

  createLinearGradient(x0: number, y0: number, x1: number, y1: number): ShimLinearGradient {
    return new ShimLinearGradient(x0, y0, x1, y1);
  }

  getImageData(sx: number, sy: number, sw: number, sh: number): ShimImageData {
    const out = new ShimImageData(sw, sh);
    const { width: W, height: H, data } = this.canvas.buffer;
    for (let y = 0; y < sh; y++) {
      const yy = sy + y;
      if (yy < 0 || yy >= H) continue;
      const x0 = Math.max(0, sx);
      const x1 = Math.min(W, sx + sw);
      if (x1 <= x0) continue;
      out.data.set(data.subarray((yy * W + x0) * 4, (yy * W + x1) * 4), (y * sw + (x0 - sx)) * 4);
    }
    return out;
  }

  /** 합성 없이 그대로 덮어쓴다 (스펙) */
  putImageData(image: ShimImageData, dx: number, dy: number): void {
    const { width: W, height: H, data } = this.canvas.buffer;
    dx = Math.trunc(dx);
    dy = Math.trunc(dy);
    for (let y = 0; y < image.height; y++) {
      const yy = dy + y;
      if (yy < 0 || yy >= H) continue;
      const x0 = Math.max(0, dx);
      const x1 = Math.min(W, dx + image.width);
      if (x1 <= x0) continue;
      data.set(image.data.subarray((y * image.width + (x0 - dx)) * 4, (y * image.width + (x1 - dx)) * 4), (yy * W + x0) * 4);
    }
  }

  clearRect(x: number, y: number, w: number, h: number): void {
    const { width: W, height: H, data } = this.canvas.buffer;
    const [x0, x1] = pixelSpan(x, w, W);
    const [y0, y1] = pixelSpan(y, h, H);
    for (let yy = y0; yy < y1; yy++) data.fill(0, (yy * W + x0) * 4, (yy * W + x1) * 4);
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    if (w < 0) {
      x += w;
      w = -w;
    }
    if (h < 0) {
      y += h;
      h = -h;
    }
    const { width: W, height: H, data } = this.canvas.buffer;
    const op = this.state.globalCompositeOperation;
    const ga = this.state.globalAlpha;
    const style = this.state.fillStyle;
    const gradient = style instanceof ShimLinearGradient ? style : null;
    const solid = this.state.fillColor;
    const x0 = Math.max(0, Math.floor(x));
    const x1 = Math.min(W, Math.ceil(x + w));
    const y0 = Math.max(0, Math.floor(y));
    const y1 = Math.min(H, Math.ceil(y + h));

    for (let py = y0; py < y1; py++) {
      // 소수 좌표 변은 픽셀 커버리지만큼 (Chrome 의 사각형 AA 근사)
      const covY = Math.min(py + 1, y + h) - Math.max(py, y);
      for (let px = x0; px < x1; px++) {
        const covX = Math.min(px + 1, x + w) - Math.max(px, x);
        const cov = Math.max(0, Math.min(1, covX)) * Math.max(0, Math.min(1, covY));
        if (cov <= 0 && !UNBOUNDED_OPS.has(op)) continue;
        let c: Color | null = solid;
        if (gradient) {
          c = gradient.colorAt(px + 0.5, py + 0.5);
          if (!c) continue;
        }
        // 그라디언트 색은 8비트로 양자화된 뒤 합성된다
        const sa = (Math.round(c[3] * 255) / 255) * ga * cov;
        blend(data, (py * W + px) * 4, Math.round(c[0]), Math.round(c[1]), Math.round(c[2]), sa, op);
      }
    }
    if (UNBOUNDED_OPS.has(op)) this.clearOutside(x0, y0, x1, y1, op);
  }

  drawImage(source: unknown, ...args: number[]): void {
    const pixels = (source as Partial<PixelSource>)?.[PIXELS]?.();
    if (!pixels || pixels.width === 0 || pixels.height === 0) return; // 로드 전 이미지는 그리지 않는다
    let sx = 0;
    let sy = 0;
    let sw = pixels.width;
    let sh = pixels.height;
    let dx: number;
    let dy: number;
    let dw: number;
    let dh: number;
    if (args.length === 2) {
      [dx, dy] = args;
      dw = sw;
      dh = sh;
    } else if (args.length === 4) {
      [dx, dy, dw, dh] = args;
    } else if (args.length === 8) {
      [sx, sy, sw, sh, dx, dy, dw, dh] = args;
    } else {
      throw new TypeError(`canvas-shim: drawImage 인자 수가 올바르지 않습니다 (${args.length + 1})`);
    }
    if (sw === 0 || sh === 0 || dw === 0 || dh === 0) return;
    if (sw < 0 || sh < 0 || dw < 0 || dh < 0) {
      throw new Error('canvas-shim: 음수 크기 drawImage(뒤집기)는 지원하지 않는다');
    }

    const { width: W, height: H, data } = this.canvas.buffer;
    const src = pixels.data;
    const SW = pixels.width;
    const SH = pixels.height;
    const op = this.state.globalCompositeOperation;
    const ga = this.state.globalAlpha;
    const scaleX = sw / dw;
    const scaleY = sh / dh;
    // 대상 픽셀: 중심이 [dx, dx+dw) 안에 드는 것
    const x0 = Math.max(0, Math.ceil(dx - 0.5));
    const x1 = Math.min(W, Math.ceil(dx + dw - 0.5));
    const y0 = Math.max(0, Math.ceil(dy - 0.5));
    const y1 = Math.min(H, Math.ceil(dy + dh - 0.5));
    // 샘플링은 소스 사각형 안으로 제한한다 (Chrome 은 drawImage 에 strict 제약을 건다)
    const minX = Math.max(0, Math.floor(sx));
    const maxX = Math.min(SW - 1, Math.ceil(sx + sw) - 1);
    const minY = Math.max(0, Math.floor(sy));
    const maxY = Math.min(SH - 1, Math.ceil(sy + sh) - 1);

    const exact =
      scaleX === 1 && scaleY === 1 && Number.isInteger(sx - dx) && Number.isInteger(sy - dy) && Number.isInteger(dx) && Number.isInteger(dy);
    const smooth = this.state.imageSmoothingEnabled && !exact;
    const boxX = smooth && scaleX > 2;
    const boxY = smooth && scaleY > 2;

    for (let py = y0; py < y1; py++) {
      const v = sy + (py + 0.5 - dy) * scaleY; // 소스 좌표 (픽셀 중심 기준)
      if (v < 0 || v >= SH) continue; // 소스 이미지 밖은 그리지 않는다 (클리핑)
      for (let px = x0; px < x1; px++) {
        const u = sx + (px + 0.5 - dx) * scaleX;
        if (u < 0 || u >= SW) continue;
        let r: number;
        let g: number;
        let b: number;
        let a: number;
        if (!smooth) {
          const ix = Math.min(maxX, Math.max(minX, Math.floor(u)));
          const iy = Math.min(maxY, Math.max(minY, Math.floor(v)));
          const s = (iy * SW + ix) * 4;
          r = src[s];
          g = src[s + 1];
          b = src[s + 2];
          a = src[s + 3] / 255;
        } else {
          // 쌍선형(확대·완만한 축소) 또는 박스 평균(2배 넘는 축소) — 프리멀티플라이드로 평균
          let ar = 0;
          let ag = 0;
          let ab = 0;
          let aa = 0;
          let wsum = 0;
          const add = (ix: number, iy: number, w: number) => {
            if (w <= 0) return;
            const s = (iy * SW + ix) * 4;
            const al = src[s + 3] / 255;
            ar += src[s] * al * w;
            ag += src[s + 1] * al * w;
            ab += src[s + 2] * al * w;
            aa += al * w;
            wsum += w;
          };
          const xs = sampleTaps(u, scaleX, boxX, minX, maxX);
          const ys = sampleTaps(v, scaleY, boxY, minY, maxY);
          for (const [iy, wy] of ys) for (const [ix, wx] of xs) add(ix, iy, wx * wy);
          a = wsum > 0 ? aa / wsum : 0;
          if (aa > 0) {
            r = ar / aa;
            g = ag / aa;
            b = ab / aa;
          } else {
            r = g = b = 0;
          }
        }
        blend(data, (py * W + px) * 4, r, g, b, a * ga, op);
      }
    }
    if (UNBOUNDED_OPS.has(op)) this.clearOutside(x0, y0, x1, y1, op);
  }

  /** unbounded 합성: 그린 사각형 밖의 픽셀에 소스 알파 0 을 적용한다 */
  private clearOutside(x0: number, y0: number, x1: number, y1: number, op: CompositeOp): void {
    const { width: W, height: H, data } = this.canvas.buffer;
    for (let py = 0; py < H; py++) {
      const inside = py >= y0 && py < y1;
      for (let px = 0; px < W; px++) {
        if (inside && px >= x0 && px < x1) continue;
        blend(data, (py * W + px) * 4, 0, 0, 0, 0, op);
      }
    }
  }
}

/** 축 하나의 샘플 탭 [(정수 좌표, 가중치)] */
function sampleTaps(c: number, scale: number, box: boolean, min: number, max: number): [number, number][] {
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  if (box) {
    // 소스 발자국 [c - scale/2, c + scale/2) 의 면적 평균
    const lo = c - scale / 2;
    const hi = c + scale / 2;
    const taps: [number, number][] = [];
    for (let i = Math.floor(lo); i < hi; i++) {
      const w = Math.min(i + 1, hi) - Math.max(i, lo);
      if (w > 0) taps.push([clamp(i), w]);
    }
    return taps;
  }
  const x = c - 0.5;
  const i0 = Math.floor(x);
  const f = x - i0;
  return [
    [clamp(i0), 1 - f],
    [clamp(i0 + 1), f],
  ];
}

/** 사각형 [x, x+w) 가 덮는 정수 픽셀 범위 (중심 기준, 캔버스로 잘라냄) */
function pixelSpan(x: number, w: number, limit: number): [number, number] {
  if (w < 0) {
    x += w;
    w = -w;
  }
  return [Math.max(0, Math.ceil(x - 0.5)), Math.min(limit, Math.ceil(x + w - 0.5))];
}

export class ShimCanvas implements PixelSource {
  private w = 300;
  private h = 150;
  /** 스트레이트 알파 RGBA 8비트 */
  buffer: RgbaImage = { width: 300, height: 150, data: new Uint8ClampedArray(300 * 150 * 4) };
  private ctx: ShimCanvasRenderingContext2D | null = null;
  readonly tagName = 'CANVAS';
  readonly nodeName = 'CANVAS';

  get width(): number {
    return this.w;
  }
  set width(value: number) {
    this.w = Math.max(0, Math.floor(Number(value) || 0));
    this.resize();
  }
  get height(): number {
    return this.h;
  }
  set height(value: number) {
    this.h = Math.max(0, Math.floor(Number(value) || 0));
    this.resize();
  }

  /** 크기를 설정하면 (같은 값이어도) 내용과 컨텍스트 상태가 초기화된다 (스펙) */
  private resize(): void {
    this.buffer = { width: this.w, height: this.h, data: new Uint8ClampedArray(this.w * this.h * 4) };
    this.ctx?.reset();
  }

  getContext(type: string): ShimCanvasRenderingContext2D | null {
    if (type !== '2d') return null;
    this.ctx ??= new ShimCanvasRenderingContext2D(this);
    return this.ctx;
  }

  [PIXELS](): RgbaImage {
    return this.buffer;
  }

  toDataURL(type = 'image/png', quality?: number): string {
    if (this.w === 0 || this.h === 0) return 'data:,';
    if (type.toLowerCase() === 'image/jpeg') {
      // Chrome 은 JPEG 인코딩 시 알파를 버린다 = 프리멀티플라이드 색(검정 위 합성)이 남는다
      const { data } = this.buffer;
      const opaque = new Uint8ClampedArray(data.length);
      for (let i = 0; i < data.length; i += 4) {
        const a = data[i + 3] / 255;
        opaque[i] = data[i] * a;
        opaque[i + 1] = data[i + 1] * a;
        opaque[i + 2] = data[i + 2] * a;
        opaque[i + 3] = 255;
      }
      const q = typeof quality === 'number' && quality >= 0 && quality <= 1 ? quality : 0.92;
      const bytes = encodeJpegOnWhite({ width: this.w, height: this.h, data: opaque }, Math.round(q * 100));
      return `data:image/jpeg;base64,${Buffer.from(bytes).toString('base64')}`;
    }
    // 그 외(webp 포함)는 Chrome 과 같이 PNG 로 폴백
    return `data:image/png;base64,${encodePng(this.buffer).toString('base64')}`;
  }
}

// ───────────────────────── Image ─────────────────────────

/** data URL → 바이트 (base64 와 퍼센트 인코딩 모두) */
function dataUrlBytes(url: string): Uint8Array {
  const m = /^data:([^,]*?),(.*)$/s.exec(url);
  if (!m) throw new Error('canvas-shim: Image.src 는 data URL 만 지원한다');
  return /;base64$/i.test(m[1]) ? Buffer.from(m[2], 'base64') : Buffer.from(decodeURIComponent(m[2]), 'latin1');
}

type Listener = (event: { type: string; target: ShimImage }) => void;

export class ShimImage implements PixelSource {
  onload: Listener | null = null;
  onerror: Listener | null = null;
  complete = true;
  naturalWidth = 0;
  naturalHeight = 0;
  width = 0;
  height = 0;
  crossOrigin: string | null = null;
  decoding = 'auto';
  readonly tagName = 'IMG';
  private url = '';
  private pixels: RgbaImage | null = null;
  private listeners = new Map<string, Set<Listener>>();
  private pending: Promise<void> | null = null;

  get src(): string {
    return this.url;
  }

  /** 브라우저처럼 비동기로 디코드한 뒤 load/error 를 쏜다 (onload 를 나중에 달아도 잡힌다) */
  set src(value: string) {
    this.url = String(value);
    this.complete = false;
    this.pixels = null;
    this.pending = new Promise<void>((resolve) => {
      setImmediate(() => {
        let failed = false;
        try {
          const img = decodeImage(dataUrlBytes(this.url));
          this.pixels = img;
          this.naturalWidth = this.width = img.width;
          this.naturalHeight = this.height = img.height;
        } catch {
          failed = true;
          this.naturalWidth = this.naturalHeight = this.width = this.height = 0;
        }
        this.complete = true;
        this.emit(failed ? 'error' : 'load');
        resolve();
      });
    });
  }

  addEventListener(type: string, listener: Listener): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  async decode(): Promise<void> {
    await this.pending;
    if (!this.pixels) throw new Error('canvas-shim: 이미지 디코딩 실패');
  }

  private emit(type: 'load' | 'error'): void {
    const event = { type, target: this };
    (type === 'load' ? this.onload : this.onerror)?.call(this, event);
    for (const l of this.listeners.get(type) ?? []) l.call(this, event);
  }

  [PIXELS](): RgbaImage | null {
    return this.pixels;
  }
}

// ───────────────────────── 설치 ─────────────────────────

let installed = false;

/**
 * MCP 프로세스 전역에 `document`·`Image`·`ImageData` 를 제공한다 (멱등).
 * 이미 진짜 DOM 이 있으면(브라우저·jsdom) 건드리지 않는다.
 */
export function installCanvasShim(): void {
  if (installed) return;
  installed = true;
  const g = globalThis as Record<string, unknown>;
  if (g.document === undefined) {
    g.document = {
      createElement(tag: string) {
        const name = String(tag).toLowerCase();
        if (name === 'canvas') return new ShimCanvas();
        if (name === 'img') return new ShimImage();
        throw new Error(`canvas-shim: document.createElement('${tag}') 는 지원하지 않는다`);
      },
    };
  }
  g.Image ??= ShimImage;
  g.ImageData ??= ShimImageData;
  g.HTMLCanvasElement ??= ShimCanvas;
  g.HTMLImageElement ??= ShimImage;
  g.CanvasGradient ??= ShimLinearGradient;
}
