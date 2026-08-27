/**
 * 룰타일 경계선 모양 프리셋.
 *
 * 지형 경계는 코드가 만들므로(`edgeProfile.ts`) 그 모양을 파라미터로 골라 쓸 수 있다.
 * 재질(잔디/흙)이 무엇이든 프리셋만 바꾸면 경계 표정이 바뀐다 — 이전에는 모든 지형이
 * 똑같은 경계 모양을 갖는 문제가 있었다.
 *
 * ## 프리셋이 계약을 깨지 않는 이유
 * 프리셋은 `TerrainMaskOptions`의 진폭·주파수만 조절한다. 변위장은 어떤 값이든
 * 타일 변에서 0이 되도록 창(`warpEdgeFalloffRatio`)이 곱해지므로 엣지 계약은 유지된다.
 * `cornerRoundRatio`도 인셋 라인에 접하는 라운딩이라 변 위의 지형 판정과 무관하다.
 *
 * ## 파라미터 읽는 법
 * - `warpAmplitudeRatio` / `warpFrequencyPx` : 경계의 **큰 흐름** (구불거림)
 * - `bladeAmplitudeRatio` / `bladeFrequencyPx` : 두 지형이 맞물리는 **잔가지**
 *   (진폭↑ = 더 깊이 침범, 주파수↑ = 더 굵고 큰 손가락)
 * - `cornerRoundRatio` : 볼록 코너 라운드 정도 (0 = 각짐, 1 = 최대 라운드)
 */

import { TilemapEdgeStyle, DEFAULT_TILEMAP_EDGE_STYLE } from '../../types/tilemap';
import { TerrainMaskOptions } from './edgeProfile';

export interface TilemapEdgeStylePreset {
  id: TilemapEdgeStyle;
  /** 드롭다운 라벨 */
  label: string;
  /** 한 줄 설명 */
  hint: string;
  /** 합성기에 그대로 넘기는 마스크 옵션 */
  mask: TerrainMaskOptions;
}

export const TILEMAP_EDGE_STYLES: TilemapEdgeStylePreset[] = [
  {
    id: 'blades',
    label: '잔가지 (기본)',
    hint: '가늘게 맞물리는 풀잎 느낌',
    mask: {
      warpAmplitudeRatio: 0.40,
      warpFrequencyPx: 26,
      bladeAmplitudeRatio: 0.30,
      bladeFrequencyPx: 6,
      cornerRoundRatio: 0.6,
    },
  },
  {
    id: 'chunky',
    label: '굵은 맞물림',
    hint: '큼직한 손가락 형태 · 캐주얼',
    mask: {
      warpAmplitudeRatio: 0.35,
      warpFrequencyPx: 30,
      bladeAmplitudeRatio: 0.45,
      bladeFrequencyPx: 15,
      cornerRoundRatio: 0.7,
    },
  },
  {
    id: 'torn',
    label: '거친 찢김',
    hint: '깊고 불규칙하게 파고드는 거친 경계',
    mask: {
      warpAmplitudeRatio: 0.30,
      warpFrequencyPx: 22,
      bladeAmplitudeRatio: 0.60,
      bladeFrequencyPx: 4,
      cornerRoundRatio: 0.5,
    },
  },
  {
    id: 'wavy',
    label: '물결',
    hint: '맞물림 없이 크게 구불거리는 곡선',
    mask: {
      warpAmplitudeRatio: 0.60,
      warpFrequencyPx: 42,
      bladeAmplitudeRatio: 0,
      bladeFrequencyPx: 8,
      cornerRoundRatio: 0.8,
    },
  },
  {
    id: 'pebble',
    label: '조약돌',
    hint: '둥글둥글 뭉친 덩어리 윤곽',
    mask: {
      warpAmplitudeRatio: 0.28,
      warpFrequencyPx: 55,
      bladeAmplitudeRatio: 0.22,
      bladeFrequencyPx: 24,
      cornerRoundRatio: 1.0,
    },
  },
  {
    id: 'clean',
    label: '매끈함',
    hint: '흔들림 최소 · 깔끔한 유기 곡선',
    mask: {
      warpAmplitudeRatio: 0.15,
      warpFrequencyPx: 38,
      bladeAmplitudeRatio: 0,
      bladeFrequencyPx: 8,
      cornerRoundRatio: 0.85,
    },
  },
  {
    id: 'sharp',
    label: '각진 형태',
    hint: '거의 직선 · 기하학적',
    mask: {
      warpAmplitudeRatio: 0.06,
      warpFrequencyPx: 30,
      bladeAmplitudeRatio: 0.04,
      bladeFrequencyPx: 12,
      cornerRoundRatio: 0.12,
    },
  },
];

/** id로 프리셋 조회 — 미지정/미인식이면 기본 프리셋 */
export function getEdgeStyle(id?: TilemapEdgeStyle): TilemapEdgeStylePreset {
  return (
    TILEMAP_EDGE_STYLES.find((s) => s.id === id) ??
    TILEMAP_EDGE_STYLES.find((s) => s.id === DEFAULT_TILEMAP_EDGE_STYLE)!
  );
}
