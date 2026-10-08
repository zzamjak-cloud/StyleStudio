/**
 * 타일맵 도구 테스트 (API 호출 없음) — `bun test mcp/test`
 *
 * (a) 앱 셀프체크 게이트 23건을 canvas shim 위에서 실행 (b) 합성기·내보내기 결과 구성
 * (c) shim 의 그라디언트·합성 연산 단위 테스트
 */
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { installCanvasShim, ShimCanvas, ShimImage, parseCssColor } from '../src/canvas-shim';
import { decodeImage, encodePng, type RgbaImage } from '../src/imageio';
import { composeTileset, planTilemapBatch, ruleNeighbors, writeTileset, type SetSpec } from '../src/tilemap';
import { runAllTilemapChecks } from '../../src/lib/tilemap/tilemapSelfCheck';
import { buildRuleGrid } from '../../src/lib/tilemap/tilemapExporter';
import { buildSlotTable } from '../../src/lib/tilemap/autotileSignature';

installCanvasShim();

/** 결정적 잡음으로 채운 PNG (재질 스와치 대용) */
function noisePng(size: number, tone: (x: number, y: number) => [number, number, number]): Uint8Array {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const n = ((x * 374761393 + y * 668265263) >>> 0) % 23;
      const [r, g, b] = tone(x, y);
      data[i] = r + n;
      data[i + 1] = g + n;
      data[i + 2] = b + n;
      data[i + 3] = 255;
    }
  }
  return encodePng({ width: size, height: size, data });
}

function canvasOf(size: number, fill: (x: number, y: number) => [number, number, number, number]): ShimCanvas {
  const c = new ShimCanvas();
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) img.data.set(fill(x, y), (y * size + x) * 4);
  ctx.putImageData(img, 0, 0);
  return c;
}

const pixel = (c: ShimCanvas, x: number, y: number) => [...c.getContext('2d')!.getImageData(x, y, 1, 1).data];

const baseSpec: SetSpec = {
  mode: 'variation',
  grid: '4x4',
  edgeStyle: 'chunky',
  outlineSide: 'outer',
  transparentBase: false,
  transparentOverlay: false,
  matchAppJpeg: true,
};

describe('(a) 앱 셀프체크 게이트 (shim 위)', () => {
  test(
    '게이트가 전부 통과한다 (앱이 게이트를 추가해도 따라간다)',
    async () => {
      const results = await runAllTilemapChecks();
      const failed = results.filter((r) => !r.passed).map((r) => `${r.name}\n${r.detail}`);
      // 개수를 고정하지 않는다 — 앱 쪽에 게이트가 늘면(v0.10.1 에서 24건) 그대로 함께 돈다. 줄어드는 것만 막는다.
      expect(results.length).toBeGreaterThanOrEqual(24);
      expect(failed).toEqual([]);
    },
    120_000
  );
});

describe('(b) 합성기·내보내기', () => {
  const swatch = noisePng(1024, (x, y) => [60 + (x >> 4), 110 + (y >> 5), 50]);
  const sheet = noisePng(1024, (x) => (x < 512 ? [60, 110, 50] : [180, 150, 100]));

  test('variation 4x4 → 256px 타일 16장 (풀 32장 중 배정분)', async () => {
    const set = await composeTileset(swatch, { ...baseSpec, grid: '4x4' });
    expect(set.tiles.length).toBe(16);
    expect(set.poolSize).toBe(32);
    expect(set.distinctCount).toBe(32);
    const tile = decodeImage(Buffer.from(set.tiles[0].split(',')[1], 'base64'));
    expect([tile.width, tile.height]).toEqual([256, 256]);
  }, 60_000);

  test('variation 8x8 → 128px 타일 64장', async () => {
    const set = await composeTileset(swatch, { ...baseSpec, grid: '8x8', matchAppJpeg: false });
    expect(set.tiles.length).toBe(64);
    const tile = decodeImage(Buffer.from(set.tiles[63].split(',')[1], 'base64'));
    expect([tile.width, tile.height]).toEqual([128, 128]);
  }, 60_000);

  test('ruletile 8x8 → 64장 + 베이스 8장, 투명 베이스면 베이스 0장·알파 있음', async () => {
    const spec: SetSpec = { ...baseSpec, mode: 'ruletile', grid: '8x8', baseTerrain: 'grass', overlayTerrain: 'dirt' };
    const set = await composeTileset(sheet, spec);
    expect(set.tiles.length).toBe(64);
    expect(set.baseTiles.length).toBe(8);
    expect(set.slots?.length).toBe(64);

    const clear = await composeTileset(sheet, { ...spec, baseTerrain: '', transparentBase: true });
    expect(clear.baseTiles.length).toBe(0);
    const isolated = decodeImage(Buffer.from(clear.tiles[0].split(',')[1], 'base64'));
    // signature 0(고립) 타일의 모서리는 베이스 = 투명
    expect(isolated.data[3]).toBe(0);
  }, 60_000);

  test('tileset.json 규칙이 앱 가이드의 buildRuleGrid 와 같다', () => {
    for (const slot of buildSlotTable('8x8')) {
      const n = ruleNeighbors(slot.signature);
      const pad = (v: string) => v.padEnd(4);
      const text = `${pad(n.NW)}${pad(n.N)}${pad(n.NE)}| ${pad(n.W)}[본체]${pad(n.E)}| ${pad(n.SW)}${pad(n.S)}${pad(n.SE)}`;
      expect(text).toBe(buildRuleGrid(slot.signature));
    }
  });

  test('세트 폴더 구성 — 앱 내보내기 + tileset.json + 원본, 재실행은 새 폴더', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ss-tilemap-'));
    try {
      const spec: SetSpec = { ...baseSpec, mode: 'ruletile', grid: '8x8', baseTerrain: 'grass', overlayTerrain: 'dirt' };
      const files = await writeTileset(sheet, spec, join(root, 'set'), { model: 'openai/gpt-image-2' });
      expect(files.length).toBe(4 + 64 + 8);
      const dir = join(root, 'set');
      expect(readdirSync(dir).sort()).toEqual(['IMPORT_GUIDE.txt', 'source_sheet.png', 'tiles', 'tileset.json', 'tilesheet.png']);
      expect(readdirSync(join(dir, 'tiles'))).toContain('tile_base_7.png');

      const sheetImg = decodeImage(readFileSync(join(dir, 'tilesheet.png')));
      expect([sheetImg.width, sheetImg.height]).toEqual([1024, 1024]);

      const json = JSON.parse(readFileSync(join(dir, 'tileset.json'), 'utf-8'));
      expect(json.mode).toBe('ruletile');
      expect(json.cell_size).toBe(128);
      expect(json.pixels_per_unit).toBe(128);
      expect(json.slots.length).toBe(64);
      expect(json.slots[1].file).toBe('tiles/tile_01.png');
      expect(json.slots[0].rule_grid[1][1]).toBe('Self');
      expect(json.base_tiles.length).toBe(8);
      expect(json.default_sprite).toMatch(/^tiles\/tile_\d\d\.png$/);
      expect(readFileSync(join(dir, 'IMPORT_GUIDE.txt'), 'utf-8')).toContain('룰타일 설정');

      // 같은 폴더로 다시 쓰면 덮어쓰지 않고 set_2 를 만든다
      const again = await writeTileset(swatch, baseSpec, join(root, 'set'));
      expect(again[0].startsWith(join(root, 'set_2'))).toBe(true);
      expect(again.length).toBe(4 + 16);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);

  test('계획: 룰타일 8x8 강제·투명 지형·검증 오류·dry run 견적', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ss-tilemap-plan-'));
    try {
      const plan = await planTilemapBatch(join(root, 'appdata'), {
        dest_dir: join(root, 'out'),
        tasks: [
          { mode: 'ruletile', base_terrain: '', overlay_terrain: '흙길', grid: '4x4' },
          { mode: 'variation', terrain: 'grass', grid: '8x8', count: 2 },
        ],
        options: { quality: 'low' },
      });
      expect(plan.units.length).toBe(3);
      expect(plan.units[0].grid).toBe('8x8');
      expect(plan.units[0].expectedFiles).toBe(4 + 64);
      expect(plan.units[1].expectedFiles).toBe(4 + 64);
      expect(plan.units.every((u) => u.call.aspectRatio === '1:1' && u.call.quality === 'low')).toBe(true);
      expect((plan.breakdown[0] as { note?: string }).note).toContain('8x8');
      expect(plan.units.map((u) => u.label)).toEqual(['투명_흙길', 'grass_01', 'grass_02']);

      const bad = (tasks: unknown[], options?: object) =>
        planTilemapBatch(join(root, 'appdata'), { dest_dir: join(root, 'out'), tasks, options } as never);
      await expect(bad([{ mode: 'ruletile' }])).rejects.toThrow('최소 하나');
      await expect(bad([{ mode: 'variation', edge_style: 'wavy' }])).rejects.toThrow('ruletile 전용');
      await expect(bad([{ mode: 'variation' }], { model: 'google/gemini-3.1-flash-image-preview' })).rejects.toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('(c) canvas shim', () => {
  test('CSS 색 해석', () => {
    expect(parseCssColor('#3f6b3a')).toEqual([0x3f, 0x6b, 0x3a, 1]);
    expect(parseCssColor('rgba(0,0,0,0.25)')).toEqual([0, 0, 0, 0.25]);
    expect(parseCssColor('#fff')).toEqual([255, 255, 255, 1]);
    expect(parseCssColor('nope')).toBeNull();
  });

  test('선형 그라디언트 + destination-in = 알파만 창 가중치로 곱한다', () => {
    const c = canvasOf(100, () => [200, 100, 50, 255]);
    const ctx = c.getContext('2d')!;
    const g = ctx.createLinearGradient(0, 0, 100, 0);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalCompositeOperation = 'destination-in';
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 100, 100);
    // 픽셀 중심 t=(x+0.5)/100 에서 알파 = 1 - t
    for (const x of [0, 25, 50, 99]) {
      const [r, gr, b, a] = pixel(c, x, 7);
      expect([r, gr, b]).toEqual([200, 100, 50]);
      expect(Math.abs(a - Math.round((1 - (x + 0.5) / 100) * 255))).toBeLessThanOrEqual(1);
    }
  });

  test('반투명 source-over 는 볼록 결합이다 (makeSeamless 크로스페이드)', () => {
    const dst = canvasOf(4, () => [0, 0, 0, 255]);
    const src = canvasOf(4, () => [255, 128, 64, 64]); // 알파 0.25
    dst.getContext('2d')!.drawImage(src, 0, 0);
    const [r, g, b, a] = pixel(dst, 1, 1);
    expect(a).toBe(255);
    expect(Math.abs(r - 255 * 0.251)).toBeLessThanOrEqual(1);
    expect(Math.abs(g - 128 * 0.251)).toBeLessThanOrEqual(1);
    expect(Math.abs(b - 64 * 0.251)).toBeLessThanOrEqual(1);
  });

  test('음수 오프셋 drawImage 두 번 = 반 굴리기 (rollHalf)', () => {
    const src = canvasOf(8, (x) => [x * 10, 0, 0, 255]);
    const out = new ShimCanvas();
    out.width = 8;
    out.height = 8;
    const ctx = out.getContext('2d')!;
    ctx.drawImage(src, -4, 0);
    ctx.drawImage(src, 4, 0);
    for (let x = 0; x < 8; x++) expect(pixel(out, x, 3)[0]).toBe(((x + 4) % 8) * 10);
  });

  test('1:1 크롭은 스무딩 여부와 무관하게 픽셀 그대로, NN 확대는 블록', () => {
    const src = canvasOf(16, (x, y) => ((x + y) % 2 ? [255, 255, 255, 255] : [0, 0, 0, 255]));
    const out = new ShimCanvas();
    out.width = 8;
    out.height = 8;
    const ctx = out.getContext('2d')!;
    ctx.drawImage(src, 3, 5, 8, 8, 0, 0, 8, 8); // 스무딩 켜진 기본값이어도 1:1 이면 보간 없음
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) expect(pixel(out, x, y)[0]).toBe((x + 3 + y + 5) % 2 ? 255 : 0);

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(src, 0, 0, 2, 2, 0, 0, 8, 8);
    expect(pixel(out, 0, 0)[0]).toBe(0);
    expect(pixel(out, 3, 3)[0]).toBe(0);
    expect(pixel(out, 4, 0)[0]).toBe(255);
    expect(pixel(out, 7, 7)[0]).toBe(0);
  });

  test('destination-in 은 그린 영역 밖을 지운다 (unbounded)', () => {
    const c = canvasOf(8, () => [10, 20, 30, 255]);
    const mask = canvasOf(4, () => [255, 255, 255, 255]);
    const ctx = c.getContext('2d')!;
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(mask, 0, 0);
    expect(pixel(c, 1, 1)).toEqual([10, 20, 30, 255]);
    expect(pixel(c, 6, 6)[3]).toBe(0);
  });

  test('toDataURL PNG 왕복·JPEG 흰 배경, Image 는 비동기로 로드된다', async () => {
    const c = canvasOf(8, (x) => [x * 30, 40, 50, x < 4 ? 255 : 0]);
    const png = c.toDataURL('image/png');
    expect(png.startsWith('data:image/png;base64,iVBORw0KGgo')).toBe(true);
    const img = new ShimImage();
    let loaded = false;
    img.src = png;
    img.onload = () => (loaded = true); // 대입 후에 달아도 잡혀야 한다
    expect(img.complete).toBe(false);
    await img.decode();
    expect(loaded).toBe(true);
    expect([img.width, img.height]).toEqual([8, 8]);
    const back = new ShimCanvas();
    back.width = 8;
    back.height = 8;
    back.getContext('2d')!.drawImage(img, 0, 0);
    expect(pixel(back, 2, 2)).toEqual([60, 40, 50, 255]);
    expect(pixel(back, 6, 2)[3]).toBe(0);

    // 앱 convertBase64ToJpeg 와 같은 순서: 흰색 채우고 그린 뒤 JPEG
    const j = new ShimCanvas();
    j.width = 8;
    j.height = 8;
    const jctx = j.getContext('2d')!;
    jctx.fillStyle = '#ffffff';
    jctx.fillRect(0, 0, 8, 8);
    jctx.drawImage(img, 0, 0);
    const jpg: RgbaImage = decodeImage(Buffer.from(j.toDataURL('image/jpeg', 0.92).split(',')[1], 'base64'));
    const i = (2 * 8 + 6) * 4;
    expect(jpg.data[i]).toBeGreaterThan(230); // 투명했던 곳은 흰색
  });
});
