import { join } from '@tauri-apps/api/path';
import { mkdir, writeFile, writeTextFile, exists } from '@tauri-apps/plugin-fs';
import { getPixelArtGridInfo } from '../../types/pixelart';
import { TilemapGridLayout, TilemapMode } from '../../types/tilemap';
import { getSessionImageFolder } from '../config/paths';
import { loadImageElement } from './tileSlicer';
import { BASE_TILE_FILENAME, baseTileFilename, buildSlotTable, describeSlot } from './autotileSignature';
import { dataUrlToBytes as sharedDataUrlToBytes } from '../utils/imageDataUrl';
import { NEIGHBOR } from './edgeProfile';

/**
 * 유니티 임포트 시 권장 Pixels Per Unit.
 * 8x8 그리드(셀 128px)에서 타일 1개 = 1유닛이 되는 값이며, 이를 프로젝트 표준으로 삼는다.
 * 4x4 그리드(셀 256px)에서는 타일 1개가 2x2유닛이 되므로 가이드에 함께 명시한다.
 */
const UNITY_PIXELS_PER_UNIT = 128;

/**
 * 내보내기 폴더명용 타임스탬프 — 로컬 시각 기준 `yymmdd_HHMMSS`.
 * 예) 2026년 8월 27일 13시 44분 55초 → `260827_134455`
 * (epoch 밀리초는 사람이 읽을 수 없어 폴더 정렬·식별이 어려웠다)
 */
export function formatExportStamp(date: Date = new Date()): string {
  const p2 = (n: number) => String(n).padStart(2, '0');
  const yy = p2(date.getFullYear() % 100);
  return (
    `${yy}${p2(date.getMonth() + 1)}${p2(date.getDate())}_` +
    `${p2(date.getHours())}${p2(date.getMinutes())}${p2(date.getSeconds())}`
  );
}

/** dataURL → PNG 바이트 배열 */
/**
 * data URL을 **재인코딩 없이** 그대로 바이트로 옮긴다.
 *
 * 내보내는 타일은 전부 `canvas.toDataURL('image/png')` 결과이므로, 이 경로가 원본 바이트를
 * 그대로 파일에 쓰는 한 알파 채널이 온전히 보존된다. 중간에 canvas로 다시 그리거나
 * JPEG로 변환하면 투명 영역이 흰색으로 굳는다.
 */
const dataUrlToBytes = sharedDataUrlToBytes;

/**
 * 교체 반영된 최종 타일들로 1024 시트를 재합성.
 *
 * 내보내는 `tilesheet.png`가 바로 이 결과다. 결과 뷰의 "시트 보기"도 같은 함수를 써서
 * **내보내기 결과와 동일한 이미지**를 보여준다 — AI 원본 시트(룰타일에서는 머티리얼 시트)를
 * 그대로 띄우면 실제 산출물과 달라 혼란을 준다.
 */
export async function composeFinalSheet(tiles: string[], grid: TilemapGridLayout): Promise<string> {
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

/** signature 비트에서 유니티 Rule Tile 3x3 규칙 문자열을 만든다 */
function buildRuleGrid(signature: number): string {
  // 대각은 인접 두 변이 모두 오버레이일 때만 의미가 있다 → 그 외는 Any(비워둠)
  const has = (b: number) => (signature & b) !== 0;
  const cell = (b: number, meaningful: boolean): string => {
    if (!meaningful) return 'Any';
    return has(b) ? 'This' : 'Not';
  };
  const nw = cell(NEIGHBOR.NW, has(NEIGHBOR.N) && has(NEIGHBOR.W));
  const ne = cell(NEIGHBOR.NE, has(NEIGHBOR.N) && has(NEIGHBOR.E));
  const sw = cell(NEIGHBOR.SW, has(NEIGHBOR.S) && has(NEIGHBOR.W));
  const se = cell(NEIGHBOR.SE, has(NEIGHBOR.S) && has(NEIGHBOR.E));
  const n = cell(NEIGHBOR.N, true);
  const e = cell(NEIGHBOR.E, true);
  const sth = cell(NEIGHBOR.S, true);
  const w = cell(NEIGHBOR.W, true);
  const pad = (v: string) => v.padEnd(4);
  return `${pad(nw)}${pad(n)}${pad(ne)}| ${pad(w)}[본체]${pad(e)}| ${pad(sw)}${pad(sth)}${pad(se)}`;
}

/**
 * 룰타일 모드: 슬롯별 (행,열) → signature/규칙 표.
 * 표의 규칙 칸이 곧 유니티 Rule Tile 편집기의 3x3 화살표 설정이다
 * (This=이 타일과 같음, Not=다름/빈칸, Any=무관 — 화살표를 누르지 않은 상태).
 */
function buildRoleTable(grid: TilemapGridLayout): string {
  const { cols } = getPixelArtGridInfo(grid);
  const slots = buildSlotTable(grid);
  const lines: string[] = [];
  for (let i = 0; i < slots.length; i++) {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const name = `tile_${String(i).padStart(2, '0')}`;
    lines.push(
      `  (${r},${c}) ${name}.png  ${describeSlot(slots[i]).padEnd(12)}` +
      `sig=${String(slots[i].signature).padStart(3)}  ${buildRuleGrid(slots[i].signature)}`
    );
  }
  return lines.join('\n');
}

/** 유니티 임포트 안내 텍스트 */
function buildImportGuide(
  grid: TilemapGridLayout,
  mode: TilemapMode,
  /** 룰타일: 베이스 지형이 투명이라 바닥 타일이 나가지 않는 경우 */
  baseTransparent = false,
  /**
   * 예전 알고리즘으로 만든 세트인지 (변형 v1 = AI 시트를 잘라 만든 세트).
   *
   * **접합 보장 문구와 Random Tile 권장을 여기서 갈라야 한다.** 레거시 세트는 변 픽셀을
   * 공유하지 않으므로 "어떤 순서로 배치해도 이음새가 없다"가 거짓이고, 그 상태에서
   * Random Tile로 묶으라고 안내하면 이 변경이 없애려던 이음새를 오히려 만들게 된다.
   * 화면에는 재생성 배너가 뜨지만 유니티에 넘기는 파일이 그것과 모순되면 안 된다.
   */
  legacySet = false
): string {
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
   - Pixels Per Unit: ${UNITY_PIXELS_PER_UNIT}  (타일 1개 = ${cellSize / UNITY_PIXELS_PER_UNIT}x${cellSize / UNITY_PIXELS_PER_UNIT}유닛)
   - Filter Mode: Bilinear (손맵 스타일 권장)
3. Sprite Editor 열기 → Slice → Type: Grid By Cell Size → X:${cellSize}, Y:${cellSize} → Slice → Apply
4. Window > 2D > Tile Palette에서 새 팔레트 생성 후 슬라이스된 스프라이트를 드래그해 등록`;

  if (mode === 'ruletile') {
    const isBlob = grid === '8x8';
    return `${baseGuide}
5. 아래 "룰타일 설정"을 따라 지형 전환용 Rule Tile을 구성합니다

개별 PNG(tiles/) 사용 시:
- 폴더째 임포트 후 전체 선택 → 위와 동일한 Sprite 설정 (4단계까지)
${baseTransparent
  ? `- 베이스 지형이 **투명**이라 바닥 타일(${BASE_TILE_FILENAME})은 나가지 않습니다.
  이 Rule Tile은 배경이 비어 있으므로, 원하는 바닥 타일맵 **위에 레이어를 하나 더 얹어**
  그리면 됩니다 (Tilemap Renderer의 Order in Layer를 바닥보다 크게).`
  : `- ${BASE_TILE_FILENAME} / tile_base_1.png ~ : 순수 베이스 지형 타일과 그 변형들.
  그리드 슬롯 밖의 별도 타일이며 Rule Tile 규칙에는 넣지 않고, 바닥 전체를 칠하는
  일반 Tile로 팔레트에 등록합니다. 변형끼리는 서로 이어지므로, Random Tile
  (2D Tilemap Extras)로 묶어 두면 넓은 바닥에서도 같은 무늬가 반복되지 않습니다.`}

이 세트는 ${isBlob
  ? '대각까지 구분하는 blob 47종 + 자주 쓰이는 조합의 변형 17종'
  : '상하좌우만 구분하는 4비트 16종'} 입니다.
${isBlob
  ? '오목 코너를 포함하므로 좁게 꺾인 길과 안쪽 모서리까지 정확히 표현됩니다.'
  : '대각을 구분하지 않아 오목 코너가 없습니다. 좁게 꺾인 길이 필요하면 8x8 세트를 쓰세요.'}

슬롯 표 (행,열) — 파일명 · 역할 · signature · 유니티 3x3 규칙:
-----------------------------------------------------------------------
규칙 표기: This=이 타일과 같음 / Not=다름(빈칸) / Any=무관(화살표를 누르지 않은 상태)
배치 순서: 좌상 좌 우상 | 좌 [본체] 우 | 좌하 하 우하
-----------------------------------------------------------------------
${buildRoleTable(grid)}

룰타일 설정 (Rule Tile):
1. Package Manager에서 "2D Tilemap Extras" 패키지를 설치합니다
2. Project 창에서 우클릭 → Create > 2D > Tiles > Rule Tile 로 새 Rule Tile 애셋을 만듭니다
3. Default Sprite에는 "채움" 역할 스프라이트를 지정합니다 (사방이 모두 오버레이인 타일)
4. 위 표의 각 행마다 Rules 항목을 하나 추가하고, 표의 규칙 칸을 그대로 3x3 화살표에 옮깁니다.
   ※ Any는 화살표를 **누르지 않은** 상태입니다. 의미 없는 대각(인접 두 변 중 하나라도
     베이스인 경우)을 This/Not으로 고정하면 매칭이 실패하므로 반드시 비워두세요.
5. "변형" 이 붙은 슬롯들은 같은 규칙의 다른 그림입니다. 해당 Rule 하나에 묶어
   Output: Random 으로 지정하고 스프라이트를 모두 넣으면 반복 무늬가 완화됩니다.
6. Tile Palette에는 개별 타일이 아닌 이 Rule Tile 애셋 1개만 등록한 뒤 칠합니다.
${baseTransparent
  ? `   베이스가 투명이므로 바닥은 프로젝트의 다른 타일로 채우고, 그 위 레이어에 이 Rule Tile로
   지형을 그리면 됩니다.`
  : `   바닥은 베이스 타일(${BASE_TILE_FILENAME} 및 변형)로 먼저 채우고, 그 위에 Rule Tile로
   지형을 그리면 됩니다.`}

이 타일들은 그림을 잘라 만든 것이 아니라 공통 재질에서 절차적으로 합성된 것이라,
어떤 순서로 배치해도 경계가 어긋나지 않습니다.
`;
  }

  if (legacySet) {
    return `${baseGuide}
5. Tilemap에 배치

개별 PNG(tiles/) 사용 시:
- 폴더째 임포트 후 전체 선택 → 위와 동일한 Sprite 설정 → Tile Palette에 드래그

⚠️ 주의 — 이 세트는 StyleStudio의 **예전 방식**(AI가 그린 타일 시트를 잘라낸 것)으로
만들어졌습니다. 잘라낸 타일은 원래 붙어 있던 이웃과만 이어지므로, **순서를 섞어 배치하면
이음새가 어긋날 수 있습니다.** Random Tile로 묶어 무작위 배치하면 특히 잘 드러납니다.
StyleStudio에서 다시 생성하면 모든 타일이 변 픽셀을 공유하는 현재 방식으로 만들어져
임의 배치에서도 이음새가 없습니다.
`;
  }

  return `${baseGuide}
5. Tilemap에 배치 — 모든 타일은 상호 호환 변형이므로 자유롭게 섞어 칠할 수 있습니다
6. 넓은 바닥이라면 Random Tile (2D Tilemap Extras)로 ${totalFrames}장을 하나로 묶어 등록하면
   칠하는 대로 변형이 무작위로 섞여 같은 무늬가 반복되지 않습니다

개별 PNG(tiles/) 사용 시:
- 폴더째 임포트 후 전체 선택 → 위와 동일한 Sprite 설정 → Tile Palette에 드래그

이 타일들은 그림을 잘라 만든 것이 아니라 공통 재질에서 절차적으로 합성된 것입니다.
모든 타일이 변 픽셀을 공유하고 각 타일 자체가 상하좌우로 순환 연결되므로, 어떤 순서로
무작위 배치해도 이음새가 생기지 않습니다.
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
  /** 룰타일: 순수 베이스 지형 타일 변형 목록 (그리드 슬롯 밖의 별도 타일) */
  baseTiles?: string[] | null;
  /** 예전 알고리즘으로 만든 세트인지 — 가이드의 접합 보장 문구를 가른다 */
  legacySet?: boolean;
}): Promise<string> {
  const { sessionName, grid, tiles, mode, baseTiles, legacySet } = params;
  const { totalFrames } = getPixelArtGridInfo(grid);
  if (tiles.length !== totalFrames) {
    throw new Error(`타일 수가 그리드와 맞지 않습니다 (${tiles.length}/${totalFrames})`);
  }

  const sessionFolder = await getSessionImageFolder(sessionName);
  const exportFolder = await join(sessionFolder, `tilemap_${formatExportStamp()}`);
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

  // 3) 룰타일 전용: 순수 베이스 지형 타일 변형들 (그리드 밖의 별도 타일)
  if (mode === 'ruletile' && baseTiles) {
    for (let i = 0; i < baseTiles.length; i++) {
      await writeFile(await join(tilesFolder, baseTileFilename(i)), dataUrlToBytes(baseTiles[i]));
    }
  }

  // 4) 임포트 가이드 — 룰타일인데 바닥 타일이 없으면 투명 베이스다
  await writeTextFile(
    await join(exportFolder, 'IMPORT_GUIDE.txt'),
    buildImportGuide(
      grid,
      mode,
      mode === 'ruletile' && (baseTiles?.length ?? 0) === 0,
      legacySet ?? false
    )
  );

  return exportFolder;
}
