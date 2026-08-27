import { join } from '@tauri-apps/api/path';
import { mkdir, writeFile, writeTextFile, exists } from '@tauri-apps/plugin-fs';
import { getPixelArtGridInfo } from '../../types/pixelart';
import { TilemapGridLayout, TilemapMode } from '../../types/tilemap';
import { getSessionImageFolder } from '../config/paths';
import { loadImageElement } from './tileSlicer';
import { getRuleTileRoles, RULE_TILE_ROLE_LABELS } from './ruleTileLayout';

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

/** 룰타일 모드: (행,열)→역할 표 텍스트 생성 */
function buildRoleTable(grid: TilemapGridLayout): string {
  const { cols } = getPixelArtGridInfo(grid);
  const roles = getRuleTileRoles(grid);
  const lines: string[] = [];
  for (let i = 0; i < roles.length; i++) {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const name = `tile_${String(i).padStart(2, '0')}`;
    lines.push(`  (${r},${c}) ${name}.png → ${RULE_TILE_ROLE_LABELS[roles[i]]} (${roles[i]})`);
  }
  return lines.join('\n');
}

/** 유니티 임포트 안내 텍스트 */
function buildImportGuide(grid: TilemapGridLayout, mode: TilemapMode): string {
  const { cellSize, totalFrames } = getPixelArtGridInfo(grid);
  const baseGuide = `StyleStudio 타일맵 내보내기 — 유니티 임포트 가이드
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
4. Window > 2D > Tile Palette에서 새 팔레트 생성 후 슬라이스된 스프라이트를 드래그해 등록`;

  if (mode === 'ruletile') {
    return `${baseGuide}
5. 아래 "룰타일 설정"을 따라 지형 전환용 Rule Tile을 구성합니다

개별 PNG(tiles/) 사용 시:
- 폴더째 임포트 후 전체 선택 → 위와 동일한 Sprite 설정 (4단계까지)

셀 역할 표 (행,열) — tile_NN.png → 역할:
-----------------------------------------------------
${buildRoleTable(grid)}

룰타일 설정 (Rule Tile):
1. Package Manager에서 "2D Tilemap Extras" 패키지를 설치합니다
2. Project 창에서 우클릭 → Create > 2D > Tiles > Rule Tile 로 새 Rule Tile 애셋을 만듭니다
3. Rule Tile의 Default Sprite에 "풀(fill)" 역할 스프라이트를 지정합니다 (베이스 지형이 그대로 이어지는 타일)
4. Rules 목록에 역할별 스프라이트를 추가하고, 각 스프라이트마다 이웃 규칙을 3x3 화살표로 지정합니다:
   - 화살표를 클릭할 때마다 This(이 타일과 같음) → Not This(이 타일과 다름/빈칸) → Any(무관) 순으로 전환됩니다
   예) 엣지↑(edge_n): 위(N)=Not This, 아래(S)·좌(W)·우(E)=This, 위쪽 대각(NE·NW)=Any(비워둠), 아래 대각(SE·SW)=This
   예) 코너↖(corner_nw): 위(N)·좌(W)·좌상(NW)=Not This, 아래(S)·우(E)·우하(SE)=This, 나머지 대각(NE·SW)=Any(비워둠)
   ※ Rule Tile 편집기에서 화살표를 클릭하지 않고 비워두면 Any(무관)입니다. 대각선을 This로 고정하면 코너 인접에서 규칙이 매칭되지 않으니 주의.
   - 오목(concave) 역할은 대각선 이웃만 Not This이고 상하좌우 이웃은 This인 경우입니다 (셀 자신의 사분면에 베이스 지형이 살짝 보이는 안쪽 모서리)
5. Tile Palette에는 개별 타일이 아닌 이 Rule Tile 애셋 1개만 등록한 뒤 칠하면, 주변 타일에 맞춰 자동으로 알맞은 스프라이트가 선택됩니다
6. 8x8 세트의 "베이스" 타일 4장은 Rule Tile 규칙에 넣지 말고, 바닥 전체를 채우는 일반 Tile(또는 별도 Rule Tile 없이 팔레트에 직접 등록)로 사용하세요.

참고: 4x4 세트에는 오목(concave) 코너 역할이 없어 좁게 꺾인 길(오목 모서리가 필요한 지형)을 정확히 표현할 수 없습니다.
이런 경우 오목 코너가 포함된 8x8 세트 사용을 권장합니다.
`;
  }

  return `${baseGuide}
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
  mode: TilemapMode;
}): Promise<string> {
  const { sessionName, grid, tiles, mode } = params;
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
  await writeTextFile(await join(exportFolder, 'IMPORT_GUIDE.txt'), buildImportGuide(grid, mode));

  return exportFolder;
}
