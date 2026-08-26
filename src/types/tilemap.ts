import { PixelArtGridLayout } from './pixelart';

/**
 * 타일맵 그리드 레이아웃 (PixelArtGridLayout의 부분집합)
 * 타일맵 세션은 4x4(16타일·셀 256px)와 8x8(64타일·셀 128px)만 지원한다.
 */
export type TilemapGridLayout = Extract<PixelArtGridLayout, '4x4' | '8x8'>;

/** 타일맵에서 지원하는 그리드 목록 (UI 노출용) */
export const TILEMAP_GRID_LAYOUTS: TilemapGridLayout[] = ['4x4', '8x8'];

/** seam 점수(0~100)가 이 값 미만이면 이음새 경고 뱃지를 표시한다 */
export const TILEMAP_SEAM_WARNING_THRESHOLD = 70;

/** 생성된 타일 시트 1장. 원본 1024 이미지는 imageStorage 키로만 보관한다(직접 base64 저장 금지) */
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
}

/** PixelArtGridLayout 값이 타일맵 지원 그리드인지 판별 */
export function isTilemapGridLayout(grid: PixelArtGridLayout): grid is TilemapGridLayout {
  return grid === '4x4' || grid === '8x8';
}
