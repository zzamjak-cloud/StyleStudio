# 참조 문서 (Reference Documents)

UI 디자인 세션에서 PDF·Excel·CSV·Markdown·Text·Google Sheets·웹페이지를 첨부하면, 그 내용을 텍스트로 파싱해 **이미지 생성 프롬프트에 그대로 주입**하는 기능. 기획서(PDF/Excel)의 요구사항을 AI가 UI 화면 생성에 반영하게 한다. 문서는 **현재 세션(`session.referenceDocuments`)에 저장**되며, `UI` 세션 타입에서만 첨부 UI가 노출된다. 파일 파싱은 로컬(Tauri fs)·원격(Tauri http) 모두 클라이언트에서 수행하고, 긴 내용은 10만 자로 잘리며 별도로 Gemini 요약(최대 500자)을 붙인다.

## 관련 파일

- `src/types/referenceDocument.ts` — `ReferenceDocument` 타입(파싱 결과 + 메타 + 요약 + 추출 이미지)
- `src/lib/utils/fileParser.ts` — 형식별 파서. `parseFile`(디스패처)·`parsePDF`·`parseExcel`·`parseCSV`·`parseMarkdown`·`parseText`·`parseGoogleSpreadsheet`·`parseWebPage`·`getFileType`·`checkFileSize`·`SUPPORTED_FILE_TYPES`
- `src/lib/utils/fileOptimization.ts` — 크기 제한·요약. `validateFileSize`(10만 자 상한)·`truncateFileContent`·`generateFileSummary`(gemini-2.5-flash, 500자)·`MAX_FILE_SIZE_CHARS`·`SUMMARY_MAX_LENGTH`
- `src/components/generator/DocumentManager.tsx` — 문서 관리 UI. 한 줄 드롭 영역·파일 선택(`handleAddFile`)·URL 추가(`processUrl`)·문서 칩 리스트·요약 뷰·삭제. `processFiles`가 파싱→검증→요약→`ReferenceDocument` 생성→`onAdd`
- `src/components/generator/GeneratorSettings.tsx` — `sessionType === 'UI'`일 때만 `DocumentManager` 렌더(`GeneratorSettings.tsx:206`)
- `src/hooks/useSessionManagement.ts` — 세션에 문서 부착. `handleDocumentAdd`/`handleDocumentDelete`(`useSessionManagement.ts:321`)가 `session.referenceDocuments` 갱신 후 `persistSessions`
- `src/lib/prompts/sessionPrompts.ts` — `generateUIPrompt`(`sessionPrompts.ts:307`)가 문서 `content`를 `📄 REFERENCE DOCUMENTS` 블록으로 프롬프트에 삽입
- `src/hooks/api/useGeminiImageGenerator.ts` — 생성 시 `referenceDocuments`를 프롬프트 빌더로 전달(`useGeminiImageGenerator.ts:226`)
- `src/components/generator/ImageGeneratorPanel.tsx` — 패널→빌더 전달(`ImageGeneratorPanel.tsx:611,761`), 히스토리에 `referenceDocumentIds` 기록(`:713`)
- `src/lib/windowDragDropBus.ts` — `subscribeWindowDragDrop`. Tauri 창 드롭 이벤트 버스(이미지 핸들러와 공유)
- `src/types/session.ts` — `Session.referenceDocuments?`(UI 세션 전용, `session.ts:22`)

## 데이터 모델

```
ReferenceDocument = {
  id: "ref-{timestamp}-{random}"
  fileName, filePath        // filePath 는 로컬 경로 또는 URL
  fileType                  // pdf | xlsx | xls | csv | md | markdown | txt | google-spreadsheet | webpage | unknown
  content                   // 파싱된 전체 텍스트 (최대 10만 자, 초과 시 truncate)
  summary?                  // Gemini 요약 (최대 500자), 실패 시 content 앞 500자
  metadata?: { pageCount?, sheetCount?, lineCount?, characterCount?, extractedImageCount? }
  extractedImages?: string[] // v0.4.4+ PDF 내장 이미지 data URL 배열
  createdAt, updatedAt      // epoch ms
}

ParsedFileContent = {         // fileParser 반환형
  text
  metadata?: { fileName, fileType, pageCount?, sheetCount?, extractedImageCount? }
  extractedImages?: string[]
}
```

- `content`는 파싱 직후 `validateFileSize`로 검사 — 10만 자(`MAX_FILE_SIZE_CHARS`) 초과 시 `truncateFileContent`가 문장 경계에서 자르고 안내 문구를 덧붙인다.
- `summary`는 별개 필드. `generateFileSummary`가 gemini-2.5-flash로 생성(내용 1000자 미만이면 원문 그대로, 5만 자 초과 입력은 중간 생략). 요약 실패 시 `content` 앞 500자로 대체(DocumentManager 예외 처리).

## 파싱 파이프라인 (fileParser)

`parseFile(filePathOrUrl, fileName?)`이 진입점이며 순서대로 분기한다(`fileParser.ts:450`):

1. `docs.google.com/spreadsheets` 포함 → `parseGoogleSpreadsheet`(export CSV URL로 변환 후 다운로드·파싱)
2. `http(s)://`로 시작 → `parseWebPage`(HTML 태그·script/style 제거, 엔티티 디코딩)
3. 그 외(로컬 파일) → 확장자별: `pdf`→`parsePDF`, `xlsx|xls`→`parseExcel`, `csv`→`parseCSV`, `md|markdown`→`parseMarkdown`, `txt`→`parseText`, 미지원 → `parseText` 시도 후 실패 시 throw

- **로컬 파일 읽기**: `@tauri-apps/plugin-fs`의 `readFile`. **원격 다운로드**: `@tauri-apps/plugin-http`의 `fetch`(CORS 우회, 브라우저 fetch 아님).
- `SUPPORTED_FILE_TYPES = [pdf, xlsx, xls, csv, md, markdown, txt]` — 파일 첨부 UI의 확장자 필터·드롭 검증 기준. Google Sheets·웹페이지는 URL 입력으로만 추가(확장자 목록에 없음).
- `checkFileSize`는 **바이트 10MB** 상한(파일 크기), `validateFileSize`는 **문자 10만 자** 상한(파싱 텍스트) — 서로 다른 단계의 서로 다른 제한.

### PDF 파싱 (pdfjs-dist)

- `pdfjs-dist`는 **PDF 처리 시점에 동적 import**(`getPdfJs`) — 앱 시작 번들 크기 축소. worker는 `/pdf.worker.min.mjs`.
- 모든 페이지 순회: `getTextContent`로 텍스트 누적 + `extractImagesFromPdfPage`로 내장 이미지 추출.
- **이미지 추출**(v0.4.4+): 오퍼레이터 리스트에서 `paintImageXObject`/`paintInlineImageXObject`/`paintJpegXObject`를 스캔, `page.objs.get`으로 이미지 획득(3초 타임아웃). Canvas/OffscreenCanvas로 PNG data URL 변환(`renderPdfImageToDataUrl`, `toRgbaBuffer`로 Grayscale/RGB/RGBA 정규화).
- **상한**: 페이지당 최대 10장, 문서 전체 최대 20장(`MAX_TOTAL_IMAGES`), 50x50 미만은 아이콘 노이즈로 스킵. 이미지 추출 실패는 텍스트 수집에 영향 없음(try/catch로 격리).

### Excel / CSV

- `parseExcel`: `xlsx` 라이브러리로 모든 시트 순회, `=== 시트: {이름} ===` 헤더 + 행별 `|` 구분 텍스트. `sheetCount` 기록.
- `parseCSV`·`parseGoogleSpreadsheet`: 쉼표 분리 + 따옴표 제거 후 `|` 결합. Google Sheets는 `/spreadsheets/d/{id}` + `gid`를 export CSV URL로 변환.

## DocumentManager UI

- `sessionType === 'UI'`에서만 `GeneratorSettings`가 렌더. 채팅 세션은 `ChatAISettings` 하단에서 동일 컴포넌트를 사용한다.
- 문서 등록 표면은 큰 카드가 아니라 **한 줄 드롭 영역**이다. 왼쪽에는 "기획 문서"와 현재 상태, 오른쪽에는 URL 추가(`Link`)와 파일 추가(`Plus`) 버튼을 둔다.
- 주요 설명은 라벨 옆 `?` 도움말 버튼의 hover tooltip로 표시한다. 화면을 차지하는 설명 문단은 두지 않는다.
- 문서가 여러 개 추가되면 한 줄 아래에 **칩 리스트**가 `flex-wrap`으로 자동 증가한다. 각 칩은 파일명·대화 참조 배지(옵션)·요약 보기·삭제 버튼만 가진다.
- **입력 3경로**: (1) 창 전역 드롭(`subscribeWindowDragDrop`) — 이미지 확장자는 무시(`useImageHandling`이 처리), 지원 확장자만 `processFiles`. (2) `+` 버튼 파일 선택(`open` 다이얼로그). (3) `🔗` 버튼 URL 입력(`processUrl`).
- **중복 방지**: `filePath` 동일 문서 스킵, `processingPathsRef`로 처리 중 경로 중복 방지, 드롭 이벤트 500ms 디바운스(`lastDropAtRef`).
- 각 문서 처리: `parseFile` → `validateFileSize` → `generateFileSummary`(실패 시 앞 500자) → `ReferenceDocument` 생성 → `onAdd`. `onAdd`는 `useSessionManagement.handleDocumentAdd`로 세션에 저장.
- 리스트에서 요약 뷰(메타·전체 내용 `details`)·삭제 확인 다이얼로그 제공. `showPersistentBadge`로 "대화 참조중" 배지 표시(채팅 세션 연동).

## UI 디자인 세션에서의 활용

- 생성 시 `ImageGeneratorPanel`이 `session.referenceDocuments`를 `useGeminiImageGenerator`→`buildPromptForSession`로 전달.
- `generateUIPrompt`이 각 문서를 `\n[Document N] {fileName}:\n{content}\n` 형태로 `📄 REFERENCE DOCUMENTS` 블록에 이어붙여 최종 프롬프트에 삽입. **요약이 아니라 `content`(파싱 텍스트) 전문을 주입**한다(요약은 UI 표시용).
- 그리드(`pixelArtGrid`)가 `1x1`이 아니면 UI 스크린 세트(`frameCount`개 화면)로, 아니면 단일 화면으로 프롬프트를 구성. 두 경우 모두 문서 컨텍스트를 포함.
- 생성 히스토리에는 문서 전문 대신 `referenceDocumentIds`(ID 목록)만 기록해 스냅샷 크기를 억제.

## 회귀 증상별 원인

| 증상 | 원인 |
|------|------|
| 문서 첨부 UI가 안 보임 | `sessionType !== 'UI'` — DocumentManager는 UI 세션에서만 렌더(`GeneratorSettings.tsx:206`) |
| 문서 첨부 영역이 큰 카드로 보임 | 구 UI 상태. 현재는 한 줄 드롭 영역 + hover tooltip + 칩 리스트가 기준 |
| 드롭한 이미지가 문서로 안 들어감 | 정상 동작. 이미지 확장자(png/jpg/…)는 의도적으로 스킵하고 `useImageHandling`이 처리 |
| 같은 파일 두 번 추가됨 | `filePath` 중복/처리 중(`processingPathsRef`)/드롭 디바운스(500ms) 체크 우회 — 세 방어선 중 하나 미작동 |
| PDF 이미지가 프롬프트에 안 반영됨 | `extractedImages`는 추출·저장만, `generateUIPrompt`은 `content`(텍스트)만 주입 |
| PDF 이미지 일부 누락 | 페이지당 10장·문서 20장 상한, 50x50 미만 스킵, `page.objs.get` 3초 타임아웃 초과 |
| 긴 문서 내용이 잘림 | `content` 10만 자(`MAX_FILE_SIZE_CHARS`) 상한 — `truncateFileContent`가 문장 경계에서 절단 |
| 요약이 원문 그대로임 | 내용 1000자 미만이면 `generateFileSummary`가 요약 없이 원문 반환 |
| Google Sheets가 빈 내용 | export CSV URL 변환 실패(비공개 시트·잘못된 gid) 또는 `/spreadsheets/d/` 패턴 불일치 |
| 웹페이지 파싱이 지저분함 | `parseWebPage`는 정규식 태그 제거 방식(DOM 파서 아님) — 복잡한 SPA는 텍스트 부실 |
| 요약에 API 키 오류 | `generateFileSummary`가 gemini-2.5-flash 호출 — 키 없으면 실패→앞 500자 fallback |
