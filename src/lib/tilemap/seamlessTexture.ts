/**
 * 이음새 없는(wrap 연속) 재질 텍스처 생성 유틸.
 *
 * 룰타일 합성과 변형 세트 합성이 **공유하는 1단계**다. AI가 그린 재질 스와치에서
 * 필드 영역을 잘라내 "좌우/상하로 순환 연결되는" 텍스처로 변환한다. 이 텍스처를 모든
 * 타일이 동일한 오프셋 (0,0)으로 샘플링하기 때문에, 어떤 타일을 어디에 놓아도 재질
 * 면이 서로 이어진다 (임의 배치 교체 가능성의 전제 조건).
 *
 * 여기에는 그 위에 얹는 **엣지 계약**(`buildTextureVariants`)도 함께 둔다 — 두 모드가
 * 같은 계약을 쓰지 않으면 한쪽 접합만 조용히 깨진다.
 *
 * ## 알고리즘: 분리형 주기 크로스페이드
 *
 * 원본 src(S x S)를 절반(S/2)만큼 굴린 복사본과 섞는다. 가중치 w는 주기 S의
 * 코사인 창이며 **경계에서 1, 중앙에서 0**이다:
 *
 *   w(x) = 0.5 * (1 + cos(2*pi*x/S))     // w(0)=w(S)=1, w(S/2)=0
 *   H(x,y) = (1-w(x))*src(x,y) + w(x)*src((x+S/2) mod S, y)
 *
 * - x=0 에서 w=1 이므로 H(0,y) = src(S/2, y)
 * - x->S 에서도 w->1 이고 (x+S/2) mod S -> S/2 이므로 H(S-,y) -> src(S/2-, y)
 * - src는 내부점 S/2 부근에서 연속이므로 **H의 좌우 경계는 연속**이 된다.
 * - 굴린 복사본 자신의 이음새는 x=S/2 에 오는데 그 지점의 가중치가 0이라 소멸한다.
 *
 * 세로 방향으로 같은 연산을 한 번 더 적용한다(분리 가능). 가로 연속성은 세로
 * 블렌딩에 의해 깨지지 않으므로(연속 이미지 2장의 볼록 결합) 최종 결과는 상하좌우
 * 모두 wrap 연속이다.
 *
 * ## 트레이드오프
 * 크로스페이드이므로 원본 디테일(꽃/돌 등)이 두 위치에 반투명하게 겹쳐 보인다.
 * 따라서 입력은 **디테일 없는 균질한 재질 필드**여야 한다(프롬프트에서 강제).
 * 개별 디테일은 이후 합성 단계에서 코드가 배치한다.
 */

/** 창 가중치 근사에 사용할 그라디언트 정지점 개수 (많을수록 부드러움) */
const GRADIENT_STOPS = 65;

/**
 * 창의 평탄부 폭 — 이 구간에서 가중치가 정확히 0 또는 1이 되어 **블렌딩이 없다**.
 *
 * 초기 구현은 순수 코사인 창(`0.5*(1+cos(2*pi*t))`)을 썼는데, 그 창은 `t = 0.25`에서
 * 정확히 50:50 블렌딩이 된다. 문제는 엣지 계약의 인셋도 `k = T/4`(= t 0.25)라는 것 —
 * **지형 경계가 지나가는 바로 그 위치가 최대 유령(ghosting) 지점**이었다. 경계가
 * 뭉개져 보이던 주된 원인이다.
 *
 * 그래서 평탄부를 가진 창으로 바꾼다:
 *   t in [0, FLAT] 및 [1-FLAT, 1] -> w = 1 (굴린 복사본만, 블렌딩 없음)
 *   t in [RAMP_END, 1-RAMP_END]   -> w = 0 (원본만, 블렌딩 없음)
 *   그 사이 좁은 구간에서만 부드럽게 전환
 * FLAT = 0.30 이므로 t = 0.25 와 0.75 는 평탄부(w=1)에 들어가 유령이 전혀 없다.
 * 전환 구간 [0.30, 0.45] / [0.55, 0.70] 은 지형이 균일한 내부라 무해하다.
 */
const WINDOW_FLAT = 0.30;
/** 창이 0에 도달하는 지점 (평탄부 끝에서 여기까지가 전환 구간) */
const WINDOW_RAMP_END = 0.45;

/** 2D 컨텍스처를 얻거나 실패 시 예외 */
function get2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('canvas 2d context를 생성할 수 없습니다');
  return ctx;
}

/** 지정 크기의 빈 캔버스 생성 */
function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/**
 * 원본 이미지의 사각 영역을 잘라 정사각 캔버스로 리샘플한다.
 * 머티리얼 시트에서 베이스/오버레이 지형 필드 영역을 추출할 때 사용한다.
 *
 * @param source 원본 이미지 (실측 크기 기준으로 좌표를 해석)
 * @param sx     추출 시작 x (원본 픽셀)
 * @param sy     추출 시작 y (원본 픽셀)
 * @param sw     추출 폭 (원본 픽셀)
 * @param sh     추출 높이 (원본 픽셀)
 * @param outSize 출력 정사각형 한 변
 */
export function extractRegion(
  source: CanvasImageSource,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  outSize: number
): HTMLCanvasElement {
  const out = createCanvas(outSize, outSize);
  const ctx = get2d(out);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, outSize, outSize);
  return out;
}

/**
 * 재질 스와치에서 타일 크기만큼을 **원본 해상도 그대로** 잘라낸다.
 *
 * 이전에는 512px 스와치를 타일 크기(8x8 그리드면 128px)로 축소했는데, 이는 4배
 * 다운스케일이라 또렷함이 정체성인 스타일(벡터·픽셀아트·셀 셰이딩)의 디테일이
 * 통째로 사라졌다. 스와치는 설계상 **통계적으로 균일한 필드**이므로, 축소하지 않고
 * 중앙에서 타일 크기만큼 1:1로 잘라내도 대표성은 동일하고 선명도는 보존된다.
 *
 * 스와치가 타일보다 작은 경우(모델이 작은 이미지를 반환)에만 확대 리샘플로 폴백한다.
 */
export function cropMaterialSwatch(
  source: CanvasImageSource,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  outSize: number
): HTMLCanvasElement {
  const available = Math.min(sw, sh);
  if (available < outSize) {
    // 원본이 부족하면 어쩔 수 없이 확대 — 이 경로는 모델이 규격보다 작은 이미지를 준 경우다
    return extractRegion(source, sx, sy, sw, sh, outSize);
  }
  const out = createCanvas(outSize, outSize);
  const ctx = get2d(out);
  ctx.imageSmoothingEnabled = false; // 1:1 이므로 보간 자체가 불필요
  const offsetX = sx + (sw - outSize) / 2;
  const offsetY = sy + (sh - outSize) / 2;
  ctx.drawImage(source, offsetX, offsetY, outSize, outSize, 0, 0, outSize, outSize);
  return out;
}

/** 5차 스무스스텝 */
function smoothstep(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * c * (c * (c * 6 - 15) + 10);
}

/**
 * 평탄부를 가진 주기 창 w(t). t는 0~1로 정규화된 축 방향 위치.
 * 경계 부근(평탄부)에서 1, 중앙부에서 0, 그 사이 좁은 구간에서만 전환.
 * 상수 근거는 `WINDOW_FLAT` 주석 참조.
 */
function windowWeight(t: number): number {
  // 경계로부터의 거리 (주기성 확보)
  const d = Math.min(t, 1 - t);
  if (d <= WINDOW_FLAT) return 1;
  if (d >= WINDOW_RAMP_END) return 0;
  return 1 - smoothstep((d - WINDOW_FLAT) / (WINDOW_RAMP_END - WINDOW_FLAT));
}

/** 창 가중치를 알파로 갖는 선형 그라디언트를 만든다. */
function createWindowGradient(
  ctx: CanvasRenderingContext2D,
  size: number,
  axis: 'x' | 'y'
): CanvasGradient {
  const gradient = axis === 'x'
    ? ctx.createLinearGradient(0, 0, size, 0)
    : ctx.createLinearGradient(0, 0, 0, size);
  for (let i = 0; i < GRADIENT_STOPS; i++) {
    const t = i / (GRADIENT_STOPS - 1);
    gradient.addColorStop(t, `rgba(0,0,0,${windowWeight(t)})`);
  }
  return gradient;
}

/**
 * 입력 캔버스를 지정 축으로 size/2 만큼 굴린(roll) 새 캔버스를 반환한다.
 * 원본을 -size/2, +size/2 두 번 그려 순환 이동을 구현한다.
 */
function rollHalf(input: HTMLCanvasElement, size: number, axis: 'x' | 'y'): HTMLCanvasElement {
  const out = createCanvas(size, size);
  const ctx = get2d(out);
  const half = size / 2;
  if (axis === 'x') {
    ctx.drawImage(input, -half, 0);
    ctx.drawImage(input, half, 0);
  } else {
    ctx.drawImage(input, 0, -half);
    ctx.drawImage(input, 0, half);
  }
  return out;
}

/**
 * 한 축에 대해 크로스페이드 1회를 수행한다.
 * 결과 = (1-w)*input + w*roll(input, size/2)  — source-over 합성이 이 식과 동일하다.
 */
function crossfadeAxis(input: HTMLCanvasElement, size: number, axis: 'x' | 'y'): HTMLCanvasElement {
  // 굴린 복사본에 창 가중치를 알파로 심는다 (destination-in: 기존 픽셀 x 새 알파)
  const rolled = rollHalf(input, size, axis);
  const rolledCtx = get2d(rolled);
  rolledCtx.globalCompositeOperation = 'destination-in';
  rolledCtx.fillStyle = createWindowGradient(rolledCtx, size, axis);
  rolledCtx.fillRect(0, 0, size, size);
  rolledCtx.globalCompositeOperation = 'source-over';

  // 원본 위에 알파를 가진 굴린 복사본을 얹으면 볼록 결합이 된다
  const out = createCanvas(size, size);
  const ctx = get2d(out);
  ctx.drawImage(input, 0, 0);
  ctx.drawImage(rolled, 0, 0);
  return out;
}

/**
 * 정사각 소스를 상하좌우 wrap 연속인 텍스처로 변환한다.
 *
 * @param source  원본 이미지 또는 캔버스
 * @param size    출력 한 변 (짝수여야 한다 — S/2 굴림을 쓰므로)
 * @returns       size x size wrap 연속 텍스처 캔버스
 */
export function makeSeamless(source: CanvasImageSource, size: number): HTMLCanvasElement {
  if (size % 2 !== 0) throw new Error(`makeSeamless: size는 짝수여야 합니다 (받은 값: ${size})`);

  // 소스를 정확히 size x size로 정규화
  const normalized = createCanvas(size, size);
  const ctx = get2d(normalized);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, size, size);

  // 가로 -> 세로 순서로 분리 적용
  return crossfadeAxis(crossfadeAxis(normalized, size, 'x'), size, 'y');
}

/**
 * 변형 텍스처의 **공유 테두리 폭 비율** (타일 한 변 대비).
 *
 * ## 왜 테두리를 공유해야 하는가
 * 타일을 어느 칸에 놓을지는 런타임에 결정된다(유니티 Rule Tile의 Output: Random,
 * 변형 세트의 Random Tile, 사용자가 직접 칠하는 경우 모두). 즉 **어떤 두 변형이
 * 이웃해도 접합부가 이어져야** 하고, 그러려면 모든 변형의 변 픽셀이 완전히 동일해야
 * 한다. 그래서 변형은 "정규 텍스처(wrap 연속) 위에 다른 크롭을 안쪽에만 얹은 것"으로
 * 만든다:
 *
 *   variant = (1 - a(x,y)) * canonical + a(x,y) * crop
 *   a = 0  (변에서 `EDGE_HOLD_PX` 픽셀까지)  →  변 근처는 정규 텍스처 그대로
 *   a: 0→1 (RAMP 구간에서 스무스스텝)       →  기울기까지 이어져 띠가 보이지 않는다
 *   a = 1  (내부)                            →  다른 크롭 = 랜덤성
 *
 * 변에서 a가 정확히 0이므로 변 픽셀은 모든 변형에서 정규 텍스처와 같다 → 접합 보장.
 * 재질 스와치는 설계상 균질한 필드라, 테두리가 공통이어도 반복으로 읽히지 않는다.
 */
const VARIANT_RAMP_RATIO = 0.12;
/** 변에서 이 픽셀 수까지는 정규 텍스처를 **그대로** 유지한다 (a = 0 구간) */
const EDGE_HOLD_PX = 2;

/**
 * 변형 블렌딩 가중치의 축 방향 성분. 변에서 0, 안쪽에서 1.
 * 상수 근거는 `VARIANT_RAMP_RATIO` 주석 참조.
 */
function variantAxisWeight(i: number, size: number): number {
  const d = Math.min(i + 0.5, size - i - 0.5); // 변까지의 거리
  const ramp = Math.max(1, size * VARIANT_RAMP_RATIO);
  if (d <= EDGE_HOLD_PX) return 0;
  return smoothstep((d - EDGE_HOLD_PX) / ramp);
}

/**
 * 한 재질 스와치 영역에서 텍스처 **변형 목록**을 만든다.
 *
 * - index 0 : 스와치 중앙을 1:1 크롭해 `makeSeamless`로 wrap 연속화한 **정규 텍스처**
 * - index v : 스와치의 다른 위치를 크롭해 정규 텍스처의 **안쪽에만** 얹은 것
 *
 * 변 픽셀은 전부 정규 텍스처와 동일하므로 어떤 변형끼리 이웃해도 접합이 이어진다
 * (`VARIANT_RAMP_RATIO` 주석의 계약 설명 참조). 룰타일 합성과 변형 세트 합성이
 * **같은 계약을 쓰도록** 여기 한 곳에 둔다 — 한쪽만 고치면 접합이 조용히 깨진다.
 *
 * 크롭 위치는 황금비 저불일치 수열로 스와치 전체에 고르게 흩는다 — 규칙적인 격자로
 * 잡으면 변형끼리 겹치는 영역이 많아져 차이가 잘 드러나지 않는다.
 *
 * @param count 만들 변형 개수(정규 텍스처 포함). 크롭 여유가 없으면 1장으로 폴백한다.
 */
export function buildTextureVariants(
  source: CanvasImageSource,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  T: number,
  count: number
): Uint8ClampedArray[] {
  const canonicalCanvas = makeSeamless(cropMaterialSwatch(source, sx, sy, sw, sh, T), T);
  const canonical = get2d(canonicalCanvas).getImageData(0, 0, T, T).data;
  const variants: Uint8ClampedArray[] = [canonical];

  // 크롭 여유가 없으면(모델이 규격보다 작은 이미지를 준 경우) 변형을 만들 수 없다 — 정규 1장으로 폴백
  const spanX = Math.max(0, sw - T);
  const spanY = Math.max(0, sh - T);
  if (spanX < 4 && spanY < 4) return variants;

  // 축 방향 가중치를 미리 계산 (픽셀 루프에서는 곱만 한다)
  const axis = new Float32Array(T);
  for (let i = 0; i < T; i++) axis[i] = variantAxisWeight(i, T);

  for (let v = 1; v < count; v++) {
    const fx = (v * 0.6180339887498949) % 1;
    const fy = (v * 0.7548776662466927) % 1;
    const crop = get2d(cropMaterialSwatch(source, sx + spanX * fx, sy + spanY * fy, T, T, T))
      .getImageData(0, 0, T, T).data;

    const blended = new Uint8ClampedArray(canonical.length);
    for (let y = 0; y < T; y++) {
      const ay = axis[y];
      for (let x = 0; x < T; x++) {
        const a = axis[x] * ay;
        const i = (y * T + x) * 4;
        blended[i] = canonical[i] + (crop[i] - canonical[i]) * a;
        blended[i + 1] = canonical[i + 1] + (crop[i + 1] - canonical[i + 1]) * a;
        blended[i + 2] = canonical[i + 2] + (crop[i + 2] - canonical[i + 2]) * a;
        blended[i + 3] = 255;
      }
    }
    variants.push(blended);
  }
  return variants;
}

/**
 * 텍스처 픽셀 버퍼를 불투명 PNG dataURL로 굽는다.
 * `buildTextureVariants` 결과를 그대로 타일로 쓸 때 사용한다.
 */
export function textureToDataUrl(texture: Uint8ClampedArray, T: number): string {
  const canvas = createCanvas(T, T);
  const ctx = get2d(canvas);
  const out = ctx.createImageData(T, T);
  out.data.set(texture);
  // 알파를 완전 불투명으로 고정 (텍스처가 투명 픽셀을 가진 경우 대비)
  for (let i = 3; i < out.data.length; i += 4) out.data[i] = 255;
  ctx.putImageData(out, 0, 0);
  return canvas.toDataURL('image/png');
}

/** wrap 연속성 측정 결과 (self-check 리포트용) */
export interface WrapContinuityReport {
  /** 좌우 경계를 넘는 평균 채널 변화량 (0~255) */
  seamX: number;
  /** 상하 경계를 넘는 평균 채널 변화량 (0~255) */
  seamY: number;
  /** 내부 인접 픽셀의 평균 가로 변화량 */
  interiorX: number;
  /** 내부 인접 픽셀의 평균 세로 변화량 */
  interiorY: number;
  /** 내부 가로 변화량 분포의 95분위 — 판정 기준선 */
  interiorP95X: number;
  /** 내부 세로 변화량 분포의 95분위 — 판정 기준선 */
  interiorP95Y: number;
}

/** 정렬되지 않은 배열의 분위값 (선형 보간 없이 최근접 인덱스) */
function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = Float64Array.from(values).sort();
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
  return sorted[idx];
}

/**
 * 텍스처의 wrap 연속성을 측정한다.
 *
 * ## 판정 기준을 고른 근거
 * - "경계 양쪽 픽셀이 동일한가"는 **틀린 기준**이다 — 그건 열/행 중복을 의미한다.
 * - "경계 변화량 <= 내부 *평균* 변화량 x 배수"도 **틀린 기준**이다. 크로스페이드는
 *   기울기를 위치에 따라 재분배하므로(코사인 창의 미분항) 내부 기울기 분포가 넓어지고,
 *   전역 평균은 이음새 판정의 기준선이 될 수 없다.
 * - 올바른 기준은 **분위수**다: 경계를 넘는 스텝이 내부 스텝 분포에서 평범한 값
 *   (P95 이하)이면 그 경계는 다른 인접쌍과 구별되지 않는다 = 이음새가 안 보인다.
 */
export function measureWrapContinuity(canvas: HTMLCanvasElement): WrapContinuityReport {
  const { width: w, height: h } = canvas;
  const data = get2d(canvas).getImageData(0, 0, w, h).data;

  /** (x,y) 픽셀의 RGB를 읽는다 */
  const at = (x: number, y: number, ch: number): number => data[(y * w + x) * 4 + ch];
  /** 두 픽셀의 RGB 평균 절대차 */
  const diff = (x1: number, y1: number, x2: number, y2: number): number =>
    (Math.abs(at(x1, y1, 0) - at(x2, y2, 0)) +
      Math.abs(at(x1, y1, 1) - at(x2, y2, 1)) +
      Math.abs(at(x1, y1, 2) - at(x2, y2, 2))) / 3;

  // 좌우 경계: 마지막 열 -> (wrap) 첫 열
  let seamX = 0;
  for (let y = 0; y < h; y++) seamX += diff(w - 1, y, 0, y);
  seamX /= h;

  // 상하 경계: 마지막 행 -> (wrap) 첫 행
  let seamY = 0;
  for (let x = 0; x < w; x++) seamY += diff(x, h - 1, x, 0);
  seamY /= w;

  // 내부 기준선 — 열/행 단위로 집계해 seam 측정치(열/행 평균)와 같은 척도로 비교한다.
  // (픽셀 단위 스텝과 열 평균 스텝은 분산이 다르므로 척도를 맞춰야 분위 비교가 유효하다)
  const colSteps: number[] = [];
  for (let x = 0; x < w - 1; x++) {
    let s = 0;
    for (let y = 0; y < h; y++) s += diff(x, y, x + 1, y);
    colSteps.push(s / h);
  }
  const rowSteps: number[] = [];
  for (let y = 0; y < h - 1; y++) {
    let s = 0;
    for (let x = 0; x < w; x++) s += diff(x, y, x, y + 1);
    rowSteps.push(s / w);
  }

  const mean = (a: number[]) => (a.length === 0 ? 0 : a.reduce((p, c) => p + c, 0) / a.length);

  return {
    seamX,
    seamY,
    interiorX: mean(colSteps),
    interiorY: mean(rowSteps),
    interiorP95X: percentile(colSteps, 0.95),
    interiorP95Y: percentile(rowSteps, 0.95),
  };
}
