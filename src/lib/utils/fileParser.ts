// 파일 파서 유틸리티 - 다양한 파일 형식을 텍스트로 변환

import * as XLSX from 'xlsx';
import { readFile } from '@tauri-apps/plugin-fs';
import { fetch } from '@tauri-apps/plugin-http';
import * as pdfjsLib from 'pdfjs-dist';

// PDF.js Worker 설정 (로컬 파일 사용)
pdfjsLib.GlobalWorkerOptions.workerSrc = `/pdf.worker.min.mjs`;

export interface ParsedFileContent {
  text: string;
  metadata?: {
    fileName: string;
    fileType: string;
    pageCount?: number;
    sheetCount?: number;
  };
}

/**
 * 파일 확장자로 파일 타입 판단
 */
export function getFileType(fileName: string): string {
  const ext = fileName.toLowerCase().split('.').pop() || '';
  return ext;
}

/**
 * PDF 파일 파싱 (pdfjs-dist 사용)
 */
export async function parsePDF(filePath: string, fileName: string): Promise<ParsedFileContent> {
  try {
    const fileData = await readFile(filePath);

    // PDF 문서 로드
    const loadingTask = pdfjsLib.getDocument({ data: fileData });
    const pdf = await loadingTask.promise;

    let text = '';

    // 모든 페이지 텍스트 추출
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();

      // 텍스트 아이템들을 문자열로 변환
      const pageText = textContent.items
        .map((item: any) => {
          if ('str' in item) {
            return item.str;
          }
          return '';
        })
        .join(' ');

      text += pageText + '\n\n';
    }

    return {
      text: text.trim(),
      metadata: {
        fileName,
        fileType: 'pdf',
        pageCount: pdf.numPages,
      },
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
