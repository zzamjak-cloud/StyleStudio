/**
 * 픽셀 정규화 (pixelation).
 *
 * AI는 1024px 캔버스에 "픽셀아트처럼 보이는" 그림을 그린다. 확대해 보면
 * ① 블록 경계가 1~2px 흐리고 ② 블록 안에서도 색이 미세하게 변하며
 * ③ 블록 격자가 이미지 전체에 일정하게 정렬돼 있지 않다.
 * 프롬프트로는 이 세 개를 잡을 수 없어, 생성 후 결정론적으로 재구성한다.
 *
 * 파이프라인:
 *   1) 논리 해상도 결정 — 그리드 세션은 계산으로 확정, 1x1은 격자 자동 감지
 *   2) 셀 대표색 추출 — 코어 영역 최빈색 (평균은 흐린 경계를 섞어 없던 색을 만든다)
 *   3) 팔레트 양자화 — median-cut K색으로 스냅 (디더링 없음)
 *   4) 정수배 Nearest-Neighbor 업스케일 (lib/pixelArtUpscaler.ts)
 *
 * 1~3단계는 canvas에 의존하지 않는 순수 함수다 — 브라우저 없이 검증할 수 있다.
 * canvas 입출력은 pixelateDataUrl(파일 하단)에서만 다룬다.
 */

import { PixelArtGridLayout, getPixelArtGridInfo } from '../../types/pixelart';
import { upscalePixelArt } from '../pixelArtUpscaler';
import {
  Palette,
  WeightedColor,
  buildPalette,
  estimatePaletteSize,
  nearestColorIndex,
} from './palette';

/** canvas에 의존하지 않는 RGBA 이미지 표현 */
export interface RgbaImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** 격자 추정 결과 */
export interface GridEstimate {
  /** 논리 픽셀 하나가 차지하는 원본 px (실수 — 1024/96처럼 나누어떨어지지 않는 경우가 많다) */
  cellSize: number;
  /** 가로 논리 픽셀 수 */
  cols: number;
  /** 세로 논리 픽셀 수 */
  rows: number;
  /** 격자 시작 위상 (원본 px) */
  offsetX: number;
  offsetY: number;
  /** 격자 정합 점수 (1.0 = 무작위, 클수록 격자에 에지가 몰려 있다) */
  score: number;
}

/**
 * 1x1 자동 감지 후보 논리 해상도.
 * 게임 스프라이트/배경에서 실제로 쓰이는 크기만 둔다 — 후보를 늘리면 오검출이 늘어난다.
 */
export const CANDIDATE_LOGICAL_SIZES = [32, 40, 48, 64, 80, 96, 128, 160, 192, 256];

/** 셀 코어 비율 — 셀 중앙 60%만 대표색 계산에 쓴다(경계 흐림 배제) */
const CORE_RATIO = 0.6;
/** 최빈색 집계용 채널 양자화 단계 (5bit = 32단계) */
const MODE_BUCKET_SHIFT = 3;
/** 알파 이진화 임계값 — 픽셀아트는 반투명 경계를 쓰지 않는다 */
const ALPHA_THRESHOLD = 128;
/** 논리 픽셀 하나가 최소 이만큼의 원본 px를 차지해야 정규화 의미가 있다 */
const MIN_CELL_SIZE = 2;

/**
 * 휘도 (격자 감지용 — 정확한 색이 아니라 경계 세기만 필요하다)
 */
function luminance(data: Uint8ClampedArray, index: number): number {
  return 0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2];
}

/**
 * 열 경계별 에지 세기 프로파일.
 * profile[x] = x-1열과 x열 사이의 휘도 차이 총합 (x = 1..width-1)
 */
function columnEdgeProfile(img: RgbaImage): Float64Array {
  const { data, width, height } = img;
  const profile = new Float64Array(width);
  for (let x = 1; x < width; x++) {
    let sum = 0;
    for (let y = 0; y < height; y++) {
      const index = (y * width + x) * 4;
      sum += Math.abs(luminance(data, index) - luminance(data, index - 4));
    }
    profile[x] = sum;
  }
  return profile;
}

/**
 * 행 경계별 에지 세기 프로파일.
 */
function rowEdgeProfile(img: RgbaImage): Float64Array {
  const { data, width, height } = img;
  const profile = new Float64Array(height);
  const rowStride = width * 4;
  for (let y = 1; y < height; y++) {
    let sum = 0;
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      sum += Math.abs(luminance(data, index) - luminance(data, index - rowStride));
    }
    profile[y] = sum;
  }
  return profile;
}

/** 격자선 정합 판정 시 허용 오차 (px) — 흐린 경계는 에지가 ±1px로 번진다 */
const EDGE_TOLERANCE = 1;
/**
 * 이 아래면 격자 정합으로 인정하지 않는다 (1.0 = 무작위와 구분 불가).
 * 블록 격자가 없는 일반 이미지에 억지로 격자를 씌우는 것을 막는 하한선.
 */
const MIN_ENRICHMENT = 1.35;
/**
 * 최고 enrichment의 이 비율 이상이면 "격자에 정렬된 후보"로 본다.
 * 진짜 격자와 그 약수 격자들만 이 문턱을 넘고, 어긋난 후보는 1.0 근처로 떨어진다.
 */
const ENRICHMENT_FLOOR_RATIO = 0.7;

/**
 * 주어진 셀 크기·위상에서 "전체 에지 에너지 중 격자선 위에 놓인 비율"을 구한다.
 *
 * 커버리지를 쓰는 이유: 평균 비율(경계 평균/전체 평균)로 점수를 매기면 거친 격자가
 * 항상 이긴다. 64격자의 경계는 32격자 경계를 모두 포함하므로 32후보도 "맞는 위치"만
 * 샘플링하게 되고, 표본이 적어 분산이 커서 최댓값이 부풀려지기 때문이다.
 * 커버리지는 반대로 **놓친 에지를 벌점으로 잡는다** — 32후보는 실제 경계의 절반을
 * 격자 밖에 남기므로 커버리지가 0.5 수준으로 떨어진다.
 *
 * 다만 커버리지 단독으로도 반대 방향 편향이 있다: 셀이 4px이면 ±1 창이 전체 열의
 * 3/4를 덮어 아무 이미지에서나 커버리지가 높게 나온다. 그래서 enrichment
 * (= 커버리지 / 창이 덮는 열 비율)를 함께 돌려주고, 선택 단계에서 두 지표를 같이 쓴다.
 *
 * @returns coverage 0~1, enrichment 1.0이면 무작위와 구분 불가
 */
function gridCoverage(
  profile: Float64Array,
  length: number,
  cellSize: number,
  offset: number
): { coverage: number; enrichment: number } {
  let total = 0;
  for (let i = 1; i < length; i++) total += profile[i];
  if (total === 0) return { coverage: 0, enrichment: 0 };

  const onGrid = new Uint8Array(length);
  for (let k = 0; ; k++) {
    const position = Math.round(offset + k * cellSize);
    if (position - EDGE_TOLERANCE >= length) break;
    for (let d = -EDGE_TOLERANCE; d <= EDGE_TOLERANCE; d++) {
      const p = position + d;
      if (p >= 1 && p < length) onGrid[p] = 1;
    }
  }

  let covered = 0;
  let coveredColumns = 0;
  for (let i = 1; i < length; i++) {
    if (onGrid[i]) {
      covered += profile[i];
      coveredColumns += 1;
    }
  }

  const coverage = covered / total;
  const columnRatio = coveredColumns / (length - 1);
  return {
    coverage,
    enrichment: columnRatio > 0 ? coverage / columnRatio : 0,
  };
}

/**
 * 한 축에서 커버리지가 가장 높은 위상을 찾는다.
 */
function bestPhase(
  profile: Float64Array,
  length: number,
  cellSize: number
): { offset: number; coverage: number; enrichment: number } {
  const phaseCount = Math.max(1, Math.ceil(cellSize));
  let best = { offset: 0, coverage: -1, enrichment: 0 };

  for (let phase = 0; phase < phaseCount; phase++) {
    const { coverage, enrichment } = gridCoverage(profile, length, cellSize, phase);
    if (coverage > best.coverage) {
      best = { offset: phase, coverage, enrichment };
    }
  }

  return best;
}

/**
 * 이미지에서 픽셀 블록 격자를 추정한다 (1x1 세션용).
 *
 * 후보 논리 해상도마다 가로·세로 정합 점수를 구해 가장 높은 것을 고른다.
 * 셀 크기는 가로 기준으로 잡고, 세로 논리 픽셀 수는 같은 셀 크기로 환산한다
 * (픽셀아트의 픽셀은 정사각이다).
 *
 * @param img 원본 이미지
 * @param candidates 후보 논리 해상도 (기본 CANDIDATE_LOGICAL_SIZES)
 */
/** 후보 평가 결과 (진단·테스트용으로 공개한다) */
export interface GridCandidateEvaluation extends GridEstimate {
  /** 격자선 위에 놓인 에지 에너지 비율 */
  coverage: number;
  /** coverage / (격자 창이 덮는 열 비율) — 1.0이면 무작위와 구분 불가 */
  enrichment: number;
}

/**
 * 후보 논리 해상도별 격자 정합 지표를 계산한다.
 */
export function evaluateGridCandidates(
  img: RgbaImage,
  candidates: number[] = CANDIDATE_LOGICAL_SIZES
): GridCandidateEvaluation[] {
  const colProfile = columnEdgeProfile(img);
  const rowProfile = rowEdgeProfile(img);

  const evaluated: GridCandidateEvaluation[] = [];
  for (const logicalWidth of [...candidates].sort((a, b) => a - b)) {
    const cellSize = img.width / logicalWidth;
    if (cellSize < MIN_CELL_SIZE) continue;

    const x = bestPhase(colProfile, img.width, cellSize);
    const y = bestPhase(rowProfile, img.height, cellSize);

    evaluated.push({
      cellSize,
      cols: logicalWidth,
      rows: Math.max(1, Math.round(img.height / cellSize)),
      offsetX: x.offset,
      offsetY: y.offset,
      score: (x.enrichment + y.enrichment) / 2,
      coverage: (x.coverage + y.coverage) / 2,
      enrichment: (x.enrichment + y.enrichment) / 2,
    });
  }

  return evaluated;
}

export function estimatePixelGrid(
  img: RgbaImage,
  candidates: number[] = CANDIDATE_LOGICAL_SIZES
): GridEstimate {
  const evaluated = evaluateGridCandidates(img, candidates);

  // 두 지표를 순서대로 쓴다. 어느 하나만으로는 반드시 틀린다:
  //
  //  · enrichment 단독 → 진짜 격자의 **약수** 격자를 구분하지 못한다. 128격자 이미지에서
  //    32·64·128 후보의 격자선은 모두 진짜 경계 위에만 놓이므로 밀도가 사실상 같다
  //    (실측 2.26 / 2.25 / 2.24). 순서 탓에 가장 거친 32가 뽑힌다.
  //  · 커버리지 단독 → 블록 내부 노이즈가 모든 열에 에지를 흩뿌리기 때문에, ±1 창이 넓은
  //    세밀한 후보가 노이즈를 더 많이 주워담아 항상 이긴다(셀 4px이면 창이 열의 75%를 덮는다).
  //
  // 따라서 ① enrichment로 "격자에 정렬된 후보"만 남기고(어긋난 후보는 1.0 근처로 탈락)
  //       ② 그중 커버리지 최대 = 에지를 가장 많이 설명하는 격자를 고른다.
  //         약수 격자는 진짜 경계의 일부만 담으므로 커버리지가 명확히 낮다(0.21 / 0.42 / 0.84).
  const maxEnrichment = evaluated.reduce((max, e) => Math.max(max, e.enrichment), 0);
  let best: GridEstimate | null = null;
  if (maxEnrichment >= MIN_ENRICHMENT) {
    const floor = maxEnrichment * ENRICHMENT_FLOOR_RATIO;
    let bestCoverage = -1;
    for (const candidate of evaluated) {
      if (candidate.enrichment < floor) continue;
      if (candidate.coverage > bestCoverage) {
        bestCoverage = candidate.coverage;
        best = candidate;
      }
    }
  }

  // 정합되는 격자가 없다(이미 저해상도이거나 픽셀아트가 아니다) — 원본을 논리 해상도로 취급
  if (!best) {
    return {
      cellSize: 1,
      cols: img.width,
      rows: img.height,
      offsetX: 0,
      offsetY: 0,
      score: 0,
    };
  }

  return best;
}

/**
 * 셀 하나의 대표색을 코어 영역 최빈색으로 뽑는다.
 *
 * 평균을 쓰지 않는 이유: 블록 경계의 흐린 픽셀이 섞여 원본에 없던 중간색이 생긴다.
 * 이게 바로 "확대하면 뭉개진 컬러"의 정체다. 최빈 버킷에 속한 픽셀들만 평균해
 * 버킷 대표색을 정밀화한다.
 *
 * @returns [r, g, b, a] — 불투명 픽셀이 없으면 알파 0
 */
function cellRepresentativeColor(
  img: RgbaImage,
  startX: number,
  startY: number,
  endX: number,
  endY: number
): [number, number, number, number] {
  const { data, width } = img;

  // 코어 영역 (셀 중앙 CORE_RATIO) — 최소 1px은 보장
  const cellWidth = endX - startX;
  const cellHeight = endY - startY;
  const insetX = Math.floor((cellWidth * (1 - CORE_RATIO)) / 2);
  const insetY = Math.floor((cellHeight * (1 - CORE_RATIO)) / 2);
  const coreStartX = cellWidth > 2 ? startX + insetX : startX;
  const coreStartY = cellHeight > 2 ? startY + insetY : startY;
  const coreEndX = cellWidth > 2 ? Math.max(coreStartX + 1, endX - insetX) : endX;
  const coreEndY = cellHeight > 2 ? Math.max(coreStartY + 1, endY - insetY) : endY;

  // 버킷별 집계: 키 = 5bit RGB
  const buckets = new Map<number, { count: number; r: number; g: number; b: number }>();
  let opaqueCount = 0;
  let totalCount = 0;

  for (let y = coreStartY; y < coreEndY; y++) {
    for (let x = coreStartX; x < coreEndX; x++) {
      const index = (y * width + x) * 4;
      totalCount += 1;

      // 투명 픽셀은 색 집계에서 제외 (배경색이 대표색을 오염시키지 않게)
      if (data[index + 3] < ALPHA_THRESHOLD) continue;
      opaqueCount += 1;

      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];
      const key =
        ((r >> MODE_BUCKET_SHIFT) << 10) |
        ((g >> MODE_BUCKET_SHIFT) << 5) |
        (b >> MODE_BUCKET_SHIFT);

      const bucket = buckets.get(key);
      if (bucket) {
        bucket.count += 1;
        bucket.r += r;
        bucket.g += g;
        bucket.b += b;
      } else {
        buckets.set(key, { count: 1, r, g, b });
      }
    }
  }

  // 셀 과반이 투명하면 투명 픽셀로 확정 (알파 이진화)
  if (totalCount === 0 || opaqueCount * 2 < totalCount) {
    return [0, 0, 0, 0];
  }

  let bestBucket: { count: number; r: number; g: number; b: number } | null = null;
  for (const bucket of buckets.values()) {
    if (!bestBucket || bucket.count > bestBucket.count) bestBucket = bucket;
  }
  if (!bestBucket) return [0, 0, 0, 0];

  return [
    Math.round(bestBucket.r / bestBucket.count),
    Math.round(bestBucket.g / bestBucket.count),
    Math.round(bestBucket.b / bestBucket.count),
    255,
  ];
}

/**
 * 격자 정보로 원본을 논리 해상도 이미지로 다운샘플한다.
 *
 * @param img 원본 이미지
 * @param grid 격자 추정/계산 결과
 * @returns cols x rows 크기의 논리 이미지
 */
export function downsampleToLogical(img: RgbaImage, grid: GridEstimate): RgbaImage {
  const { cols, rows, cellSize, offsetX, offsetY } = grid;
  const out = new Uint8ClampedArray(cols * rows * 4);

  for (let ry = 0; ry < rows; ry++) {
    // 격자 위상을 반영한 셀 경계. 이미지 밖으로 나가지 않도록 clamp한다.
    const startY = Math.max(0, Math.min(img.height - 1, Math.round(offsetY + ry * cellSize)));
    const endY = Math.max(startY + 1, Math.min(img.height, Math.round(offsetY + (ry + 1) * cellSize)));

    for (let rx = 0; rx < cols; rx++) {
      const startX = Math.max(0, Math.min(img.width - 1, Math.round(offsetX + rx * cellSize)));
      const endX = Math.max(startX + 1, Math.min(img.width, Math.round(offsetX + (rx + 1) * cellSize)));

      const [r, g, b, a] = cellRepresentativeColor(img, startX, startY, endX, endY);
      const outIndex = (ry * cols + rx) * 4;
      out[outIndex] = r;
      out[outIndex + 1] = g;
      out[outIndex + 2] = b;
      out[outIndex + 3] = a;
    }
  }

  return { data: out, width: cols, height: rows };
}

/**
 * 논리 이미지의 색 히스토그램을 만든다 (불투명 픽셀만).
 */
function collectColors(img: RgbaImage): WeightedColor[] {
  const map = new Map<number, WeightedColor>();

  for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i + 3] < ALPHA_THRESHOLD) continue;
    const r = img.data[i];
    const g = img.data[i + 1];
    const b = img.data[i + 2];
    const key = (r << 16) | (g << 8) | b;
    const existing = map.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      map.set(key, { r, g, b, count: 1 });
    }
  }

  return [...map.values()];
}

/**
 * 논리 이미지를 팔레트에 스냅한다 (제자리 변경 없이 새 이미지 반환).
 */
export function quantizeToPalette(img: RgbaImage, palette: Palette): RgbaImage {
  if (palette.length === 0) return img;

  const out = new Uint8ClampedArray(img.data);
  // 같은 색이 반복되므로 조회 결과를 캐시한다 (논리 픽셀 수만큼 최근접 탐색을 반복하지 않게)
  const cache = new Map<number, number>();

  for (let i = 0; i < out.length; i += 4) {
    if (out[i + 3] < ALPHA_THRESHOLD) continue;
    const r = out[i];
    const g = out[i + 1];
    const b = out[i + 2];
    const key = (r << 16) | (g << 8) | b;

    let paletteIndex = cache.get(key);
    if (paletteIndex === undefined) {
      paletteIndex = nearestColorIndex(palette, r, g, b);
      cache.set(key, paletteIndex);
    }

    const [pr, pg, pb] = palette[paletteIndex];
    out[i] = pr;
    out[i + 1] = pg;
    out[i + 2] = pb;
  }

  return { data: out, width: img.width, height: img.height };
}

/** 팔레트 색 수 설정 — 'auto'는 히스토그램에서 산정 */
export type PaletteSizeOption = 'auto' | 8 | 16 | 32 | 48;
/** 논리 해상도 설정 — 'auto'는 격자 자동 감지(1x1) 또는 그리드 권장값 */
export type PixelateSizeOption = 'auto' | 32 | 64 | 128;

export interface PixelateOptions {
  /** 논리 해상도 (1x1은 이미지 전체, 그리드 세션은 프레임당) */
  size?: PixelateSizeOption;
  /** 팔레트 색 수 */
  paletteSize?: PaletteSizeOption;
  /** 스프라이트 그리드 레이아웃 — 있으면 격자를 계산으로 확정한다 */
  grid?: PixelArtGridLayout;
}

/** 정규화 결과 메타데이터 */
export interface PixelateResult {
  /** 논리 해상도 이미지 (게임 엔진에 그대로 넣을 수 있는 크기) */
  logical: RgbaImage;
  /** 실제 사용된 팔레트 */
  palette: Palette;
  /** 격자 정보 */
  grid: GridEstimate;
}

/**
 * 논리 해상도를 결정한다.
 *
 * 그리드 세션(2x2~8x8)은 자동 감지를 쓰지 않는다 — 프레임 경계가 픽셀 격자에
 * 정확히 맞아야 스프라이트 시트 분리가 깨지지 않기 때문에, rows/cols에서 계산으로 확정한다.
 */
function resolveGrid(img: RgbaImage, options: PixelateOptions): GridEstimate {
  const { size = 'auto', grid } = options;

  if (grid && grid !== '1x1') {
    const info = getPixelArtGridInfo(grid);
    const perFrame = size === 'auto' ? info.recommendedPixelSize : size;
    const cols = info.cols * perFrame;
    const rows = info.rows * perFrame;
    const cellSize = img.width / cols;

    // 셀이 너무 작으면(=거의 원본 해상도) 정규화 효과가 없다 → 권장값으로 되돌린다
    if (cellSize < MIN_CELL_SIZE) {
      const fallbackCols = info.cols * info.recommendedPixelSize;
      const fallbackRows = info.rows * info.recommendedPixelSize;
      return {
        cellSize: img.width / fallbackCols,
        cols: fallbackCols,
        rows: fallbackRows,
        offsetX: 0,
        offsetY: 0,
        score: 0,
      };
    }

    return { cellSize, cols, rows, offsetX: 0, offsetY: 0, score: 0 };
  }

  // 1x1: 사용자가 해상도를 지정했으면 그 값으로, 아니면 격자 자동 감지
  if (size !== 'auto') {
    const cellSize = img.width / size;
    if (cellSize >= MIN_CELL_SIZE) {
      // 위상만 자동으로 맞춘다 — 크기를 알아도 격자 시작점은 이미지마다 다르다
      const colProfile = columnEdgeProfile(img);
      const rowProfile = rowEdgeProfile(img);
      const x = bestPhase(colProfile, img.width, cellSize);
      const y = bestPhase(rowProfile, img.height, cellSize);
      return {
        cellSize,
        cols: size,
        rows: Math.max(1, Math.round(img.height / cellSize)),
        offsetX: x.offset,
        offsetY: y.offset,
        score: (x.coverage + y.coverage) / 2,
      };
    }
  }

  return estimatePixelGrid(img);
}

/**
 * 픽셀 정규화 본체 (1~3단계). canvas에 의존하지 않는다.
 *
 * @param img 원본 RGBA 이미지
 * @param options 정규화 옵션
 */
export function pixelateRgba(img: RgbaImage, options: PixelateOptions = {}): PixelateResult {
  const grid = resolveGrid(img, options);
  const logical = downsampleToLogical(img, grid);

  const colors = collectColors(logical);
  const targetSize =
    options.paletteSize === undefined || options.paletteSize === 'auto'
      ? estimatePaletteSize(colors)
      : options.paletteSize;
  const palette = buildPalette(colors, targetSize);

  return {
    logical: quantizeToPalette(logical, palette),
    palette,
    grid,
  };
}

// ============================================
// canvas 경계 — 여기서만 브라우저 API를 쓴다
// ============================================

/**
 * data URL을 RGBA 이미지로 읽는다.
 */
function loadRgbaImage(dataUrl: string): Promise<RgbaImage> {
  return new Promise((resolve, reject) => {
    const img = new Image();

    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) throw new Error('Canvas 2D context를 가져올 수 없습니다');

        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, img.width, img.height);
        resolve({ data: imageData.data, width: img.width, height: img.height });
      } catch (error) {
        reject(error);
      }
    };

    img.onerror = () => reject(new Error('이미지 로드 실패'));
    img.src = dataUrl;
  });
}

/**
 * RGBA 이미지를 PNG data URL로 만든다.
 */
function toDataUrl(img: RgbaImage): string {
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context를 가져올 수 없습니다');

  const imageData = ctx.createImageData(img.width, img.height);
  imageData.data.set(img.data);
  ctx.putImageData(imageData, 0, 0);

  return canvas.toDataURL('image/png');
}

/** 표시·저장용 목표 크기 (원본 생성 해상도와 맞춘다) */
const DISPLAY_TARGET_SIZE = 1024;

export interface PixelateDataUrlResult {
  /** 정수배 확대본 (표시·자동저장용) */
  dataUrl: string;
  /** 논리 해상도 원본 (게임 엔진용) */
  logicalDataUrl: string;
  logicalWidth: number;
  logicalHeight: number;
  paletteSize: number;
  /** 적용된 업스케일 배율 */
  scale: number;
  /** 격자 정합 점수 (1x1 자동 감지 시 신뢰도 참고용) */
  gridScore: number;
}

/**
 * data URL을 받아 픽셀 정규화 후 정수배 확대본을 돌려준다.
 *
 * 확대는 기존 Nearest-Neighbor 유틸(lib/pixelArtUpscaler.ts)을 재사용한다 —
 * 정수배 + NN이어야 확대해도 픽셀 경계가 칼같이 떨어진다.
 *
 * @param dataUrl 원본 이미지 data URL
 * @param options 정규화 옵션
 */
export async function pixelateDataUrl(
  dataUrl: string,
  options: PixelateOptions = {}
): Promise<PixelateDataUrlResult> {
  const source = await loadRgbaImage(dataUrl);
  const { logical, palette, grid } = pixelateRgba(source, options);

  const logicalDataUrl = toDataUrl(logical);

  // 정수배만 허용 — 소수 배율은 픽셀을 다시 뭉갠다
  const longestSide = Math.max(logical.width, logical.height);
  const scale = Math.max(1, Math.floor(DISPLAY_TARGET_SIZE / longestSide));
  const upscaled = scale > 1 ? await upscalePixelArt(logicalDataUrl, scale) : logicalDataUrl;

  return {
    dataUrl: upscaled,
    logicalDataUrl,
    logicalWidth: logical.width,
    logicalHeight: logical.height,
    paletteSize: palette.length,
    scale,
    gridScore: grid.score,
  };
}
