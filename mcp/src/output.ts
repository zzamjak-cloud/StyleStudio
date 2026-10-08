/**
 * 응답 이미지 저장 — 그리드 셀 분할·픽셀 정규화·포맷 변환을 한 곳에서 처리한다.
 * 모든 세션 도구(생성기·컨셉·일러스트·편집 체인)가 같은 규칙으로 파일을 남기도록 공유한다.
 */

import { join } from 'node:path';

import { getPixelArtGridInfo, type PixelArtGridLayout } from '../../src/types/pixelart';
import { pixelateRgba, type PaletteSizeOption, type PixelateSizeOption } from '../../src/lib/pixelart/pixelate';

import { sanitizeName, writeUnique } from './env';
import {
  canDecode,
  crop,
  decodeImage,
  encodeJpegOnWhite,
  encodePng,
  extensionFor,
  hasTransparency,
  sniffMime,
  upscaleNearest,
  type RgbaImage,
} from './imageio';

export interface PixelateSpec {
  enabled: boolean;
  size: PixelateSizeOption;
  palette_size: PaletteSizeOption;
}

export interface OutputOptions {
  split_grid: boolean;
  keep_sheet: boolean;
  output_format: 'png' | 'jpg';
  pixel_output: 'logical' | 'upscaled' | 'both';
  pixelate: PixelateSpec;
  transparent: boolean;
}

export const DEFAULT_OUTPUT: OutputOptions = {
  split_grid: true,
  keep_sheet: true,
  output_format: 'png',
  pixel_output: 'both',
  pixelate: { enabled: false, size: 'auto', palette_size: 'auto' },
  transparent: false,
};

export interface SaveSpec {
  /** 저장 폴더 */
  dir: string;
  /** 시트(또는 단일 이미지) 파일 이름 */
  sheetBase: string;
  grid: PixelArtGridLayout;
  /** items 그리드면 셀별 항목 이름 — 셀 파일 이름이 된다 */
  items?: string[];
  options: OutputOptions;
}

/** 그리드 이미지를 셀로 나눈다 (균등 분할, 나머지 픽셀은 버림) */
export function splitCells(img: RgbaImage, grid: PixelArtGridLayout): RgbaImage[] {
  const { rows, cols } = getPixelArtGridInfo(grid);
  const w = Math.floor(img.width / cols);
  const h = Math.floor(img.height / rows);
  const cells: RgbaImage[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) cells.push(crop(img, c * w, r * h, w, h));
  }
  return cells;
}

function encodeOutput(options: OutputOptions, img: RgbaImage): { bytes: Uint8Array; ext: string } {
  if (options.output_format === 'jpg' && !options.transparent && !hasTransparency(img)) {
    return { bytes: encodeJpegOnWhite(img), ext: 'jpg' };
  }
  return { bytes: encodePng(img), ext: 'png' };
}

/** 이 스펙으로 저장하면 몇 개 파일이 생기는지 (dry run 의 expected_files) */
export function expectedFileCount(grid: PixelArtGridLayout, images: number, items: number | undefined, options: OutputOptions): number {
  const copies = options.pixelate.enabled && options.pixel_output === 'both' ? 2 : 1;
  if (grid !== '1x1' && options.split_grid) {
    const cells = items ?? images * getPixelArtGridInfo(grid).totalFrames;
    return cells * copies + (options.keep_sheet ? images : 0);
  }
  return images * copies;
}

/** 응답 이미지 1장 저장 → 파일 경로들 */
export function saveGeneratedImage(bytes: Uint8Array, spec: SaveSpec): string[] {
  const { dir, sheetBase, grid, items, options } = spec;
  const mime = sniffMime(bytes);
  if (!canDecode(mime)) {
    // 디코딩할 수 없는 형식(webp 등)은 원본 그대로 저장하고 후처리를 건너뛴다
    return [writeUnique(dir, sheetBase, extensionFor(mime), bytes)];
  }

  const { cols } = getPixelArtGridInfo(grid);
  const cellName = (i: number) =>
    items
      ? sanitizeName(items[i] ?? `cell-${i + 1}`, `cell-${i + 1}`)
      : `${sheetBase}_r${Math.floor(i / cols) + 1}c${(i % cols) + 1}`;
  const single = items?.length === 1 ? cellName(0) : sheetBase;

  const files: string[] = [];
  const img = decodeImage(bytes);
  const isGrid = grid !== '1x1';
  const cellCount = items ? items.length : getPixelArtGridInfo(grid).totalFrames;

  if (options.pixelate.enabled) {
    // 앱과 같은 픽셀 정규화(순수 함수). 그리드면 격자를 셀 경계에 맞춰 확정한다.
    const { logical } = pixelateRgba(img, {
      size: options.pixelate.size,
      paletteSize: options.pixelate.palette_size,
      grid,
    });
    const save = (image: RgbaImage, base: string) => {
      const out: string[] = [];
      const mode = options.pixel_output;
      if (mode === 'logical' || mode === 'both') out.push(writeUnique(dir, base, 'png', encodePng(image)));
      if (mode === 'upscaled' || mode === 'both') {
        const scale = Math.max(1, Math.floor(512 / Math.max(image.width, image.height)));
        const suffix = mode === 'both' ? `@${scale}x` : '';
        out.push(writeUnique(dir, `${base}${suffix}`, 'png', encodePng(upscaleNearest(image, scale))));
      }
      return out;
    };
    if (isGrid && options.split_grid) {
      splitCells(logical, grid)
        .slice(0, cellCount)
        .forEach((cell, i) => files.push(...save(cell, cellName(i))));
      if (options.keep_sheet) files.push(writeUnique(dir, sheetBase, 'png', encodePng(logical)));
    } else {
      files.push(...save(logical, single));
    }
    return files;
  }

  if (isGrid && options.split_grid) {
    splitCells(img, grid)
      .slice(0, cellCount)
      .forEach((cell, i) => {
        const { bytes: out, ext } = encodeOutput(options, cell);
        files.push(writeUnique(dir, cellName(i), ext, out));
      });
    if (options.keep_sheet) {
      const { bytes: out, ext } = encodeOutput(options, img);
      files.push(writeUnique(dir, sheetBase, ext, out));
    }
    return files;
  }

  const { bytes: out, ext } = encodeOutput(options, img);
  files.push(writeUnique(dir, single, ext, out));
  return files;
}

/** 후처리 실패 시에도 과금된 결과를 버리지 않도록 원본 그대로 저장 */
export function saveRaw(dir: string, base: string, bytes: Uint8Array): string {
  return writeUnique(dir, `${base}_raw`, extensionFor(sniffMime(bytes)), bytes);
}

export function taskDir(destDir: string, taskName: string): string {
  return join(destDir, taskName);
}
