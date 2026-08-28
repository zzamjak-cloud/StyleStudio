/**
 * 이미지 data URL의 실제 포맷을 판별하는 유틸.
 *
 * ## 왜 선언된 MIME을 믿지 않는가
 * 앱 곳곳에서 `data:image/jpeg;base64,...` 를 **하드코딩**해 붙인다(생성 API가 무엇을
 * 돌려주든). 저장 로직이 그 선언을 따라 확장자를 정하면 **PNG 바이트가 `.jpg` 파일로**
 * 나간다 — 실제로 룰타일 합성 시트(투명 PNG)가 `.jpg`로 저장되고 있었다. 확장자와 헤더가
 * 어긋나면 OS 썸네일러·유니티 임포터가 흰 배경이나 체크무늬로 잘못 그린다.
 *
 * 그래서 **base64 앞부분의 매직 넘버로 실제 포맷을 판별**하고, 판별에 실패했을 때만
 * 선언된 MIME으로 폴백한다. 판별은 문자열 prefix 비교라 디코딩 비용이 없다.
 */

/** 지원하는 이미지 포맷 (저장 확장자 기준) */
export type ImageFileFormat = 'png' | 'jpg' | 'webp' | 'gif';

/** base64 페이로드 선두의 매직 넘버 → 포맷 */
const BASE64_SIGNATURES: Array<[prefix: string, format: ImageFileFormat]> = [
  ['iVBORw0KGgo', 'png'], // \x89PNG\r\n\x1a\n
  ['/9j/', 'jpg'], // \xFF\xD8\xFF
  ['R0lGOD', 'gif'], // GIF8
  ['UklGR', 'webp'], // RIFF (WEBP 컨테이너)
];

/** 선언된 MIME → 포맷 (매직 넘버 판별이 실패했을 때의 폴백) */
const MIME_FORMATS: Record<string, ImageFileFormat> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/** data URL에 선언된 MIME 타입 (data URL이 아니면 null) */
export function getDataUrlMime(dataUrl: string): string | null {
  const m = /^data:([^;,]+)[;,]/.exec(dataUrl);
  return m ? m[1].toLowerCase() : null;
}

/** data URL의 base64 페이로드 (없으면 null) */
export function getDataUrlBase64(dataUrl: string): string | null {
  const comma = dataUrl.indexOf(',');
  if (!dataUrl.startsWith('data:') || comma === -1) return null;
  return dataUrl.slice(comma + 1);
}

/**
 * base64 페이로드의 실제 이미지 포맷 (매직 넘버 기준).
 * 알 수 없으면 null — 호출부가 선언 MIME으로 폴백한다.
 */
export function detectFormatFromBase64(base64: string): ImageFileFormat | null {
  const head = base64.slice(0, 16);
  for (const [prefix, format] of BASE64_SIGNATURES) {
    if (head.startsWith(prefix)) return format;
  }
  return null;
}

/**
 * data URL 바이트의 실제 포맷. 매직 넘버 → 선언 MIME → `jpg` 순으로 결정한다.
 * (`jpg` 폴백은 이 앱의 기존 기본값이다 — 생성 이미지는 대부분 JPEG였다)
 */
export function detectImageFormat(dataUrl: string): ImageFileFormat {
  const base64 = getDataUrlBase64(dataUrl);
  if (base64) {
    const sniffed = detectFormatFromBase64(base64);
    if (sniffed) return sniffed;
  }
  const mime = getDataUrlMime(dataUrl);
  return (mime && MIME_FORMATS[mime]) || 'jpg';
}

/** 저장 다이얼로그 필터 1개 (Tauri `save`의 filters 항목 형태) */
export interface ImageSaveFilter {
  name: string;
  extensions: string[];
}

/** 포맷별 저장 정보 (확장자 + 다이얼로그 필터) */
export interface ImageSaveFormat {
  format: ImageFileFormat;
  /** 파일명에 붙일 확장자 (점 없음) */
  extension: string;
  filter: ImageSaveFilter;
}

const SAVE_FILTERS: Record<ImageFileFormat, ImageSaveFilter> = {
  png: { name: 'PNG Image', extensions: ['png'] },
  jpg: { name: 'JPEG Image', extensions: ['jpg', 'jpeg'] },
  webp: { name: 'WebP Image', extensions: ['webp'] },
  gif: { name: 'GIF Image', extensions: ['gif'] },
};

/**
 * data URL을 파일로 저장할 때 쓸 확장자·필터.
 * **바이트가 PNG면 반드시 `.png`로 나간다** — 알파 채널이 살아 있는 파일을 `.jpg`로
 * 저장하면 뷰어·임포터가 투명 영역을 흰색이나 체크무늬로 그린다.
 */
export function getImageSaveFormat(dataUrl: string): ImageSaveFormat {
  const format = detectImageFormat(dataUrl);
  return { format, extension: format, filter: SAVE_FILTERS[format] };
}

/** data URL의 base64를 그대로 바이트 배열로 (재인코딩 없음 — 알파 보존) */
export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = getDataUrlBase64(dataUrl);
  if (!base64) {
    throw new Error('Base64 데이터를 추출할 수 없습니다. Data URL 형식이 잘못되었습니다.');
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
