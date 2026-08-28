/**
 * 룰타일 합성기 — 머티리얼 시트 1장에서 교체 가능한 타일 세트를 만든다.
 *
 * 룰타일 v3 파이프라인의 4단계이자 핵심이다. AI가 그린 그림을 **자르지 않는다**.
 * AI에게는 재질과 화풍만 받고(머티리얼 시트), 타일의 지형 경계는 코드가
 * `edgeProfile.ts`의 계약에 따라 직접 그린다.
 *
 * ## 머티리얼 시트 레이아웃 (실측 비율로 해석 — 좌우 2등분)
 *
 * 지형 하나를 **투명**으로 두면(`transparentBase`/`transparentOverlay`) 그 지형은 재질이
 * 필요 없으므로 시트가 **캔버스 전체를 채우는 스와치 1장**이 된다(프롬프트도 그렇게 요청한다).
 * ```
 *  +------------------+------------------+
 *  |                  |                  |
 *  |   베이스 지형    |  오버레이 지형   |   각 캔버스의 좌/우 절반
 *  |   (예: 잔디)     |  (예: 흙길)      |   디테일 없는 균질 스와치
 *  |                  |                  |
 *  +------------------+------------------+
 * ```
 * 초기 버전에는 하단에 "두 지형이 만나는 전환 샘플" 패널이 하나 더 있었고 거기서
 * 프린지 붓결을 추출해 경계에 알파 블렌딩했다. 그 블렌딩이 경계를 탁하게 만든
 * 원인이었으므로(`edgeProfile.bladeAmplitudeRatio` 주석) 제거했고, 패널도 함께
 * 없앴다. 덕분에 모델이 맞춰야 할 레이아웃이 단순해지고 지형당 스와치 면적이 두 배가 됐다.
 *
 * ## 왜 임의 조합에서 이어지는가
 * 1. 베이스/오버레이 텍스처를 `makeSeamless`로 wrap 연속화하고, **모든 타일이
 *    오프셋 (0,0)으로 동일하게** 샘플링한다. 두 타일을 나란히 놓으면 접합부는
 *    그 텍스처 자신의 wrap 경계와 정확히 같은 지점이 되어 이어진다.
 * 2. 지형 경계는 `edgeProfile.ts`의 엣지 계약을 따르므로, 공유 변에서의
 *    베이스/오버레이 판정이 인접 타일과 완전히 일치한다(2단계에서 전수 증명).
 * 3. 재질에 랜덤성을 주기 위해 슬롯마다 **다른 텍스처 변형**을 쓰지만, 변형은
 *    정규 텍스처와 **변 픽셀을 공유**하도록 만든다(`VARIANT_RAMP_RATIO`).
 *    따라서 1의 결론은 변형을 섞어도 그대로다.
 */

import { getPixelArtGridInfo } from '../../types/pixelart';
import {
  DEFAULT_TILEMAP_OUTLINE,
  TilemapEdgeStyle,
  TilemapGridLayout,
  TilemapOutline,
  TilemapOutlineSide,
  outlineOpacity,
} from '../../types/tilemap';
import { getEdgeStyle } from './edgeStyles';
import { cropMaterialSwatch, makeSeamless } from './seamlessTexture';
import {
  buildTerrainMask,
  resolveMaskOptions,
  warpedTerrainSDFResolved,
  TerrainMaskOptions,
} from './edgeProfile';
import { buildSlotTable, SlotSpec } from './autotileSignature';
import { loadImageElement } from './tileSlicer';

/**
 * 합성 알고리즘 버전. 결과가 달라지는 변경이 있으면 올린다 (세션 데이터 호환 판정용).
 * v2: 재질을 1:1 크롭으로 뽑고(다운스케일 제거), makeSeamless 창에 평탄부를 도입해
 *     전환선(k=T/4)에서 유령을 제거 — 선명도 개선.
 * v3: 경계 프린지 알파 블렌딩을 제거하고 블레이드 변위(이진 맞물림)로 대체 — 경계 탁함 제거.
 *     머티리얼 시트도 전환 패널 없이 좌/우 2패널로 단순화.
 * v4: 경계선 모양 프리셋(edgeStyle)과 경계 아웃라인(두께·색)을 지원.
 * v5: 재질 텍스처를 슬롯마다 다른 **변형**으로 샘플링해 내부 텍스처에 랜덤성을 준다
 *     (그전에는 64장이 모두 같은 텍스처라 화면 전체가 한 타일의 반복으로 보였다).
 *     아웃라인 불투명도·이중 아웃라인도 함께 지원.
 * v6: 지형을 투명으로 둘 수 있다(재질 대신 알파 0). 합성이 프리멀티플라이드 알파로 바뀌었다.
 * v7: 아웃라인이 경계선을 중심으로 양쪽에 퍼지지 않고 **한쪽으로만** 뻗는다.
 *     두 아웃라인은 감싸는 대신 계단처럼 이어 붙어 색이 단계별로 보인다.
 */
export const COMPOSER_VERSION = 7;

/** 셀 128px을 아웃라인 두께의 기준 해상도로 삼는다 (유니티 PPU 128과 맞춘다) */
const OUTLINE_REFERENCE_CELL_PX = 128;

/**
 * 지형당 재질 텍스처 변형 개수.
 *
 * 베이스·오버레이 각각 이 수만큼 만들고 슬롯마다 다른 조합을 고른다 → 8x8 = 64 조합이라
 * 64슬롯이 사실상 전부 다른 재질 표정을 갖는다.
 */
const MATERIAL_VARIANT_COUNT = 8;

/**
 * 변형 텍스처의 **공유 테두리 폭 비율** (타일 한 변 대비).
 *
 * ## 왜 테두리를 공유해야 하는가
 * 유니티 Rule Tile은 어떤 변형을 어느 칸에 놓을지 런타임에 고르므로, 어떤 두 변형이
 * 이웃해도 접합부가 이어져야 한다. 즉 **모든 변형의 변 픽셀이 완전히 동일**해야 한다.
 * 그래서 변형은 "정규 텍스처(wrap 연속) 위에 다른 크롭을 안쪽에만 얹은 것"으로 만든다:
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

/** 합성 옵션 */
export interface RuleTileBuildOptions {
  /** 경계선 모양 프리셋 (미지정 시 기본 프리셋) */
  edgeStyle?: TilemapEdgeStyle;
  /** 경계 아웃라인 (미지정 시 비활성) */
  outline?: TilemapOutline;
  /** 보조 아웃라인 — 1단계 띠에 이어 붙는 2단계 띠 (미지정 시 비활성) */
  outline2?: TilemapOutline;
  /** 아웃라인을 뻗는 방향 (미지정 시 'outer' = 오버레이 바깥쪽) */
  outlineSide?: TilemapOutlineSide;
  /**
   * 베이스 지형을 재질 대신 **투명**(알파 0)으로 합성한다.
   * 어떤 바닥 타일 위에도 얹을 수 있는 길 타일을 만들 때 쓴다 — 오버레이와 아웃라인만 남는다.
   */
  transparentBase?: boolean;
  /** 오버레이 지형을 투명으로 합성한다 (베이스만 남긴다) */
  transparentOverlay?: boolean;
  /** 프리셋 위에 덮어쓸 마스크 파라미터 (실험·검증용) */
  maskOverrides?: TerrainMaskOptions;
}

/** 합성 결과 */
export interface RuleTileSet {
  /** 슬롯 순서(행우선) 타일 dataURL */
  tiles: string[];
  /**
   * 순수 베이스 지형 타일 **변형 목록** — 그리드 슬롯 밖에서 별도로 쓴다.
   * 베이스 지형은 맵의 대부분을 덮으므로 한 장만 쓰면 바닥 전체가 같은 무늬로 반복된다.
   * 모든 변형은 변 픽셀을 공유하므로 아무 순서로 섞어 칠해도 이어진다.
   * 베이스가 투명이면 칠할 바닥 자체가 없으므로 **빈 배열**이다.
   */
  baseTiles: string[];
  /** 슬롯별 signature/변형 정보 (뱃지·가이드용) */
  slots: SlotSpec[];
}

/**
 * 이벤트 루프에 양보 — 긴 합성 루프가 메인 스레드를 독점하지 않게 한다.
 *
 * `setTimeout(0)`을 쓰면 안 된다: **백그라운드 탭에서 1초로 클램프**되므로 타일 64장이면
 * 64초가 걸린다(실측으로 확인했다 — 합성 계산 자체는 세트 전체가 0.5초다).
 * `MessageChannel` 메시지는 스로틀 대상이 아니라서 백그라운드에서도 즉시 돌아온다.
 */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}

/** 캔버스 헬퍼 */
function createCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function get2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('canvas 2d context를 생성할 수 없습니다');
  return ctx;
}

/** `#RRGGBB` → [r,g,b]. 파싱 실패 시 기본 아웃라인 색으로 폴백 */
function parseHexColor(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return parseHexColor(DEFAULT_TILEMAP_OUTLINE.color);
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** 머티리얼 시트에서 뽑아낸 재료 */
interface Materials {
  /** 베이스 지형 텍스처 변형들 (index 0 = 정규 wrap 연속 텍스처). 투명 지형이면 빈 배열 */
  baseTextures: Uint8ClampedArray[];
  /** 오버레이 지형 텍스처 변형들 (index 0 = 정규 wrap 연속 텍스처). 투명 지형이면 빈 배열 */
  overlayTextures: Uint8ClampedArray[];
  tileSize: number;
}

/** 5차 스무스스텝 */
function smoothstep(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * c * (c * (c * 6 - 15) + 10);
}

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

/** 결정적 해시 (슬롯 → 텍스처 변형 선택용) */
function hashInt(a: number, seed: number): number {
  let h = (a * 374761393 + seed * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = h ^ (h >>> 16);
  return h >>> 0;
}

/**
 * 한 지형 패널에서 재질 텍스처 **변형 목록**을 만든다.
 *
 * - index 0 : 패널 중앙을 1:1 크롭해 `makeSeamless`로 wrap 연속화한 **정규 텍스처**
 * - index v : 패널의 다른 위치를 크롭해 정규 텍스처의 **안쪽에만** 얹은 것
 *
 * 변 픽셀은 전부 정규 텍스처와 동일하므로 어떤 변형끼리 이웃해도 접합이 이어진다
 * (`VARIANT_RAMP_RATIO` 주석의 계약 설명 참조).
 *
 * 크롭 위치는 황금비 저불일치 수열로 패널 전체에 고르게 흩는다 — 규칙적인 격자로
 * 잡으면 변형끼리 겹치는 영역이 많아져 차이가 잘 드러나지 않는다.
 */
function buildTextureVariants(
  img: CanvasImageSource,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  T: number
): Uint8ClampedArray[] {
  const canonicalCanvas = makeSeamless(cropMaterialSwatch(img, sx, sy, sw, sh, T), T);
  const canonical = get2d(canonicalCanvas).getImageData(0, 0, T, T).data;
  const variants: Uint8ClampedArray[] = [canonical];

  // 크롭 여유가 없으면(모델이 규격보다 작은 이미지를 준 경우) 변형을 만들 수 없다 — 정규 1장으로 폴백
  const spanX = Math.max(0, sw - T);
  const spanY = Math.max(0, sh - T);
  if (spanX < 4 && spanY < 4) return variants;

  // 축 방향 가중치를 미리 계산 (픽셀 루프에서는 곱만 한다)
  const axis = new Float32Array(T);
  for (let i = 0; i < T; i++) axis[i] = variantAxisWeight(i, T);

  for (let v = 1; v < MATERIAL_VARIANT_COUNT; v++) {
    const fx = (v * 0.6180339887498949) % 1;
    const fy = (v * 0.7548776662466927) % 1;
    const crop = get2d(cropMaterialSwatch(img, sx + spanX * fx, sy + spanY * fy, T, T, T))
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
 * 머티리얼 시트 이미지에서 재료를 추출한다.
 * 시트가 정사각형이 아니어도 실측 비율로 영역을 해석한다.
 */
async function extractMaterials(
  sheetDataUrl: string,
  tileSize: number,
  transparentBase: boolean,
  transparentOverlay: boolean
): Promise<Materials> {
  const img = await loadImageElement(sheetDataUrl);
  const W = img.width;
  const H = img.height;

  // 한쪽이 투명이면 시트는 캔버스 전체를 채우는 스와치 1장이다 (프롬프트가 그렇게 요청한다).
  // 투명 지형은 재질을 뽑지 않고 빈 배열로 둔다 — 합성 단계에서 알파 0으로 처리한다.
  if (transparentBase && transparentOverlay) {
    // 둘 다 투명하면 타일에 남는 게 아웃라인뿐이다. UI에서 막지만 방어적으로 허용한다
    return { baseTextures: [], overlayTextures: [], tileSize };
  }
  if (transparentBase) {
    return {
      baseTextures: [],
      overlayTextures: buildTextureVariants(img, 0, 0, W, H, tileSize),
      tileSize,
    };
  }
  if (transparentOverlay) {
    return {
      baseTextures: buildTextureVariants(img, 0, 0, W, H, tileSize),
      overlayTextures: [],
      tileSize,
    };
  }

  // 좌/우 절반이 각각 베이스·오버레이 스와치.
  // 축소가 아니라 1:1 크롭이다 — 다운스케일은 또렷한 재질의 디테일을 통째로 날린다
  // (cropMaterialSwatch 주석 참조)
  return {
    baseTextures: buildTextureVariants(img, 0, 0, W / 2, H, tileSize),
    overlayTextures: buildTextureVariants(img, W / 2, 0, W / 2, H, tileSize),
    tileSize,
  };
}

/** 픽셀 루프에서 쓰는 아웃라인 띠 하나 (미리 해석해 둔다) */
export interface OutlineLayer {
  /** 경계선에서 이 띠가 시작하는 거리 (px, 지정한 방향으로) */
  start: number;
  /** 끝나는 거리 (px) */
  end: number;
  r: number;
  g: number;
  b: number;
  /** 0~1 불투명도 */
  alpha: number;
}

/** 해석된 아웃라인 띠들 + 방향 부호 */
export interface OutlineBands {
  /**
   * SDF에 곱해 "지정한 방향으로의 거리"를 만드는 부호.
   * SDF는 오버레이 내부가 양수이므로, 바깥쪽(`outer`)은 -1이다.
   */
  sign: number;
  /** 경계선에서 가까운 순서 (1단계 → 2단계). 서로 겹치지 않고 이어 붙는다 */
  layers: OutlineLayer[];
}

/**
 * 아웃라인 설정을 픽셀 루프용 띠로 해석한다.
 *
 * ## 왜 경계선을 중심으로 두지 않는가
 * 예전에는 두 아웃라인이 모두 `|SDF| < 반두께`로 **경계선을 가운데 두고 양쪽에** 퍼졌다.
 * 그러면 굵은 쪽이 얇은 쪽을 **감싸는** 동심 구조밖에 나오지 않아, 두 색을 단계별로
 * 늘어놓을 수가 없었다. 지금은 각 띠가 지정한 **한쪽 방향으로만** 뻗고, 2단계 띠는
 * 1단계 띠가 끝나는 지점에서 **이어서** 시작한다:
 *
 * ```
 *   [오버레이 재질] │ 1단계 띠 │ 2단계 띠 │ [베이스 재질/투명]
 *                  ↑ 경계선(SDF=0)      바깥쪽 →
 * ```
 *
 * 폭은 셀 128px 기준값을 실제 셀 크기로 환산해, 유니티에서 PPU 128로 임포트했을 때
 * 4x4(256px)와 8x8(128px)이 같은 세계 두께로 보이게 한다.
 *
 * ## 엣지 계약
 * 예전 방식은 SDF의 *크기*만 공유 변에서 일치하면 됐지만, 방향이 생겼으니 **부호까지**
 * 일치해야 한다. 부호는 지형 판정 그 자체이므로 엣지 계약이 이미 보장한다(2단계에서
 * 전수 증명). 따라서 띠도 타일 경계에서 끊기지 않는다 — 전용 게이트로 확인한다.
 */
export function resolveOutlineBands(
  T: number,
  outlines: Array<TilemapOutline | undefined>,
  side: TilemapOutlineSide = 'outer'
): OutlineBands {
  let cursor = 0;
  const layers = outlines
    .filter((o): o is TilemapOutline => !!o?.enabled && o.thicknessPx > 0 && outlineOpacity(o) > 0)
    .map((o) => {
      const [r, g, b] = parseHexColor(o.color);
      const start = cursor;
      cursor += o.thicknessPx * (T / OUTLINE_REFERENCE_CELL_PX);
      return { start, end: cursor, r, g, b, alpha: outlineOpacity(o) };
    });
  return { sign: side === 'inner' ? 1 : -1, layers };
}

/** `sampleOutline` 결과를 담는 그릇 — 픽셀 루프 밖에서 한 번만 만들어 재사용한다 */
export interface OutlineSample {
  /** 프리멀티플라이드 알파 (0~1) */
  a: number;
  /** 프리멀티플라이드 색 */
  r: number;
  g: number;
  b: number;
}

/**
 * 한 픽셀에 얹을 아웃라인 기여분을 계산한다 (프리멀티플라이드).
 *
 * 각 띠의 가중치를 `clamp(t - start + 0.5) - clamp(t - end + 0.5)` 로 잡는 이유:
 * 이렇게 두면 맞닿은 두 띠의 가중치가 경계에서 **정확히 0.5씩으로 서로 보완**되어 합이 1이
 * 된다. 띠를 하나씩 순서대로 source-over 하면 그 지점에서 두 띠가 각각 0.5만 덮어
 * 아래(재질/투명)가 25% 비쳐 **1px 틈**이 생긴다 — 투명 베이스에서는 반투명 선으로 보인다.
 * 그래서 기여분을 **먼저 다 합친 뒤 한 번에** 합성한다.
 *
 * 가중치 합은 전체 띠 구간의 커버리지(<= 1)이고 불투명도도 <= 1이므로 `a <= 1`이 보장된다.
 */
export function sampleOutline(bands: OutlineBands, d: number, out: OutlineSample): void {
  out.a = 0;
  out.r = 0;
  out.g = 0;
  out.b = 0;
  const t = bands.sign * d; // 지정한 방향으로의 거리
  const layers = bands.layers;
  for (let i = 0; i < layers.length; i++) {
    const L = layers[i];
    const lo = t - L.start + 0.5;
    const hi = t - L.end + 0.5;
    const w = (lo < 0 ? 0 : lo > 1 ? 1 : lo) - (hi < 0 ? 0 : hi > 1 ? 1 : hi);
    if (w <= 0) continue;
    const a = w * L.alpha;
    out.a += a;
    out.r += a * L.r;
    out.g += a * L.g;
    out.b += a * L.b;
  }
}

/**
 * 타일 한 장을 합성한다.
 *
 * 픽셀마다 SDF 부호로 베이스/오버레이를 **이진 결정**하고, 경계에서 1px만
 * 안티에일리어싱한다. 그 이상 섞지 않는다 — 알파 블렌딩은 두 텍스처의 평균을
 * 만들어 경계를 탁하게 하므로(`bladeAmplitudeRatio` 주석 참조), 손맵스러운 경계는
 * 색을 섞어서가 아니라 `edgeProfile`의 블레이드 변위로 두 지형이 맞물리게 해서 만든다.
 *
 * 재질은 슬롯마다 **다른 텍스처 변형**을 고른다. 예전에는 64장이 모두 같은 텍스처를
 * 같은 오프셋으로 샘플링해서, 경계 모양은 달라도 화면 전체가 한 타일의 반복으로 보였다.
 * 변형은 변 픽셀을 공유하므로 접합 계약은 그대로다(`VARIANT_RAMP_RATIO` 주석).
 *
 * 아웃라인은 경계선에서 **한쪽 방향으로만** 뻗는 계단식 띠다(`resolveOutlineBands`).
 *
 * ## 투명 지형과 프리멀티플라이드 알파
 * 지형 텍스처가 없으면(투명) 그 쪽은 알파 0이다. 합성을 **프리멀티플라이드**로 하는 이유:
 * 경계 1px AA와 아웃라인 덮기가 모두 알파를 건드리는데, 스트레이트 알파로 섞으면
 * 투명 픽셀의 (의미 없는) RGB가 결과에 끼어들어 경계에 검은 테두리가 생긴다.
 * 마지막에 한 번만 언프리멀티플라이해서 내보낸다.
 */
function composeTile(
  materials: Materials,
  slot: SlotSpec,
  slotIndex: number,
  mask: TerrainMaskOptions,
  outlineBands: OutlineBands
): string {
  const T = materials.tileSize;
  // 옵션 해석은 픽셀 루프 **밖에서 한 번만** (edgeProfile.ResolvedMaskOptions 주석 참조)
  const opts = resolveMaskOptions(T, { ...mask, warpSeed: slot.variant });

  // 슬롯마다 베이스·오버레이 변형을 독립적으로 고른다 (결정적 — 같은 시트는 항상 같은 결과).
  // 투명 지형이면 텍스처가 없다(null)
  const bt =
    materials.baseTextures.length > 0
      ? materials.baseTextures[hashInt(slotIndex, 0x9e37) % materials.baseTextures.length]
      : null;
  const ot =
    materials.overlayTextures.length > 0
      ? materials.overlayTextures[hashInt(slotIndex, 0x85eb) % materials.overlayTextures.length]
      : null;

  const canvas = createCanvas(T, T);
  const ctx = get2d(canvas);
  const out = ctx.createImageData(T, T);
  const hasOutline = outlineBands.layers.length > 0;
  const bothOpaque = bt !== null && ot !== null;
  // 픽셀 루프 밖에서 한 번만 만들어 재사용 (세트당 100만 픽셀 — 픽셀마다 객체를 만들면 GC가 터진다)
  const outline: OutlineSample = { a: 0, r: 0, g: 0, b: 0 };

  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      const i = (y * T + x) * 4;
      const d = warpedTerrainSDFResolved(slot.signature, x + 0.5, y + 0.5, T, opts);

      // 경계 1px 안티에일리어싱만 — 그 이상 섞지 않는다
      const w = Math.max(0, Math.min(1, d + 0.5));

      // 프리멀티플라이드 누산기 (pa = 알파 0~1, pr/pg/pb = 색 x 알파)
      let pa: number;
      let pr: number;
      let pg: number;
      let pb: number;
      if (bothOpaque) {
        // 두 지형 다 불투명 — 알파는 항상 1이라 기존 경로와 완전히 같다
        pa = 1;
        pr = bt![i] * (1 - w) + ot![i] * w;
        pg = bt![i + 1] * (1 - w) + ot![i + 1] * w;
        pb = bt![i + 2] * (1 - w) + ot![i + 2] * w;
      } else {
        const ab = bt ? 1 - w : 0;
        const ao = ot ? w : 0;
        pa = ab + ao;
        pr = (bt ? bt[i] * ab : 0) + (ot ? ot[i] * ao : 0);
        pg = (bt ? bt[i + 1] * ab : 0) + (ot ? ot[i + 1] * ao : 0);
        pb = (bt ? bt[i + 2] * ab : 0) + (ot ? ot[i + 2] * ao : 0);
      }

      // 아웃라인: 경계선에서 한쪽으로 뻗는 띠들을 한 번에 합성한다.
      // 알파 그라디언트가 아니라 1px 안티에일리어싱만 있는 하드 스텐실이라 지형이 탁해지지 않는다.
      // 불투명도는 "덮는 양"을 줄이는 것 — 그림자처럼 은은하게 깔 때 쓴다.
      // 투명 지형 위에도 그대로 얹힌다(source-over) — 그래야 반쪽만 남은 윤곽선이 되지 않는다.
      if (hasOutline) {
        sampleOutline(outlineBands, d, outline);
        if (outline.a > 0) {
          const keep = 1 - outline.a;
          pr = outline.r + pr * keep;
          pg = outline.g + pg * keep;
          pb = outline.b + pb * keep;
          pa = outline.a + pa * keep;
        }
      }

      // 언프리멀티플라이 (알파가 0이면 색은 의미가 없으므로 0으로 둔다)
      if (pa > 0) {
        const inv = 1 / pa;
        out.data[i] = pr * inv;
        out.data[i + 1] = pg * inv;
        out.data[i + 2] = pb * inv;
        out.data[i + 3] = pa * 255;
      } else {
        out.data[i] = 0;
        out.data[i + 1] = 0;
        out.data[i + 2] = 0;
        out.data[i + 3] = 0;
      }
    }
  }

  ctx.putImageData(out, 0, 0);
  return canvas.toDataURL('image/png');
}

/** 순수 베이스 타일 1장 (마스크 없이 베이스 텍스처 변형 그대로) */
function composeBaseTile(texture: Uint8ClampedArray, T: number): string {
  const canvas = createCanvas(T, T);
  const ctx = get2d(canvas);
  const out = ctx.createImageData(T, T);
  out.data.set(texture);
  // 알파를 완전 불투명으로 고정 (텍스처가 투명 픽셀을 가진 경우 대비)
  for (let i = 3; i < out.data.length; i += 4) out.data[i] = 255;
  ctx.putImageData(out, 0, 0);
  return canvas.toDataURL('image/png');
}

/**
 * 머티리얼 시트에서 룰타일 세트를 합성한다.
 *
 * @param sheetDataUrl AI가 생성한 머티리얼 시트 (레이아웃은 파일 상단 주석 참조)
 * @param grid         '4x4'(16종 4비트 세트) 또는 '8x8'(47종 blob 세트 + 17 변형)
 */
export async function buildRuleTileSet(
  sheetDataUrl: string,
  grid: TilemapGridLayout,
  options?: RuleTileBuildOptions
): Promise<RuleTileSet> {
  const { cellSize } = getPixelArtGridInfo(grid);
  const materials = await extractMaterials(
    sheetDataUrl,
    cellSize,
    options?.transparentBase ?? false,
    options?.transparentOverlay ?? false
  );
  const slots = buildSlotTable(grid);
  const mask: TerrainMaskOptions = {
    ...getEdgeStyle(options?.edgeStyle).mask,
    ...options?.maskOverrides,
  };
  const outlineBands = resolveOutlineBands(
    cellSize,
    [options?.outline, options?.outline2],
    options?.outlineSide
  );

  // 타일 사이마다 이벤트 루프에 양보한다. 64장(8x8) x 셀 128px = 100만 픽셀을 한 번에
  // 동기 처리하면 메인 스레드가 수 초간 막혀 UI가 얼어붙는다(dev 검증 페이지에서는
  // 렌더러가 응답 불가 상태가 되어 CDP 호출까지 타임아웃됐다).
  const tiles: string[] = [];
  for (let i = 0; i < slots.length; i++) {
    tiles.push(composeTile(materials, slots[i], i, mask, outlineBands));
    await yieldToEventLoop();
  }

  return {
    tiles,
    // 베이스가 투명이면 칠할 바닥이 없다 → 빈 배열 (내보내기·미리보기가 이걸로 판단한다)
    baseTiles: materials.baseTextures.map((tex) => composeBaseTile(tex, cellSize)),
    slots,
  };
}

/** 마스크만 필요한 경우(미리보기·검증용) 재노출 */
export { buildTerrainMask };
