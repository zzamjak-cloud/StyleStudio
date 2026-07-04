# 채팅 (Chat)

대화형으로 이미지를 생성·수정하는 세션. 사용자가 텍스트/이미지를 보내면 **멀티턴 컨텍스트**(요약 + 이후 메시지 + 현재 입력)를 구성해 Gemini(또는 OpenAI) 이미지 모델에 전달하고, 응답 이미지를 다시 대화에 쌓는다. 대화 데이터는 `session.chatData` 에 저장되고, 생성 이미지는 `~/Downloads/AI_Gen/` 에 자동 저장된다. 토큰 누적이 임계값을 넘으면 오래된 메시지를 자동 요약해 이미지 데이터를 버려 저장 공간과 토큰을 절약한다. 부분 편집(어노테이션)은 `wiki/chat/annotation.md` 참고.

## 관련 파일

- `src/components/chat/ChatPanel.tsx` — 채팅 패널 메인. `useChatSession`/`useChatImageGeneration` 결합, 전송(`handleSend`)·자동저장(`autoSaveImage`)·수동저장(`handleSaveImage`)·어노테이션 제출(`handleAnnotationSubmit`)·이미지 미리보기 모달. 좌측 대화 + 우측 `ChatAISettings` 레이아웃
- `src/components/chat/ChatInput.tsx` — 하단 입력창(`ChatInput`). textarea 자동 높이, 이미지 첨부(붙여넣기·드래그드롭, 최대 `MAX_IMAGES=5`), Enter 전송/Shift+Enter 줄바꿈. 붙여넣기 이미지는 `downscaleImage(1280, 0.85)` 로 다운스케일
- `src/components/chat/ChatMessage.tsx` — 개별 메시지 렌더(`ChatMessage`, memo). user/assistant/summary 3종, `LazyImage` 이미지, 요약 접기/펼치기, 생성 이미지 위 연필 버튼(어노테이션 진입)
- `src/components/chat/ChatAISettings.tsx` — 우측 AI 설정 패널. 모델 드롭다운/한 줄 비율/크기/품질/추론모드/그리드 + 하단 기획문서(`DocumentManager`). 2K/4K 선택 시 비용 경고 팝업
- `src/components/chat/ChatSettings.tsx` — 상단 설정 바(한 줄 비율·모델 드롭다운). 현재 레이아웃에서는 `ChatAISettings` 가 주 설정 UI
- `src/hooks/useChatSession.ts` — `session.chatData` 파생/변경 훅. 메시지 CRUD·토큰 집계·요약·설정 업데이트. `ref` 기반으로 클로저 문제 회피
- `src/hooks/useChatImageGeneration.ts` — 멀티턴 `contents` 구성(`buildContents`)·이미지 생성(`generateFromChat`)·요약(`summarizeMessages`). Gemini/OpenAI 분기
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
  imageSignatures?: string[]    // Gemini 생성 이미지의 thought_signature (images와 1:1)
}
ChatSessionData = { messages, attachedDocuments?, summary?, summarizedUpTo?, totalTokenCount, settings }
ChatGenerationSettings = {
  aspectRatio: '1:1'|'16:9'|'9:16'|'4:3'|'3:4'|'1:3'|'3:1',
  imageModel: ImageGenerationModel, imageSize: '1K'|'2K'|'4K',
  imageQuality?, pixelArtGrid, stylePreset?, customStyle?, thinkingMode?
}
```

- 토큰 추정(`estimateTokenCount`, chat.ts:42): 텍스트 ~2자/토큰, 이미지 258토큰/장, 문서 content·추출이미지 합산.

## 메시지 전송 흐름 (handleSend)

`ChatPanel.tsx:87` 의 `handleSend(text, images)`:
1. 전송 시점의 `attachedDocuments` 스냅샷 캡처.
2. `addMessage('user', ...)` 로 사용자 메시지 즉시 추가(문서 포함).
3. `generateFromChat(text, images, documents)` 호출 → `{ content, images, imageSignatures, isGeneratedImage }`.
4. `addMessage('assistant', ...)` 로 응답 추가. **`imageSignatures` 를 함께 저장**해야 다음 요청 시 생성 이미지를 `thought_signature` 와 함께 재전송할 수 있다.
5. 응답 이미지가 있으면 `autoSaveImage` 로 `~/Downloads/AI_Gen/` 에 `chat-image-{ts}-{rand}.jpg` 저장(실패해도 대화는 계속).
6. `needsSummarization` 이면 최근 `RECENT_MESSAGES_TO_KEEP=5` 개만 남기고 앞부분을 요약.
7. 예외 시 `assistant` 역할로 오류 메시지 추가.

## 멀티턴 컨텍스트 구성 (buildContents)

`useChatImageGeneration.ts:62` — Gemini `contents` 배열을 만든다:
- **요약**(`chatData.summary`)이 있으면 맨 앞에 user/model 페어로 주입.
- `summarizedUpTo + 1` 이후 메시지만 포함(요약된 앞부분은 제외).
- 히스토리 이미지·signature 는 **IndexedDB 키일 수 있어** API 직전 `loadImage` 로 data URL 복원.
- **signature 있는 Gemini 생성 이미지**: `model` 역할 + `inline_data` + `thought_signature` 로 전송.
- **signature 없는 생성 이미지(OpenAI/어노테이션 결과)**: `model` 역할로 `inline_data` 를 보내면 Gemini 가 400 을 반환하므로, "직전 생성 이미지" 안내와 함께 **user 보조 턴**으로 분리하고 짧은 model ack 을 끼워 user→model 교차를 유지(`isOrphanGeneratedImage`, :96).
- 프리셋/그리드/추론모드는 API 파라미터가 아니라 **프롬프트 prefix**(`buildSettingsPrefix`, :14)로 결합. 첨부 문서는 `summary`(없으면 content 1500자)만 주입해 토큰 절약, 문서 추출 이미지는 참조로 합산.

## 모델 분기 (Gemini / OpenAI)

- `isOpenAIModel(imageModel)` 로 분기(`generateFromChat`, :183). OpenAI 는 `useOpenAIImageGenerator`, Gemini 는 `fetch` 로 `:generateContent` 직접 호출.
- Gemini 요청: `generationConfig.responseModalities: ['TEXT','IMAGE']`, `imageConfig: { aspectRatio, imageSize }`. 5xx 에러는 `MAX_RETRIES=2`, `RETRY_DELAY=5000ms` 로 재시도.
- 응답 파싱: `part.text` → 텍스트 누적, `part.inlineData` → data URL(MIME 은 **강제 `image/jpeg`**), `part.thoughtSignature` → `imageSignatures` 보존.
- OpenAI Key 미설정 상태에서 `gpt-image-2` 선택 시 자동으로 Gemini 로 폴백(`ChatPanel.tsx:48`). 모델이 지원하지 않는 비율/크기는 정의 기본값으로 자동 보정(`ChatPanel.tsx:54`).

## 요약(자동 컨텍스트 압축)

- 임계값 `SUMMARIZATION_THRESHOLD=30000` 토큰 초과 시 `needsSummarization=true`.
- `summarizeMessages`(:351)가 `gemini-2.5-flash` 로 3~5문장 한국어 요약 생성(기존 요약이 있으면 통합).
- `markSummarized`(useChatSession.ts:184): 요약된 인덱스 이하 메시지의 `images`/`imageSignatures` 를 `undefined` 로 비우고 `tokenCount` 를 텍스트 기준으로 재계산 → 저장 용량·토큰 감소.

## 저장·정리

- **자동 저장**: 생성 이미지는 `~/Downloads/AI_Gen/` 로. `handleSaveImage` 는 Tauri `save` 다이얼로그로 수동 저장.
- **첨부 이미지 다운스케일**: 붙여넣기 시 1280px/품질 0.85 로 축소해 대화 누적 비용 절감(`ChatInput.tsx:91`).
- **삭제 시 orphan 정리**(`deleteMessage`, useChatSession.ts:127): 메시지의 이미지 키(`{sessionId}-chat-{messageId}-{i}`)와 signature 블롭(`{sessionId}{CHAT_SIGNATURE_KEY_MARKER}{messageId}-{i}`)을 IndexedDB 에서 제거.

## 회귀 증상별 원인

| 증상 | 원인 |
|------|------|
| 생성 이미지 재전송 시 Gemini 400 | signature 없는 생성 이미지를 `model` 역할 `inline_data` 로 보냄 → user 보조 턴으로 분리(`isOrphanGeneratedImage`) 필요 |
| 이어지는 편집이 직전 이미지를 반영 못 함 | assistant 메시지에 `imageSignatures` 미저장 → `addMessage` 4번째/5번째 인자로 signature 전달 필요 |
| 히스토리 이미지가 API 에서 빈 데이터 | 이미지가 IndexedDB 키인데 `loadImage` 복원 누락 → `buildContents` 에서 data URL 복원 |
| 요약 후에도 토큰이 안 줄어듦 | `markSummarized` 가 이미지 미제거 → 요약 범위 이미지 `undefined` + tokenCount 재계산 |
| OpenAI Key 없는데 gpt-image-2 로 생성 실패 | 모델 폴백 미동작 → `ChatPanel.tsx:48` effect 로 Gemini 전환 |
| 극단 비율(1:3/3:1) 선택 후 OpenAI 에서 오류 | 극단 비율은 Gemini 전용 → 모델별 지원 비율로 자동 보정(`ChatPanel.tsx:54`) |
| 메시지 삭제 후 저장 용량 안 줄어듦 | IndexedDB orphan(이미지/signature) 미정리 → `deleteMessage` 에서 키 삭제 |
| 첨부 이미지 누적으로 세션 비대 | 붙여넣기 다운스케일 누락 → `downscaleImage` 적용 |
| 생성 이미지에 연필(편집) 버튼 안 보임 | `isGeneratedImage` 미설정 또는 OpenAI Key 없음(`onAnnotateImage` 조건) |
