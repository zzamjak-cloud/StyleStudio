import { loadImageElement } from './tileSlicer';

// 경계 스트립 두께(px)와 변당 색 샘플 수 — 휴리스틱 상수
const EDGE_STRIP_PX = 4;
const EDGE_SAMPLES = 32;
// 8x8(64타일)에서 전수 쌍 계산 폭주 방지: 타일당 비교 상대 샘플 상한
const MAX_PARTNERS_PER_TILE = 16;
// 평균 절대 색차(0~255)를 0~100 점수로 매핑할 때의 최악 기준값
// (색차 0 → 100점, 색차 SEAM_ENERGY_WORST 이상 → 0점)
const SEAM_ENERGY_WORST = 64;

/** 타일 한 장의 4변 경계 색 프로파일: 변마다 EDGE_SAMPLES개의 [r,g,b] 평균색 */
interface EdgeProfile {
  top: number[][];
  bottom: number[][];
  left: number[][];
  right: number[][];
}

/** 타일 이미지에서 4변 경계 스트립의 평균색 프로파일 추출 */
async function extractEdgeProfile(tileDataUrl: string): Promise<EdgeProfile> {
  const img = await loadImageElement(tileDataUrl);
  const size = Math.min(img.width, img.height);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('canvas 2d context를 생성할 수 없습니다');
  ctx.drawImage(img, 0, 0, size, size);
  const data = ctx.getImageData(0, 0, size, size).data;

  // (x, y)의 RGB 반환
  const px = (x: number, y: number): [number, number, number] => {
    const i = (y * size + x) * 4;
    return [data[i], data[i + 1], data[i + 2]];
  };

  // 한 변을 따라 EDGE_SAMPLES개 지점에서, 스트립 두께 방향으로 평균한 색을 수집
  const sampleEdge = (
    along: (t: number) => [number, number, number][] // t(0~1) 지점의 스트립 픽셀들
  ): number[][] => {
    const samples: number[][] = [];
    for (let s = 0; s < EDGE_SAMPLES; s++) {
      const t = (s + 0.5) / EDGE_SAMPLES;
      const strip = along(t);
      let r = 0, g = 0, b = 0;
      for (const [pr, pg, pb] of strip) { r += pr; g += pg; b += pb; }
      samples.push([r / strip.length, g / strip.length, b / strip.length]);
    }
    return samples;
  };

  const strip = Math.min(EDGE_STRIP_PX, size);
  const coord = (t: number) => Math.min(size - 1, Math.floor(t * size));

  return {
    top: sampleEdge((t) => Array.from({ length: strip }, (_, d) => px(coord(t), d))),
    bottom: sampleEdge((t) => Array.from({ length: strip }, (_, d) => px(coord(t), size - 1 - d))),
    left: sampleEdge((t) => Array.from({ length: strip }, (_, d) => px(d, coord(t)))),
    right: sampleEdge((t) => Array.from({ length: strip }, (_, d) => px(size - 1 - d, coord(t)))),
  };
}

/** 두 경계 프로파일이 맞닿았을 때의 seam 에너지 = 샘플별 RGB 평균 절대차 (0~255) */
function seamEnergy(a: number[][], b: number[][]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += Math.abs(a[i][0] - b[i][0]) + Math.abs(a[i][1] - b[i][1]) + Math.abs(a[i][2] - b[i][2]);
  }
  return sum / (a.length * 3);
}

/**
 * 변형 타일 세트의 타일별 이음새 점수(0~100)를 계산한다.
 * "임의 두 타일이 이웃해도 이어져야 한다"는 요구에 따라, 각 타일의 4변을
 * 다른 타일들의 반대편 변과 쌍별 비교한 평균 에너지를 점수로 환산한다.
 * (64타일은 타일당 MAX_PARTNERS_PER_TILE개 상대만 균등 샘플링)
 */
export async function computeSeamScores(tiles: string[]): Promise<number[]> {
  const profiles = await Promise.all(tiles.map(extractEdgeProfile));
  const n = profiles.length;

  return profiles.map((p, i) => {
    // 비교 상대 균등 샘플링 (자기 자신 제외)
    const step = Math.max(1, Math.floor(n / MAX_PARTNERS_PER_TILE));
    let total = 0;
    let count = 0;
    for (let j = 0; j < n; j += step) {
      if (j === i) continue;
      const q = profiles[j];
      // 수평 이웃(내 오른쪽 ↔ 상대 왼쪽, 내 왼쪽 ↔ 상대 오른쪽)
      total += seamEnergy(p.right, q.left) + seamEnergy(p.left, q.right);
      // 수직 이웃(내 아래 ↔ 상대 위, 내 위 ↔ 상대 아래)
      total += seamEnergy(p.bottom, q.top) + seamEnergy(p.top, q.bottom);
      count += 4;
    }
    if (count === 0) return 100;
    const energy = total / count;
    return Math.max(0, Math.round(100 - (energy / SEAM_ENERGY_WORST) * 100));
  });
}
