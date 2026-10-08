/**
 * 참조 문서 로더 테스트 (API 호출 없음 — summary 는 쓰지 않는다)
 */
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as XLSX from 'xlsx';

import { loadDocuments } from '../src/documents';

const dir = mkdtempSync(join(tmpdir(), 'ss-docs-'));
const dataDir = mkdtempSync(join(tmpdir(), 'ss-data-'));

/** 텍스트 한 줄짜리 최소 PDF */
function tinyPdf(text: string): Uint8Array {
  const stream = `BT /F1 18 Tf 10 50 Td (${text}) Tj ET`;
  const pdf = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 100]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length ${stream.length}>>stream
${stream}
endstream endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R>>
%%EOF`;
  return new Uint8Array(Buffer.from(pdf, 'latin1'));
}

describe('참조 문서 로딩', () => {
  test('엑셀·CSV·마크다운·PDF 를 앱과 같은 규칙으로 텍스트화', async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['버튼', '색상'], ['확인', '파랑']]), '화면');
    const xlsxPath = join(dir, 'spec.xlsx');
    writeFileSync(xlsxPath, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
    writeFileSync(join(dir, 'a.csv'), 'name,"value"\nhp,100\n');
    writeFileSync(join(dir, 'b.md'), '# 제목\n본문');
    writeFileSync(join(dir, 'c.pdf'), tinyPdf('Hello StyleStudio'));

    const docs = await loadDocuments(
      dataDir,
      [{ path: xlsxPath }, { path: join(dir, 'a.csv') }, { path: join(dir, 'b.md') }, { path: join(dir, 'c.pdf') }, { name: 'memo', content: '직접' }],
      { forPrompt: 'content' }
    );
    expect(docs[0].content).toContain('=== 시트: 화면 ===');
    expect(docs[0].content).toContain('확인 | 파랑');
    expect(docs[1].content).toBe('name | value\nhp | 100');
    expect(docs[2].content).toContain('# 제목');
    expect(docs[3].content).toContain('Hello StyleStudio');
    expect(docs[4].fileName).toBe('memo');
    expect(docs.every((d) => d.summary === undefined)).toBe(true);
  });

  test('지원하지 않는 형식·빈 문서는 오류', async () => {
    writeFileSync(join(dir, 'x.docx'), 'x');
    await expect(loadDocuments(dataDir, [{ path: join(dir, 'x.docx') }], { forPrompt: 'content' })).rejects.toThrow('지원하지 않는');
    await expect(loadDocuments(dataDir, [{ content: '   ' }], { forPrompt: 'content' })).rejects.toThrow('내용이 없습니다');
  });

  test('10만 자를 넘으면 앱과 같이 자른다', async () => {
    const [doc] = await loadDocuments(dataDir, [{ content: 'a'.repeat(150_000) }], { forPrompt: 'content' });
    expect(doc.content.length).toBeLessThan(110_000);
  });
});
