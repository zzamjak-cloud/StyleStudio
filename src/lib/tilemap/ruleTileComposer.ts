/**
 * 룰타일 합성기 — 머티리얼 시트 1장에서 교체 가능한 타일 세트를 만든다.
 *
 * 룰타일 v3 파이프라인의 4단계이자 핵심이다. AI가 그린 그림을 **자르지 않는다**.
 * AI에게는 재질과 화풍만 받고(머티리얼 시트), 타일의 지형 경계는 코드가
 * `edgeProfile.ts`의 계약에 따라 직접 그린다.
 *
 * ## 머티리얼 시트 레이아웃 (실측 비율로 해석 — 좌우 2등분)
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
 */

import { getPixelArtGridInfo } from '../../types/pixelart';
import {
  DEFAULT_TILEMAP_OUTLINE,
  TilemapEdgeStyle,
  TilemapGridLayout,
  TilemapOutline,
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
 */
export const COMPOSER_VERSION = 4;

/** 셀 128px을 아웃라인 두께의 기준 해상도로 삼는다 (유니티 PPU 128과 맞춘다) */
const OUTLINE_REFERENCE_CELL_PX = 128;

/** 합성 옵션 */
export interface RuleTileBuildOptions {
  /** 경계선 모양 프리셋 (미지정 시 기본 프리셋) */
  edgeStyle?: TilemapEdgeStyle;
  /** 경계 아웃라인 (미지정 시 비활성) */
  outline?: TilemapOutline;
  /** 프리셋 위에 덮어쓸 마스크 파라미터 (실험·검증용) */
  maskOverrides?: TerrainMaskOptions;
}

/** 합성 결과 */
export interface RuleTileSet {
  /** 슬롯 순서(행우선) 타일 dataURL */
  tiles: string[];
  /** 순수 베이스 지형 타일 — 그리드 슬롯 밖에서 별도로 쓴다 */
  baseTile: string;
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
  baseTexture: Uint8ClampedArray;
  overlayTexture: Uint8ClampedArray;
  tileSize: number;
}

/**
 * 머티리얼 시트 이미지에서 재료를 추출한다.
 * 시트가 정사각형이 아니어도 실측 비율로 영역을 해석한다.
 */
async function extractMaterials(sheetDataUrl: string, tileSize: number): Promise<Materials> {
  const img = await loadImageElement(sheetDataUrl);
  const W = img.width;
  const H = img.height;

  // 좌/우 절반이 각각 베이스·오버레이 스와치.
  // 축소가 아니라 1:1 크롭이다 — 다운스케일은 또렷한 재질의 디테일을 통째로 날린다
  // (cropMaterialSwatch 주석 참조)
  const baseField = cropMaterialSwatch(img, 0, 0, W / 2, H, tileSize);
  const overlayField = cropMaterialSwatch(img, W / 2, 0, W / 2, H, tileSize);
  const baseSeamless = makeSeamless(baseField, tileSize);
  const overlaySeamless = makeSeamless(overlayField, tileSize);

  return {
    baseTexture: get2d(baseSeamless).getImageData(0, 0, tileSize, tileSize).data,
    overlayTexture: get2d(overlaySeamless).getImageData(0, 0, tileSize, tileSize).data,
    tileSize,
  };
}

/**
 * 타일 한 장을 합성한다.
 *
 * 픽셀마다 SDF 부호로 베이스/오버레이를 **이진 결정**하고, 경계에서 1px만
 * 안티에일리어싱한다. 그 이상 섞지 않는다 — 알파 블렌딩은 두 텍스처의 평균을
 * 만들어 경계를 탁하게 하므로(`bladeAmplitudeRatio` 주석 참조), 손맵스러운 경계는
 * 색을 섞어서가 아니라 `edgeProfile`의 블레이드 변위로 두 지형이 맞물리게 해서 만든다.
 */
function composeTile(
  materials: Materials,
  slot: SlotSpec,
  mask: TerrainMaskOptions,
  outline: TilemapOutline | undefined
): string {
  const T = materials.tileSize;
  // 옵션 해석은 픽셀 루프 **밖에서 한 번만** (edgeProfile.ResolvedMaskOptions 주석 참조)
  const opts = resolveMaskOptions(T, { ...mask, warpSeed: slot.variant });

  // 아웃라인 반두께. 셀 128px 기준값을 실제 셀 크기로 환산해, 유니티에서 PPU 128로
  // 임포트했을 때 4x4(256px)와 8x8(128px)이 같은 세계 두께로 보이게 한다.
  const outlineHalf = outline?.enabled
    ? (outline.thicknessPx * (T / OUTLINE_REFERENCE_CELL_PX)) / 2
    : 0;
  const [or, og, ob] = outline?.enabled
    ? parseHexColor(outline.color)
    : [0, 0, 0];

  const canvas = createCanvas(T, T);
  const ctx = get2d(canvas);
  const out = ctx.createImageData(T, T);
  const { baseTexture, overlayTexture } = materials;

  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      const i = (y * T + x) * 4;
      const d = warpedTerrainSDFResolved(slot.signature, x + 0.5, y + 0.5, T, opts);

      // 경계 1px 안티에일리어싱만 — 그 이상 섞지 않는다
      const w = Math.max(0, Math.min(1, d + 0.5));
      let r = baseTexture[i] * (1 - w) + overlayTexture[i] * w;
      let g = baseTexture[i + 1] * (1 - w) + overlayTexture[i + 1] * w;
      let b = baseTexture[i + 2] * (1 - w) + overlayTexture[i + 2] * w;

      // 아웃라인: 경계선 양옆 outlineHalf 안쪽을 지정 색으로 덮는다.
      // 알파 그라디언트가 아니라 1px 안티에일리어싱만 있는 하드 스텐실이므로 탁해지지 않는다.
      if (outlineHalf > 0) {
        const cover = Math.max(0, Math.min(1, outlineHalf + 0.5 - Math.abs(d)));
        if (cover > 0) {
          r = r * (1 - cover) + or * cover;
          g = g * (1 - cover) + og * cover;
          b = b * (1 - cover) + ob * cover;
        }
      }

      out.data[i] = r;
      out.data[i + 1] = g;
      out.data[i + 2] = b;
      out.data[i + 3] = 255;
    }
  }

  ctx.putImageData(out, 0, 0);
  return canvas.toDataURL('image/png');
}

/** 순수 베이스 타일 (마스크 없이 seamless 베이스 텍스처 그대로) */
function composeBaseTile(materials: Materials): string {
  const T = materials.tileSize;
  const canvas = createCanvas(T, T);
  const ctx = get2d(canvas);
  const out = ctx.createImageData(T, T);
  out.data.set(materials.baseTexture);
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
  const materials = await extractMaterials(sheetDataUrl, cellSize);
  const slots = buildSlotTable(grid);
  const mask: TerrainMaskOptions = {
    ...getEdgeStyle(options?.edgeStyle).mask,
    ...options?.maskOverrides,
  };

  // 타일 사이마다 이벤트 루프에 양보한다. 64장(8x8) x 셀 128px = 100만 픽셀을 한 번에
  // 동기 처리하면 메인 스레드가 수 초간 막혀 UI가 얼어붙는다(dev 검증 페이지에서는
  // 렌더러가 응답 불가 상태가 되어 CDP 호출까지 타임아웃됐다).
  const tiles: string[] = [];
  for (const slot of slots) {
    tiles.push(composeTile(materials, slot, mask, options?.outline));
    await yieldToEventLoop();
  }

  return {
    tiles,
    baseTile: composeBaseTile(materials),
    slots,
  };
}

/** 마스크만 필요한 경우(미리보기·검증용) 재노출 */
export { buildTerrainMask };
