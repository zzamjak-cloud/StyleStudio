# 분석 프롬프트·API·비교

Gemini Vision 에 넘길 **분석 프롬프트 생성**(`analysisPrompt.ts`), **API 호출·응답 파싱**(`useGeminiAnalyzer.ts`), **이전↔현재 분석 비교**(`analysisComparator.ts`) 세 축을 다룬다. 프롬프트는 세션 타입별 10종이며 각자 다른 JSON 스키마를 지시하는 **문자열 상수/팩토리**다. 호출은 `fetch` 로 선택된 분석 모델(기본 `gemini-3.7-flash`)의 `generateContent` 를 직접 때리고, 응답 텍스트에서 JSON 을 관대하게 추출·검증한다. 비교기는 편집·재분석 후 어느 섹션이 바뀌었는지 해시로 판정해 불필요한 저장/후처리를 스킵한다.

## 관련 파일

- `src/lib/gemini/analysisPrompt.ts` — 분석 프롬프트 상수 10종
- `src/hooks/api/useGeminiAnalyzer.ts` — `analyzeImages`(메인)·`analyzeIllustrationCharacter`·`analyzeIllustrationBackground`
- `src/lib/analysisComparator.ts` — `hashSection`·`detectChangedSections`
- `src/hooks/useAutoSave.ts` — `detectChangedSections` 소비처(`useAutoSave.ts:63`)
- `src/types/analysis.ts` — 프롬프트 JSON 스키마의 근거 타입

## 프롬프트 구조 (`analysisPrompt.ts`)

모두 한국어 지시문 + **출력할 JSON 스키마 예시**(필드별 한글 설명·영문 예시) + "유효한 JSON 만 출력" 규칙으로 구성. 대부분 `export const NAME = \`...\``, 두 개(REFINEMENT·ILLUSTRATION_CHARACTER)는 인자를 받는 **팩토리 함수**.

| 상수 | 정의 | 용도 |
|------|------|------|
| `STYLE_ANALYZER_PROMPT` | `analysisPrompt.ts:1` | 단일 이미지 일반 분석(style/character/composition/negative_prompt) |
| `MULTI_IMAGE_ANALYZER_PROMPT` | `:56` | 여러 이미지의 **공통 스타일** 추출 |
| `REFINEMENT_ANALYZER_PROMPT(prev)` | `:116` | 강화 모드 — 기존 분석 JSON 을 프롬프트에 주입해 개선 |
| `BACKGROUND_ANALYZER_PROMPT` | `:166` | 배경 전용(캐릭터 제외) |
| `PIXELART_ANALYZER_PROMPT` | `:215` | 픽셀아트 캐릭터/아이콘(`pixelart_specific` 채움) |
| `PIXELART_BACKGROUND_ANALYZER_PROMPT` | `:330` | 픽셀아트 배경 |
| `UI_ANALYZER_PROMPT` | `:428` | UI 디자인(`ui_specific`, 캐릭터 제외) |
| `LOGO_ANALYZER_PROMPT` | `:527` | 게임 로고(`logo_specific`, Typography/Material 중심) |
| `ILLUSTRATION_CHARACTER_ANALYZER_PROMPT(name)` | `:655` | 일러스트 캐릭터 개별 분석(별도 흐름) |
| `ILLUSTRATION_BACKGROUND_ANALYZER_PROMPT` | `:725` | 일러스트 배경 분석(별도 흐름) |

- 캐릭터 프롬프트는 **body_proportions·limb_proportions·eyes(눈 간격 비율)** 를 숫자·비율로 정밀 기술하라고 강하게 지시(`analysisPrompt.ts:41`~`50`) — 생성 시 신체 비율 일관성이 핵심이기 때문.
- 뒤 2개(ILLUSTRATION_*)는 `analyzeIllustrationCharacter`/`analyzeIllustrationBackground` 전용이며 `ImageAnalysisResult` 가 아니라 `types/illustration` 타입을 반환한다(분석 카테고리 밖, illustration 참조).

## API 흐름 (`analyzeImages`)

`useGeminiAnalyzer.ts:29`. 시그니처: `analyzeImages(apiKey, imageBase64Array, callbacks, sessionType?, options?)`.

1. **검증**: apiKey trim·비어있음 체크(`AIza` 접두 경고 로그만), 이미지 배열 비어있음 체크(`:38`~`51`).
2. **이미지 변환**: 각 base64 → data URL prefix 제거 + MIME 추출 → `{inline_data:{mime_type,data}}`(`:59`~`75`).
3. **프롬프트 선택**(우선순위, `:83`~`119`): `LOGO` → `UI` → `BACKGROUND` → `PIXELART_BACKGROUND` → `PIXELART_CHARACTER`/`PIXELART_ICON` → `options.previousAnalysis`(강화) → 이미지 2장↑(MULTI) → 1장(STYLE). **전용 타입 체크가 강화 모드보다 앞선다**.
4. **호출**: OpenRouter `chatComplete`(`POST /api/v1/chat/completions`). `analysisModel = normalizeAnalysisModel(options.model)`(레거시 ID는 `google/` 접두어 부여), 기본값은 `google/gemini-3.7-flash`. 메시지 content `[{type:'text'}, ...image_url 파트]`, `max_tokens: 8192`.
5. **finishReason 분기**(`:189`~`217`): `SAFETY`/`RECITATION`/`MAX_TOKENS`/`OTHER`/`BLOCKLIST` 각각 한국어 에러 throw. `STOP` 아니면 경고만.
6. **JSON 추출·클린업**(`:246`~`290`): ① ```` ```json ```` / ```` ``` ```` 코드블록 벗기기 → ② 첫 `{`~마지막 `}` 슬라이스 → ③ trailing comma 제거(`/,(\s*[}\]])/g`) → ④ `JSON.parse`. 실패 시 에러 위치 주변 로그 후 throw.
7. **결과 검증**(`:319`~`363`): `style`/`character`/`composition` 존재 + `negative_prompt !== undefined` 필수. 캐릭터 신규 필드(`body_proportions`/`limb_proportions`/`torso_shape`/`hand_style`/`feet_style`) 누락 시 `'not specified'` 기본값 채움.
8. **콜백**: 성공 `onComplete(result)`, 실패 `onError(Error)`. 진행 메시지 `onProgress`.

- 모델 목록은 `types/constants.ts`의 `ANALYSIS_MODELS`, 기본값은 `DEFAULT_ANALYSIS_MODEL`(`gemini-3.7-flash`). API 키는 URL 쿼리스트링으로 전달, 로그에선 마스킹.
- `analyzeIllustrationCharacter`(`:379`)·`analyzeIllustrationBackground`(`:479`)는 같은 패턴의 축약판(파싱 클린업 동일, finishReason 은 SAFETY 만 체크). 반환은 `{analysis, negativePrompt}`.

## 분석 비교 (`analysisComparator.ts`)

`detectChangedSections(oldAnalysis, newAnalysis)`(`analysisComparator.ts:40`) → `('style'|'character'|'composition'|'prompts')[]`.

- `hashSection(data)`(`:25`): 키 정렬 후 `JSON.stringify` → `simpleHash`(32bit rolling, 36진수). 키 순서 무관하게 내용 동일하면 같은 해시.
- `oldAnalysis === null` → 최초 분석으로 보고 `['style','character','composition','prompts']` 전부 반환(`:45`).
- style·character·composition 각각 해시 비교 후 다른 것만 push. **`prompts` 는 자동 감지 안 함**(주석 `:80` — 번역은 수동 버튼) — 비교 결과에 `'prompts'` 는 최초 분석에서만 등장.
- 소비처 `useAutoSave.triggerSave`(`useAutoSave.ts:63`): 변경 섹션 0개면 저장 스킵(`useAutoSave.ts:69`). 비교 기준은 **세션에 저장된 `currentSession.analysis`** vs 편집된 현재 분석.

## 회귀 증상별 원인

| 증상 | 원인 |
|------|------|
| "JSON으로 파싱할 수 없습니다" | Gemini 응답이 스키마를 안 지킴/코드블록 변형 → 클린업(`useGeminiAnalyzer.ts:246`) 로그로 위치 확인 |
| "응답이 너무 길어서 잘렸습니다" | `finishReason==='MAX_TOKENS'` → 이미지 수 축소(`maxOutputTokens:8192` 상한) |
| "안전 필터에 의해 차단" | `finishReason==='SAFETY'` — 다른 이미지 필요 |
| "올바른 형식이 아닙니다" | `style`/`character`/`composition`/`negative_prompt` 중 누락(`:321`) |
| 캐릭터 비율 필드가 'not specified' | 모델이 신규 필드 미채움 → 기본값 보정(`:348`~`362`) |
| 편집했는데 저장 스킵됨 | `detectChangedSections` 가 변경 없음 판정(해시 동일) — 정상 |
| 강화 모드인데 일반 프롬프트로 감 | 전용 타입 아님 + `previousAnalysis` 미전달(`isRefinementMode` false, `App.tsx:421`) |
| LOGO/UI 인데 강화 프롬프트 무시됨 | 전용 타입 체크가 우선(`useGeminiAnalyzer.ts:84`) — 의도된 동작 |
