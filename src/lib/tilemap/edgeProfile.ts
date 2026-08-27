/**
 * 룰타일 경계 기하 — 지형 마스크를 이웃 signature로부터 절차적으로 생성한다.
 *
 * 룰타일 v3 파이프라인의 2단계다. AI가 그린 "한 장"을 자르는 대신, 코드가 모든
 * 타일의 지형 경계를 직접 정의한다. 그래야 임의 조합에서 이어지는 것을 **증명**할 수 있다.
 *
 * ## 엣지 계약 (이 파일이 지키는 불변식)
 *
 * > 타일 변을 따라 지형이 갈리는 위치는 항상 정규 상수 `k = size * TRANSITION_INSET_RATIO`
 * > 이며, 오목 코너의 반경도 반드시 같은 `k`다.
 *
 * 이 하나로 인접 타일의 공유 변 내용이 서로 일치한다. 증명 스케치 — 우리 셀의
 * 서쪽 변에서 y < k 구간이 베이스인지 오버레이인지는 (N, W, NW) 세 이웃만으로 정해지고,
 * 서쪽 이웃 셀의 동쪽 변 같은 구간도 자신의 (N, E, NE) = 우리의 (NW, 자기자신, N)로
 * 정해진다. 네 조합을 모두 전개하면 항상 같은 결론이 나온다:
 *
 * | 우리 N | 우리 NW | 우리 서쪽 변 y<k | 서쪽 이웃의 동쪽 변 y<k |
 * |--------|---------|------------------|--------------------------|
 * | base   | base    | 베이스 (N 인셋)  | 베이스 (자기 N=base 인셋) |
 * | base   | overlay | 베이스 (N 인셋)  | 베이스 (자기 NE=base 오목) |
 * | overlay| base    | 베이스 (NW 오목) | 베이스 (자기 N=base 인셋)  |
 * | overlay| overlay | 오버레이         | 오버레이                   |
 *
 * ## 왜 인셋이 T/2 가 아니라 T/4 인가
 * 인셋을 T/2로 두면 위·아래가 모두 베이스인 **1칸 폭 통로**에서 오버레이 영역이
 * 선으로 수축해 사라진다(고립 셀도 마찬가지). T/4면 통로는 높이 T/2의 띠가 되어
 * 16종·47종 모든 signature가 표현 가능하다.
 *
 * ## 유기적 흔들림(warp)의 제약
 * 손맵 느낌을 위해 경계에 잡음 변위를 준다. 단 변위장은 **타일 변에서 정확히 0**이어야
 * 한다. 변 위에서 변위가 0이 아니면 그 변의 내용이 타일 내부 값을 참조하게 되어
 * 위 증명이 깨진다(인접 타일은 서로 다른 signature이므로 내부는 일치하지 않는다).
 * 대가로 변 근처 얇은 띠에서는 경계가 곧게 지나간다 — 프린지 브러시가 이를 가린다.
 */

/** 8방향 이웃 비트. 세트 = 그 이웃도 오버레이 셀 */
export const NEIGHBOR = {
  N: 1,
  NE: 2,
  E: 4,
  SE: 8,
  S: 16,
  SW: 32,
  W: 64,
  NW: 128,
} as const;

/** 전이 인셋 비율 — 경계가 변을 가르는 정규 위치 (변 길이 대비) */
export const TRANSITION_INSET_RATIO = 0.25;

/** 마스크 생성 옵션 */
export interface TerrainMaskOptions {
  /** 볼록 코너 라운드 반경 (인셋 k 대비 비율, 0~1). 계약과 무관한 자유 파라미터 */
  cornerRoundRatio?: number;
  /** 경계 흔들림 진폭 (인셋 k 대비 비율). 0이면 완전 기하학적 경계 */
  warpAmplitudeRatio?: number;
  /** 흔들림 잡음의 셀 크기 (픽셀). 작을수록 잔물결 */
  warpFrequencyPx?: number;
  /** 변 근처에서 변위를 0으로 눌러주는 띠의 폭 (변 길이 대비 비율) */
  warpEdgeFalloffRatio?: number;
  /**
   * 경계 맞물림("블레이드") 진폭 (인셋 k 대비 비율).
   *
   * 손맵 타일셋의 지형 경계는 두 재질이 **섞인** 것이 아니라 한쪽이 다른 쪽을
   * 손가락처럼 침범한 것이다. 초기 구현은 프린지 색을 알파 블렌딩했는데, 알파
   * 블렌딩은 원리적으로 두 텍스처의 **평균**을 만들므로 아무리 선명한 재질을 넣어도
   * 그 밴드가 탁해졌다("얼버무리는 느낌"). 그래서 블렌딩을 버리고, 경계 판정값에
   * 고주파 변위를 더해 **이진 결정**이 맞물리게 한다. 픽셀은 100% 베이스 또는
   * 100% 오버레이이므로 탁해질 수 없다.
   */
  bladeAmplitudeRatio?: number;
  /** 블레이드 잡음의 셀 크기 (픽셀). 작을수록 잔가지가 촘촘 */
  bladeFrequencyPx?: number;
  /**
   * 흔들림 잡음 시드. 변형(variant) 타일은 이 값만 다르다.
   * 흔들림은 변에서 0이므로 시드가 달라도 변 위의 지형 판정은 동일하다 → 계약 유지.
   */
  warpSeed?: number;
}

/**
 * 옵션을 미리 해석한 형태.
 *
 * SDF는 **픽셀마다** 호출된다(타일 1장 = 셀^2회, 8x8 세트 = 100만회). 예전에는 호출마다
 * `{...DEFAULT_OPTIONS, ...options}` 스프레드와 오목 코너 배열 리터럴을 새로 만들어
 * 세트당 수백만 개의 단기 객체가 생겼고, GC 때문에 합성이 수십 초씩 걸렸다(dev 검증
 * 페이지에서는 렌더러가 응답 불가가 될 정도). 그래서 옵션 해석과 파생값 계산을
 * 루프 **밖으로** 끌어낸다.
 */
export interface ResolvedMaskOptions extends Required<TerrainMaskOptions> {
  /** 인셋 k (픽셀). size에 의존하므로 resolve 시점에 size를 함께 받는다 */
  k: number;
  /** 큰 흔들림 진폭 (픽셀) */
  warpAmp: number;
  /** 블레이드 진폭 (픽셀) */
  bladeAmp: number;
  /** 블레이드 잡음 시드 오프셋 (warpSeed 파생) */
  seedOffset: number;
  /** 블레이드 저주파 셀 크기 (warpFrequencyPx 파생) */
  warpFrequencyPx2: number;
}

/** 옵션을 해석한다 — 픽셀 루프 **앞에서 한 번만** 호출할 것 */
export function resolveMaskOptions(size: number, options?: TerrainMaskOptions): ResolvedMaskOptions {
  const o = { ...DEFAULT_OPTIONS, ...options };
  const k = size * TRANSITION_INSET_RATIO;
  return {
    ...o,
    k,
    warpAmp: k * o.warpAmplitudeRatio,
    bladeAmp: k * o.bladeAmplitudeRatio,
    seedOffset: o.warpSeed * 977,
    warpFrequencyPx2: o.warpFrequencyPx / 2.7,
  };
}

const DEFAULT_OPTIONS: Required<TerrainMaskOptions> = {
  cornerRoundRatio: 0.6,
  warpAmplitudeRatio: 0.40,
  warpFrequencyPx: 26,
  warpEdgeFalloffRatio: 0.08,
  bladeAmplitudeRatio: 0.30,
  bladeFrequencyPx: 6,
  warpSeed: 0,
};

/** 결정적 해시 → 0~1 */
function hash2(ix: number, iy: number, seed: number): number {
  let h = (ix * 374761393 + iy * 668265263 + seed * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967295;
}

/** 5차 스무스스텝 (에르미트) */
function smooth(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** 격자 보간 값잡음 — 결정적, 시드별로 독립 */
function valueNoise(x: number, y: number, cell: number, seed: number): number {
  const gx = Math.floor(x / cell);
  const gy = Math.floor(y / cell);
  const fx = smooth(x / cell - gx);
  const fy = smooth(y / cell - gy);
  const a = hash2(gx, gy, seed);
  const b = hash2(gx + 1, gy, seed);
  const c = hash2(gx, gy + 1, seed);
  const d = hash2(gx + 1, gy + 1, seed);
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
}

/**
 * 변 근처에서 0으로 떨어지는 창.
 * t는 0~1 정규화 좌표, falloff는 창이 1에 도달하는 지점.
 */
function edgeFalloff(t: number, falloff: number): number {
  if (falloff <= 0) return 1;
  const d = Math.min(t, 1 - t);
  if (d >= falloff) return 1;
  return smooth(Math.max(0, d) / falloff);
}

/**
 * (x, y)에 적용할 변위 x 성분·y 성분. 타일 변에서 정확히 0이 되도록 창을 곱한다.
 * 모든 타일이 같은 변위장을 쓰므로 타일 간 정합성이 유지된다.
 *
 * 픽셀 루프의 핫 패스이므로 객체를 반환하지 않는다 — 모듈 스코프 스크래치에 쓴다.
 * (예전에는 매 픽셀 `{dx, dy}`를 새로 만들어 세트당 100만 개의 단기 객체가 생겼다)
 */
let warpDx = 0;
let warpDy = 0;

function computeWarp(x: number, y: number, size: number, o: ResolvedMaskOptions): void {
  if (o.warpAmp === 0 && o.bladeAmp === 0) {
    warpDx = 0;
    warpDy = 0;
    return;
  }
  const win =
    edgeFalloff(x / size, o.warpEdgeFalloffRatio) *
    edgeFalloff(y / size, o.warpEdgeFalloffRatio);
  if (win === 0) {
    warpDx = 0;
    warpDy = 0;
    return;
  }

  const s = o.seedOffset;
  // 두 옥타브를 겹쳐 손맵스러운 큰 흔들림을 만든다. 시드는 변형 번호만큼 어긋난다
  const n1x = valueNoise(x, y, o.warpFrequencyPx, 11 + s) - 0.5;
  const n1y = valueNoise(x, y, o.warpFrequencyPx, 23 + s) - 0.5;
  const n2x = valueNoise(x, y, o.warpFrequencyPx2, 31 + s) - 0.5;
  const n2y = valueNoise(x, y, o.warpFrequencyPx2, 41 + s) - 0.5;

  // 블레이드 옥타브: 고주파·고진폭 변위로 두 지형이 손가락처럼 맞물리게 한다.
  // 알파 블렌딩 대신 이 이진 침범이 손맵 경계를 만든다 (bladeAmplitudeRatio 주석 참조).
  // 창(win)을 똑같이 곱하므로 타일 변에서는 0 → 엣지 계약 유지.
  const b1x = valueNoise(x, y, o.bladeFrequencyPx, 53 + s) - 0.5;
  const b1y = valueNoise(x, y, o.bladeFrequencyPx, 67 + s) - 0.5;

  warpDx = win * (o.warpAmp * (n1x * 1.4 + n2x * 0.6) + o.bladeAmp * b1x * 2);
  warpDy = win * (o.warpAmp * (n1y * 1.4 + n2y * 0.6) + o.bladeAmp * b1y * 2);
}

/** 편의 래퍼 — 루프 밖에서 한두 번 쓸 때만 사용할 것 */
export function warpOffset(
  x: number,
  y: number,
  size: number,
  options?: TerrainMaskOptions
): { dx: number; dy: number } {
  computeWarp(x, y, size, resolveMaskOptions(size, options));
  return { dx: warpDx, dy: warpDy };
}

/**
 * 지형 signed distance (해석된 옵션 버전 — 픽셀 루프에서 이걸 쓴다).
 * **양수 = 오버레이 내부**, 음수 = 베이스, 0 = 경계선.
 *
 * 구성:
 *  1) 베이스인 변마다 인셋 k만큼 들어온 반평면으로 오버레이를 제한 → 라운드 박스
 *  2) 인접 두 변이 모두 오버레이인데 대각이 베이스면 그 코너에서 반경 k 원판을 뺀다 (오목)
 */
export function terrainSDFResolved(
  signature: number,
  x: number,
  y: number,
  size: number,
  o: ResolvedMaskOptions
): number {
  const k = o.k;
  // 제약 없는 방향은 타일 밖으로 충분히 밀어 코너 라운딩에 잡히지 않게 한다
  const FAR = size * 4;

  const xmin = signature & NEIGHBOR.W ? -FAR : k;
  const xmax = signature & NEIGHBOR.E ? size + FAR : size - k;
  const ymin = signature & NEIGHBOR.N ? -FAR : k;
  const ymax = signature & NEIGHBOR.S ? size + FAR : size - k;

  // 라운드 박스 SDF (내부 양수). 실제 코너(양쪽 변이 모두 베이스)에서만 라운딩이 보인다
  const r = Math.min(k * o.cornerRoundRatio, (xmax - xmin) / 2, (ymax - ymin) / 2);
  const cx = (xmin + xmax) / 2;
  const cy = (ymin + ymax) / 2;
  const hx = (xmax - xmin) / 2 - r;
  const hy = (ymax - ymin) / 2 - r;
  const qx = Math.abs(x - cx) - hx;
  const qy = Math.abs(y - cy) - hy;
  const mx = qx > 0 ? qx : 0;
  const my = qy > 0 ? qy : 0;
  const outside = Math.sqrt(mx * mx + my * my);
  const inside = Math.min(qx > qy ? qx : qy, 0);
  let d = -(outside + inside - r); // 내부 양수로 부호 반전

  // 오목 코너: 인접 두 변 오버레이 + 대각 베이스 → 그 타일 모서리에서 반경 k 원판 제거.
  // 반경은 반드시 k여야 한다 (계약: 변이 갈리는 위치가 정규 상수 k).
  // 배열 리터럴을 만들지 않고 네 코너를 직접 전개한다 (핫 패스).
  if (signature & NEIGHBOR.N) {
    if ((signature & NEIGHBOR.W) && !(signature & NEIGHBOR.NW)) {
      const dc = Math.sqrt(x * x + y * y) - k;
      if (dc < d) d = dc;
    }
    if ((signature & NEIGHBOR.E) && !(signature & NEIGHBOR.NE)) {
      const ex = x - size;
      const dc = Math.sqrt(ex * ex + y * y) - k;
      if (dc < d) d = dc;
    }
  }
  if (signature & NEIGHBOR.S) {
    const sy = y - size;
    if ((signature & NEIGHBOR.W) && !(signature & NEIGHBOR.SW)) {
      const dc = Math.sqrt(x * x + sy * sy) - k;
      if (dc < d) d = dc;
    }
    if ((signature & NEIGHBOR.E) && !(signature & NEIGHBOR.SE)) {
      const ex = x - size;
      const dc = Math.sqrt(ex * ex + sy * sy) - k;
      if (dc < d) d = dc;
    }
  }

  return d;
}

/** 편의 래퍼 — 루프 밖에서 한두 번 쓸 때만 사용할 것 */
export function terrainSDF(
  signature: number,
  x: number,
  y: number,
  size: number,
  options?: TerrainMaskOptions
): number {
  return terrainSDFResolved(signature, x, y, size, resolveMaskOptions(size, options));
}

/** warp를 적용한 지형 SDF (해석된 옵션 버전 — 픽셀 루프에서 이걸 쓴다) */
export function warpedTerrainSDFResolved(
  signature: number,
  x: number,
  y: number,
  size: number,
  o: ResolvedMaskOptions
): number {
  computeWarp(x, y, size, o);
  return terrainSDFResolved(signature, x + warpDx, y + warpDy, size, o);
}

/** 편의 래퍼 — 루프 밖에서 한두 번 쓸 때만 사용할 것 */
export function warpedTerrainSDF(
  signature: number,
  x: number,
  y: number,
  size: number,
  options?: TerrainMaskOptions
): number {
  return warpedTerrainSDFResolved(signature, x, y, size, resolveMaskOptions(size, options));
}

/**
 * signature에 대응하는 지형 마스크를 만든다.
 * 알파 255 = 오버레이, 0 = 베이스. 경계는 1px 안티에일리어싱.
 */
export function buildTerrainMask(
  signature: number,
  size: number,
  options?: TerrainMaskOptions
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context를 생성할 수 없습니다');

  const o = resolveMaskOptions(size, options);
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // 픽셀 중심에서 평가
      const d = warpedTerrainSDFResolved(signature, x + 0.5, y + 0.5, size, o);
      // d를 -0.5~+0.5 구간에서 0~255로 매핑 (안티에일리어싱)
      const a = Math.round(Math.max(0, Math.min(1, d + 0.5)) * 255);
      const i = (y * size + x) * 4;
      img.data[i] = 255;
      img.data[i + 1] = 255;
      img.data[i + 2] = 255;
      img.data[i + 3] = a;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** 타일 변 식별자 */
export type TileSide = 'N' | 'E' | 'S' | 'W';

/**
 * 지정한 변을 따라가며 지형 판정을 뽑는다 (true = 오버레이).
 * 계약 검증용 — 인접 두 타일의 공유 변 프로파일이 같아야 한다.
 *
 * 변 위의 픽셀 중심에서 평가한다. warp는 변에서 0이므로 결과는 순수 기하값이다.
 */
export function borderTerrainProfile(
  signature: number,
  side: TileSide,
  size: number,
  options?: TerrainMaskOptions
): boolean[] {
  const o = resolveMaskOptions(size, options);
  const out: boolean[] = [];
  for (let i = 0; i < size; i++) {
    const t = i + 0.5;
    let x: number;
    let y: number;
    switch (side) {
      case 'N': x = t; y = 0.5; break;
      case 'S': x = t; y = size - 0.5; break;
      case 'W': x = 0.5; y = t; break;
      case 'E': x = size - 0.5; y = t; break;
    }
    out.push(warpedTerrainSDFResolved(signature, x, y, size, o) > 0);
  }
  return out;
}

/**
 * 맵 격자(오버레이 여부 2차원 배열)에서 한 셀의 8비트 signature를 계산한다.
 * 격자 밖은 베이스로 취급한다.
 */
export function signatureFromMap(
  isOverlay: (row: number, col: number) => boolean,
  row: number,
  col: number
): number {
  let sig = 0;
  if (isOverlay(row - 1, col)) sig |= NEIGHBOR.N;
  if (isOverlay(row - 1, col + 1)) sig |= NEIGHBOR.NE;
  if (isOverlay(row, col + 1)) sig |= NEIGHBOR.E;
  if (isOverlay(row + 1, col + 1)) sig |= NEIGHBOR.SE;
  if (isOverlay(row + 1, col)) sig |= NEIGHBOR.S;
  if (isOverlay(row + 1, col - 1)) sig |= NEIGHBOR.SW;
  if (isOverlay(row, col - 1)) sig |= NEIGHBOR.W;
  if (isOverlay(row - 1, col - 1)) sig |= NEIGHBOR.NW;
  return sig;
}
