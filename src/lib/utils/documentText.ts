/**
 * 참조 문서 → 텍스트 변환 (순수 함수, Tauri·DOM 비의존)
 *
 * 앱(`fileParser.ts`, Tauri fs/http 로 읽음)과 MCP 서버(`mcp/src/documents.ts`, Node fs/fetch 로 읽음)가
 * 같은 변환 규칙을 쓰도록 바이트·문자열 입력만 받는 부분을 여기에 둔다.
 */
import * as XLSX from 'xlsx';

/** CSV 텍스트 → `셀 | 셀` 줄 목록 (앱의 기존 표기와 동일) */
export function csvToText(csv: string): string {
  return csv
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) =>
      line
        .split(',')
        .map((cell) => cell.trim().replace(/^"|"$/g, ''))
        .filter((cell) => cell.length > 0)
        .join(' | ')
    )
    .join('\n');
}

/** 엑셀(xlsx/xls) 바이트 → 시트별 `셀 | 셀` 텍스트 */
export function excelToText(bytes: Uint8Array): { text: string; sheetCount: number } {
  const workbook = XLSX.read(bytes, { type: 'buffer' });
  let text = '';
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as unknown[][];
    text += `\n\n=== 시트: ${sheetName} ===\n\n`;
    for (const row of rows) {
      if (Array.isArray(row) && row.length > 0) {
        const rowText = row
          .map((cell) => (cell !== null && cell !== undefined ? String(cell).trim() : ''))
          .filter((cell) => cell.length > 0)
          .join(' | ');
        if (rowText) text += rowText + '\n';
      }
    }
  }
  return { text: text.trim(), sheetCount: workbook.SheetNames.length };
}

/** HTML → 본문 텍스트 (script/style 제거, 태그 제거, 엔티티 일부 복원) */
export function htmlToText(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n')
    .trim();
}

/** 구글 스프레드시트 URL 이면 CSV 내보내기 URL 로, 아니면 그대로 */
export function googleSheetCsvUrl(url: string): string {
  const sheetIdMatch = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!sheetIdMatch) return url;
  const gid = url.match(/[#&]gid=(\d+)/)?.[1] ?? '0';
  return `https://docs.google.com/spreadsheets/d/${sheetIdMatch[1]}/export?format=csv&gid=${gid}`;
}

export function isGoogleSheetUrl(url: string): boolean {
  return url.includes('docs.google.com/spreadsheets');
}

/** pdf.js 문서 객체 → 페이지별 텍스트 (pdf.js 로딩 방식은 호출부마다 다르다 — 브라우저 워커 / Node legacy) */
export async function pdfDocumentToText(pdf: {
  numPages: number;
  getPage: (n: number) => Promise<{ getTextContent: () => Promise<{ items: unknown[] }> }>;
}): Promise<string> {
  let text = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((item) => (item && typeof item === 'object' && 'str' in item ? String((item as { str: unknown }).str) : '')).join(' ') + '\n\n';
  }
  return text.trim();
}
