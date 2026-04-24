// 파일 파서 유틸리티 - 다양한 파일 형식을 텍스트로 변환

import * as XLSX from 'xlsx';
import { readFile } from '@tauri-apps/plugin-fs';
import { fetch } from '@tauri-apps/plugin-http';

// pdfjs-dist는 PDF 처리 시점에만 동적으로 로드한다. 앱 시작 번들 크기 축소.
let pdfjsLibPromise: Promise<typeof import('pdfjs-dist')> | null = null;
let pdfOpsRef: any = {};

async function getPdfJs(): Promise<typeof import('pdfjs-dist')> {
  if (!pdfjsLibPromise) {
    pdfjsLibPromise = import('pdfjs-dist').then((mod) => {
      mod.GlobalWorkerOptions.workerSrc = `/pdf.worker.min.mjs`;
      pdfOpsRef = (mod as any).OPS ?? {};
      return mod;
    });
  }
  return pdfjsLibPromise;
}

export interface ParsedFileContent {
  text: string;
  metadata?: {
    fileName: string;
    fileType: string;
    pageCount?: number;
    sheetCount?: number;
    extractedImageCount?: number; // v0.4.4: PDF 내장 이미지 개수
  };
  extractedImages?: string[]; // v0.4.4: PDF 내장 이미지 (data URL 배열)
}

/**
 * 파일 확장자로 파일 타입 판단
 */
export function getFileType(fileName: string): string {
  const ext = fileName.toLowerCase().split('.').pop() || '';
  return ext;
}

/**
 * PDF 페이지에서 내장 이미지를 추출해 PNG data URL 배열로 반환.
 * 실패 시 빈 배열 반환 (텍스트 파싱은 계속 진행).
 * 페이지당 최대 10장, 크기 50x50 미만 이미지는 스킵(아이콘 등 노이즈 제거).
 */
async function extractImagesFromPdfPage(page: any): Promise<string[]> {
  const out: string[] = [];
  try {
    // pdfjs-dist의 OPS 상수가 채워져 있도록 보장 (호출 시점에 lazy 로드 완료)
    await getPdfJs();
    const ops = await page.getOperatorList();
    const targetOps = [
      pdfOpsRef.paintImageXObject,
      pdfOpsRef.paintInlineImageXObject,
      pdfOpsRef.paintJpegXObject,
    ].filter((v: any) => v !== undefined);

    for (let i = 0; i < ops.fnArray.length; i++) {
      if (!targetOps.includes(ops.fnArray[i])) continue;
      const name = ops.argsArray[i]?.[0];
      if (!name) continue;

      // pdf.js 이미지 오브젝트는 resolve 콜백으로 획득 (3초 타임아웃)
      const img: any = await Promise.race([
        new Promise((resolve) => {
          try {
            page.objs.get(name, resolve);
          } catch {
            resolve(null);
          }
        }),
        new Promise((resolve) => setTimeout(() => resolve(null), 3000)),
      ]);
      if (!img || !img.width || !img.height) continue;
      if (img.width < 50 || img.height < 50) continue; // 아이콘 노이즈 제거

      const dataUrl = await renderPdfImageToDataUrl(img);
      if (dataUrl) out.push(dataUrl);

      if (out.length >= 10) break; // 페이지당 상한
    }
  } catch (error) {
    console.warn('[pdf] 페이지 이미지 추출 실패:', error);
  }
  return out;
}

/** pdf.js 이미지 오브젝트를 Canvas로 그려 PNG data URL 반환 */
async function renderPdfImageToDataUrl(img: {
  width: number;
  height: number;
  data?: Uint8ClampedArray | Uint8Array;
  kind?: number; // 1=Grayscale, 2=RGB, 3=RGBA
  bitmap?: ImageBitmap;
}): Promise<string | null> {
  try {
    const useOffscreen = typeof OffscreenCanvas !== 'undefined';
    const canvas: any = useOffscreen
      ? new OffscreenCanvas(img.width, img.height)
      : Object.assign(document.createElement('canvas'), {
          width: img.width,
          height: img.height,
        });
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    if (img.bitmap) {
      ctx.drawImage(img.bitmap, 0, 0);
    } else if (img.data) {
      const rgba = toRgbaBuffer(img.data, img.kind ?? 2, img.width, img.height);
      const imageData = new ImageData(rgba, img.width, img.height);
      ctx.putImageData(imageData, 0, 0);
    } else {
      return null;
    }

    if (useOffscreen && canvas instanceof OffscreenCanvas) {
      const blob = await canvas.convertToBlob({ type: 'image/png' });
      return await blobToDataUrl(blob);
    }
    return (canvas as HTMLCanvasElement).toDataURL('image/png');
  } catch (error) {
    console.warn('[pdf] 이미지 변환 실패:', error);
    return null;
  }
}

/** pdf.js 이미지 data 버퍼를 RGBA로 정규화 */
function toRgbaBuffer(
  src: Uint8ClampedArray | Uint8Array,
  kind: number,
  width: number,
  height: number
): Uint8ClampedArray {
  const total = width * height;
  const out = new Uint8ClampedArray(total * 4);

  // 버퍼 길이 방어: 예상 크기보다 작으면 투명 검정 반환 (안전하게 건너뜀 유도)
  const expected = kind === 1 ? total : kind === 3 ? total * 4 : total * 3;
  if (src.length < expected) {
    return out;
  }

  if (kind === 1) {
    // Grayscale
    for (let i = 0; i < total; i++) {
      const v = src[i];
      out[i * 4] = v;
      out[i * 4 + 1] = v;
      out[i * 4 + 2] = v;
      out[i * 4 + 3] = 255;
    }
  } else if (kind === 3) {
    // RGBA (이미 4채널)
    out.set(src);
  } else {
    // RGB (기본)
    for (let i = 0; i < total; i++) {
      out[i * 4] = src[i * 3];
      out[i * 4 + 1] = src[i * 3 + 1];
      out[i * 4 + 2] = src[i * 3 + 2];
      out[i * 4 + 3] = 255;
    }
  }
  return out;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * PDF 파일 파싱 (pdfjs-dist 사용)
 */
export async function parsePDF(filePath: string, fileName: string): Promise<ParsedFileContent> {
  try {
    const fileData = await readFile(filePath);

    // PDF 문서 로드
    const pdfjsLib = await getPdfJs();
    const loadingTask = pdfjsLib.getDocument({ data: fileData });
    const pdf = await loadingTask.promise;

    let text = '';
    const extractedImages: string[] = [];
    const MAX_TOTAL_IMAGES = 20; // 문서 전체 상한 (메모리 보호)

    // 모든 페이지 텍스트 및 이미지 추출
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();

      // 텍스트 아이템들을 문자열로 변환
      const pageText = textContent.items
        .map((item: any) => ('str' in item ? item.str : ''))
        .join(' ');

      text += pageText + '\n\n';

      // 이미지 추출 (전체 상한 미달 시)
      if (extractedImages.length < MAX_TOTAL_IMAGES) {
        try {
          const pageImages = await extractImagesFromPdfPage(page);
          for (const img of pageImages) {
            if (extractedImages.length >= MAX_TOTAL_IMAGES) break;
            extractedImages.push(img);
          }
        } catch (imgError) {
          // 이미지 추출 실패는 텍스트 수집에 영향 주지 않음
          console.warn(`[pdf] 페이지 ${i} 이미지 추출 예외, 건너뜀:`, imgError);
        }
      }
    }

    return {
      text: text.trim(),
      metadata: {
        fileName,
        fileType: 'pdf',
        pageCount: pdf.numPages,
        extractedImageCount: extractedImages.length,
      },
      extractedImages: extractedImages.length > 0 ? extractedImages : undefined,
    };
  } catch (error) {
    throw new Error(`PDF 파싱 실패: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Excel 파일 파싱 (xlsx, xls)
 */
export async function parseExcel(filePath: string, fileName: string): Promise<ParsedFileContent> {
  try {
    const fileData = await readFile(filePath);
    const workbook = XLSX.read(fileData, { type: 'buffer' });

    let text = '';
    const sheetNames = workbook.SheetNames;

    // 모든 시트를 순회하며 텍스트로 변환
    for (const sheetName of sheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const sheetData = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

      text += `\n\n=== 시트: ${sheetName} ===\n\n`;

      // 각 행을 텍스트로 변환
      for (const row of sheetData as any[][]) {
        if (Array.isArray(row) && row.length > 0) {
          const rowText = row
            .map((cell) => (cell !== null && cell !== undefined ? String(cell).trim() : ''))
            .filter((cell) => cell.length > 0)
            .join(' | ');

          if (rowText) {
            text += rowText + '\n';
          }
        }
      }
    }

    return {
      text: text.trim(),
      metadata: {
        fileName,
        fileType: 'excel',
        sheetCount: sheetNames.length,
      },
    };
  } catch (error) {
    throw new Error(`Excel 파싱 실패: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * CSV 파일 파싱
 */
export async function parseCSV(filePath: string, fileName: string): Promise<ParsedFileContent> {
  try {
    const fileData = await readFile(filePath);
    const text = new TextDecoder('utf-8').decode(fileData);

    // CSV를 파싱하여 읽기 쉬운 형식으로 변환
    const lines = text.split('\n').filter((line) => line.trim().length > 0);
    const parsedLines = lines.map((line) => {
      // CSV 셀 분리 (쉼표로 구분, 따옴표 처리)
      const cells = line.split(',').map((cell) => cell.trim().replace(/^"|"$/g, ''));
      return cells.filter((cell) => cell.length > 0).join(' | ');
    });

    return {
      text: parsedLines.join('\n'),
      metadata: {
        fileName,
        fileType: 'csv',
      },
    };
  } catch (error) {
    throw new Error(`CSV 파싱 실패: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Markdown 파일 파싱
 */
export async function parseMarkdown(filePath: string, fileName: string): Promise<ParsedFileContent> {
  try {
    const fileData = await readFile(filePath);
    const text = new TextDecoder('utf-8').decode(fileData);

    return {
      text,
      metadata: {
        fileName,
        fileType: 'markdown',
      },
    };
  } catch (error) {
    throw new Error(`Markdown 파싱 실패: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * 텍스트 파일 파싱
 */
export async function parseText(filePath: string, fileName: string): Promise<ParsedFileContent> {
  try {
    const fileData = await readFile(filePath);
    const text = new TextDecoder('utf-8').decode(fileData);

    return {
      text,
      metadata: {
        fileName,
        fileType: 'text',
      },
    };
  } catch (error) {
    throw new Error(`텍스트 파일 파싱 실패: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Google Spreadsheet URL에서 CSV 다운로드 및 파싱
 */
export async function parseGoogleSpreadsheet(url: string): Promise<ParsedFileContent> {
  try {
    // Google Spreadsheet URL을 CSV export URL로 변환
    // 예: https://docs.google.com/spreadsheets/d/{SHEET_ID}/edit
    // -> https://docs.google.com/spreadsheets/d/{SHEET_ID}/export?format=csv&gid=0

    let csvUrl = url;

    // URL 형식 변환
    if (url.includes('/spreadsheets/d/')) {
      const sheetIdMatch = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
      if (sheetIdMatch) {
        const sheetId = sheetIdMatch[1];
        // gid 파라미터 추출 (있는 경우)
        const gidMatch = url.match(/[#&]gid=(\d+)/);
        const gid = gidMatch ? gidMatch[1] : '0';

        csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
      }
    }

    // CSV 다운로드
    const response = await fetch(csvUrl);
    if (!response.ok) {
      throw new Error(`Google Spreadsheet 다운로드 실패: ${response.status}`);
    }

    const csvText = await response.text();

    // CSV 파싱
    const lines = csvText.split('\n').filter((line) => line.trim().length > 0);
    const parsedLines = lines.map((line) => {
      const cells = line.split(',').map((cell) => cell.trim().replace(/^"|"$/g, ''));
      return cells.filter((cell) => cell.length > 0).join(' | ');
    });

    return {
      text: parsedLines.join('\n'),
      metadata: {
        fileName: 'Google Spreadsheet',
        fileType: 'google-spreadsheet',
      },
    };
  } catch (error) {
    throw new Error(`Google Spreadsheet 파싱 실패: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * 웹 페이지 HTML 파싱 (일반 URL)
 */
export async function parseWebPage(url: string): Promise<ParsedFileContent> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`웹 페이지 다운로드 실패: ${response.status}`);
    }

    const html = await response.text();

    // HTML 태그 제거 및 텍스트 추출
    let text = html
      // script, style 태그와 그 내용 제거
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      // HTML 태그 제거
      .replace(/<[^>]+>/g, ' ')
      // HTML 엔티티 디코딩
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      // 연속된 공백 제거
      .replace(/\s+/g, ' ')
      // 빈 줄 제거
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .join('\n');

    return {
      text: text.trim(),
      metadata: {
        fileName: url,
        fileType: 'webpage',
      },
    };
  } catch (error) {
    throw new Error(`웹 페이지 파싱 실패: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * 파일 경로 또는 URL로부터 파일 내용 파싱
 */
export async function parseFile(filePathOrUrl: string, fileName?: string): Promise<ParsedFileContent> {
  const actualFileName = fileName || filePathOrUrl.split('/').pop() || 'unknown';
  const fileType = getFileType(actualFileName);

  // Google Spreadsheet URL인 경우
  if (filePathOrUrl.includes('docs.google.com/spreadsheets')) {
    return parseGoogleSpreadsheet(filePathOrUrl);
  }

  // 일반 웹 페이지 URL인 경우
  if (filePathOrUrl.startsWith('http://') || filePathOrUrl.startsWith('https://')) {
    return parseWebPage(filePathOrUrl);
  }

  // 로컬 파일인 경우
  switch (fileType.toLowerCase()) {
    case 'pdf':
      return parsePDF(filePathOrUrl, actualFileName);

    case 'xlsx':
    case 'xls':
      return parseExcel(filePathOrUrl, actualFileName);

    case 'csv':
      return parseCSV(filePathOrUrl, actualFileName);

    case 'md':
    case 'markdown':
      return parseMarkdown(filePathOrUrl, actualFileName);

    case 'txt':
      return parseText(filePathOrUrl, actualFileName);

    default:
      // 기본적으로 텍스트 파일로 시도
      try {
        return await parseText(filePathOrUrl, actualFileName);
      } catch {
        throw new Error(`지원하지 않는 파일 형식입니다: ${fileType}`);
      }
  }
}

/**
 * 파일 크기 제한 체크 (10MB)
 */
export function checkFileSize(fileSize: number): boolean {
  const MAX_SIZE = 10 * 1024 * 1024; // 10MB
  return fileSize <= MAX_SIZE;
}

/**
 * 지원하는 파일 형식 목록
 */
export const SUPPORTED_FILE_TYPES = ['pdf', 'xlsx', 'xls', 'csv', 'md', 'markdown', 'txt'] as const;

export const SUPPORTED_FILE_EXTENSIONS = SUPPORTED_FILE_TYPES.map((ext) => `.${ext}`).join(',');
