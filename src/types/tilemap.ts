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

/** seam 점수(0~100)가 이 값 미만이면 이음새 경고 뱃지를 표시한다 */
export const TILEMAP_SEAM_WARNING_THRESHOLD = 70;

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
 * 모드에 따라 시트의 의미가 다르다:
 * - variation: 타일이 그리드로 배치된 **타일 시트** → `sliceTileSheet`로 분할
 * - ruletile:  베이스/오버레이 재질과 프린지가 담긴 **머티리얼 시트**
 *              → `buildRuleTileSet`로 타일을 절차적으로 합성 (자르지 않는다)
 */
export interface TilemapSheet {
  id: string;
  imageKey: string; // imageStorage 키: `tilemap-sheet-{id}`
  createdAt: string; // ISO 8601
}

/**
 * 슬롯 → (시트, 셀) 매핑.
 * 타일은 시트의 결정적 분할 결과이므로 개별 저장하지 않고 이 매핑으로만 관리한다.
 */
export interface TileSlotAssignment {
  slotIndex: number; // 0 ~ (타일 수 - 1), 행우선
  sheetId: string; // TilemapSheet.id
  cellIndex: number; // 해당 시트 내 셀 번호 (행우선)
  seamScore?: number; // 0~100 이음새 점수
  locked?: boolean; // true면 교체 재생성에서 보호
}

/** TILEMAP 세션 전용 데이터 (Session.tilemapData) */
export interface TilemapSessionData {
  grid: TilemapGridLayout;
  sheets: TilemapSheet[];
  slotAssignments: TileSlotAssignment[];
  mode?: TilemapMode;        // 미지정 시 'variation' (v1 세션 호환)
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
   * 룰타일 합성 알고리즘 버전 (`ruleTileComposer.COMPOSER_VERSION`).
   * 타일은 저장하지 않고 머티리얼 시트에서 매번 재합성하므로, 알고리즘이 바뀌면
   * 기존 세션의 결과도 달라진다. 이 값이 없거나(=v2 이전의 "잘라낸" 세트) 현재 버전과
   * 다르면 재생성이 필요하다고 안내한다.
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
