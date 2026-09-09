# 생성 설정 (GeneratorSettings)

우측 설정 사이드바(`w-96`). 프롬프트·생성 버튼을 상단 고정 영역에 두고, 스크롤 영역에서 참조 문서(UI 세션)·그리드·카메라 앵글/렌즈·모델·비율·해상도·품질·참조 이미지 토글·도움말 버튼을 입력받는다. (고급 설정 seed/temperature/top-K/top-P는 OpenRouter 미지원으로 v0.6에서 제거) 상태는 부모 `ImageGeneratorPanel`이 소유하고, 이 컴포넌트는 값+`on*Change` 콜백을 props로 받는 프레젠테이션 컴포넌트다(`React.memo`).

## 관련 파일

- `src/components/generator/GeneratorSettings.tsx` — 설정 UI 전체. `GeneratorSettings`(memo 래퍼)·`GeneratorSettingsComponent`.
- `src/hooks/api/imageModels.ts` — 모델 정의와 모델별 지원 옵션(`ImageModelDefinition.supports`).
- `src/types/cameraAngle.ts` — 앵글 프리셋 `CAMERA_ANGLES`(20종)·`getCameraAnglePrompt`.
- `src/types/cameraLens.ts` — 렌즈/화각 프리셋 `CAMERA_LENSES`·`getCameraLensPrompt`.
- `src/types/constants.ts` — 기본값·슬라이더 범위(`ADVANCED_SETTINGS_RANGES`).

## 모델 선택

`availableModels`(부모가 `getAvailableImageModels()` 전달)를 `모델` 라벨과 같은 줄의 **단일 드롭다운**으로 렌더.

| id | 라벨 | provider | 비율 | 해상도 | 품질 | 참조 | n |
|----|------|----------|------|--------|------|------|---|
| `openai/gpt-image-2` | 덕테이프 **(기본)** | openai | 8종 | — (1K 고정) | low/medium/high | 16 | 10 |
| `openai/gpt-image-2.5-flare` | 덕테이프 2.5 플레어 | openai | 8종 | — | +xhigh/max | 16 | 10 |
| `openai/gpt-image-2.5-sunburst` | 덕테이프 2.5 선버스트 | openai | 8종 | — | +xhigh/max | 16 | 10 |
| `google/gemini-3-pro-image-preview` | 나노바나나 프로 | gemini | 10종 | 1K/2K/4K | medium | 14 | 1 |
| `google/gemini-3.1-flash-image-preview` | 나노바나나2 | gemini | 10종 | 1K/2K/4K | medium | 14 | 1 |
| `google/gemini-3.1-flash-lite-image` | 나노바나나 2 라이트 | gemini | 10종 | 1K | medium | 14 | 1 |

- **2.5 계열 두 종은 `availability: 'pending'`이라 드롭다운에 뜨지 않는다** — OpenRouter 미등재. 등재되면 그 값만 `available`로 바꾼다. → `generator/image-generation-api.md`
- 기본 모델은 `DEFAULT_IMAGE_MODEL`(`openai/gpt-image-2`). v0.7.2에서 나노바나나 프로에서 바뀌었다.
- **능력치는 전부 `supports`에서 온다.** UI에 모델 ID를 직접 비교하는 조건을 새로 만들지 말 것 — `isOpenAIModel()` / `supports.qualities.length > 1`을 쓴다.

## 이미지 비율 (aspectRatio)

- `supportedAspectRatios`(모델별) 기반 버튼. 모델당 8~10종이라 한 줄에 안 들어가므로 **`grid-cols-5`로 감싸 넘긴다**(예전엔 `flex-nowrap` 5개였다).
- 기본값 `IMAGE_GENERATION_DEFAULTS.ASPECT_RATIO`(`1:1`).
- 모든 모델이 OpenRouter Image API `aspect_ratio` 필드로 직접 전달.
- 모델을 바꿔 지원하지 않는 비율이 남으면 effect가 첫 지원값으로 보정한다.

## 이미지 크기 (imageSize)

- 1K/2K/4K 버튼. `supportedImageSizes`에 없으면 비활성.
- 기본값 `IMAGE_GENERATION_DEFAULTS.IMAGE_SIZE`(`1K`).
- **비용 확인 모달**: 2K/4K 클릭 시 바로 적용하지 않고 확인 모달을 띄운다(`handleImageSizeClick`/`confirmImageSizeChange`). 안내상 2K≈4배, 4K≈16배 비용.
- Gemini만 `imageSize` 실사용(`imageConfig`). OpenAI(gpt-image-2)는 1K만 지원하며 실제 픽셀은 비율에서 결정.

## 이미지 품질 (imageQuality)

- **`supports.qualities.length > 1`일 때만 노출**하고 버튼도 그 배열에서 렌더한다. 모델 ID를 비교하지 않는 이유는 2.5 계열이 늘어나도 조건을 안 고치기 위해서다.
- 덕테이프 `low/medium/high`, 2.5 계열은 `xhigh`·`max`가 추가된다. Gemini는 `['medium']` 한 종이라 UI가 안 뜬다.
- 모델을 바꿔 지원하지 않는 티어가 남으면 effect가 **`medium`으로** 보정한다(첫 값 `low`로 가면 품질이 조용히 낮아진다).

## 구도 스케치

- `sketchGuide.SKETCH_GUIDE_KIND`에 있는 세션에서만 "구도 스케치" 섹션이 뜬다. 그린 스케치는 **마지막 참조 이미지**로 붙고 프롬프트가 "마지막 참조는 스케치, 펜선은 그리지 말 것"을 명시한다.
- **세션에 따라 스케치를 읽는 방식이 다르다** — 배경·UI는 `layout`(배치), 캐릭터·아이콘은 `subject`(포즈·방향·보이는 면). 캐릭터 쪽은 스케치가 정체성을 흔들지 않도록 문구가 훨씬 강하다.
- 캔버스는 **선택된 출력 비율로** 뜬다 — 그린 프레이밍이 그대로 결과 프레이밍이 된다.
- 모달은 ILLUSTRATION의 `ConceptSketchPanel`을 **그대로 재사용**한다 — 캐릭터가 없으므로 자유 텍스트 라벨 모드로 뜬다. 상세는 [illustration/concept-sketch.md](../illustration/concept-sketch.md).
- **세션에 저장하지 않는다**(이번 생성용 가이드). 이유는 위 문서 참조.

## 카메라 앵글 / 렌즈

- 앵글·렌즈는 **인접한 두 개의 개별 `<select>`**(그룹 컨트롤 아님). 표시 조건 세션: `BACKGROUND`, `ILLUSTRATION`, `PIXELART_BACKGROUND`.
- `CHARACTER`·`STYLE`·`ICON`·`PIXELART_ICON` 세션은 카메라 앵글/렌즈 메뉴를 숨긴다. 캐릭터/스타일/아이콘 생성에서는 시점보다 참조 복제·형태·스타일·그리드가 핵심이라 공간 효율을 우선한다.
- 옵션 라벨: `'none'`은 라벨만, 그 외는 `"{label} : {description}"`.
- **앵글 20종**(`CAMERA_ANGLES`): 눈높이/하이/로우/버드아이/개미시점/더치/측면/3-4뷰/후면/오버숄더/POV 등 시점 + 3분할/중앙/대칭/비대칭/황금비율/리딩라인/프레임속프레임/네거티브스페이스/프레임채우기 등 구도.
- **렌즈**(`CAMERA_LENSES`, `category`로 그룹): 초광각(14/16/20mm)·광각(24/28/35mm)·표준(50mm)·망원(85/105/135/200mm)·특수(macro/fisheye/tilt-shift).
- 선택된 프리셋의 영어 `prompt`가 `getCameraAnglePrompt`/`getCameraLensPrompt`로 최종 프롬프트에 합류(`ImageGeneratorPanel.tsx:568`). `ILLUSTRATION`은 캐릭터 정확도 뒤 낮은 우선순위로 별도 섹션 처리.

## 픽셀 그리드 레이아웃

- 픽셀아트 및 일부 세션에서 1x1/2x2/3x3/4x4 버튼 렌더. 섹션 라벨은 세션별 명칭이 아니라 공통 `그리드`로 표시하고, 세션별 부가 설명은 렌더하지 않는다.
- 그리드 개념·업스케일 상세는 픽셀아트 문서 참고(본 문서 범위 밖). 프롬프트에서의 그리드 처리(no grid lines 등)는 [프롬프트 개요](../prompts/overview.md).
- 기본값 `IMAGE_GENERATION_DEFAULTS.PIXEL_ART_GRID`(`1x1`).

## 참조 이미지 토글 (useReferenceImages)

- 체크박스. `sessionType === 'CHARACTER'`에서는 숨김(항상 참조 사용).
- 기본값 `IMAGE_GENERATION_DEFAULTS.USE_REFERENCE_IMAGES`(`true`).
- 켜져 있고 참조가 있으면 세션별 "참조 복제" 프롬프트 경로, 꺼져 있으면 분석 프롬프트(`positivePrompt`) 기반 텍스트 생성 경로.

## 프롬프트 (additionalPrompt)

- 자동 확장 textarea(72~200px 클램프). 라벨은 `프롬프트`이고 placeholder는 `getPromptPlaceholder(sessionType)`.
- **번역 버튼/설명 문구 없음**: 한글을 넣으면 생성 시 자동으로 영어 번역(`useGeminiTranslator`). 번역 중 진행 상자에 `Languages` 아이콘.

## 도움말

"이미지 생성 도움말" 버튼이 부모 `showHelp` 모달을 연다. 고급 설정(seed/temperature/top-K/top-P) 접이식 섹션은 OpenRouter Image API 미지원으로 제거됐다.

| 항목 | 기본값 | 범위(STEP) | API 전달 |
|------|--------|-----------|----------|
| seed | undefined(랜덤) | number 입력 + 주사위 랜덤 | Gemini `generationConfig.seed` |
| temperature | 1.0 | 0.0~2.0 (0.1) | Gemini `temperature` |
| topK | 40 | 1~100 (1) | Gemini `topK` |
| topP | 0.95 | 0.0~1.0 (0.05) | Gemini `topP` |
| referenceStrength | 1.0 | 0.0~2.0 (0.1) | **미전달(현재 미지원)** |

- seed 미지정 시 매번 랜덤(첫 생성으로 간주해 모델 가용성 체크도 이때만 수행 — `useGeminiImageGenerator.ts:127`).
- **referenceStrength는 UI에만 존재**하고 Gemini API에 실제 전달되지 않는다(공식 미지원, `useGeminiImageGenerator.ts:245` 주석 처리).
- Negative Prompt는 여기서 못 고친다 — 분석 패널의 "부정 프롬프트 카드"에서만 수정(고정 품질 유지 목적).

## 참조 문서 (UI 세션 전용)

- `sessionType === 'UI'`에서만 `<DocumentManager>` 렌더(문서 관리는 별도 담당). 첨부된 `referenceDocuments`는 UI 프롬프트에 `REFERENCE DOCUMENTS` 섹션으로 삽입된다.
- 문서 등록 UI는 큰 카드가 아니라 **한 줄 드롭 영역**이다. 설명은 `?` 도움말 hover tooltip로 이동했고, 문서가 추가되면 하단에 칩이 줄바꿈되며 늘어난다.

## 회귀 증상별 원인

| 증상 | 원인 |
|------|------|
| Reference Strength를 올려도 효과 없음 | Gemini API 미지원 — 값이 전달되지 않음(UI 표시만) |
| 카메라 앵글/렌즈가 안 보임 | 현재 세션 타입이 표시 조건 목록에 없음(`CHARACTER`, `STYLE`, `LOGO`, `UI`, `ICON`, `PIXELART_CHARACTER`, `PIXELART_ICON`) |
| 품질(low/high) 옵션이 없음 | Gemini 모델은 medium 고정 — gpt-image-2 선택 시에만 노출 |
| 2K/4K 눌러도 안 바뀜 | 비용 확인 모달에서 미확인. 확인해야 적용 |
| seed 고정했는데 모델 체크가 안 뜸 | seed가 있으면 첫 생성이 아니라고 보고 모델 가용성 체크 스킵 |
| 고급 슬라이더가 안 보임 | v0.6에서 제거됨(OpenRouter 미지원) — 의도된 동작 |
