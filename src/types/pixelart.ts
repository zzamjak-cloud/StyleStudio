/**
 * 픽셀아트 그리드 레이아웃 타입
 *
 * 1024px 캔버스를 그리드로 분할하여 여러 프레임의 픽셀아트를 생성합니다.
 */
export type PixelArtGridLayout = '1x1' | '2x2' | '3x3' | '4x4' | '6x6' | '8x8';

/**
 * 그리드 레이아웃별 상세 정보
 */
export interface PixelArtGridInfo {
  rows: number; // 행 개수
  cols: number; // 열 개수
  totalFrames: number; // 총 프레임 수
  cellSize: number; // 각 셀의 크기 (px)
  recommendedPixelSize: number; // 권장 픽셀아트 크기
}

/**
 * 그리드 레이아웃 정보 가져오기
 *
 * @param layout - 그리드 레이아웃 ('1x1', '2x2', '4x4')
 * @returns 그리드 정보 (행, 열, 프레임 수, 셀 크기, 권장 픽셀 크기)
 */
export function getPixelArtGridInfo(layout: PixelArtGridLayout): PixelArtGridInfo {
  switch (layout) {
    case '1x1':
      return {
        rows: 1,
        cols: 1,
        totalFrames: 1,
        cellSize: 1024,
        recommendedPixelSize: 256,
      };
    case '2x2':
      return {
        rows: 2,
        cols: 2,
        totalFrames: 4,
        cellSize: 512,
        recommendedPixelSize: 128,
      };
    case '3x3':
      return {
        rows: 3,
        cols: 3,
        totalFrames: 9,
        cellSize: Math.floor(1024 / 3), // 약 341px
        recommendedPixelSize: 85,
      };
    case '4x4':
      return {
        rows: 4,
        cols: 4,
        totalFrames: 16,
        cellSize: 256,
        recommendedPixelSize: 64,
      };
    case '6x6':
      return {
        rows: 6,
        cols: 6,
        totalFrames: 36,
        cellSize: Math.floor(1024 / 6), // 약 170px
        recommendedPixelSize: 42,
      };
    case '8x8':
      return {
        rows: 8,
        cols: 8,
        totalFrames: 64,
        cellSize: 128,
        recommendedPixelSize: 32,
      };
  }
}
