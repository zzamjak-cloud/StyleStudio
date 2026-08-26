import { join } from '@tauri-apps/api/path';
import { mkdir, writeFile, writeTextFile, exists } from '@tauri-apps/plugin-fs';
import { getPixelArtGridInfo } from '../../types/pixelart';
import { TilemapGridLayout } from '../../types/tilemap';
import { getSessionImageFolder } from '../config/paths';
import { loadImageElement } from './tileSlicer';

/** dataURL → PNG 바이트 배열 */
function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64Data = dataUrl.split(',')[1];
  if (!base64Data) throw new Error('Data URL 형식이 잘못되었습니다');
  const binaryString = atob(base64Data);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/** 교체 반영된 최종 타일들로 1024 시트를 재합성 */
async function composeFinalSheet(tiles: string[], grid: TilemapGridLayout): Promise<string> {
  const { rows, cols, cellSize } = getPixelArtGridInfo(grid);
  const canvas = document.createElement('canvas');
  canvas.width = cellSize * cols;  // 4x4=1024, 8x8=1024
  canvas.height = cellSize * rows;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context를 생성할 수 없습니다');

  for (let i = 0; i < tiles.length; i++) {
    const img = await loadImageElement(tiles[i]);
    const r = Math.floor(i / cols);
    const c = i % cols;
    ctx.drawImage(img, c * cellSize, r * cellSize, cellSize, cellSize);
  }
  return canvas.toDataURL('image/png');
}

/** 유니티 임포트 안내 텍스트 */
function buildImportGuide(grid: TilemapGridLayout): string {
  const { cellSize, totalFrames } = getPixelArtGridInfo(grid);
  return `StyleStudio 타일맵 내보내기 — 유니티 임포트 가이드
=====================================================

구성:
- tilesheet.png : ${totalFrames}개 타일이 ${grid} 그리드로 배치된 시트 (1024x1024)
- tiles/tile_00.png ~ : 개별 타일 PNG (${cellSize}x${cellSize}px, 행우선 순서)

유니티 설정 (tilesheet.png 사용 시):
1. tilesheet.png를 프로젝트에 임포트
2. Inspector에서:
   - Texture Type: Sprite (2D and UI)
   - Sprite Mode: Multiple
   - Pixels Per Unit: ${cellSize}  (타일 1개 = 1유닛)
   - Filter Mode: Bilinear (손맵 스타일 권장)
3. Sprite Editor 열기 → Slice → Type: Grid By Cell Size → X:${cellSize}, Y:${cellSize} → Slice → Apply
4. Window > 2D > Tile Palette에서 새 팔레트 생성 후 슬라이스된 스프라이트를 드래그해 등록
5. Tilemap에 배치 — 모든 타일은 상호 호환 변형이므로 자유롭게 섞어 칠할 수 있습니다

개별 PNG(tiles/) 사용 시:
- 폴더째 임포트 후 전체 선택 → 위와 동일한 Sprite 설정 → Tile Palette에 드래그
`;
}

/**
 * 타일맵을 유니티용으로 내보낸다.
 * ~/Downloads/AI_Gen/{세션명}/tilemap_{timestamp}/ 에
 * tilesheet.png + tiles/tile_NN.png + IMPORT_GUIDE.txt 를 기록하고 폴더 경로를 반환.
 */
export async function exportTilemapForUnity(params: {
  sessionName: string;
  grid: TilemapGridLayout;
  tiles: string[];
}): Promise<string> {
  const { sessionName, grid, tiles } = params;
  const { totalFrames } = getPixelArtGridInfo(grid);
  if (tiles.length !== totalFrames) {
    throw new Error(`타일 수가 그리드와 맞지 않습니다 (${tiles.length}/${totalFrames})`);
  }

  const sessionFolder = await getSessionImageFolder(sessionName);
  const exportFolder = await join(sessionFolder, `tilemap_${Date.now()}`);
  const tilesFolder = await join(exportFolder, 'tiles');
  if (!(await exists(exportFolder))) await mkdir(exportFolder, { recursive: true });
  if (!(await exists(tilesFolder))) await mkdir(tilesFolder, { recursive: true });

  // 1) 교체 반영 최종 시트 재합성
  const sheetDataUrl = await composeFinalSheet(tiles, grid);
  await writeFile(await join(exportFolder, 'tilesheet.png'), dataUrlToBytes(sheetDataUrl));

  // 2) 개별 타일
  for (let i = 0; i < tiles.length; i++) {
    const name = `tile_${String(i).padStart(2, '0')}.png`;
    await writeFile(await join(tilesFolder, name), dataUrlToBytes(tiles[i]));
  }

  // 3) 임포트 가이드
  await writeTextFile(await join(exportFolder, 'IMPORT_GUIDE.txt'), buildImportGuide(grid));

  return exportFolder;
}
