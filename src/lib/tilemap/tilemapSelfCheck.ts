/**
 * 타일맵 파이프라인 self-check (룰타일 v3 · 변형 v2, dev 전용).
 *
 * 이 프로젝트에는 테스트 러너가 없고, 파이프라인 핵심 연산이 전부 실제 canvas 2D에
 * 의존한다(node 환경에서 재현하려면 네이티브 canvas 의존성이 필요). 그래서 검증을
 * 브라우저에서 실행하는 self-check 모듈로 둔다.
 *
 * 실행: `npm run dev` 후 http://localhost:1420/dev/tilemap-check.html
 *
 * 단계별 게이트(계획서 §3)를 이 파일에 누적한다.
 *  - 1단계: makeSeamless 의 wrap 연속성
 *  - 2단계 이후: edgeProfile / autotileSignature / ruleTileComposer 검사 추가 예정
 */

import { cropMaterialSwatch, extractRegion, makeSeamless, measureWrapContinuity } from './seamlessTexture';
import { buildVariationTileSet } from './variationComposer';
import {
  NEIGHBOR,
  TRANSITION_INSET_RATIO,
  TileSide,
  borderTerrainProfile,
  buildTerrainMask,
  signatureFromMap,
  resolveMaskOptions,
  warpedTerrainSDFResolved,
} from './edgeProfile';
import { TILEMAP_EDGE_STYLES, getEdgeStyle } from './edgeStyles';
import {
  SIGNATURES_4BIT,
  SIGNATURES_BLOB,
  buildSignatureIndex,
  buildSlotTable,
  reduceToBlob,
  reduceToSides,
  signatureToSlot,
} from './autotileSignature';
import { buildRuleTileSet } from './ruleTileComposer';
import { loadImageElement } from './tileSlicer';
import { DEFAULT_TILEMAP_EDGE_STYLE, TilemapGridLayout } from '../../types/tilemap';
import { detectImageFormat } from '../utils/imageDataUrl';
import { formatExportStamp } from './tilemapExporter';

/** 개별 검사 결과 */
export interface CheckResult {
  name: string;
  passed: boolean;
  /** 사람이 읽는 근거 (측정값 포함) */
  detail: string;
  /** 리포트 페이지에 함께 띄울 시각 증거 (있으면) */
  canvases?: Array<{ label: string; canvas: HTMLCanvasElement }>;
}

/**
 * 이음새 판정: 경계를 넘는 스텝이 내부 스텝 분포의 P95 이하면 통과.
 * 내부의 평범한 인접쌍과 구별되지 않는다는 뜻이므로 이음새가 보이지 않는다.
 * (동일 픽셀 요구는 열/행 중복을 뜻하므로 올바른 기준이 아니다 — seamlessTexture.ts 참조)
 */

/** 테스트 픽스처 크기 */
const FIXTURE_SIZE = 256;

/** 결정적 해시 잡음 (테스트 픽스처 전용 — 프로덕션 잡음과 독립) */
function hashNoise(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return ((h >>> 0) % 100000) / 100000;
}

/** 캔버스를 만들고 픽셀 단위 생성 함수로 채운다 */
function makeFixture(
  size: number,
  fill: (x: number, y: number) => [number, number, number]
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context를 생성할 수 없습니다');
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b] = fill(x, y);
      const i = (y * size + x) * 4;
      img.data[i] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** 가로 방향 밝기 램프 — 좌우 wrap 이음새 최악 케이스 */
function fixtureRampX(size: number): HTMLCanvasElement {
  return makeFixture(size, (x) => {
    const v = Math.round((x / (size - 1)) * 255);
    return [v, v, v];
  });
}

/** 세로 방향 밝기 램프 — 상하 wrap 이음새 최악 케이스 */
function fixtureRampY(size: number): HTMLCanvasElement {
  return makeFixture(size, (_x, y) => {
    const v = Math.round((y / (size - 1)) * 255);
    return [v, v, v];
  });
}

/** 대각 램프 — 양축 동시 최악 케이스 */
function fixtureRampXY(size: number): HTMLCanvasElement {
  return makeFixture(size, (x, y) => {
    const v = Math.round(((x + y) / (2 * (size - 1))) * 255);
    return [v, v, v];
  });
}

/**
 * 잔디풍 값잡음 — 실제 입력에 가까운 케이스.
 * 저주파 색조 흐름 + 고주파 붓결을 섞어 균질하지만 이음새가 있는 텍스처를 만든다.
 */
function fixtureGrassNoise(size: number): HTMLCanvasElement {
  return makeFixture(size, (x, y) => {
    // 저주파: 좌상 -> 우하로 색조가 흐르므로 wrap 경계에 불연속이 생긴다
    const low = 0.6 * (x / size) + 0.4 * (y / size);
    // 고주파: 붓결
    const high = hashNoise(x >> 2, y >> 2, 7) * 0.35 + hashNoise(x, y, 13) * 0.15;
    const t = low * 0.6 + high * 0.4;
    return [
      Math.round(60 + t * 50),
      Math.round(110 + t * 60),
      Math.round(55 + t * 40),
    ];
  });
}

/** 텍스처 1건에 대해 before/after wrap 연속성을 비교하는 검사 */
function checkSeamlessFor(name: string, fixture: HTMLCanvasElement): CheckResult {
  const before = measureWrapContinuity(fixture);
  const after = measureWrapContinuity(makeSeamless(fixture, FIXTURE_SIZE));
  const seamless = makeSeamless(fixture, FIXTURE_SIZE);

  const limitX = after.interiorP95X;
  const limitY = after.interiorP95Y;
  const passed = after.seamX <= limitX && after.seamY <= limitY;

  const f = (n: number) => n.toFixed(2);
  const detail =
    `변환 전: seamX=${f(before.seamX)}  seamY=${f(before.seamY)}  ` +
    `(내부 평균 ${f(before.interiorX)}/${f(before.interiorY)}, P95 ${f(before.interiorP95X)}/${f(before.interiorP95Y)})\n` +
    `변환 후: seamX=${f(after.seamX)} vs P95 ${f(limitX)}   |   ` +
    `seamY=${f(after.seamY)} vs P95 ${f(limitY)}\n` +
    `내부 평균 ${f(after.interiorX)}/${f(after.interiorY)} · ` +
    `이음새 감소율 X ${((1 - after.seamX / (before.seamX || 1)) * 100).toFixed(1)}% / ` +
    `Y ${((1 - after.seamY / (before.seamY || 1)) * 100).toFixed(1)}%`;

  return {
    name: `makeSeamless — ${name}`,
    passed,
    detail,
    canvases: [
      { label: '입력', canvas: fixture },
      { label: '변환 결과', canvas: seamless },
      { label: '2x2 타일링 (이음새 육안 확인)', canvas: tile2x2(seamless) },
    ],
  };
}

/** 결과 텍스처를 2x2로 이어 붙여 이음새를 육안 확인할 수 있게 만든다 */
function tile2x2(source: HTMLCanvasElement): HTMLCanvasElement {
  const s = source.width;
  const canvas = document.createElement('canvas');
  canvas.width = s * 2;
  canvas.height = s * 2;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context를 생성할 수 없습니다');
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 2; c++) ctx.drawImage(source, c * s, r * s);
  }
  return canvas;
}

/** 홀수 size 방어가 동작하는지 */
function checkOddSizeGuard(): CheckResult {
  const fixture = fixtureRampX(64);
  let threw = false;
  let message = '';
  try {
    makeSeamless(fixture, 65);
  } catch (e) {
    threw = true;
    message = e instanceof Error ? e.message : String(e);
  }
  return {
    name: 'makeSeamless — 홀수 size 방어',
    passed: threw,
    detail: threw ? `예상대로 예외 발생: "${message}"` : '홀수 size인데 예외가 발생하지 않았다',
  };
}

/**
 * extractRegion이 지정한 사분면을 정확히 잘라내는지.
 * 머티리얼 시트에서 베이스/오버레이 필드를 뽑는 연산이라 좌표가 어긋나면
 * 두 지형이 뒤섞이므로 파이프라인 전체가 조용히 망가진다.
 */
function checkExtractRegion(): CheckResult {
  const S = 128;
  const half = S / 2;
  // 사분면별로 서로 다른 단색 (TL=빨강, TR=초록, BL=파랑, BR=노랑)
  const expected: Array<[string, number, number, [number, number, number]]> = [
    ['TL', 0, 0, [255, 0, 0]],
    ['TR', half, 0, [0, 255, 0]],
    ['BL', 0, half, [0, 0, 255]],
    ['BR', half, half, [255, 255, 0]],
  ];
  const fixture = makeFixture(S, (x, y) => {
    if (y < half) return x < half ? [255, 0, 0] : [0, 255, 0];
    return x < half ? [0, 0, 255] : [255, 255, 0];
  });

  const problems: string[] = [];
  for (const [label, sx, sy, [er, eg, eb]] of expected) {
    const out = extractRegion(fixture, sx, sy, half, half, 64);
    const ctx = out.getContext('2d');
    if (!ctx) throw new Error('canvas 2d context를 생성할 수 없습니다');
    // 중앙 픽셀 + 네 귀퉁이 안쪽을 확인 (경계 리샘플 오차 회피)
    for (const [px, py] of [[32, 32], [2, 2], [61, 2], [2, 61], [61, 61]]) {
      const d = ctx.getImageData(px, py, 1, 1).data;
      if (d[0] !== er || d[1] !== eg || d[2] !== eb) {
        problems.push(`${label} (${px},${py}): 기대 rgb(${er},${eg},${eb}) → 실제 rgb(${d[0]},${d[1]},${d[2]})`);
      }
    }
  }

  return {
    name: 'extractRegion — 사분면 좌표 정확도',
    passed: problems.length === 0,
    detail: problems.length === 0
      ? '4개 사분면 각각에서 5개 표본 픽셀이 모두 기대 색과 일치'
      : problems.join('\n'),
  };
}

/**
 * 재질 크롭이 **리샘플 없이** 1:1로 잘라내는지.
 * 다운스케일은 벡터·픽셀아트처럼 또렷함이 정체성인 스타일을 흐리게 만들었다.
 */
function checkCropMaterialSwatch(): CheckResult {
  const SRC = 256;
  const OUT = 64;
  // 1px 체커보드 — 리샘플이 일어나면 즉시 회색으로 뭉개진다
  const fixture = makeFixture(SRC, (x, y) =>
    (x + y) % 2 === 0 ? [255, 255, 255] : [0, 0, 0]
  );
  const out = cropMaterialSwatch(fixture, 0, 0, SRC, SRC, OUT);
  const ctx = out.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('canvas 2d context를 생성할 수 없습니다');
  const data = ctx.getImageData(0, 0, OUT, OUT).data;

  let midtone = 0;
  let total = 0;
  for (let i = 0; i < data.length; i += 4) {
    total++;
    // 순수 흑/백이 아니면 보간이 일어났다는 뜻
    if (data[i] > 8 && data[i] < 247) midtone++;
  }

  // 원본보다 작을 때만 확대 폴백이 걸리는지도 확인
  const upscaled = cropMaterialSwatch(fixture, 0, 0, 32, 32, OUT);

  const passed = midtone === 0 && upscaled.width === OUT;
  return {
    name: 'cropMaterialSwatch — 1:1 크롭 (리샘플 없음)',
    passed,
    detail: passed
      ? `1px 체커보드 ${total}픽셀 전부 순수 흑/백 유지 (보간 0건) · 원본 부족 시 확대 폴백 동작`
      : `보간된 중간톤 픽셀 ${midtone}/${total}개 — 리샘플이 일어나고 있다`,
  };
}

/**
 * `makeSeamless` 창이 **전환선 t=0.25 / 0.75 에서 블렌딩을 하지 않는지**.
 *
 * 초기 구현의 순수 코사인 창은 t=0.25에서 정확히 50:50 블렌딩이었는데, 엣지 계약의
 * 인셋도 k = T/4 (= t 0.25)여서 **지형 경계가 지나가는 자리가 최대 유령 지점**이었다.
 * 평탄부를 가진 창으로 바꿨으므로, 그 열은 굴린 원본과 픽셀 단위로 일치해야 한다.
 */
function checkWindowFlatAtInset(): CheckResult {
  const S = 128;
  const half = S / 2;
  // 열마다 완전히 다른 색 — 블렌딩이 조금이라도 있으면 즉시 드러난다
  const fixture = makeFixture(S, (x) => [
    (x * 7) % 256,
    (x * 31 + 90) % 256,
    (x * 53 + 170) % 256,
  ]);
  const fctx = fixture.getContext('2d', { willReadFrequently: true });
  if (!fctx) throw new Error('canvas 2d context를 생성할 수 없습니다');
  const src = fctx.getImageData(0, 0, S, S).data;

  const out = makeSeamless(fixture, S);
  const octx = out.getContext('2d', { willReadFrequently: true });
  if (!octx) throw new Error('canvas 2d context를 생성할 수 없습니다');
  const dst = octx.getImageData(0, 0, S, S).data;

  const problems: string[] = [];
  // 세로 방향 창도 같이 적용되지만 이 픽스처는 x에만 의존하므로 y 블렌딩은 무해하다
  for (const insetX of [S * TRANSITION_INSET_RATIO, S * (1 - TRANSITION_INSET_RATIO)]) {
    const x = Math.round(insetX);
    // 창이 1이면 결과는 "half만큼 굴린 원본" = src[(x + half) mod S]
    const sxWrapped = (x + half) % S;
    const di = (0 * S + x) * 4;
    const si = (0 * S + sxWrapped) * 4;
    const diff = Math.max(
      Math.abs(dst[di] - src[si]),
      Math.abs(dst[di + 1] - src[si + 1]),
      Math.abs(dst[di + 2] - src[si + 2])
    );
    // 알파 8비트 양자화 오차 정도만 허용
    if (diff > 2) {
      problems.push(
        `x=${x} (t=${(x / S).toFixed(2)}): 굴린 원본과 최대 ${diff} 차이 — 블렌딩이 남아 있다`
      );
    }
  }

  return {
    name: `makeSeamless — 전환선 t=${TRANSITION_INSET_RATIO}/${1 - TRANSITION_INSET_RATIO}에서 유령 없음`,
    passed: problems.length === 0,
    detail: problems.length === 0
      ? '두 전환선 열이 굴린 원본과 픽셀 단위 일치 (블렌딩 0)'
      : problems.join('\n'),
  };
}

/** 1단계 게이트: 재질 텍스처 준비 단계 검사 전체 */
export function runSeamlessChecks(): CheckResult[] {
  return [
    checkOddSizeGuard(),
    checkExtractRegion(),
    checkCropMaterialSwatch(),
    checkWindowFlatAtInset(),
    checkSeamlessFor('가로 램프 (최악 X)', fixtureRampX(FIXTURE_SIZE)),
    checkSeamlessFor('세로 램프 (최악 Y)', fixtureRampY(FIXTURE_SIZE)),
    checkSeamlessFor('대각 램프 (최악 XY)', fixtureRampXY(FIXTURE_SIZE)),
    checkSeamlessFor('잔디풍 값잡음 (실사용 근사)', fixtureGrassNoise(FIXTURE_SIZE)),
  ];
}

// ---------------------------------------------------------------------------
// 2단계 게이트: 엣지 계약 (edgeProfile.ts)
// ---------------------------------------------------------------------------

/** 계약 검증에 쓰는 타일 크기 — 변 프로파일만 보므로 작아도 충분하다 */
const CONTRACT_TILE_SIZE = 64;

/** 프로파일을 "TFTF..." 문자열로 (진단 출력용) */
function profileRuns(profile: boolean[]): string {
  const runs: string[] = [];
  let start = 0;
  for (let i = 1; i <= profile.length; i++) {
    if (i === profile.length || profile[i] !== profile[start]) {
      runs.push(`${profile[start] ? '오버레이' : '베이스'}[${start}~${i - 1}]`);
      start = i;
    }
  }
  return runs.join(' ');
}

/**
 * **핵심 계약 검사 (전수)**: 인접할 수 있는 모든 (오버레이 셀, 오버레이 셀) 쌍에 대해
 * 공유 변의 지형 프로파일이 일치하는지.
 *
 * 두 셀이 가로로 인접하려면 signature가 서로 모순 없어야 한다:
 *   L.E=1, R.W=1, R.N=L.NE, R.S=L.SE, R.NW=L.N, R.SW=L.S
 * 나머지 비트(R.NE/E/SE, L.NW/W/SW)는 공유 변과 무관하므로 자유롭게 순회한다.
 */
function checkAdjacentOverlayPairs(): CheckResult {
  const S = CONTRACT_TILE_SIZE;
  const problems: string[] = [];
  let pairs = 0;

  /** 비트 조합 헬퍼 */
  const bit = (sig: number, b: number) => (sig & b) !== 0;

  // --- 가로 인접 ---
  for (let L = 0; L < 256; L++) {
    if (!bit(L, NEIGHBOR.E)) continue; // 동쪽 이웃이 오버레이일 때만 쌍이 성립
    // R의 강제 비트
    let base = NEIGHBOR.W;
    if (bit(L, NEIGHBOR.NE)) base |= NEIGHBOR.N;
    if (bit(L, NEIGHBOR.SE)) base |= NEIGHBOR.S;
    if (bit(L, NEIGHBOR.N)) base |= NEIGHBOR.NW;
    if (bit(L, NEIGHBOR.S)) base |= NEIGHBOR.SW;
    // R의 자유 비트: NE, E, SE
    for (const free of [0, NEIGHBOR.NE, NEIGHBOR.E, NEIGHBOR.SE,
      NEIGHBOR.NE | NEIGHBOR.E, NEIGHBOR.NE | NEIGHBOR.SE,
      NEIGHBOR.E | NEIGHBOR.SE, NEIGHBOR.NE | NEIGHBOR.E | NEIGHBOR.SE]) {
      const R = base | free;
      const a = borderTerrainProfile(L, 'E', S);
      const b = borderTerrainProfile(R, 'W', S);
      pairs++;
      if (a.some((v, i) => v !== b[i])) {
        problems.push(
          `가로 L=${L} E변 [${profileRuns(a)}] != R=${R} W변 [${profileRuns(b)}]`
        );
      }
    }
  }

  // --- 세로 인접 (위 셀 U, 아래 셀 D) ---
  for (let U = 0; U < 256; U++) {
    if (!bit(U, NEIGHBOR.S)) continue;
    let base = NEIGHBOR.N;
    if (bit(U, NEIGHBOR.SW)) base |= NEIGHBOR.W;
    if (bit(U, NEIGHBOR.SE)) base |= NEIGHBOR.E;
    if (bit(U, NEIGHBOR.W)) base |= NEIGHBOR.NW;
    if (bit(U, NEIGHBOR.E)) base |= NEIGHBOR.NE;
    for (const free of [0, NEIGHBOR.SW, NEIGHBOR.S, NEIGHBOR.SE,
      NEIGHBOR.SW | NEIGHBOR.S, NEIGHBOR.SW | NEIGHBOR.SE,
      NEIGHBOR.S | NEIGHBOR.SE, NEIGHBOR.SW | NEIGHBOR.S | NEIGHBOR.SE]) {
      const D = base | free;
      const a = borderTerrainProfile(U, 'S', S);
      const b = borderTerrainProfile(D, 'N', S);
      pairs++;
      if (a.some((v, i) => v !== b[i])) {
        problems.push(
          `세로 U=${U} S변 [${profileRuns(a)}] != D=${D} N변 [${profileRuns(b)}]`
        );
      }
    }
  }

  return {
    name: '엣지 계약 — 인접 오버레이 타일 쌍 전수 검사',
    passed: problems.length === 0,
    detail: problems.length === 0
      ? `가로·세로 합계 ${pairs}쌍 전부 공유 변 프로파일 일치`
      : `${problems.length}/${pairs}쌍 불일치\n` + problems.slice(0, 8).join('\n'),
  };
}

/**
 * 오버레이 셀의 이웃이 베이스 셀이면, 그 변은 **전부 베이스**여야 한다.
 * (베이스 셀은 순수 베이스 타일로 그려지므로 변 전체가 베이스다)
 */
function checkBaseNeighborBorders(): CheckResult {
  const S = CONTRACT_TILE_SIZE;
  const sides: Array<[TileSide, number]> = [
    ['N', NEIGHBOR.N], ['E', NEIGHBOR.E], ['S', NEIGHBOR.S], ['W', NEIGHBOR.W],
  ];
  const problems: string[] = [];
  let checked = 0;

  for (let sig = 0; sig < 256; sig++) {
    for (const [side, bitMask] of sides) {
      if (sig & bitMask) continue; // 그 방향 이웃이 오버레이면 대상 아님
      const profile = borderTerrainProfile(sig, side, S);
      checked++;
      if (profile.some(Boolean)) {
        problems.push(`sig=${sig} ${side}변: 이웃이 베이스인데 오버레이 픽셀 존재 [${profileRuns(profile)}]`);
      }
    }
  }

  return {
    name: '엣지 계약 — 베이스 이웃과 맞닿은 변은 전부 베이스',
    passed: problems.length === 0,
    detail: problems.length === 0
      ? `${checked}건(signature x 변) 전부 베이스로 확인`
      : `${problems.length}/${checked}건 위반\n` + problems.slice(0, 8).join('\n'),
  };
}

/**
 * 변을 따라 지형이 갈리는 위치가 정규 상수 k(= size * TRANSITION_INSET_RATIO)
 * 또는 size-k 뿐인지. 다른 위치에서 갈리면 계약 자체가 무너진 것이다.
 */
function checkSplitPositions(): CheckResult {
  const S = CONTRACT_TILE_SIZE;
  const k = S * TRANSITION_INSET_RATIO;
  const allowed = new Set([Math.round(k), Math.round(S - k)]);
  const sides: TileSide[] = ['N', 'E', 'S', 'W'];
  const problems: string[] = [];
  let transitions = 0;

  for (let sig = 0; sig < 256; sig++) {
    for (const side of sides) {
      const profile = borderTerrainProfile(sig, side, S);
      for (let i = 1; i < profile.length; i++) {
        if (profile[i] === profile[i - 1]) continue;
        transitions++;
        if (!allowed.has(i)) {
          problems.push(`sig=${sig} ${side}변: index ${i}에서 전이 (허용 ${[...allowed].join(', ')})`);
        }
      }
    }
  }

  return {
    name: `엣지 계약 — 전이 위치가 정규 상수 k=${k} / ${S - k} 뿐인지`,
    passed: problems.length === 0,
    detail: problems.length === 0
      ? `256개 signature x 4변에서 발견된 전이 ${transitions}건 전부 정규 위치`
      : `${problems.length}/${transitions}건 이탈\n` + problems.slice(0, 8).join('\n'),
  };
}

/**
 * 시각 증거: 임의 맵을 signature로 풀어 마스크만 렌더한다.
 * 계약이 지켜지면 타일 경계선이 보이지 않고 하나의 연속된 지형 덩어리로 보여야 한다.
 */
function checkMaskVisual(): CheckResult {
  const TILE = 48;
  const COLS = 12;
  const ROWS = 8;
  // 결정적 의사난수 덩어리 맵
  const map: boolean[][] = Array.from({ length: ROWS }, (_, r) =>
    Array.from({ length: COLS }, (_, c) => {
      const blob = hashNoise(Math.floor(c / 2), Math.floor(r / 2), 3);
      const detail = hashNoise(c, r, 9);
      return blob * 0.75 + detail * 0.25 > 0.45;
    })
  );
  const isOverlay = (r: number, c: number) =>
    r >= 0 && r < ROWS && c >= 0 && c < COLS && map[r][c];

  const canvas = document.createElement('canvas');
  canvas.width = COLS * TILE;
  canvas.height = ROWS * TILE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context를 생성할 수 없습니다');
  // 베이스 = 진한 초록, 오버레이 = 모래색
  ctx.fillStyle = '#3f6b3a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const overlayLayer = document.createElement('canvas');
  overlayLayer.width = TILE;
  overlayLayer.height = TILE;
  const olCtx = overlayLayer.getContext('2d');
  if (!olCtx) throw new Error('canvas 2d context를 생성할 수 없습니다');

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (!map[r][c]) continue;
      const sig = signatureFromMap(isOverlay, r, c);
      const mask = buildTerrainMask(sig, TILE);
      olCtx.clearRect(0, 0, TILE, TILE);
      olCtx.fillStyle = '#c8a468';
      olCtx.fillRect(0, 0, TILE, TILE);
      olCtx.globalCompositeOperation = 'destination-in';
      olCtx.drawImage(mask, 0, 0);
      olCtx.globalCompositeOperation = 'source-over';
      ctx.drawImage(overlayLayer, c * TILE, r * TILE);
    }
  }

  return {
    name: '엣지 계약 — 맵 렌더 시각 확인 (12x8, 마스크만)',
    passed: true,
    detail: '수치 검사가 아닌 육안 증거. 타일 격자선이 보이면 계약 위반이다.',
    canvases: [{ label: '절차적 마스크로 조립한 맵', canvas }],
  };
}

/** 2단계 게이트: 엣지 계약 검사 전체 */
export function runEdgeContractChecks(): CheckResult[] {
  return [
    checkAdjacentOverlayPairs(),
    checkBaseNeighborBorders(),
    checkSplitPositions(),
    checkMaskVisual(),
  ];
}

// ---------------------------------------------------------------------------
// 3단계 게이트: signature 테이블 (autotileSignature.ts)
// ---------------------------------------------------------------------------

/** 정규형 개수와 축약의 멱등성 */
function checkSignatureTables(): CheckResult {
  const problems: string[] = [];

  if (SIGNATURES_4BIT.length !== 16) {
    problems.push(`4비트 정규형이 16종이 아님: ${SIGNATURES_4BIT.length}종`);
  }
  if (SIGNATURES_BLOB.length !== 47) {
    problems.push(`blob 정규형이 47종이 아님: ${SIGNATURES_BLOB.length}종`);
  }
  // 축약은 멱등이어야 한다 (정규형을 다시 축약해도 그대로)
  for (const s of SIGNATURES_BLOB) {
    if (reduceToBlob(s) !== s) problems.push(`blob 축약이 멱등이 아님: ${s} → ${reduceToBlob(s)}`);
  }
  for (const s of SIGNATURES_4BIT) {
    if (reduceToSides(s) !== s) problems.push(`4비트 축약이 멱등이 아님: ${s} → ${reduceToSides(s)}`);
  }

  return {
    name: 'signature 테이블 — 정규형 개수(16 / 47)와 축약 멱등성',
    passed: problems.length === 0,
    detail: problems.length === 0
      ? `4비트 ${SIGNATURES_4BIT.length}종, blob ${SIGNATURES_BLOB.length}종, 축약 멱등 확인`
      : problems.slice(0, 8).join('\n'),
  };
}

/** 슬롯 배치표가 모든 정규형을 덮고, 256개 raw signature가 전부 슬롯으로 해석되는지 */
function checkSlotCoverage(): CheckResult {
  const problems: string[] = [];
  const grids: TilemapGridLayout[] = ['4x4', '8x8'];
  const summary: string[] = [];

  for (const grid of grids) {
    const slots = buildSlotTable(grid);
    const expected = grid === '8x8' ? 64 : 16;
    if (slots.length !== expected) {
      problems.push(`${grid}: 슬롯 수 ${slots.length} (기대 ${expected})`);
    }
    const index = buildSignatureIndex(slots);
    const canonical = grid === '8x8' ? SIGNATURES_BLOB : SIGNATURES_4BIT;
    for (const sig of canonical) {
      if (!index.has(sig)) problems.push(`${grid}: 정규형 ${sig}에 배정된 슬롯이 없음`);
    }
    // 256개 raw signature 전수 해석
    for (let raw = 0; raw < 256; raw++) {
      const slotIdx = signatureToSlot(raw, grid, index, raw);
      if (slotIdx < 0) {
        problems.push(`${grid}: raw ${raw}이 슬롯으로 해석되지 않음`);
        continue;
      }
      const want = grid === '8x8' ? reduceToBlob(raw) : reduceToSides(raw);
      if (slots[slotIdx].signature !== want) {
        problems.push(`${grid}: raw ${raw} → 슬롯 ${slotIdx} (signature ${slots[slotIdx].signature}, 기대 ${want})`);
      }
    }
    const variants = slots.filter((s) => s.variant > 0).length;
    summary.push(`${grid}: 슬롯 ${slots.length}개 (정규형 ${canonical.length} + 변형 ${variants})`);
  }

  return {
    name: 'signature 테이블 — 슬롯 커버리지와 raw 256종 해석',
    passed: problems.length === 0,
    detail: problems.length === 0
      ? summary.join(' · ') + ' · raw 256종 전부 올바른 정규형 슬롯으로 해석'
      : problems.slice(0, 8).join('\n'),
  };
}

// ---------------------------------------------------------------------------
// 4단계 게이트: 합성 타일의 접합 연속성 (ruleTileComposer.ts)
// ---------------------------------------------------------------------------

/**
 * 검사용 합성 머티리얼 시트 (1024x1024).
 * 실제 AI 출력과 같은 레이아웃으로 만든다 — TL 베이스, TR 오버레이, 하단 전환 띠.
 */
function fixtureMaterialSheet(): HTMLCanvasElement {
  const S = 1024;
  const half = S / 2;
  /** 잔디풍 */
  const grass = (x: number, y: number): [number, number, number] => {
    const t = hashNoise(x >> 2, y >> 2, 5) * 0.6 + hashNoise(x, y, 17) * 0.4;
    return [Math.round(58 + t * 26), Math.round(104 + t * 34), Math.round(52 + t * 22)];
  };
  /** 흙길풍 */
  const dirt = (x: number, y: number): [number, number, number] => {
    const t = hashNoise(x >> 2, y >> 2, 29) * 0.6 + hashNoise(x, y, 37) * 0.4;
    return [Math.round(186 + t * 32), Math.round(154 + t * 30), Math.round(104 + t * 26)];
  };

  return makeFixture(S, (x, y) => {
    if (y < half) return x < half ? grass(x, y) : dirt(x - half, y);
    // 하단: 좌=베이스, 우=오버레이, 경계 x=half 에 손맵 프린지 밴드
    const wobble = (hashNoise(0, y >> 3, 71) - 0.5) * 30;
    const boundary = half + wobble;
    const dist = x - boundary;
    if (Math.abs(dist) < 40) {
      // 프린지: 베이스 색이 오버레이 위로 삐져나온 붓결
      const blades = hashNoise(x >> 1, y >> 1, 83);
      const over = blades > 0.5 - dist / 160 ? grass(x, y - half) : dirt(x - half, y - half);
      return over;
    }
    return dist < 0 ? grass(x, y - half) : dirt(x - half, y - half);
  });
}

/** 캔버스에서 특정 열/행의 평균 RGB 차이 */
function columnDiff(
  a: Uint8ClampedArray, aw: number, ax: number,
  b: Uint8ClampedArray, bw: number, bx: number,
  height: number
): number {
  let sum = 0;
  for (let y = 0; y < height; y++) {
    const i = (y * aw + ax) * 4;
    const j = (y * bw + bx) * 4;
    sum += (Math.abs(a[i] - b[j]) + Math.abs(a[i + 1] - b[j + 1]) + Math.abs(a[i + 2] - b[j + 2])) / 3;
  }
  return sum / height;
}

function rowDiff(
  a: Uint8ClampedArray, aw: number, ay: number,
  b: Uint8ClampedArray, bw: number, by: number,
  width: number
): number {
  let sum = 0;
  for (let x = 0; x < width; x++) {
    const i = (ay * aw + x) * 4;
    const j = (by * bw + x) * 4;
    sum += (Math.abs(a[i] - b[j]) + Math.abs(a[i + 1] - b[j + 1]) + Math.abs(a[i + 2] - b[j + 2])) / 3;
  }
  return sum / width;
}

/**
 * **핵심 게이트**: 합성한 타일들을 실제 맵으로 조립하고 접합부 연속성을 잰다.
 *
 * 판정 기준은 "픽셀 차이 == 0"이 **아니다**. 인접 타일은 같은 seamless 텍스처를
 * 같은 오프셋으로 샘플링하므로, 접합부는 그 텍스처 자신의 wrap 경계와 같은 지점이 된다.
 * 따라서 목표는 "접합부 스텝이 타일 내부의 인접 열 스텝 분포(P95)를 넘지 않는가"다.
 * 지형 판정(베이스/오버레이)의 완전 일치는 2단계에서 이미 전수 증명했다.
 */
async function checkComposedJoins(): Promise<CheckResult> {
  const grid: TilemapGridLayout = '8x8';
  const sheet = fixtureMaterialSheet().toDataURL('image/png');
  const set = await buildRuleTileSet(sheet, grid);
  const T = set.tiles.length > 0 ? 128 : 128; // 8x8 → cellSize 128

  // 타일 이미지를 픽셀 버퍼로
  const buffers: Uint8ClampedArray[] = [];
  for (const dataUrl of set.tiles) {
    const img = await loadImageElement(dataUrl);
    const c = document.createElement('canvas');
    c.width = T;
    c.height = T;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('canvas 2d context를 생성할 수 없습니다');
    ctx.drawImage(img, 0, 0);
    buffers.push(ctx.getImageData(0, 0, T, T).data);
  }
  const baseImg = await loadImageElement(set.baseTiles[0]);
  const baseCanvas = document.createElement('canvas');
  baseCanvas.width = T;
  baseCanvas.height = T;
  const baseCtx = baseCanvas.getContext('2d', { willReadFrequently: true });
  if (!baseCtx) throw new Error('canvas 2d context를 생성할 수 없습니다');
  baseCtx.drawImage(baseImg, 0, 0);
  const baseBuf = baseCtx.getImageData(0, 0, T, T).data;

  // 내부 기준선: 모든 타일의 인접 열/행 스텝 분포
  const interior: number[] = [];
  for (const buf of buffers) {
    for (let x = 0; x < T - 1; x++) interior.push(columnDiff(buf, T, x, buf, T, x + 1, T));
    for (let y = 0; y < T - 1; y++) interior.push(rowDiff(buf, T, y, buf, T, y + 1, T));
  }
  interior.sort((a, b) => a - b);
  const p95 = interior[Math.round(0.95 * (interior.length - 1))];
  const interiorMean = interior.reduce((p, c) => p + c, 0) / interior.length;

  // 결정적 의사난수 덩어리 맵으로 실제 배치
  const COLS = 12;
  const ROWS = 8;
  const map: boolean[][] = Array.from({ length: ROWS }, (_, r) =>
    Array.from({ length: COLS }, (_, c) =>
      hashNoise(Math.floor(c / 2), Math.floor(r / 2), 3) * 0.75 + hashNoise(c, r, 9) * 0.25 > 0.45
    )
  );
  const isOverlay = (r: number, c: number) =>
    r >= 0 && r < ROWS && c >= 0 && c < COLS && map[r][c];

  const slots = buildSlotTable(grid);
  const index = buildSignatureIndex(slots);
  /** 셀에 놓일 타일 버퍼 */
  const bufAt = (r: number, c: number): Uint8ClampedArray => {
    if (!map[r][c]) return baseBuf;
    const sig = signatureFromMap(isOverlay, r, c);
    const slot = signatureToSlot(sig, grid, index, r * 31 + c * 17);
    return slot >= 0 ? buffers[slot] : baseBuf;
  };

  const joins: number[] = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS - 1; c++) {
      joins.push(columnDiff(bufAt(r, c), T, T - 1, bufAt(r, c + 1), T, 0, T));
    }
  }
  for (let r = 0; r < ROWS - 1; r++) {
    for (let c = 0; c < COLS; c++) {
      joins.push(rowDiff(bufAt(r, c), T, T - 1, bufAt(r + 1, c), T, 0, T));
    }
  }
  const worst = Math.max(...joins);
  const joinMean = joins.reduce((p, c) => p + c, 0) / joins.length;

  // 시각 증거: 실제 조립 결과
  const visual = document.createElement('canvas');
  visual.width = COLS * T;
  visual.height = ROWS * T;
  const vctx = visual.getContext('2d');
  if (!vctx) throw new Error('canvas 2d context를 생성할 수 없습니다');
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const src = document.createElement('canvas');
      src.width = T;
      src.height = T;
      const sctx = src.getContext('2d');
      if (!sctx) throw new Error('canvas 2d context를 생성할 수 없습니다');
      const im = sctx.createImageData(T, T);
      im.data.set(bufAt(r, c));
      sctx.putImageData(im, 0, 0);
      vctx.drawImage(src, c * T, r * T);
    }
  }

  const f = (n: number) => n.toFixed(2);
  return {
    name: '합성 타일 — 실제 맵 배치 접합 연속성 (8x8 세트, 12x8 맵)',
    passed: worst <= p95,
    detail:
      `접합부 ${joins.length}곳: 평균 ${f(joinMean)}, 최악 ${f(worst)}\n` +
      `타일 내부 인접 스텝: 평균 ${f(interiorMean)}, P95 ${f(p95)} (판정 기준)\n` +
      `합성 타일 ${set.tiles.length}장 + 베이스 타일 1장`,
    canvases: [{ label: '합성 타일로 조립한 12x8 맵', canvas: visual }],
  };
}

/** 타일 여러 장을 가로로 이어 붙여 확인용 스트립을 만든다 */
function tileStrip(tiles: string[]): HTMLCanvasElement {
  const T = 128;
  const canvas = document.createElement('canvas');
  canvas.width = T * tiles.length;
  canvas.height = T;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context를 생성할 수 없습니다');
  tiles.forEach((dataUrl, i) => {
    const img = new Image();
    img.onload = () => ctx.drawImage(img, i * T, 0);
    img.src = dataUrl;
  });
  return canvas;
}

/**
 * **재질 랜덤성 게이트**: 슬롯마다 다른 텍스처 변형을 쓰되, 변형끼리 이어지는가.
 *
 * 두 가지를 동시에 잰다 — 하나만 보면 회귀를 놓친다:
 * 1) **변 픽셀 동일성**: 모든 변형의 4변이 정규 변형과 **픽셀 단위로 같아야** 한다.
 *    유니티 Rule Tile은 변형을 런타임에 무작위로 고르므로, 어떤 두 변형이 이웃해도
 *    접합이 이어져야 하기 때문이다. 어긋나면 격자선이 보인다.
 * 2) **내부 상이성**: 내부는 실제로 달라야 한다. 같으면 변형이 무의미해지고
 *    64장이 다시 한 타일의 반복으로 보인다(v4까지의 증상).
 *
 * 픽스처는 위치에 따라 톤이 크게 변하는 패널이다 — 균일한 패널을 쓰면 크롭 위치를
 * 바꿔도 결과가 같아 2)가 항상 통과해 버려 게이트가 무력해진다.
 */
async function checkMaterialVariants(): Promise<CheckResult> {
  const T = 128; // 8x8 → cellSize
  const S = 1024;
  // 좌: 베이스 패널 (가로로 톤이 크게 변함) / 우: 오버레이 패널 (세로로 변함)
  const sheet = makeFixture(S, (x, y) => {
    const n = hashNoise(x >> 1, y >> 1, 13) * 18;
    if (x < S / 2) {
      const t = x / (S / 2);
      return [60 + t * 90 + n, 110 + t * 40 + n, 50 + t * 30 + n];
    }
    const t = y / S;
    return [190 - t * 40 + n, 150 + t * 50 + n, 100 + t * 60 + n];
  }).toDataURL('image/png');

  const set = await buildRuleTileSet(sheet, '8x8');
  const problems: string[] = [];
  if (set.baseTiles.length < 4) {
    problems.push(`베이스 타일 변형이 ${set.baseTiles.length}장 — 랜덤성이 사실상 없다`);
  }

  // 변형들을 픽셀 버퍼로
  const bufs: Uint8ClampedArray[] = [];
  for (const dataUrl of set.baseTiles) {
    const img = await loadImageElement(dataUrl);
    const c = document.createElement('canvas');
    c.width = T;
    c.height = T;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('canvas 2d context를 생성할 수 없습니다');
    ctx.drawImage(img, 0, 0);
    bufs.push(ctx.getImageData(0, 0, T, T).data);
  }

  const at = (b: Uint8ClampedArray, x: number, y: number, ch: number) => b[(y * T + x) * 4 + ch];
  const chDiff = (a: Uint8ClampedArray, b: Uint8ClampedArray, x: number, y: number) =>
    (Math.abs(at(a, x, y, 0) - at(b, x, y, 0)) +
      Math.abs(at(a, x, y, 1) - at(b, x, y, 1)) +
      Math.abs(at(a, x, y, 2) - at(b, x, y, 2))) / 3;

  // 1) 변 픽셀 동일성 — PNG 왕복의 반올림만 허용
  const EDGE_TOL = 1;
  let edgeSamples = 0;
  let edgeBreaks = 0;
  let worstEdge = 0;
  for (let v = 1; v < bufs.length; v++) {
    for (let i = 0; i < T; i++) {
      for (const [x, y] of [[i, 0], [i, T - 1], [0, i], [T - 1, i]] as Array<[number, number]>) {
        const d = chDiff(bufs[0], bufs[v], x, y);
        edgeSamples++;
        worstEdge = Math.max(worstEdge, d);
        if (d > EDGE_TOL) edgeBreaks++;
      }
    }
  }
  if (edgeBreaks > 0) {
    problems.push(`변 픽셀 불일치 ${edgeBreaks}/${edgeSamples} (최악 ${worstEdge.toFixed(1)}) — 접합 계약 위반`);
  }

  // 2) 내부 상이성 — 중앙 절반 영역의 평균 채널 차
  const INTERIOR_MIN = 2;
  const q = Math.floor(T / 4);
  let weakest = Infinity;
  for (let v = 1; v < bufs.length; v++) {
    let sum = 0;
    let n = 0;
    for (let y = q; y < T - q; y++) {
      for (let x = q; x < T - q; x++) {
        sum += chDiff(bufs[0], bufs[v], x, y);
        n++;
      }
    }
    weakest = Math.min(weakest, sum / n);
  }
  if (weakest < INTERIOR_MIN) {
    problems.push(`내부가 거의 동일하다 (가장 비슷한 변형의 평균 차 ${weakest.toFixed(2)} < ${INTERIOR_MIN})`);
  }

  return {
    name: `재질 변형 — 변 픽셀 동일성 + 내부 랜덤성 (베이스 ${set.baseTiles.length}종)`,
    passed: problems.length === 0,
    detail:
      problems.length > 0
        ? problems.join('\n')
        : `변 픽셀: 표본 ${edgeSamples}개 전부 일치 (최악 ${worstEdge.toFixed(1)} <= ${EDGE_TOL})\n` +
          `내부 차이: 가장 비슷한 변형도 평균 ${weakest.toFixed(2)} (하한 ${INTERIOR_MIN})\n` +
          `변은 공유하고 안쪽만 다른 텍스처 — 어떤 변형끼리 이웃해도 이어지면서 반복이 깨진다`,
    canvases: [{ label: '베이스 지형 타일 변형들', canvas: tileStrip(set.baseTiles) }],
  };
}

/**
 * **변형 세트 게이트**: 변형 모드 타일 64장이 임의 배치에서 이어지는가.
 *
 * 임의 배치 접합은 두 조건이 동시에 성립해야 한다 — 둘 중 하나만 재면 회귀를 놓친다:
 *  1) **타일 간 변 픽셀 동일성** — 어떤 두 타일을 이웃시켜도 접합부가 이어진다.
 *     모든 타일의 4변을 정규 타일(index 0)과 전수 비교한다.
 *  2) **wrap 연속성** — 같은 타일이 반복돼도 이음새가 없다. 1)만 재면 "모든 타일의
 *     변이 똑같이 어긋난" 상태를 통과시켜 버린다. 정규 텍스처의 이음새 유무와
 *     변형의 경계 스텝 상속을 나눠 재는 이유는 2) 블록 주석에 적었다.
 *
 * 여기에 3) 내부 상이성을 더한다. 변만 재면 "변형이 사실상 전부 같아짐" 회귀를
 * (즉 무늬 반복이 그대로 남는 회귀를) 놓치기 때문이다.
 */
async function checkVariationSet(): Promise<CheckResult> {
  const T = 128; // 8x8 → cellSize
  const S = 1024;
  // 캔버스 전체가 하나의 재질 스와치 — 위치에 따라 톤이 변하게 만들어
  // "어디를 크롭했는지"가 결과에 드러나도록 한다 (변형이 실제로 달라야 통과)
  const swatch = makeFixture(S, (x, y) => {
    const n = hashNoise(x >> 1, y >> 1, 29) * 20;
    const tx = x / S;
    const ty = y / S;
    return [70 + tx * 80 + n, 120 + ty * 50 + n, 55 + (tx + ty) * 25 + n];
  }).toDataURL('image/png');

  const set = await buildVariationTileSet(swatch, '8x8');
  const problems: string[] = [];
  if (set.slotCount !== 64) {
    problems.push(`슬롯 배정분이 ${set.slotCount}장 — 8x8은 64장이어야 한다`);
  }
  /*
    풀은 슬롯보다 **커야** 한다. 같으면 슬롯 교체가 이미 화면에 있는 변형끼리 자리를
    바꾸는 것밖에 못 해, 1개만 고르면 아무 일도 일어나지 않는다(회귀로 실제 발생했다).
  */
  if (set.tiles.length <= set.slotCount) {
    problems.push(
      `변형 풀이 ${set.tiles.length}장으로 슬롯(${set.slotCount})보다 크지 않다 — 슬롯 교체가 무의미해진다`
    );
  }
  if (set.distinctCount !== set.tiles.length) {
    problems.push(`서로 다른 변형이 ${set.distinctCount}/${set.tiles.length}장 — 풀이 복사본으로 채워졌다`);
  }

  // 타일을 픽셀 버퍼로
  const bufs: Uint8ClampedArray[] = [];
  const canvases: HTMLCanvasElement[] = [];
  for (const dataUrl of set.tiles) {
    const img = await loadImageElement(dataUrl);
    const c = document.createElement('canvas');
    c.width = T;
    c.height = T;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('canvas 2d context를 생성할 수 없습니다');
    ctx.drawImage(img, 0, 0);
    bufs.push(ctx.getImageData(0, 0, T, T).data);
    canvases.push(c);
  }

  const at = (b: Uint8ClampedArray, x: number, y: number, ch: number) => b[(y * T + x) * 4 + ch];
  const chDiff = (a: Uint8ClampedArray, b: Uint8ClampedArray, x: number, y: number) =>
    (Math.abs(at(a, x, y, 0) - at(b, x, y, 0)) +
      Math.abs(at(a, x, y, 1) - at(b, x, y, 1)) +
      Math.abs(at(a, x, y, 2) - at(b, x, y, 2))) / 3;

  // 1) 타일 간 변 픽셀 동일성 — PNG 왕복의 반올림만 허용
  const EDGE_TOL = 1;
  let edgeSamples = 0;
  let edgeBreaks = 0;
  let worstEdge = 0;
  for (let v = 1; v < bufs.length; v++) {
    for (let i = 0; i < T; i++) {
      for (const [x, y] of [[i, 0], [i, T - 1], [0, i], [T - 1, i]] as Array<[number, number]>) {
        const d = chDiff(bufs[0], bufs[v], x, y);
        edgeSamples++;
        worstEdge = Math.max(worstEdge, d);
        if (d > EDGE_TOL) edgeBreaks++;
      }
    }
  }
  if (edgeBreaks > 0) {
    problems.push(`타일 간 변 픽셀 불일치 ${edgeBreaks}/${edgeSamples} (최악 ${worstEdge.toFixed(1)}) — 접합 계약 위반`);
  }

  /*
    2) wrap 연속성.

    ## 왜 변형마다 "자기 내부 P95"와 비교하면 안 되는가
    `measureWrapContinuity`의 P95 기준은 "경계 스텝이 그 이미지의 내부 스텝 분포에서
    평범한 값인가"를 묻는다. 정규 텍스처에는 맞는 질문이지만 **변형에는 틀린 질문**이다:

    변형은 정규 텍스처의 변 근처를 그대로 두고 안쪽만 다른 크롭으로 바꾼 것이다.
    그래서 경계 스텝(마지막 열↔첫 열)은 정규 텍스처와 **정확히 같은 픽셀**에서 나오지만,
    내부 스텝 분포는 얹은 크롭에 따라 달라진다. 크롭이 더 평탄하면 내부 P95가 내려가
    변하지 않은 경계 스텝이 기준을 넘어 버린다 — 실제로 처음 이 게이트를 돌렸을 때
    3/64장이 **0.05** 초과로 걸렸다. 극단적으로 크롭이 단색이면 내부 P95가 0이 되어
    전부 실패하는데, 그때도 경계는 정규 텍스처의 연속된 픽셀이라 이음새가 없다.

    그래서 질문을 둘로 나눈다:
      2a. **정규 텍스처**가 P95 기준을 통과하는가 — 이음새 자체의 유무.
      2b. 모든 **변형의 경계 스텝이 정규 텍스처와 같은가** — 변형이 그 결론을 물려받는가.
    2b는 1)의 변 픽셀 동일성에서 따라 나오지만(경계 스텝은 첫/마지막 열만 쓴다),
    따로 재 두면 어느 쪽이 깨졌는지 실패 메시지에서 바로 갈린다.
  */
  const canonicalWrap = measureWrapContinuity(canvases[0]);
  const canonOverX = canonicalWrap.seamX - canonicalWrap.interiorP95X;
  const canonOverY = canonicalWrap.seamY - canonicalWrap.interiorP95Y;
  if (canonOverX > 0 || canonOverY > 0) {
    problems.push(
      `정규 텍스처에 이음새가 있다 — seamX ${canonicalWrap.seamX.toFixed(2)} vs P95 ` +
      `${canonicalWrap.interiorP95X.toFixed(2)} / seamY ${canonicalWrap.seamY.toFixed(2)} vs P95 ` +
      `${canonicalWrap.interiorP95Y.toFixed(2)}`
    );
  }

  const WRAP_TOL = 1; // PNG 왕복의 반올림만 허용 (변 픽셀 동일성과 같은 기준)
  let wrapBreaks = 0;
  let worstWrap = 0;
  for (let v = 1; v < canvases.length; v++) {
    const r = measureWrapContinuity(canvases[v]);
    const dx = Math.abs(r.seamX - canonicalWrap.seamX);
    const dy = Math.abs(r.seamY - canonicalWrap.seamY);
    worstWrap = Math.max(worstWrap, dx, dy);
    if (dx > WRAP_TOL || dy > WRAP_TOL) wrapBreaks++;
  }
  if (wrapBreaks > 0) {
    problems.push(
      `변형의 경계 스텝이 정규 텍스처와 다르다 ${wrapBreaks}/${canvases.length - 1}장 ` +
      `(최악 차 ${worstWrap.toFixed(2)} > ${WRAP_TOL}) — 변 근처가 변형됐다`
    );
  }

  // 3) 내부 상이성 — 중앙 절반 영역의 평균 채널 차
  const INTERIOR_MIN = 2;
  const q = Math.floor(T / 4);
  let weakest = Infinity;
  for (let v = 1; v < bufs.length; v++) {
    let sum = 0;
    let n = 0;
    for (let y = q; y < T - q; y++) {
      for (let x = q; x < T - q; x++) {
        sum += chDiff(bufs[0], bufs[v], x, y);
        n++;
      }
    }
    weakest = Math.min(weakest, sum / n);
  }
  if (weakest < INTERIOR_MIN) {
    problems.push(`내부가 거의 동일하다 (가장 비슷한 변형의 평균 차 ${weakest.toFixed(2)} < ${INTERIOR_MIN})`);
  }

  return {
    name: `변형 세트 — 타일 간 변 동일성 + wrap 연속성 + 내부 랜덤성 (풀 ${set.tiles.length}장 / 슬롯 ${set.slotCount})`,
    passed: problems.length === 0,
    detail:
      problems.length > 0
        ? problems.join('\n')
        : `변 픽셀: 표본 ${edgeSamples}개 전부 일치 (최악 ${worstEdge.toFixed(1)} <= ${EDGE_TOL})\n` +
          `정규 텍스처 wrap: seamX ${canonicalWrap.seamX.toFixed(2)} vs P95 ${canonicalWrap.interiorP95X.toFixed(2)} · ` +
          `seamY ${canonicalWrap.seamY.toFixed(2)} vs P95 ${canonicalWrap.interiorP95Y.toFixed(2)}\n` +
          `경계 스텝 상속: 변형 ${canvases.length - 1}장 전부 정규와 일치 (최악 차 ${worstWrap.toFixed(2)} <= ${WRAP_TOL})\n` +
          `내부 차이: 가장 비슷한 변형도 평균 ${weakest.toFixed(2)} (하한 ${INTERIOR_MIN})\n` +
          `→ 어떤 순서로 랜덤 배치해도 이음새가 없고, 무늬 반복도 깨진다`,
    canvases: [{ label: '변형 타일 (풀 앞 16장)', canvas: tileStrip(set.tiles.slice(0, 16)) }],
  };
}

/**
 * **투명 지형 게이트**: 지형 하나를 투명으로 두면 알파가 제대로 나오는가.
 *
 * 세 가지를 함께 잰다:
 * 1) **바닥 타일이 나가지 않는다** — 베이스가 투명이면 칠할 바닥이 없다(`baseTiles` 빈 배열).
 * 2) **투명 영역이 실제로 알파 0** — 흰색으로 칠해 놓고 투명한 척하면 안 된다.
 * 3) **검은 테두리(halo)가 없다** — 이게 핵심이다. 스트레이트 알파로 섞으면 투명 픽셀의
 *    의미 없는 RGB(0,0,0)가 경계 AA와 아웃라인 덮기에 끼어들어 어두운 띠가 생긴다.
 *    합성이 프리멀티플라이드로 돌아가는지를 이 검사가 지킨다.
 *
 *    판정은 "재질/아웃라인 색과 일치하는가"가 **아니라 "어두워졌는가"**다. 아웃라인
 *    가장자리에는 재질↔아웃라인이 섞인 AA 픽셀이 정상적으로 존재하므로 색 일치로
 *    재면 그 정상 픽셀까지 위반으로 세어 기준이 무뎌진다. 두 기준색의 볼록 결합은
 *    휘도가 절대 `min(두 색의 휘도)` 아래로 내려가지 않으므로, 그 아래면 검은색이
 *    섞여 들어왔다는 뜻이다 — halo만 정확히 잡힌다.
 *
 * 아웃라인은 경계선을 중심으로 그리므로 **투명한 쪽으로도 뻗어야** 한다 — 안 그러면
 * 반쪽짜리 윤곽선이 된다. 그것도 함께 확인한다.
 *
 * 마지막으로 **산출물이 실제 PNG 바이트인지**도 본다. 알파를 아무리 정확히 계산해도
 * 타일을 JPEG로 인코딩하면(예: `toDataURL('image/png')`을 바꾸면) 투명 영역이 흰색으로
 * 굳어 버린다. 내보내기는 이 바이트를 재인코딩 없이 `.png`로 그대로 쓴다.
 */
async function checkTransparentTerrain(): Promise<CheckResult> {
  const T = 128;
  const S = 1024;
  const OVERLAY: [number, number, number] = [220, 150, 60];
  const OUTLINE: [number, number, number] = [255, 0, 255]; // 재질과 절대 겹치지 않는 마젠타

  // 베이스가 투명이면 시트는 캔버스 전체가 오버레이 스와치 1장이다
  const sheet = makeFixture(S, () => OVERLAY).toDataURL('image/png');
  const set = await buildRuleTileSet(sheet, '8x8', {
    transparentBase: true,
    outline: { enabled: true, thicknessPx: 4, color: '#ff00ff' },
  });

  const problems: string[] = [];
  if (set.baseTiles.length !== 0) {
    problems.push(`베이스가 투명인데 바닥 타일이 ${set.baseTiles.length}장 나왔다`);
  }
  // 산출물이 실제 PNG 바이트여야 알파가 파일까지 살아서 나간다
  const nonPng = set.tiles.filter((t) => detectImageFormat(t) !== 'png').length;
  if (nonPng > 0) {
    problems.push(`타일 ${nonPng}장이 PNG가 아니다 — JPEG로 인코딩되면 투명 영역이 흰색으로 굳는다`);
  }

  const bufs: Uint8ClampedArray[] = [];
  for (const dataUrl of set.tiles) {
    const img = await loadImageElement(dataUrl);
    const c = document.createElement('canvas');
    c.width = T;
    c.height = T;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('canvas 2d context를 생성할 수 없습니다');
    ctx.drawImage(img, 0, 0);
    bufs.push(ctx.getImageData(0, 0, T, T).data);
  }

  const near = (r: number, g: number, b: number, c: [number, number, number], tol: number) =>
    Math.abs(r - c[0]) <= tol && Math.abs(g - c[1]) <= tol && Math.abs(b - c[2]) <= tol;

  /** ITU-R BT.601 휘도 */
  const luma = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;
  // 두 기준색의 볼록 결합이 가질 수 있는 최저 휘도 — 이보다 어두우면 검은색이 섞인 것
  const HALO_LUMA = Math.min(luma(...OVERLAY), luma(...OUTLINE)) - 15;

  let total = 0;
  let clear = 0; // 알파 0
  let opaque = 0; // 알파 255
  let halo = 0; // 기준색 조합으로는 나올 수 없을 만큼 어두운 (반)불투명 픽셀
  let darkest = 255; // 관측된 최저 휘도 (여유가 얼마나 남았는지 보려고)
  let outlineOverClear = 0; // 투명한 쪽으로 뻗은 아웃라인 픽셀
  for (const buf of bufs) {
    for (let y = 0; y < T; y++) {
      for (let x = 0; x < T; x++) {
        const i = (y * T + x) * 4;
        const a = buf[i + 3];
        total++;
        if (a === 0) {
          clear++;
          continue;
        }
        if (a === 255) opaque++;
        const [r, g, b] = [buf[i], buf[i + 1], buf[i + 2]];
        const y601 = luma(r, g, b);
        if (y601 < darkest) darkest = y601;
        if (y601 < HALO_LUMA) halo++;
        // 아웃라인 픽셀인데 바로 옆이 완전 투명이면 = 투명한 쪽 가장자리까지 뻗었다
        if (near(r, g, b, OUTLINE, 40) && x + 1 < T && buf[i + 7] === 0) outlineOverClear++;
      }
    }
  }

  const clearRatio = clear / total;
  if (clearRatio < 0.1) {
    problems.push(`투명 픽셀이 ${(clearRatio * 100).toFixed(1)}% 뿐이다 — 투명 처리가 안 됐다`);
  }
  // halo는 있으면 안 되는 것이므로 비율이 아니라 **개수 0**을 요구한다
  if (halo > 0) {
    problems.push(
      `기준색 조합으로 나올 수 없이 어두운 픽셀 ${halo}개 (최저 휘도 ${darkest.toFixed(1)} < ${HALO_LUMA.toFixed(1)}) ` +
      `— 프리멀티플라이드 합성이 깨져 검은 테두리가 생겼다`
    );
  }
  if (outlineOverClear === 0) {
    problems.push('아웃라인이 투명한 쪽으로 뻗지 않았다 — 반쪽짜리 윤곽선이다');
  }

  return {
    name: '투명 지형 — 알파 0 · 검은 테두리 없음 · 아웃라인 관통',
    passed: problems.length === 0,
    detail:
      problems.length > 0
        ? problems.join('\n')
        : `타일 ${set.tiles.length}장 전부 PNG · 바닥 타일 0장(투명 베이스) · 투명 ${(clearRatio * 100).toFixed(1)}% / ` +
          `불투명 ${((opaque / total) * 100).toFixed(1)}%\n` +
          `검은 테두리 0개 · 관측 최저 휘도 ${darkest.toFixed(1)} (한계선 ${HALO_LUMA.toFixed(1)})\n` +
          `투명한 쪽 경계까지 뻗은 아웃라인 픽셀 ${outlineOverClear}개`,
    canvases: [{ label: '투명 베이스 + 아웃라인 슬롯 일부', canvas: tileStrip(set.tiles.slice(0, 8)) }],
  };
}

/**
 * **계단식 아웃라인 게이트**: 두 아웃라인이 서로를 감싸지 않고 나란히 놓이는가.
 *
 * 예전 방식은 두 아웃라인이 모두 `|SDF| < 반두께`로 경계선을 **가운데 두고** 퍼져서,
 * 굵은 쪽이 얇은 쪽을 감싸는 동심 구조밖에 나오지 않았다. 지금은 각 띠가 지정한
 * 한쪽으로만 뻗고 2단계 띠가 1단계 띠 끝에서 이어 시작한다. 이 게이트는 합성기가 쓴 것과
 * **같은 SDF를 다시 계산해** 픽셀마다 기대 색을 만들고 실제 색과 대조한다:
 *
 * ```
 *   d >= +1        → 오버레이 재질     (아웃라인이 안쪽을 침범하면 안 된다)
 *   -t1+1..-1      → 1단계 색
 *   -t1-t2+1..-t1-1→ 2단계 색
 *   d <= -t1-t2-1  → 베이스 재질
 * ```
 * 경계에서 ±1px는 안티에일리어싱 구간이라 표본에서 뺀다.
 *
 * 띠 사이 **1px 틈**도 함께 잡는다. 띠를 하나씩 순서대로 합성하면 맞닿는 지점에서 각각
 * 0.5만 덮어 아래 재질이 25% 비친다 — 투명 베이스에서는 반투명 선으로 보인다. 그래서
 * 합성기는 기여분을 먼저 합산한 뒤 한 번에 얹는다(`sampleOutline`).
 *
 * 판정은 "정확히 50:50인가"가 **아니라 "재질이 섞였는가"**다. 맞닿는 1px 안에서 두 띠의
 * 혼합 비율은 위치에 따라 연속으로 변하므로(0.85:0.15 ~ 0.15:0.85) 특정 비율을 요구하면
 * 정상 픽셀이 걸린다. 그래서 두 아웃라인 색이 **공유하는 채널**(둘 다 G=0, B=255)로 본다 —
 * 두 색의 볼록 결합은 무슨 비율이든 G=0·B=255를 유지하고, 재질(G≈140·B≈60)이 비치는
 * 순간에만 어긋난다.
 */
async function checkSteppedOutline(): Promise<CheckResult> {
  const grid: TilemapGridLayout = '8x8';
  const T = 128;
  const BASE: [number, number, number] = [40, 140, 60];
  const OVERLAY: [number, number, number] = [220, 150, 60];
  const STEP1: [number, number, number] = [255, 0, 255]; // 마젠타
  const STEP2: [number, number, number] = [0, 0, 255]; // 파랑
  const W1 = 4;
  const W2 = 6;

  const sheet = makeFixture(1024, (x) => (x < 512 ? BASE : OVERLAY)).toDataURL('image/png');
  const set = await buildRuleTileSet(sheet, grid, {
    outline: { enabled: true, thicknessPx: W1, color: '#ff00ff', opacity: 1 },
    outline2: { enabled: true, thicknessPx: W2, color: '#0000ff', opacity: 1 },
    outlineSide: 'outer',
  });

  const buffers: Uint8ClampedArray[] = [];
  for (const dataUrl of set.tiles) {
    const img = await loadImageElement(dataUrl);
    const c = document.createElement('canvas');
    c.width = T;
    c.height = T;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('canvas 2d context를 생성할 수 없습니다');
    ctx.drawImage(img, 0, 0);
    buffers.push(ctx.getImageData(0, 0, T, T).data);
  }

  const near = (buf: Uint8ClampedArray, i: number, c: [number, number, number], tol = 10) =>
    Math.abs(buf[i] - c[0]) <= tol &&
    Math.abs(buf[i + 1] - c[1]) <= tol &&
    Math.abs(buf[i + 2] - c[2]) <= tol;

  // 합성기와 **같은** 마스크·시드로 SDF를 다시 계산해 기대 색을 만든다
  const slots = buildSlotTable(grid);
  const maskBase = getEdgeStyle(DEFAULT_TILEMAP_EDGE_STYLE).mask;

  let samples = 0;
  const wrong = { overlay: 0, step1: 0, step2: 0, base: 0 };
  let seamSamples = 0;
  let seamLeaks = 0;

  for (let si = 0; si < slots.length; si++) {
    const buf = buffers[si];
    const opts = resolveMaskOptions(T, { ...maskBase, warpSeed: slots[si].variant });
    for (let y = 0; y < T; y++) {
      for (let x = 0; x < T; x++) {
        const i = (y * T + x) * 4;
        const d = warpedTerrainSDFResolved(slots[si].signature, x + 0.5, y + 0.5, T, opts);

        // 1단계 ↔ 2단계 맞닿는 지점: 두 아웃라인 색의 (임의 비율) 혼합이어야 하고 재질이 섞이면 안 된다.
        // 두 색이 공유하는 채널로 본다 — STEP1·STEP2 모두 G=0·B=255이므로 볼록 결합도 그대로다.
        if (Math.abs(d + W1) < 0.5) {
          seamSamples++;
          if (buf[i + 1] > 12 || buf[i + 2] < 243) seamLeaks++;
          continue;
        }

        if (d >= 1) {
          samples++;
          if (!near(buf, i, OVERLAY)) wrong.overlay++;
        } else if (d <= -1 && d >= -W1 + 1) {
          samples++;
          if (!near(buf, i, STEP1)) wrong.step1++;
        } else if (d <= -W1 - 1 && d >= -W1 - W2 + 1) {
          samples++;
          if (!near(buf, i, STEP2)) wrong.step2++;
        } else if (d <= -W1 - W2 - 1) {
          samples++;
          if (!near(buf, i, BASE)) wrong.base++;
        }
      }
    }
  }

  // 반대 방향('inner')도 확인 — 부호만 뒤집혀 오버레이 안쪽에 띠가 생기고 베이스는 그대로여야 한다
  const innerSet = await buildRuleTileSet(sheet, grid, {
    outline: { enabled: true, thicknessPx: W1, color: '#ff00ff', opacity: 1 },
    outlineSide: 'inner',
  });
  let innerInside = 0; // 오버레이 안쪽에 칠해진 1단계 색
  let innerOutside = 0; // 베이스 쪽으로 새어 나간 1단계 색 (0이어야 한다)
  for (let si = 0; si < slots.length; si++) {
    const img = await loadImageElement(innerSet.tiles[si]);
    const c = document.createElement('canvas');
    c.width = T;
    c.height = T;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('canvas 2d context를 생성할 수 없습니다');
    ctx.drawImage(img, 0, 0);
    const buf = ctx.getImageData(0, 0, T, T).data;
    const opts = resolveMaskOptions(T, { ...maskBase, warpSeed: slots[si].variant });
    for (let y = 0; y < T; y++) {
      for (let x = 0; x < T; x++) {
        const i = (y * T + x) * 4;
        if (!near(buf, i, STEP1)) continue;
        const d = warpedTerrainSDFResolved(slots[si].signature, x + 0.5, y + 0.5, T, opts);
        if (d >= 1) innerInside++;
        else if (d <= -1) innerOutside++;
      }
    }
  }

  const problems: string[] = [];
  if (wrong.overlay > 0) {
    problems.push(`오버레이 안쪽 ${wrong.overlay}px가 재질이 아니다 — 아웃라인이 경계 안쪽까지 퍼졌다(단방향 아님)`);
  }
  if (innerInside === 0) problems.push("방향 'inner'인데 오버레이 안쪽에 띠가 없다");
  if (innerOutside > 0) {
    problems.push(`방향 'inner'인데 베이스 쪽으로 ${innerOutside}px 새어 나갔다 — 방향 부호가 적용되지 않았다`);
  }
  if (wrong.step1 > 0) problems.push(`1단계 띠 ${wrong.step1}px가 지정 색이 아니다`);
  if (wrong.step2 > 0) problems.push(`2단계 띠 ${wrong.step2}px가 지정 색이 아니다 — 1단계가 2단계를 감싸고 있을 수 있다`);
  if (wrong.base > 0) problems.push(`띠 밖 ${wrong.base}px가 베이스 재질이 아니다 — 띠가 지정 폭보다 넓다`);
  if (seamLeaks > 0) {
    problems.push(`띠 사이 경계 ${seamLeaks}/${seamSamples}px에 재질이 비친다 — 띠를 순차 합성해 1px 틈이 생겼다`);
  }

  return {
    name: `계단식 아웃라인 — 단방향(바깥/안쪽) · ${W1}px + ${W2}px 순서·폭`,
    passed: problems.length === 0,
    detail:
      problems.length > 0
        ? problems.join('\n')
        : `표본 ${samples}px 전부 기대 색 일치 (오버레이 / ${W1}px 1단계 / ${W2}px 2단계 / 베이스)\n` +
          `방향 'inner': 오버레이 안쪽 ${innerInside}px에 띠, 베이스 쪽 유출 0px\n` +
          `띠 사이 경계 표본 ${seamSamples}px 전부 두 아웃라인 색만의 혼합 — 재질이 비치는 1px 틈 없음\n` +
          `합성기와 같은 SDF를 다시 계산해 픽셀마다 대조했다`,
    canvases: [{ label: '계단식 아웃라인 슬롯 일부', canvas: tileStrip(set.tiles.slice(0, 8)) }],
  };
}

/** 내보내기 폴더 타임스탬프가 `yymmdd_HHMMSS` 형식인지 (로컬 시각 기준) */
function checkExportStamp(): CheckResult {
  const problems: string[] = [];
  // 2026-08-27 13:44:55 -> 260827_134455 (요구 예시)
  const cases: Array<[Date, string]> = [
    [new Date(2026, 7, 27, 13, 44, 55), '260827_134455'],
    [new Date(2026, 0, 1, 0, 0, 0), '260101_000000'],
    [new Date(2099, 11, 31, 23, 59, 59), '991231_235959'],
    [new Date(2100, 0, 1, 9, 5, 3), '000101_090503'], // 연도 2자리 wrap
  ];
  for (const [date, expected] of cases) {
    const actual = formatExportStamp(date);
    if (actual !== expected) problems.push(`${date.toString()} -> "${actual}" (기대 "${expected}")`);
  }
  return {
    name: '내보내기 폴더명 — tilemap_yymmdd_HHMMSS 형식',
    passed: problems.length === 0,
    detail: problems.length === 0
      ? `${cases.length}건 일치 (예: tilemap_${formatExportStamp(cases[0][0])})`
      : problems.join('\n'),
  };
}

/**
 * **경계 품질 게이트** — 선명도와 아웃라인 연속성을 한 번의 합성으로 함께 검증한다.
 *
 * 1) **선명도**: 초기 구현은 경계 밴드에서 프린지 색을 알파 블렌딩했다. 알파 블렌딩은
 *    원리적으로 두 텍스처의 **평균**을 만들므로 아무리 선명한 재질을 넣어도 그 밴드가
 *    탁해졌다. 이제 SDF 부호로 이진 결정하고 1px만 안티에일리어싱하므로, 어느 재질도
 *    아웃라인도 아닌 "중간색" 픽셀은 윤곽선 두께만큼만 존재해야 한다.
 * 2) **아웃라인 연속성**: 아웃라인은 경계선에서 한쪽으로 뻗는 띠이므로 SDF의 부호(지형 판정)뿐
 *    아니라 **부호 있는 값**이 공유 변에서 일치해야 선이 끊기지 않는다. 실제 맵을 조립해 확인한다.
 *    (부호는 엣지 계약이, 크기는 이 검사가 지킨다)
 *
 * 두 검사가 같은 합성 결과를 쓰므로, 아웃라인이 선명도를 해치는 상호작용도 함께 잡힌다.
 * (합성 1회가 100만 픽셀이라 검사마다 따로 합성하면 dev 페이지가 분 단위로 느려진다)
 */
async function checkBoundaryQuality(): Promise<CheckResult> {
  const grid: TilemapGridLayout = '8x8';
  const T = 128;
  const BASE: [number, number, number] = [40, 140, 60];
  const OVERLAY: [number, number, number] = [220, 150, 60];
  const OUTLINE: [number, number, number] = [255, 0, 255]; // 재질과 절대 겹치지 않는 마젠타
  const THICKNESS = 4;

  const sheet = makeFixture(1024, (x) => (x < 512 ? BASE : OVERLAY)).toDataURL('image/png');
  const set = await buildRuleTileSet(sheet, grid, {
    outline: { enabled: true, thicknessPx: THICKNESS, color: '#ff00ff' },
  });

  const buffers: Uint8ClampedArray[] = [];
  for (const dataUrl of set.tiles) {
    const img = await loadImageElement(dataUrl);
    const c = document.createElement('canvas');
    c.width = T;
    c.height = T;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('canvas 2d context를 생성할 수 없습니다');
    ctx.drawImage(img, 0, 0);
    buffers.push(ctx.getImageData(0, 0, T, T).data);
  }

  const near = (r: number, g: number, b: number, c: [number, number, number], tol = 6) =>
    Math.abs(r - c[0]) <= tol && Math.abs(g - c[1]) <= tol && Math.abs(b - c[2]) <= tol;
  const isOutline = (buf: Uint8ClampedArray, x: number, y: number): boolean => {
    const i = (y * T + x) * 4;
    // 마젠타 계열 (안티에일리어싱 여유 허용)
    return buf[i] > 150 && buf[i + 1] < 110 && buf[i + 2] > 150;
  };

  // --- 1) 선명도: 재질도 아웃라인도 아닌 중간색 픽셀 비율 ---
  let mixed = 0;
  let total = 0;
  for (const buf of buffers) {
    for (let i = 0; i < buf.length; i += 4) {
      total++;
      const [r, g, b] = [buf[i], buf[i + 1], buf[i + 2]];
      if (!near(r, g, b, BASE) && !near(r, g, b, OVERLAY) && !near(r, g, b, OUTLINE, 40)) mixed++;
    }
  }
  const mixedRatio = mixed / total;
  // 아웃라인 양옆 1px 안티에일리어싱만 중간색이어야 한다. 밴드 블렌딩이 남아 있으면 훨씬 커진다.
  const MIXED_LIMIT = 0.05;

  // --- 2) 아웃라인 연속성 ---
  const COLS = 10;
  const ROWS = 8;
  const map: boolean[][] = Array.from({ length: ROWS }, (_, r) =>
    Array.from({ length: COLS }, (_, c) =>
      hashNoise(Math.floor(c / 2), Math.floor(r / 2), 3) * 0.75 + hashNoise(c, r, 9) * 0.25 > 0.45
    )
  );
  const isOverlay = (r: number, c: number) =>
    r >= 0 && r < ROWS && c >= 0 && c < COLS && map[r][c];
  const index = buildSignatureIndex(buildSlotTable(grid));
  /** 오버레이 셀만 아웃라인을 가진다 — 베이스 셀 쪽엔 없는 게 정상이므로 쌍에서 제외한다 */
  const bufAt = (r: number, c: number): Uint8ClampedArray | null => {
    if (!map[r][c]) return null;
    const slot = signatureToSlot(signatureFromMap(isOverlay, r, c), grid, index, r * 31 + c * 17);
    return slot >= 0 ? buffers[slot] : null;
  };

  let breaks = 0;
  let joinSamples = 0;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS - 1; c++) {
      const a = bufAt(r, c);
      const b = bufAt(r, c + 1);
      if (!a || !b) continue;
      for (let y = 0; y < T; y++) {
        joinSamples++;
        if (isOutline(a, T - 1, y) !== isOutline(b, 0, y)) breaks++;
      }
    }
  }
  for (let r = 0; r < ROWS - 1; r++) {
    for (let c = 0; c < COLS; c++) {
      const a = bufAt(r, c);
      const b = bufAt(r + 1, c);
      if (!a || !b) continue;
      for (let x = 0; x < T; x++) {
        joinSamples++;
        if (isOutline(a, x, T - 1) !== isOutline(b, x, 0)) breaks++;
      }
    }
  }
  const breakLimit = Math.max(4, Math.round(joinSamples * 0.01));

  const passed = mixedRatio <= MIXED_LIMIT && breaks <= breakLimit;
  return {
    name: `경계 품질 — 선명도 + 아웃라인(${THICKNESS}px) 접합 연속성`,
    passed,
    detail:
      `선명도: 중간색 픽셀 ${mixed}/${total} = ${(mixedRatio * 100).toFixed(2)}% ` +
      `(허용 ${(MIXED_LIMIT * 100).toFixed(0)}%)
` +
      `아웃라인: 접합 표본 ${joinSamples}개 중 불일치 ${breaks}개 (허용 ${breakLimit})
` +
      `순수 단색 재질 2종 + 마젠타 아웃라인으로 합성해, 중간색과 선 끊김을 동시에 측정`,
    canvases: [{ label: '아웃라인을 켠 슬롯 일부', canvas: tileStrip(set.tiles.slice(0, 8)) }],
  };
}

/** 3단계 게이트 */
export function runSignatureChecks(): CheckResult[] {
  return [checkSignatureTables(), checkSlotCoverage()];
}

/**
 * 경계선 프리셋이 UI·합성기에 쓸 수 있는 상태인지, 그리고 **프리셋마다 실제로 다른
 * 경계 모양이 나오는지**. 파라미터를 바꿨는데 결과가 같으면 프리셋이 무의미하다.
 */
function checkEdgeStylePresets(): CheckResult {
  const problems: string[] = [];
  const ids = new Set<string>();
  const S = 96;
  const signature = NEIGHBOR.S | NEIGHBOR.E | NEIGHBOR.SE;

  /** 프리셋별 경계 형태 지문 — 각 행에서 오버레이 픽셀 수를 이어붙인다 */
  const fingerprint = (styleId: (typeof TILEMAP_EDGE_STYLES)[number]['id']): string => {
    const mask = resolveMaskOptions(S, getEdgeStyle(styleId).mask);
    const counts: number[] = [];
    for (let y = 0; y < S; y++) {
      let n = 0;
      for (let x = 0; x < S; x++) {
        if (warpedTerrainSDFResolved(signature, x + 0.5, y + 0.5, S, mask) > 0) n++;
      }
      counts.push(n);
    }
    return counts.join(',');
  };

  const prints = new Map<string, string>();
  for (const style of TILEMAP_EDGE_STYLES) {
    if (ids.has(style.id)) problems.push(`id 중복: ${style.id}`);
    ids.add(style.id);
    if (!style.label.trim()) problems.push(`${style.id}: label 비어 있음`);
    if (!style.hint.trim()) problems.push(`${style.id}: hint 비어 있음`);

    const fp = fingerprint(style.id);
    for (const [otherId, otherFp] of prints) {
      if (otherFp === fp) problems.push(`${style.id}와 ${otherId}의 경계 형태가 동일하다`);
    }
    prints.set(style.id, fp);
  }

  if (!ids.has(DEFAULT_TILEMAP_EDGE_STYLE)) {
    problems.push(`기본 프리셋 ${DEFAULT_TILEMAP_EDGE_STYLE}이 목록에 없음`);
  }
  if (getEdgeStyle(undefined).id !== DEFAULT_TILEMAP_EDGE_STYLE) {
    problems.push('미지정 입력이 기본 프리셋으로 폴백하지 않음');
  }
  if (getEdgeStyle('nonexistent' as never).id !== DEFAULT_TILEMAP_EDGE_STYLE) {
    problems.push('미인식 id가 기본 프리셋으로 폴백하지 않음');
  }

  return {
    name: `경계선 프리셋 — ${TILEMAP_EDGE_STYLES.length}종 정합성·형태 상이성·폴백`,
    passed: problems.length === 0,
    detail: problems.length === 0
      ? `${TILEMAP_EDGE_STYLES.length}종: ${TILEMAP_EDGE_STYLES.map((s) => s.label).join(', ')} — 서로 다른 경계 형태 확인`
      : problems.slice(0, 8).join('\n'),
  };
}

/**
 * 현재까지 구현된 모든 단계의 검사를 실행한다.
 *
 * 무거운 검사(합성 세트 생성 = 약 100만 픽셀)가 섞여 있어 전체 수행에 수십 초가 걸린다.
 * `onProgress`로 어느 단계인지 알려주고, 단계 사이에 이벤트 루프에 양보해 페이지가
 * 응답 불가 상태가 되지 않게 한다.
 */
export async function runAllTilemapChecks(
  onProgress?: (label: string) => void
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const steps: Array<[string, () => CheckResult[] | Promise<CheckResult[]>]> = [
    ['재질 텍스처 (1단계)', () => runSeamlessChecks()],
    ['엣지 계약 (2단계)', () => runEdgeContractChecks()],
    ['signature 테이블 (3단계)', () => runSignatureChecks()],
    ['내보내기 폴더명', () => [checkExportStamp()]],
    ['경계선 프리셋', () => [checkEdgeStylePresets()]],
    ['경계 품질 (합성 1회)', async () => [await checkBoundaryQuality()]],
    ['맵 배치 접합 (합성 1회)', async () => [await checkComposedJoins()]],
    ['재질 변형 (합성 1회)', async () => [await checkMaterialVariants()]],
    ['변형 세트 (합성 1회)', async () => [await checkVariationSet()]],
    ['계단식 아웃라인 (합성 1회)', async () => [await checkSteppedOutline()]],
    ['투명 지형 (합성 1회)', async () => [await checkTransparentTerrain()]],
  ];

  for (const [label, run] of steps) {
    onProgress?.(label);
    // 브라우저가 진행 표시를 그릴 틈을 준다.
    // setTimeout은 백그라운드 탭에서 1초로 클램프되므로 MessageChannel을 쓴다
    // (ruleTileComposer.yieldToEventLoop와 같은 이유)
    await new Promise<void>((r) => {
      const ch = new MessageChannel();
      ch.port1.onmessage = () => { ch.port1.close(); r(); };
      ch.port2.postMessage(null);
    });
    results.push(...(await run()));
  }
  return results;
}
