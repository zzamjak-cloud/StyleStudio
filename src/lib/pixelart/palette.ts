/**
 * 팔레트 양자화 (최원점 초기화 + k-means).
 *
 * 픽셀아트는 "제한된 팔레트"가 미학의 핵심이다. AI 생성물은 눈으로는 몇 색처럼 보여도
 * 실제로는 수천~수만 색을 쓰기 때문에, 셀 대표색을 뽑은 뒤에도 비슷비슷한 색이 잔뜩 남는다.
 * 이 모듈은 그 색들을 K색으로 줄이고 각 색을 팔레트 최근접 색으로 스냅한다.
 *
 * 오차확산(디더링)은 의도적으로 구현하지 않는다 — 디더링은 구세대 표현이며,
 * 이 앱의 픽셀아트 프롬프트도 디더링을 금지하고 있다(lib/prompts/sessionPrompts.ts).
 */

/** RGB 색상 + 등장 횟수 */
export interface WeightedColor {
  r: number;
  g: number;
  b: number;
  count: number;
}

/** 팔레트 = RGB 삼원색 배열 */
export type Palette = Array<[number, number, number]>;

/** 자동 색 수 산정 시 허용 범위 */
const AUTO_PALETTE_MIN = 8;
const AUTO_PALETTE_MAX = 64;
/** 자동 산정 기준: 상위 색들이 전체 픽셀의 이 비율을 덮을 때까지 */
const AUTO_COVERAGE = 0.95;
/**
 * 지각적으로 같은 색으로 볼 거리 문턱 (가중 유클리드 제곱거리).
 * 채널당 약 ±10 차이까지 한 색으로 묶는다 — AI 생성물의 블록 내부 색 흔들림 폭.
 */
const CLUSTER_DISTANCE = 2 * 10 * 10 + 4 * 10 * 10 + 3 * 10 * 10;

/**
 * 사람 눈의 채널 민감도를 반영한 가중 유클리드 제곱거리 (2:4:3).
 * 단순 RGB 거리는 초록 계열이 뭉치는 경향이 있다. 제곱근을 씌우지 않는다 —
 * 비교에만 쓰므로 단조성이면 충분하고, sqrt 비용은 픽셀 수만큼 곱해진다.
 */
function weightedDistance(
  r1: number, g1: number, b1: number,
  r2: number, g2: number, b2: number
): number {
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return 2 * dr * dr + 4 * dg * dg + 3 * db * db;
}

/**
 * 색 히스토그램에서 자동 팔레트 크기를 산정한다.
 *
 * 고정 격자 버킷으로 세면 안 된다: 노이즈가 있는 색은 버킷 경계를 걸쳐 한 색이
 * 여러 버킷으로 갈라지고(실측 8색 이미지가 37버킷), 산정값이 부풀려진다.
 * 대신 등장 횟수 내림차순으로 **거리 문턱 기반 그리디 클러스터링**을 해서
 * 지각적으로 같은 색을 하나로 묶고, 상위 클러스터가 전체의 AUTO_COVERAGE(95%)를
 * 덮는 데 필요한 개수를 센다.
 *
 * @param colors 가중 색상 목록
 * @returns 8~64 범위로 clamp된 팔레트 크기
 */
export function estimatePaletteSize(colors: WeightedColor[]): number {
  const total = colors.reduce((sum, c) => sum + c.count, 0);
  if (total === 0) return AUTO_PALETTE_MIN;

  // 빈도 높은 색이 클러스터 중심을 잡도록 내림차순으로 처리
  const sorted = [...colors].sort((a, b) => b.count - a.count);
  const clusters: Array<{ r: number; g: number; b: number; count: number }> = [];

  for (const color of sorted) {
    let merged = false;
    for (const cluster of clusters) {
      if (weightedDistance(color.r, color.g, color.b, cluster.r, cluster.g, cluster.b) <= CLUSTER_DISTANCE) {
        cluster.count += color.count;
        merged = true;
        break;
      }
    }
    if (!merged) {
      clusters.push({ r: color.r, g: color.g, b: color.b, count: color.count });
    }
  }

  const weights = clusters.map((c) => c.count).sort((a, b) => b - a);
  const threshold = total * AUTO_COVERAGE;

  let cumulative = 0;
  let k = 0;
  for (const weight of weights) {
    cumulative += weight;
    k += 1;
    if (cumulative >= threshold) break;
  }

  return Math.max(AUTO_PALETTE_MIN, Math.min(AUTO_PALETTE_MAX, k));
}

/** k-means 보정 반복 횟수 — 8회면 실측상 수렴한다 */
const REFINE_ITERATIONS = 8;

/**
 * 초기 팔레트를 k-means(Lloyd)로 보정한다.
 *
 * 초기값은 실제 이미지에 있는 색을 그대로 집은 것이므로 클러스터 중심과는 다르다.
 * 몇 번 재배치하면 각 중심이 자신이 담당하는 색 무리의 무게중심으로 이동해,
 * 스냅 오차가 눈에 띄게 줄어든다.
 */
function refinePalette(colors: WeightedColor[], initial: Palette): Palette {
  let palette = initial;

  for (let iteration = 0; iteration < REFINE_ITERATIONS; iteration++) {
    const sums = palette.map(() => ({ r: 0, g: 0, b: 0, w: 0 }));

    for (const color of colors) {
      const index = nearestColorIndex(palette, color.r, color.g, color.b);
      const slot = sums[index];
      slot.r += color.r * color.count;
      slot.g += color.g * color.count;
      slot.b += color.b * color.count;
      slot.w += color.count;
    }

    let moved = false;
    const next: Palette = palette.map((entry, i) => {
      const slot = sums[i];
      // 아무 색도 배정되지 않은 중심은 그대로 둔다 (팔레트 크기를 유지)
      if (slot.w === 0) return entry;
      const candidate: [number, number, number] = [
        Math.round(slot.r / slot.w),
        Math.round(slot.g / slot.w),
        Math.round(slot.b / slot.w),
      ];
      if (candidate[0] !== entry[0] || candidate[1] !== entry[1] || candidate[2] !== entry[2]) {
        moved = true;
      }
      return candidate;
    });

    palette = next;
    if (!moved) break; // 수렴
  }

  return palette;
}

/**
 * 빈도 가중 최원점(maximin) 초기화.
 *
 * median-cut을 쓰지 않는 이유: 균등 인구 분할은 색 클러스터 경계를 존중하지 않아
 * 인접한 두 색을 한 박스에 병합하고 다른 색을 둘로 쪼개는 초기값을 자주 만든다.
 * k-means는 그 지역해에서 빠져나오지 못한다(실측: 8색 이미지에서 빨강이 둘로 갈라지고
 * 어두운색과 갈색이 하나로 합쳐져 26%의 픽셀이 엉뚱한 색으로 스냅됐다).
 *
 * 대신 이미 고른 중심들로부터 **가장 멀고 동시에 빈도가 높은** 색을 차례로 중심으로
 * 삼는다(점수 = count x 최근접거리제곱). 순수 최원점은 노이즈성 외곽 색을 집지만,
 * 빈도를 곱하면 화면을 실제로 차지하는 색이 선택된다. 난수를 쓰지 않아 결정론적이다.
 */
function seedPalette(colors: WeightedColor[], targetSize: number): Palette {
  // 첫 중심: 가장 많이 쓰인 색
  let seed = colors[0];
  for (const color of colors) {
    if (color.count > seed.count) seed = color;
  }

  const palette: Palette = [[seed.r, seed.g, seed.b]];
  // 각 색의 "가장 가까운 중심까지 거리제곱" 캐시 — 중심을 추가할 때만 갱신한다
  const nearestDistance = colors.map((c) => weightedDistance(c.r, c.g, c.b, seed.r, seed.g, seed.b));

  while (palette.length < targetSize) {
    let bestIndex = -1;
    let bestScore = -1;

    for (let i = 0; i < colors.length; i++) {
      const score = colors[i].count * nearestDistance[i];
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }

    // 남은 색이 모두 기존 중심과 동일하면(거리 0) 더 고를 것이 없다
    if (bestIndex === -1 || bestScore <= 0) break;

    const picked = colors[bestIndex];
    palette.push([picked.r, picked.g, picked.b]);

    for (let i = 0; i < colors.length; i++) {
      const distance = weightedDistance(colors[i].r, colors[i].g, colors[i].b, picked.r, picked.g, picked.b);
      if (distance < nearestDistance[i]) nearestDistance[i] = distance;
    }
  }

  return palette;
}

/**
 * 최원점 초기화 + k-means 보정으로 K색 팔레트를 만든다.
 *
 * 색 수가 이미 K 이하면 있는 색을 그대로 팔레트로 쓴다(불필요한 색 이동 방지).
 *
 * @param colors 가중 색상 목록
 * @param targetSize 목표 색 수
 * @returns 최대 targetSize개의 팔레트
 */
export function buildPalette(colors: WeightedColor[], targetSize: number): Palette {
  if (colors.length === 0) return [];
  if (colors.length <= targetSize) {
    return colors.map((c) => [c.r, c.g, c.b] as [number, number, number]);
  }

  return refinePalette(colors, seedPalette(colors, targetSize));
}

/**
 * 팔레트에서 가장 가까운 색의 인덱스를 찾는다.
 *
 * 사람 눈의 채널 민감도를 반영한 가중 유클리드 거리(2:4:3)를 쓴다 —
 * 단순 RGB 거리는 초록 계열이 뭉치는 경향이 있다.
 */
export function nearestColorIndex(palette: Palette, r: number, g: number, b: number): number {
  let bestIndex = 0;
  let bestDistance = Infinity;

  for (let i = 0; i < palette.length; i++) {
    const [pr, pg, pb] = palette[i];
    const distance = weightedDistance(r, g, b, pr, pg, pb);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i;
    }
  }

  return bestIndex;
}
