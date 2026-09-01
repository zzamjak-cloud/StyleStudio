# 이미지 생성기 (Generator) 개요

세션(분석 결과·참조 이미지·세션 타입)을 입력으로 받아 옵션을 조합해 프롬프트를 만들고, Gemini 또는 OpenAI 이미지 API를 호출해 결과 이미지를 만드는 화면. 진입점은 `ImageGeneratorPanel`이며 좌측 결과 미리보기(`GeneratorPreview`)·하단 히스토리(`GeneratorHistory`)·우측 설정 패널(`GeneratorSettings`) 레이아웃이다. 생성 결과는 자동으로 세션별 폴더(`~/Downloads/AI_Gen/{세션명}/`)에 저장되고 히스토리에 적립된다. 프롬프트 조립·세션별 규칙은 [프롬프트 개요](../prompts/overview.md) 참고.

## 관련 파일

- `src/components/generator/ImageGeneratorPanel.tsx` — 생성기 메인 패널. 통합 상태(`GeneratorState`)·생성 플로우(`handleGenerate`)·자동/수동 저장(`autoSaveImage`/`handleManualSave`)·히스토리 복원(`handleRestoreFromHistory`)·핀 토글(`handleTogglePin`) 소유. 흰 배경 제거 유틸(`removeWhiteBackground`)도 여기 정의(현재 대상 세션 없음).
- `src/components/generator/GeneratorSettings.tsx` — 우측 설정 사이드바(프롬프트·생성 버튼·그리드·모델·비율·해상도·품질·카메라·참조). 상세는 [settings.md](./settings.md).
- `src/components/generator/GeneratorPreview.tsx` — 중앙 결과 표시(로딩/이미지/빈 상태), 줌(fit/actual/%), 다운로드 버튼.
- `src/components/generator/GeneratorHistory.tsx` — 하단 히스토리 그리드(썸네일·핀·복원·삭제·리사이즈). 상세는 [history.md](./history.md).
- `src/components/generator/ImageUpload.tsx` — 참조 이미지 업로드 표면(Tauri 드래그드롭·파일선택·붙여넣기). 상세는 [image-generation-api.md](./image-generation-api.md).
- `src/hooks/api/useGeminiImageGenerator.ts` — Gemini `generateContent` 호출(`generateImage`).
- `src/hooks/api/useOpenAIImageGenerator.ts` — OpenAI images API 호출(`generateImage`/`editWithMask`).
- `src/hooks/api/imageModels.ts` — 모델 정의(`IMAGE_MODELS`)·지원 옵션·`getImageModelDefinition`/`isOpenAIModel`/`getAvailableImageModels`.
- `src/lib/promptBuilder.ts` — 분석 결과→통합 프롬프트 변환(`buildUnifiedPrompt`).
- `src/lib/prompts/sessionPrompts.ts` — 세션 타입별 프롬프트 빌더(`buildPromptForSession`).
- `src/lib/prompts/thinkingPrefix.ts` — 레거시 추론 prefix(`buildThinkingPrefix`). 현재 생성 설정 UI에서는 노출하지 않는다.
- `src/types/cameraAngle.ts`, `src/types/cameraLens.ts` — 카메라 앵글/렌즈 프리셋.
- `src/types/constants.ts` — 생성 기본값(`IMAGE_GENERATION_DEFAULTS`·`ADVANCED_SETTINGS_DEFAULTS`·`HISTORY_PANEL`).
- `src/types/session.ts` — `SessionType`·`GenerationHistoryEntry`·`GenerationSettings`.
- `src/lib/config/paths.ts` — 저장 경로(`getAiGenRoot`/`getSessionImageFolder`).

## 데이터 모델

```
GeneratorState = {
  additionalPrompt, isTranslating,
  aspectRatio: AspectRatioOption, imageSize: ImageSizeOption,
  useReferenceImages, isGenerating, progressMessage, generatedImage,
  pixelArtGrid: PixelArtGridLayout,
  cameraAngle: string, cameraLens: string,          // 프리셋 ID, 기본 'none'
  zoomLevel: 'fit'|'actual'|number, showZoomMenu, showPathTooltip, showAdvanced, showHelp,
  seed?: number, temperature, topK, topP, referenceStrength,
  historyHeight, imageModel: ImageGenerationModel, imageQuality: ImageQualityOption
}
SessionType = BASIC | STYLE | CHARACTER | BACKGROUND | ICON
            | PIXELART_CHARACTER | PIXELART_BACKGROUND | PIXELART_ICON
            | UI | LOGO | ILLUSTRATION | CONCEPT
```

- 상태는 `ImageGeneratorPanel`의 단일 `useState<GeneratorState>`로 통합 관리하고 `updateState(partial)`로 부분 갱신한다. 개별 setter(`setAspectRatio` 등)는 `useCallback`으로 감싸 자식 memo 무효화를 막는다.
- 모델 전환 시 `useEffect`(`ImageGeneratorPanel.tsx:501`)가 선택 모델이 지원하지 않는 `aspectRatio`/`imageSize`를 지원 목록 첫 값으로 자동 보정한다.

## 생성 흐름 (handleGenerate)

`ImageGeneratorPanel.tsx:526` `handleGenerate`가 전 과정을 오케스트레이션한다.

1. **모델·키 결정** — `isOpenAIModel(imageModel)`로 provider 판정, 해당 API 키가 없으면 alert 후 중단.
2. **번역** — 추가 프롬프트에 한글이 포함되면(`containsKorean`) `useGeminiTranslator`로 영어 번역, 영어면 그대로 사용. 번역 중 `isTranslating`.
3. **카메라 설정 조립** — `getCameraAnglePrompt(cameraAngle)` + `getCameraLensPrompt(cameraLens)`를 `, `로 합쳐 `cameraSettingsStr`.
4. **최종 프롬프트** — `buildPromptForSession(...)`으로 세션 타입별 프롬프트 생성.
   - `ILLUSTRATION`: 카메라 설정을 basePrompt에 섞지 않고 `cameraSettings`로 별도 전달(캐릭터 복제가 최우선).
   - 그 외: 카메라 설정을 basePrompt에 이어 붙이고, 참조 이미지가 없으면(`!hasRefImages`) 분석 통합 프롬프트(`positivePrompt`)도 basePrompt에 포함.
5. **참조 이미지 수집** — `ILLUSTRATION`은 캐릭터별 최대 `ILLUSTRATION_LIMITS.MAX_IMAGES_PER_CHARACTER`장 + 배경 + 구도 스케치(마지막 reference)를 모아 `resolveStoredImage`로 복원. `CHARACTER` 또는 `useReferenceImages` 시에는 `referenceImages`를 복원.
6. **API 호출** — provider가 `openai`면 `generateOpenAIImage`, 아니면 `generateImage`(Gemini). 콜백 `onProgress`/`onComplete`/`onError`.
7. **완료 처리**(`onComplete`) — 응답 base64의 매직 넘버로 실제 포맷을 판별해 data URL을 만든다(예전에는 `image/jpeg`로 하드코딩했다). 대상 세션이면 배경 제거(현재 없음). `setGeneratedImage`·줌 fit 리셋 → 자동 저장 → 히스토리 적립(`onHistoryAdd`).

## 생성 화면 레이아웃

- **좌측 `GeneratorPreview`** — 생성 중 스피너+진행 메시지, 완료 시 `LazyImage`+줌, 미생성 시 빈 상태.
- **하단 `GeneratorHistory`** — 리사이즈 가능한 썸네일 그리드. 초기 높이 `HISTORY_PANEL.DEFAULT_HEIGHT`(192px), 리사이즈 범위 120~600px(`handleHistoryResize`, `ImageGeneratorPanel.tsx:518`).
- **우측 `GeneratorSettings`** (`w-96`) — 모든 입력 옵션과 생성 버튼. 생성 결과 공간을 먼저 확보하기 위해 기존 좌측 사이드바에서 우측 사이드바로 이동했다.
- 헤더: 세션 타입 라벨 · 모델 라벨, `AI_Gen` 저장 폴더 열기 버튼(`openPath(getAiGenRoot())`), 생성 이미지가 있을 때 줌 드롭다운.
- 도움말 모달(`showHelp`)은 프롬프트 팁·비율·크기 설명을 담는다(고급 설정 항목은 제거됨).

## 저장·자동 저장

- **자동 저장**(`autoSaveImage`) — 생성 완료 즉시 `getSessionImageFolder(sessionName)` 경로에 `style-studio-{timestamp}.{ext}`로 저장. Base64→`Uint8Array`→Tauri `writeFile`(재인코딩 없음).
- **수동 저장**(`handleManualSave`) — Tauri `save` 다이얼로그로 사용자가 경로 지정. 기본 경로/파일명은 자동 저장과 동일 규칙.
- **확장자는 실제 바이트에서 판별한다** — 아래 절 참조. 세션 타입으로 추측하던 예전 방식은 PNG를 `.jpg`로 내보냈다.

## 저장 확장자는 세션 타입이 아니라 **실제 바이트**로 정한다

`src/lib/utils/imageDataUrl.ts` 의 `detectImageFormat`/`getImageSaveFormat` 이 base64 선두의
**매직 넘버**(`iVBORw0KGgo`=PNG, `/9j/`=JPEG, `UklGR`=WebP, `R0lGOD`=GIF)로 포맷을 판별하고,
저장 경로가 그 결과로 확장자와 다이얼로그 필터를 정한다.

예전에는 `TRANSPARENT_BACKGROUND_SESSION_TYPES` 목록(현재 **빈 배열**)으로 png/jpg를 골랐다.
목록이 비어 있으니 **무엇을 저장하든 `.jpg`** 였고, 저장 코드는 data URL의 base64를 재인코딩
없이 그대로 쓰므로 **PNG 바이트가 `.jpg` 파일로** 나갔다. 타일맵 합성 시트(투명 PNG)를
다운로드하면 그렇게 됐다 — 확장자와 헤더가 어긋나면 OS 썸네일러·유니티 임포터가 투명 영역을
흰색이나 체크무늬로 그린다.

- data URL의 **선언 MIME은 믿지 않는다.** 앱 곳곳이 `data:image/jpeg;base64,...` 를 하드코딩해
  붙이므로(생성 API가 무엇을 돌려주든) 선언을 따르면 같은 버그가 재발한다. 생성 완료 지점
  (`onComplete`)도 이제 매직 넘버로 판별한 MIME을 붙인다.
- 바이트는 **항상 재인코딩 없이** 파일로 간다(`dataUrlToBytes`). canvas로 다시 그리거나 JPEG로
  변환하는 순간 알파가 흰색으로 굳는다.
- 타일맵 유니티 내보내기는 원래부터 `.png` 고정이었다(`tilemapExporter`) — 영향받지 않았다.

> 남아 있는 것: `useOpenAIImageGenerator.convertBase64ToJpeg` 는 덕테이프(gpt-image-2)의 PNG
> 응답을 **흰 배경 위에 합성해 JPEG로** 바꾼다. 타일맵은 AI 원본이 불투명한 재질 스와치라
> 무관하지만, 투명 배경이 필요한 다른 세션을 만든다면 이 변환부터 걷어내야 한다.

- 저장 루트는 `~/Downloads/AI_Gen/` (`paths.ts` `AI_GEN_ROOT_SEGMENT`). 세션별 하위 폴더로 고정(v0.4.4).

## 회귀 증상별 원인

| 증상 | 원인 |
|------|------|
| 모델 바꿨더니 비율/해상도가 리셋됨 | 모델별 지원 목록에 없는 값이면 `useEffect`(`ImageGeneratorPanel.tsx:501`)가 첫 지원 값으로 자동 보정 — 의도된 동작 |
| 모델 목록 이상 | `getAvailableImageModels()`는 통합 키 체제에서 항상 전 모델 반환 — 레거시 ID는 `normalizeImageModelId` 확인 |
| 참조 이미지를 넣었는데 분석 프롬프트가 안 들어감 | 참조 있으면(`hasRefImages`) 분석 `positivePrompt`를 basePrompt에 넣지 않음(세션 프롬프트가 "참조 복제"를 지시) — 의도 |
| 한글 프롬프트가 그대로 전송됨 | `containsKorean` 미검출 또는 번역 실패. 번역은 항상 Gemini 키 사용(모델이 OpenAI여도) |
| 생성 이미지 색이 이상/투명 안 됨 | 응답을 항상 JPEG로 간주(`data:image/jpeg`). 투명 배경 대상 세션은 현재 `TRANSPARENT_BACKGROUND_SESSION_TYPES` 빈 배열이라 없음 |
| 저장 폴더가 안 열림 | `getAiGenRoot` 실패 또는 OS opener 권한 문제 |
