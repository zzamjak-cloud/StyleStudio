// 참조 문서 타입 정의
export interface ReferenceDocument {
  id: string; // ref-{timestamp}-{random}
  fileName: string; // 파일명
  filePath: string; // 원본 파일 경로 (또는 Google Sheets URL)
  fileType: string; // pdf, xlsx, xls, csv, md, markdown, txt, google-spreadsheet
  content: string; // 파싱된 텍스트 내용
  summary?: string; // AI 요약 (최대 500자)
  metadata?: {
    pageCount?: number; // PDF 페이지 수
    sheetCount?: number; // Excel 시트 수
    lineCount?: number; // 텍스트 줄 수
    characterCount?: number; // 문자 수
  };
  createdAt: number;
  updatedAt: number;
}
