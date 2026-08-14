# API 공통 — 에러 처리 · 번역 · 키/경로

앱의 외부 API 호출(주로 **Gemini**)에 공통으로 쓰이는 유틸리티 모음. **표준화된 API 에러 파싱/사용자 메시지 변환**(`apiErrorHandler`), **한↔영 자동 번역**(`useGeminiTranslator`, 이미지 프롬프트용), **생성 결과물 저장 경로**(`config/paths`)를 다룬다. API 키는 사용자가 설정에서 입력하며 Tauri `store` 에 영속된다.

## 관련 파일
- `src/lib/apiErrorHandler.ts` — API 에러 파싱·메시지·로깅. `parseApiError`/`getUserFriendlyErrorMessage`/`handleApiError`/`extractErrorFromResponse`
- `src/hooks/api/useGeminiTranslator.ts` — Gemini 기반 한↔영 번역 훅
- `src/lib/config/paths.ts` — 결과물 저장 폴더 경로 헬퍼(`~/Downloads/AI_Gen/`)
- `src/lib/storage.ts` — API 키 영속(`loadApiKey` 등, store 담당 에이전트 소유)
- `src/components/common/SettingsModal.tsx` — Gemini/OpenAI API 키 입력 UI(`wiki/ui/overview.md`)
- `src-tauri/capabilities/default.json:93` — `generativelanguage.googleapis.com` HTTP allow

## 데이터 모델

```ts
ApiError = { message: string, code?: string, status?: number, details?: unknown }
```

## API 에러 처리 (apiErrorHandler.ts)

4개 함수로 구성:

| 함수 | 역할 |
|------|------|
| `parseApiError(unknown)` | Error/Gemini 형식(`error.error`)/일반 객체/원시값을 `ApiError` 로 정규화 (`:16-53`) |
| `getUserFriendlyErrorMessage(ApiError)` | `code`(Gemini) → HTTP `status` → 원본 순으로 한국어 메시지 매핑 (`:58-107`) |
| `handleApiError(unknown)` | parse + friendly + `logger.error` 로깅, 사용자 메시지 반환 (`:112-124`) |
| `extractErrorFromResponse(Response)` | fetch `Response` 본문에서 에러 추출(JSON/텍스트 fallback) (`:129-155`) |

### 코드/상태 → 메시지 매핑 (일부)
- Gemini `code`: `RESOURCE_EXHAUSTED`(할당량 초과), `PERMISSION_DENIED`/`UNAUTHENTICATED`(API 키 확인), `DEADLINE_EXCEEDED`(시간 초과) 등 (`:60-81`)
- HTTP `status`: `401`/`403`(API 키), `429`(요청 과다), `500`/`503`(서버) 등 (`:84-103`)

## 번역 (useGeminiTranslator.ts)

이미지 생성 API 는 영어 프롬프트를 쓰지만 사용자는 한국어로 입력할 수 있다. 이 훅이 `GEMINI_FLASH_TEXT_MODEL`(**Gemini 3.7 Flash**, `gemini-3.7-flash:generateContent`)로 상호 번역한다. 5개 함수 반환:

| 함수 | 방향 | 용도 |
|------|------|------|
| `translateToEnglish(key, text)` | 한→영 | API 전달용 (`:99-174`) |
| `translateToKorean(key, text)` | 영→한 | 화면 표시용 (`:22-94`) |
| `translateBatchToEnglish(key, texts[])` | 한→영 | `[n]` 프리픽스 배치(API 호출 최적화) (`:179-268`) |
| `translateBatchToKorean(key, texts[])` | 영→한 | 배치 (`:273-360`) |
| `containsKorean(text)` | — | `[가-힣ㄱ-ㅎㅏ-ㅣ]` 정규식 감지 (`:14-17`) |

공통 규칙:
- **언어 스킵**: 대상 언어가 이미 포함돼 있으면(예: 한→영인데 한글 없음) 원본 그대로 반환 (`:32, :109`)
- **실패 안전**: API 오류/예외 시 로깅 후 **원본 텍스트 반환**(throw 안 함) (`:78-93, :169-173`)
- **일관성 파라미터**: `temperature: 0.3, topK: 20, topP: 0.8` (`:63-67`)
- **배치 파싱**: `[번호]` 프리픽스로 라인 매칭, 매칭 실패 시 해당 인덱스는 원본 유지 (`:249-260`)
- 응답 추출 경로: `result.candidates[0].content.parts[0].text` (`:85-86`)
- 엔드포인트에 `?key={apiKey}` 쿼리로 키 전달(헤더 아님).

## API 키 / 저장 경로 (config/paths.ts)

**키**: Gemini·OpenAI 두 키를 `SettingsModal` 에서 입력 → `store` 영속(`useSessionManagement` 가 로드·전달, `App.tsx:105-107`). `.env` 의 `VITE_*` 는 **OAuth 전용**이며 Gemini 키는 사용자 입력.

**결과물 폴더**(`paths.ts`, Tauri `path`/`fs` 사용):
- `AI_GEN_ROOT_SEGMENT = 'AI_Gen'`, `SESSIONS_SEGMENT = 'Sessions'` (`:5-7`)
- `getAiGenRoot()` → `~/Downloads/AI_Gen/`(없으면 생성) (`:10-17`)
- `getSessionsRoot()` → `~/Downloads/AI_Gen/Sessions/` (`:20-27`)
- `getSessionImageFolder(name)` → `~/Downloads/AI_Gen/{sanitized}/` (`:33-41`)
- `sanitizeFolderName()` — `\ / : * ? " < > |` → `_`, 빈 이름은 `untitled` (`:44-46`)

## 회귀 증상별 원인

| 증상 | 원인 |
|------|------|
| 에러 메시지가 영문 raw 로 노출 | `handleApiError`/`getUserFriendlyErrorMessage` 미경유 |
| 429/할당량 메시지 안 뜸 | 응답이 `code`·`status` 없이 옴 → `parseApiError` fallback message |
| 번역이 원문 그대로 나옴 | API 실패 시 원본 반환(설계), 또는 이미 대상 언어 포함으로 스킵 |
| 배치 번역 개수/순서 어긋남 | 응답 `[번호]` 프리픽스 유실 → 인덱스별 원본 fallback (`:251-259`) |
| 번역 호출이 CSP/권한 차단 | `capabilities/default.json` generativelanguage 오리진 필요 |
| 결과 폴더 경로에 특수문자로 저장 실패 | `sanitizeFolderName` 미적용 |
| API 키 없이 호출 | `SettingsModal` 미입력 — `loadApiKey` null |
