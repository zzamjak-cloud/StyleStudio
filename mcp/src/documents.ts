/**
 * 참조 문서 로딩 (헤드리스) — 앱과 같은 변환 규칙(`src/lib/utils/documentText.ts`)으로 텍스트를 만든다.
 *
 * 지원: 직접 텍스트(content) · 파일(pdf·xlsx·xls·csv·md·markdown·txt·json) · URL(웹페이지·구글 스프레드시트)
 * - UI 세션 프롬프트는 앱처럼 본문 전체(최대 10만 자)를 넣는다.
 * - 편집 체인(채팅)은 앱처럼 요약을 넣는다 — 1000자 미만이면 원문, 아니면 Flash 요약 1회(문서당).
 * - PDF 내장 이미지 추출은 하지 않는다(앱은 canvas 로 렌더링한다). 텍스트만 쓴다.
 */

import { existsSync, readFileSync } from 'node:fs';
import { basename, extname } from 'node:path';

import type { ReferenceDocument } from '../../src/types/referenceDocument';
import {
  csvToText,
  excelToText,
  googleSheetCsvUrl,
  htmlToText,
  isGoogleSheetUrl,
  pdfDocumentToText,
} from '../../src/lib/utils/documentText';
import { generateFileSummary, MAX_FILE_SIZE_CHARS, truncateFileContent } from '../../src/lib/utils/fileOptimization';

import { assertReadableDocument, getApiKey } from './env';

export interface DocumentInput {
  /** 프롬프트에 보일 문서 이름 */
  name?: string;
  /** 직접 넣는 본문 */
  content?: string;
  /** 파일 경로 (pdf·xlsx·xls·csv·md·markdown·txt·json) */
  path?: string;
  /** 웹페이지 또는 구글 스프레드시트 URL */
  url?: string;
}

let pdfjsReady: Promise<typeof import('pdfjs-dist/legacy/build/pdf.mjs')> | null = null;

/**
 * pdf.js (Node legacy 빌드). 워커를 별도 파일로 띄우지 않고 번들에 넣어 같은 스레드에서 돌린다 —
 * 단일 스크립트(ss-mcp.mjs)로 배포하므로 워커 파일 경로를 찾을 수 없다.
 */
async function loadPdfJs() {
  pdfjsReady ??= (async () => {
    const worker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
    (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = worker;
    return import('pdfjs-dist/legacy/build/pdf.mjs');
  })().catch((error) => {
    // 실패한 promise 를 캐시하면 재시작 전까지 모든 PDF 가 실패한다 — 다음 호출에서 다시 시도하게 비운다
    pdfjsReady = null;
    throw error;
  });
  return pdfjsReady;
}

async function pdfToText(bytes: Uint8Array): Promise<string> {
  const pdfjs = await loadPdfJs();
  const pdf = await pdfjs.getDocument({ data: bytes, isEvalSupported: false, verbosity: 0 }).promise;
  try {
    return await pdfDocumentToText(pdf);
  } finally {
    // 같은 스레드 워커에 문서가 남지 않게 정리한다
    await pdf.destroy();
  }
}

async function readPath(path: string, dataDir: string): Promise<{ text: string; type: string }> {
  if (!existsSync(path)) throw new Error(`참조 문서를 찾을 수 없습니다: ${path}`);
  assertReadableDocument(path, dataDir);
  const ext = extname(path).toLowerCase().slice(1);
  const bytes = readFileSync(path);
  switch (ext) {
    case 'pdf':
      return { text: await pdfToText(new Uint8Array(bytes)), type: 'pdf' };
    case 'xlsx':
    case 'xls':
      return { text: excelToText(new Uint8Array(bytes)).text, type: ext };
    case 'csv':
      return { text: csvToText(bytes.toString('utf-8')), type: 'csv' };
    case 'md':
    case 'markdown':
    case 'txt':
    case 'json':
      return { text: bytes.toString('utf-8'), type: ext };
    default:
      throw new Error(`지원하지 않는 문서 형식입니다: ${path} (pdf·xlsx·xls·csv·md·txt·json)`);
  }
}

async function readUrl(url: string): Promise<{ text: string; type: string }> {
  if (!/^https?:\/\//i.test(url)) throw new Error(`http(s) URL 만 지원합니다: ${url}`);
  const sheet = isGoogleSheetUrl(url);
  const response = await fetch(sheet ? googleSheetCsvUrl(url) : url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`문서 다운로드 실패 (${response.status}): ${url}`);
  const body = await response.text();
  return sheet ? { text: csvToText(body), type: 'google-spreadsheet' } : { text: htmlToText(body), type: 'webpage' };
}

/**
 * 문서 목록 → ReferenceDocument[]. `summarize` 면 앱 채팅처럼 요약을 함께 만든다(문서당 Flash 1회, 1000자 미만은 원문).
 */
export async function loadDocuments(
  dataDir: string,
  docs: DocumentInput[] | undefined,
  options: { forPrompt: 'content' | 'summary' }
): Promise<ReferenceDocument[]> {
  if (!docs || docs.length === 0) return [];
  const out: ReferenceDocument[] = [];
  for (const [index, doc] of docs.entries()) {
    let text = doc.content ?? '';
    let type = 'text';
    if (!text && doc.path) ({ text, type } = await readPath(doc.path, dataDir));
    else if (!text && doc.url) ({ text, type } = await readUrl(doc.url));
    if (!text.trim()) throw new Error(`참조 문서[${index}] 에 내용이 없습니다 (content·path·url 중 하나 필요).`);
    // 앱과 같은 상한 (fileOptimization.validateFileSize: 10만 자)
    if (text.length > MAX_FILE_SIZE_CHARS) text = truncateFileContent(text);
    const fileName = doc.name ?? (doc.path ? basename(doc.path) : doc.url ?? `document-${index + 1}`);
    const now = Date.now();
    out.push({
      id: `mcp-doc-${index}`,
      fileName,
      filePath: doc.path ?? doc.url ?? '',
      fileType: type,
      content: text,
      summary: options.forPrompt === 'summary' ? await generateFileSummary(text, fileName, getApiKey(dataDir)) : undefined,
      metadata: { characterCount: text.length },
      createdAt: now,
      updatedAt: now,
    });
  }
  return out;
}
