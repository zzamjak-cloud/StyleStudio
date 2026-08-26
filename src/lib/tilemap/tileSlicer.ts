import { getPixelArtGridInfo } from '../../types/pixelart';
import { TilemapGridLayout } from '../../types/tilemap';

/** dataURL 이미지를 HTMLImageElement로 로드 */
export function loadImageElement(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('타일 시트 이미지를 로드할 수 없습니다'));
    img.src = dataUrl;
  });
}

/**
 * 타일 시트를 그리드로 분할해 타일 PNG dataURL 배열(행우선)을 반환한다.
 * - 시트 실측 크기가 1024가 아니어도 실측 기준으로 셀 크기를 계산한다.
 * - 정사각형이 아니면 중앙 crop 후 분할한다 (모델이 비정확한 크기를 반환하는 경우 대비).
 */
export async function sliceTileSheet(
  sheetDataUrl: string,
  grid: TilemapGridLayout
): Promise<string[]> {
  const img = await loadImageElement(sheetDataUrl);
  const { rows, cols } = getPixelArtGridInfo(grid);

  // 정사각형 중앙 crop 기준
  const side = Math.min(img.width, img.height);
  const offsetX = Math.floor((img.width - side) / 2);
  const offsetY = Math.floor((img.height - side) / 2);
  const cellW = side / cols;
  const cellH = side / rows;
  const outSize = Math.round(cellW); // 출력 타일 한 변 = 실측 셀 크기

  const canvas = document.createElement('canvas');
  canvas.width = outSize;
  canvas.height = outSize;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context를 생성할 수 없습니다');

  const tiles: string[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      ctx.clearRect(0, 0, outSize, outSize);
      ctx.drawImage(
        img,
        offsetX + c * cellW, offsetY + r * cellH, cellW, cellH,
        0, 0, outSize, outSize
      );
      tiles.push(canvas.toDataURL('image/png'));
    }
  }
  return tiles;
}
