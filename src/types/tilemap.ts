import { PixelArtGridLayout } from './pixelart';

/**
 * 타일맵 그리드 레이아웃 (PixelArtGridLayout의 부분집합)
 * 타일맵 세션은 4x4(16타일·셀 256px)와 8x8(64타일·셀 128px)만 지원한다.
 */
export type TilemapGridLayout = Extract<PixelArtGridLayout, '4x4' | '8x8'>;

/** 타일셋 모드: 변형 세트(상호교환) vs 룰타일 지형 전환 세트(역할 고정) */
export type TilemapMode = 'variation' | 'ruletile';

/** 타일맵에서 지원하는 그리드 목록 (UI 노출용) */
export const TILEMAP_GRID_LAYOUTS: TilemapGridLayout[] = ['4x4', '8x8'];

/**
 * 룰타일 모드에서 강제되는 그리드.
 *
 * 4x4(16타일)는 상하좌우만 구분하는 4비트 세트라 오목 코너가 없고, 좁게 꺾인 길이나
 * 안쪽 모서리를 표현할 수 없다 — "완벽한 룰타일"이 되지 못한다. 8x8(64타일)은 blob
 * 47종 + 변형 17종으로 모든 조합을 담으므로, 룰타일 모드는 8x8로 고정한다.
 */
export const TILEMAP_RULETILE_GRID: TilemapGridLayout = '8x8';

/**
 * 룰타일 경계선 모양 프리셋 식별자.
 * 실제 파라미터는 `lib/tilemap/edgeStyles.ts`에 있다 (여기서 import하면 순환 참조가 된다).
 */
export type TilemapEdgeStyle =
  | 'blades'
  | 'chunky'
  | 'torn'
  | 'wavy'
  | 'pebble'
  | 'clean'
  | 'sharp'
  | 'polygon'
  | 'crystal';

/**
 * 기본 경계선 모양.
 * 손맵 타일셋에서 가장 무난하게 읽히는 굵은 맞물림을 기본값으로 둔다
 * (v3까지는 'blades'였다 — 잔가지는 셀 128px에서 너무 가늘게 보였다).
 */
export const DEFAULT_TILEMAP_EDGE_STYLE: TilemapEdgeStyle = 'chunky';

/**
 * 아웃라인을 그릴 방향.
 *
 * 아웃라인은 경계선을 **가운데 두고 양쪽으로** 퍼지지 않고, 지정한 한쪽으로만 뻗는다.
 * 그래야 두 아웃라인이 서로를 감싸지 않고 **계단처럼 나란히** 놓여 색이 단계별로 보인다.
 *
 * - `outer` : 오버레이 지형 경계의 **바깥쪽**(베이스 쪽)으로. 오버레이 재질은 온전히 보인다.
 * - `inner` : 오버레이 **안쪽**으로. 안쪽 테두리/림 효과.
 */
export type TilemapOutlineSide = 'outer' | 'inner';

/** 기본 아웃라인 방향 — 길 타일의 테두리가 바깥으로 번지는 형태가 가장 흔하다 */
export const DEFAULT_TILEMAP_OUTLINE_SIDE: TilemapOutlineSide = 'outer';

/**
 * 경계선에서 한쪽으로 뻗는 아웃라인 띠 하나.
 * 캐주얼한 감도를 사용자가 직접 잡을 수 있게 폭과 색을 노출한다.
 */
export interface TilemapOutline {
  enabled: boolean;
  /**
   * 띠의 폭(px) — 경계선에서 지정한 방향으로 이만큼 뻗는다(양쪽 합이 아니다).
   * 셀 128px 기준값이며, 4x4(셀 256px)에서는 내부적으로 2배로 환산해
   * 유니티에서 PPU 128로 임포트했을 때 **세계 좌표상 두께가 같게** 보이도록 한다.
   */
  thicknessPx: number;
  /** `#RRGGBB` */
  color: string;
  /**
   * 불투명도 0~1 (미지정 시 1 = 완전 불투명).
   *
   * 윤곽선으로 쓸 때는 1이지만, 경계에 그림자처럼 깔 때는 낮춰 쓴다.
   * 하드 스텐실의 **덮는 양**을 줄이는 것이라 경계 자체는 여전히 이진 결정이다
   * (알파 블렌딩으로 지형을 섞는 것과는 다르다).
   */
  opacity?: number;
}

/** 아웃라인 두께 허용 범위 (셀 128px 기준 px) */
export const TILEMAP_OUTLINE_THICKNESS_RANGE = { min: 1, max: 12 } as const;

export const DEFAULT_TILEMAP_OUTLINE: TilemapOutline = {
  enabled: false,
  thicknessPx: 2,
  color: '#3b2f2a',
  opacity: 1,
};

/**
 * 보조(2번째) 아웃라인 기본값 — 1단계 띠가 끝나는 지점에서 **이어서** 시작하는 2단계 띠.
 * 감싸는 게 아니라 나란히 놓이므로 두 색이 계단처럼 단계별로 보인다.
 */
export const DEFAULT_TILEMAP_OUTLINE2: TilemapOutline = {
  enabled: false,
  thicknessPx: 3,
  color: '#1f1a17',
  opacity: 1,
};

/** 아웃라인 불투명도를 0~1로 정규화 (미지정 = 1) */
export function outlineOpacity(outline?: TilemapOutline): number {
  const v = outline?.opacity;
  if (typeof v !== 'number' || Number.isNaN(v)) return 1;
  return Math.max(0, Math.min(1, v));
}

/**
 * 생성된 시트 1장. 원본 1024 이미지는 imageStorage 키로만 보관한다(직접 base64 저장 금지).
 *
 * 모드·버전에 따라 시트의 의미가 다르다 — **`composerVersion`으로 분기해야 한다**:
 * - variation v2~: 캔버스 전체가 하나의 균질한 **재질 스와치**
 *                  → `buildVariationTileSet`로 변형을 절차적으로 합성 (자르지 않는다)
 * - variation v1 (레거시, `composerVersion` 없음):
 *                  타일이 그리드로 배치된 **타일 시트** → `sliceTileSheet`로 분할
 * - ruletile:      베이스/오버레이 재질이 담긴 **머티리얼 시트**
 *                  → `buildRuleTileSet`로 타일을 절차적으로 합성 (자르지 않는다)
 */
export interface TilemapSheet {
  id: string;
  imageKey: string; // imageStorage 키: `tilemap-sheet-{id}`
  createdAt: string; // ISO 8601
}

/**
 * 슬롯 → (시트, 변형) 매핑.
 * 타일은 시트에서 결정적으로 재구성되므로 개별 저장하지 않고 이 매핑으로만 관리한다.
 */
export interface TileSlotAssignment {
  slotIndex: number; // 0 ~ (타일 수 - 1), 행우선
  sheetId: string; // TilemapSheet.id
  /**
   * 해당 시트에서 재구성한 타일 배열의 인덱스.
   *
   * 변형 v2에서는 이 배열이 **슬롯 수보다 큰 변형 풀**이다(`VARIATION_POOL_MULTIPLIER`) —
   * 뒤쪽 여유분은 슬롯 교체용이라 화면·내보내기에는 배정된 것만 나간다. 룰타일과
   * 레거시 분할 세트에서는 풀 == 슬롯이라 셀 번호(행우선)와 같다.
   */
  cellIndex: number;
  /**
   * 레거시(variation v1) 이음새 점수 0~100.
   *
   * v1은 AI 타일 시트를 잘라 썼기에 접합 보장이 없었고, 이 휴리스틱 점수로 품질을
   * 짐작했다. v2는 엣지 계약으로 접합을 **구성으로 보장**하므로 점수가 의미 없다
   * (읽지도 쓰지도 않는다). 기존 세션 데이터 호환을 위해 필드만 남긴다.
   */
  seamScore?: number;
  locked?: boolean; // true면 교체 재생성에서 보호
}

/** TILEMAP 세션 전용 데이터 (Session.tilemapData) */
export interface TilemapSessionData {
  grid: TilemapGridLayout;
  /**
   * 시트 목록.
   *
   * 새로 만드는 세트는 **항상 1장**이다 — 시트가 곧 재질 스와치이고, 서로 다른 스와치에서
   * 나온 타일은 변 픽셀이 달라 섞을 수 없기 때문이다. 여러 장이 들어 있으면 예전 교체
   * 제안 흐름으로 만든 레거시 세션이다.
   */
  sheets: TilemapSheet[];
  slotAssignments: TileSlotAssignment[];
  mode?: TilemapMode;        // 미지정 시 'variation' (초기 세션 호환)
  baseTerrain?: string;      // 룰타일: 베이스 지형 입력 원문 (예: "잔디"). 빈 값 = 투명
  overlayTerrain?: string;   // 룰타일: 오버레이 지형 입력 원문 (예: "흙길"). 빈 값 = 투명
  /**
   * 룰타일: 지형을 투명하게 처리했는지 (생성 시점의 선택을 그대로 굳힌 값).
   *
   * 지형 입력이 비어 있으면 그 지형은 재질 대신 **알파 0**으로 합성된다. 예를 들어
   * 베이스를 비우면 "어떤 바닥 타일 위에도 얹을 수 있는 길"이 된다 — 아웃라인만 남고
   * 나머지는 비치므로, 아래에 어떤 타일을 깔든 그 위에 길을 그릴 수 있다.
   *
   * 지형 문자열이 비었는지로 매번 파생하지 않고 **따로 굳혀 둔다**: 패널의 입력 필드는
   * "다음 생성 목표"라서 사용자가 지운 순간 보유 세트의 해석이 바뀌어 버린다
   * (경계 설정을 만질 때마다 재합성 결과가 달라진다). grid·mode와 같은 원리다.
   */
  transparentBase?: boolean;
  transparentOverlay?: boolean;
  /**
   * 합성 알고리즘 버전. **`mode`와 짝으로 해석한다** — 두 모드가 서로 다른 합성기를
   * 쓰므로 같은 숫자라도 의미가 다르다:
   * - ruletile  → `ruleTileComposer.COMPOSER_VERSION`
   * - variation → `variationComposer.VARIATION_COMPOSER_VERSION`
   *
   * 타일은 저장하지 않고 시트에서 매번 재구성하므로, 알고리즘이 바뀌면 기존 세션의
   * 결과도 달라진다. 값이 없으면 각 모드의 "잘라낸" 레거시 세트다 — 복원 경로가
   * 그때는 계속 `sliceTileSheet`를 쓰고, UI는 재생성이 필요하다고 안내한다.
   */
  composerVersion?: number;
  /** 룰타일: 경계선 모양 프리셋 (미지정 시 'blades') */
  edgeStyle?: TilemapEdgeStyle;
  /** 룰타일: 경계 아웃라인 설정 (미지정 시 비활성) */
  outline?: TilemapOutline;
  /** 룰타일: 보조 아웃라인 (2단계 띠, 미지정 시 비활성) */
  outline2?: TilemapOutline;
  /** 룰타일: 아웃라인을 뻗는 방향 (미지정 시 'outer') */
  outlineSide?: TilemapOutlineSide;
}

/** PixelArtGridLayout 값이 타일맵 지원 그리드인지 판별 */
export function isTilemapGridLayout(grid: PixelArtGridLayout): grid is TilemapGridLayout {
  return grid === '4x4' || grid === '8x8';
}
