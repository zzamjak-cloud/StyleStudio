/**
 * 순수 JS 이미지 입출력 — 앱이 canvas 로 하던 디코드·인코드·자르기·축소를 헤드리스로 대체한다.
 * 네이티브 모듈을 쓰지 않아 단일 실행 파일(bun --compile)에 그대로 번들된다.
 *
 * 픽셀 연산 자체(픽셀 정규화 등)는 앱의 순수 함수(`src/lib/pixelart/pixelate.ts`)를 그대로 쓴다.
 */

import { readFileSync, statSync } from 'node:fs';
import { extname } from 'node:path';
import { PNG } from 'pngjs';
import jpeg from 'jpeg-js';
import type { RgbaImage } from '../../src/lib/pixelart/pixelate';

export type { RgbaImage };

/** 매직 넘버로 포맷 판별 (응답 media_type 이 틀릴 수 있다) */
export function sniffMime(bytes: Uint8Array): string {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57 && bytes[9] === 0x45) return 'image/webp';
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif';
  return 'application/octet-stream';
}

export function extensionFor(mime: string): string {
  switch (mime) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/webp':
      return 'webp';
    case 'image/gif':
      return 'gif';
    default:
      return 'png';
  }
}

/** 디코딩 가능한 포맷인지 (PNG/JPEG 만 — 후처리 대상) */
export function canDecode(mime: string): boolean {
  return mime === 'image/png' || mime === 'image/jpeg';
}

export function decodeImage(bytes: Uint8Array): RgbaImage {
  const mime = sniffMime(bytes);
  if (mime === 'image/png') {
    const png = PNG.sync.read(Buffer.from(bytes));
    return { width: png.width, height: png.height, data: new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.length) };
  }
  if (mime === 'image/jpeg') {
    const decoded = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 1024 });
    return { width: decoded.width, height: decoded.height, data: new Uint8ClampedArray(decoded.data.buffer, decoded.data.byteOffset, decoded.data.length) };
  }
  throw new Error(`후처리할 수 없는 이미지 형식입니다 (${mime}). PNG/JPEG 만 지원합니다.`);
}

export function encodePng(img: RgbaImage): Buffer {
  const png = new PNG({ width: img.width, height: img.height });
  Buffer.from(img.data.buffer, img.data.byteOffset, img.data.length).copy(png.data);
  return PNG.sync.write(png);
}

/** 흰 배경에 합성해 JPEG 로 (앱의 convertBase64ToJpeg 와 같은 규칙: 알파 → 흰색) */
export function encodeJpegOnWhite(img: RgbaImage, quality = 92): Buffer {
  const out = Buffer.alloc(img.width * img.height * 4);
  for (let i = 0; i < img.data.length; i += 4) {
    const a = img.data[i + 3] / 255;
    out[i] = Math.round(img.data[i] * a + 255 * (1 - a));
    out[i + 1] = Math.round(img.data[i + 1] * a + 255 * (1 - a));
    out[i + 2] = Math.round(img.data[i + 2] * a + 255 * (1 - a));
    out[i + 3] = 255;
  }
  return jpeg.encode({ data: out, width: img.width, height: img.height }, quality).data;
}

export function hasTransparency(img: RgbaImage): boolean {
  for (let i = 3; i < img.data.length; i += 4) {
    if (img.data[i] < 255) return true;
  }
  return false;
}

export function crop(img: RgbaImage, x: number, y: number, width: number, height: number): RgbaImage {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let row = 0; row < height; row++) {
    const srcStart = ((y + row) * img.width + x) * 4;
    out.set(img.data.subarray(srcStart, srcStart + width * 4), row * width * 4);
  }
  return { width, height, data: out };
}

/** 정수배 최근접 확대 (픽셀아트 표시용 — 소수 배율은 픽셀을 뭉갠다) */
export function upscaleNearest(img: RgbaImage, scale: number): RgbaImage {
  if (scale <= 1) return img;
  const width = img.width * scale;
  const height = img.height * scale;
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const sy = Math.floor(y / scale);
    for (let x = 0; x < width; x++) {
      const s = (sy * img.width + Math.floor(x / scale)) * 4;
      const d = (y * width + x) * 4;
      out[d] = img.data[s];
      out[d + 1] = img.data[s + 1];
      out[d + 2] = img.data[s + 2];
      out[d + 3] = img.data[s + 3];
    }
  }
  return { width, height, data: out };
}

/** 면적 평균 축소 (긴 변을 maxDim 이하로). 이미 작으면 그대로. */
export function downscale(img: RgbaImage, maxDim: number): RgbaImage {
  const longest = Math.max(img.width, img.height);
  if (longest <= maxDim) return img;
  const ratio = maxDim / longest;
  const width = Math.max(1, Math.round(img.width * ratio));
  const height = Math.max(1, Math.round(img.height * ratio));
  const out = new Uint8ClampedArray(width * height * 4);
  const sx = img.width / width;
  const sy = img.height / height;
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * img.width + xx) * 4;
          r += img.data[i];
          g += img.data[i + 1];
          b += img.data[i + 2];
          a += img.data[i + 3];
          n++;
        }
      }
      const d = (y * width + x) * 4;
      out[d] = r / n;
      out[d + 1] = g / n;
      out[d + 2] = b / n;
      out[d + 3] = a / n;
    }
  }
  return { width, height, data: out };
}

export function toDataUrl(bytes: Uint8Array, mime = sniffMime(bytes)): string {
  return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
}

export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(',');
  return Buffer.from(comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl, 'base64');
}

/**
 * 참조 이미지를 API 페이로드용 data URL 로 만든다.
 * 앱의 업로드 처리(`downscaleImage(1280, 0.85)`)와 같은 규칙: 긴 변 1280 초과면 축소,
 * PNG 는 PNG 유지(투명 보존), 그 외는 JPEG 85.
 */
export function prepareReference(bytes: Uint8Array, maxDim = 1280): string {
  const mime = sniffMime(bytes);
  if (!canDecode(mime)) return toDataUrl(bytes, mime);
  const img = decodeImage(bytes);
  if (Math.max(img.width, img.height) <= maxDim) return toDataUrl(bytes, mime);
  const small = downscale(img, maxDim);
  return mime === 'image/png' ? toDataUrl(encodePng(small), 'image/png') : toDataUrl(encodeJpegOnWhite(small, 85), 'image/jpeg');
}

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);

/** 같은 파일을 체인 단계·컨셉 조합마다 다시 읽고 축소하지 않도록 (경로+수정 시각+크기) 기준으로 캐시한다 */
const referenceCache = new Map<string, string>();

export function readReferenceFile(path: string): string {
  if (!IMAGE_EXTENSIONS.has(extname(path).toLowerCase())) {
    throw new Error(`이미지 파일이 아닙니다: ${path}`);
  }
  const stat = statSync(path);
  const key = `${path}|${stat.mtimeMs}|${stat.size}`;
  let cached = referenceCache.get(key);
  if (!cached) {
    cached = prepareReference(readFileSync(path));
    if (referenceCache.size > 64) referenceCache.clear();
    referenceCache.set(key, cached);
  }
  return cached;
}
