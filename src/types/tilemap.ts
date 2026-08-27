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
  | 'sharp';

/** 기본 경계선 모양 — v3까지의 동작과 동일 */
export const DEFAULT_TILEMAP_EDGE_STYLE: TilemapEdgeStyle = 'blades';

/**
 * 경계선 위에 덧그리는 아웃라인 설정.
 * 캐주얼한 감도를 사용자가 직접 잡을 수 있게 두께와 색을 노출한다.
 */
export interface TilemapOutline {
  enabled: boolean;
  /**
   * 두께(px). 셀 128px 기준값이며, 4x4(셀 256px)에서는 내부적으로 2배로 환산해
   * 유니티에서 PPU 128로 임포트했을 때 **세계 좌표상 두께가 같게** 보이도록 한다.
   */
  thicknessPx: number;
  /** `#RRGGBB` */
  color: string;
}

/** 아웃라인 두께 허용 범위 (셀 128px 기준 px) */
export const TILEMAP_OUTLINE_THICKNESS_RANGE = { min: 1, max: 8 } as const;

export const DEFAULT_TILEMAP_OUTLINE: TilemapOutline = {
  enabled: false,
  thicknessPx: 2,
  color: '#3b2f2a',
};

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
  baseTerrain?: string;      // 룰타일: 베이스 지형 입력 원문 (예: "잔디")
  overlayTerrain?: string;   // 룰타일: 오버레이 지형 입력 원문 (예: "흙길")
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
}

/** PixelArtGridLayout 값이 타일맵 지원 그리드인지 판별 */
export function isTilemapGridLayout(grid: PixelArtGridLayout): grid is TilemapGridLayout {
  return grid === '4x4' || grid === '8x8';
}
