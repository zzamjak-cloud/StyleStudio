# 채팅 (Chat)

대화형으로 이미지를 생성·수정하는 세션. 사용자가 텍스트/이미지를 보내면 **텍스트 컨텍스트**(요약 + 최근 대화)와 **참조 이미지**(직전 생성 이미지 + 첨부)를 구성해 OpenRouter Image API(`/api/v1/images`)로 전달하고, 응답 이미지를 다시 대화에 쌓는다. 대화 데이터는 `session.chatData` 에 저장되고, 생성 이미지는 `~/Downloads/AI_Gen/` 에 자동 저장된다. 토큰 누적이 임계값을 넘으면 오래된 메시지를 자동 요약해 이미지 데이터를 버려 저장 공간과 토큰을 절약한다. 부분 편집(어노테이션)은 `wiki/chat/annotation.md` 참고.

> **v0.6 OpenRouter 전환**: Gemini `generateContent` 멀티턴(`buildContents`·`thought_signature`)은 OpenRouter Image API가 지원하지 않아 제거됐다. 대화 맥락은 텍스트 요약 + 최근 6턴 텍스트를 프롬프트에 결합하고, "이어지는 편집"은 직전 생성 이미지를 `input_references` 첫 번째로 전달하는 방식으로 대체됐다.

## 관련 파일

- `src/components/chat/ChatPanel.tsx` — 채팅 패널 메인. `useChatSession`/`useChatImageGeneration` 결합, 전송(`handleSend`)·자동저장(`autoSaveImage`)·수동저장(`handleSaveImage`)·어노테이션 제출(`handleAnnotationSubmit`)·이미지 미리보기 모달. 좌측 대화 + 우측 `ChatAISettings` 레이아웃. 레거시 모델 ID 정규화 effect 포함
- `src/components/chat/ChatInput.tsx` — 하단 입력창(`ChatInput`). textarea 자동 높이, 이미지 첨부(붙여넣기·드래그드롭, 최대 `MAX_IMAGES=5`), Enter 전송/Shift+Enter 줄바꿈. 붙여넣기 이미지는 `downscaleImage(1280, 0.85)` 로 다운스케일
- `src/components/chat/ChatMessage.tsx` — 개별 메시지 렌더(`ChatMessage`, memo). user/assistant/summary 3종, `LazyImage` 이미지, 요약 접기/펼치기, 생성 이미지 위 연필 버튼(어노테이션 진입)
- `src/components/chat/ChatAISettings.tsx` — 우측 AI 설정 패널. 기획문서(`DocumentManager`)·그리드·모델 드롭다운·한 줄 비율·크기·품질 순서로 구성. 2K/4K 선택 시 비용 경고 팝업
- `src/hooks/useChatSession.ts` — `session.chatData` 파생/변경 훅. 메시지 CRUD·토큰 집계·요약·설정 업데이트. `ref` 기반으로 클로저 문제 회피
- `src/hooks/useChatImageGeneration.ts` — 대화 컨텍스트 구성(`buildConversationContext`)·직전 생성 이미지 복원(`resolveLatestGeneratedImage`)·이미지 생성(`generateFromChat`)·요약(`summarizeMessages`)
- `src/lib/api/openrouter.ts` — OpenRouter 공통 클라이언트(`chatComplete`/`generateImageViaOpenRouter`)
- `src/types/chat.ts` — `ChatMessage`/`ChatSessionData`/`ChatGenerationSettings` + `estimateTokenCount`

## 데이터 모델

```
ChatMessage = {
  id, role: 'user'|'assistant'|'summary', content,
  images?: string[],            // data URL 또는 IndexedDB 키
  timestamp,
  documents?: ReferenceDocument[],   // v0.4.4 첨부 문서
  isGeneratedImage?,            // AI가 생성한 이미지 여부 (어노테이션 가능 조건)
  tokenCount?,
  imageSignatures?: string[]    // 레거시 필드 — OpenRouter 전환 후 항상 빈 배열 (저장 포맷 호환용)
}
ChatSessionData = { messages, attachedDocuments?, summary?, summarizedUpTo?, totalTokenCount, settings }
ChatGenerationSettings = {
  aspectRatio: '1:1'|'16:9'|'9:16'|'4:3'|'3:4',   // 극단 비율(1:3/3:1)은 OpenRouter 미지원으로 제거
  imageModel: ImageGenerationModel,               // OpenRouter 슬러그 (예: 'google/gemini-3-pro-image-preview')
  imageSize: '1K'|'2K'|'4K',
  imageQuality?, pixelArtGrid, stylePreset?, customStyle?, thinkingMode?
}
```

- 토큰 추정(`estimateTokenCount`, chat.ts:42): 텍스트 ~2자/토큰, 이미지 258토큰/장, 문서 content·추출이미지 합산.

## 메시지 전송 흐름 (handleSend)

`ChatPanel.tsx` 의 `handleSend(text, images)`:
1. 전송 시점의 `attachedDocuments` 스냅샷 캡처.
2. `addMessage('user', ...)` 로 사용자 메시지 즉시 추가(문서 포함).
3. `generateFromChat(text, images, documents)` 호출 → `{ content, images, imageSignatures: [], isGeneratedImage }`.
4. `addMessage('assistant', ...)` 로 응답 추가.
5. 응답 이미지가 있으면 `autoSaveImage` 로 `~/Downloads/AI_Gen/` 에 `chat-image-{ts}-{rand}.jpg` 저장(실패해도 대화는 계속).
6. `needsSummarization` 이면 최근 `RECENT_MESSAGES_TO_KEEP=5` 개만 남기고 앞부분을 요약.
7. 예외 시 `assistant` 역할로 오류 메시지 추가.

## 생성 요청 구성 (generateFromChat)

`useChatImageGeneration.ts`:
- **텍스트 컨텍스트**(`buildConversationContext`): 요약(`chatData.summary`) + `summarizedUpTo` 이후 최근 `MAX_CONTEXT_TURNS=6` 턴의 텍스트를 프롬프트 앞에 결합.
- **참조 이미지**: 직전 생성 이미지(`resolveLatestGeneratedImage`, IndexedDB 키면 `loadImage` 복원) → 사용자 첨부 → 문서 추출 이미지 순으로 최대 `MAX_REFERENCES=14`장을 `input_references` 로 전송.
- 그리드는 API 파라미터가 아니라 **프롬프트 prefix**(`buildSettingsPrefix`)로 결합. 첨부 문서는 `summary`(없으면 content 1500자)만 주입해 토큰 절약.
- 요청 파라미터: Gemini 계열은 `aspect_ratio` + `resolution`, gpt-image-2는 `aspect_ratio` + `quality`. 5xx 에러는 `MAX_RETRIES=2`, `RETRY_DELAY=5000ms` 로 재시도, 4xx는 `formatImageApiError` 로 한국어화.
- 응답: `data[0].b64_json` → `convertBase64ToJpeg` 로 내부 표준 JPEG 통일 → `data:image/jpeg;base64,` data URL.
- 텍스트 응답은 없다(Image API는 이미지만 반환) — `content` 는 항상 빈 문자열.

## 요약(자동 컨텍스트 압축)

- 임계값 `SUMMARIZATION_THRESHOLD=30000` 토큰 초과 시 `needsSummarization=true`.
- `summarizeMessages` 가 `GEMINI_FLASH_TEXT_MODEL`(`google/gemini-3.7-flash`) chat completions 로 3~5문장 한국어 요약 생성(기존 요약이 있으면 통합).
- `markSummarized`(useChatSession.ts): 요약된 인덱스 이하 메시지의 `images`/`imageSignatures` 를 `undefined` 로 비우고 `tokenCount` 를 텍스트 기준으로 재계산 → 저장 용량·토큰 감소.

## 저장·정리

- **자동 저장**: 생성 이미지는 `~/Downloads/AI_Gen/` 로. `handleSaveImage` 는 Tauri `save` 다이얼로그로 수동 저장.
- **첨부 이미지 다운스케일**: 붙여넣기 시 1280px/품질 0.85 로 축소해 대화 누적 비용 절감(`ChatInput.tsx`).
- **삭제 시 orphan 정리**(`deleteMessage`, useChatSession.ts): 메시지의 이미지 키(`{sessionId}-chat-{messageId}-{i}`)와 레거시 signature 블롭(`{sessionId}{CHAT_SIGNATURE_KEY_MARKER}{messageId}-{i}`)을 IndexedDB 에서 제거.

## 회귀 증상별 원인

| 증상 | 원인 |
|------|------|
| 이어지는 편집이 직전 이미지를 반영 못 함 | `resolveLatestGeneratedImage` 가 직전 생성 이미지를 참조 1순위로 못 넣음 (IndexedDB 키 복원 실패 포함) |
| 대화 맥락이 생성에 반영 안 됨 | `buildConversationContext` 미결합 — 요약/최근 턴이 프롬프트 앞에 붙는지 확인 |
| 요약 후에도 토큰이 안 줄어듦 | `markSummarized` 가 이미지 미제거 → 요약 범위 이미지 `undefined` + tokenCount 재계산 |
| 구세션 모델 ID 로 400 | 레거시 ID(`gemini-3-pro-image-preview` 등) 미정규화 → `normalizeImageModelId` (`ChatPanel` effect) |
| 극단 비율(1:3/3:1) 구세션 오류 | OpenRouter 미지원으로 제거됨 → 모델별 지원 비율로 자동 보정(`ChatPanel` effect) |
| 메시지 삭제 후 저장 용량 안 줄어듦 | IndexedDB orphan(이미지/signature) 미정리 → `deleteMessage` 에서 키 삭제 |
| 첨부 이미지 누적으로 세션 비대 | 붙여넣기 다운스케일 누락 → `downscaleImage` 적용 |
| 생성 이미지에 연필(편집) 버튼 안 보임 | `isGeneratedImage` 미설정 또는 API Key 없음(`onAnnotateImage` 조건) |
