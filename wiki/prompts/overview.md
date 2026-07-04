# 프롬프트 조립 (Prompts)

이미지 생성에 쓰이는 최종 프롬프트를 만드는 로직. 흐름은 두 단계다. ① `promptBuilder`가 이미지 분석 결과를 영어 통합 프롬프트로 정규화하고, ② `sessionPrompts.buildPromptForSession`이 세션 타입·참조 이미지 유무·그리드·추론 모드에 따라 세션별 지시문으로 감싼다. 모든 최종 프롬프트는 영어이며, 사용자 한글 입력은 생성 직전 번역된다.

## 관련 파일

- `src/lib/promptBuilder.ts` — 분석 결과→통합 프롬프트(`buildUnifiedPrompt`), 사용자 입력·구도 병합(`buildDynamicPrompt`).
- `src/lib/prompts/sessionPrompts.ts` — 세션 타입별 프롬프트 빌더 맵과 진입점(`buildPromptForSession`), 캐릭터 상세 섹션(`buildCharacterDetailSection`).
- `src/lib/prompts/thinkingPrefix.ts` — 세션별 단계적 사고 prefix(`buildThinkingPrefix`, `ThinkingSessionType`).
- `src/components/generator/ImageGeneratorPanel.tsx` — `handleGenerate`에서 번역·카메라 병합 후 빌더 호출(`ImageGeneratorPanel.tsx:526`).
- `src/hooks/api/useGeminiImageGenerator.ts` — 훅 내부에서 비-ILLUSTRATION 세션에 한해 `buildPromptForSession` 재적용(이중 안전장치).
- `src/types/analysis.ts` — `ImageAnalysisResult`(style/character/pixelart_specific/negative_prompt).

## 데이터 모델

```
buildUnifiedPrompt(analysis) -> { positivePrompt, negativePrompt }
PromptGenerationParams = {
  basePrompt, hasReferenceImages, sessionType?,
  pixelArtGrid?, analysis?, referenceDocuments?, illustrationData?,
  cameraSettings?,   // 카메라 앵글/렌즈 (ILLUSTRATION은 별도 섹션)
  thinkingMode?
}
ThinkingSessionType = chat | illustration | background | character | icon
                    | logo | ui | style | concept | pixelart | generic
```

## 통합 프롬프트 (buildUnifiedPrompt)

분석 결과의 영어 원본을 `, `로 잇는다.

- **style**: `art_style, technique, color_palette, lighting, mood`.
- **character(고정 특징)**: `gender, age_group, hair, eyes, face, outfit, accessories` + **신체 비율 그룹(중요)** `body_proportions, limb_proportions, torso_shape, hand_style, feet_style`.
- `positivePrompt` = 위 파트를 이어 붙인 문자열, `negativePrompt` = `analysis.negative_prompt`(없으면 빈 문자열).
- `buildDynamicPrompt(base, userInput, composition?)`: 베이스에 사용자 입력·구도(pose/angle/background)를 덧붙이는 보조 함수.

## 세션별 프롬프트 (buildPromptForSession)

`sessionPrompts.ts:75` 진입점.

- **참조 없음 또는 세션 타입 없음** → `basePrompt`를 그대로 body로 사용.
- **참조 있음 + 세션 타입** → `promptGenerators[sessionType]` 실행.
- 마지막에 `thinkingMode`면 세션 매핑(`THINKING_TYPE_BY_SESSION`)에 따른 prefix를 `\n\n`로 앞에 붙인다.

세션별 빌더 요지:

| 세션 | 핵심 지시 | 배경 | 그리드 |
|------|-----------|------|--------|
| `BASIC` | basePrompt 그대로(채팅) | — | — |
| `CHARACTER` | 캐릭터 100% 동일 복제(#1 우선), 분석 해부학 스펙(`CHARACTER ANATOMY SPEC`) 삽입, 변경 금지 목록 | 순백 #FFFFFF | 포즈 변형 그리드 |
| `BACKGROUND` | 참조 아트스타일·팔레트·분위기 매칭 | — | 씬 변형 |
| `ICON` | 참조 아이콘 스타일 매칭, 중앙 구도 | 순백 #FFFFFF | 아이콘 세트 |
| `STYLE` | 참조 아트스타일·렌더 기법 매칭 | — | 콘텐츠 변형 |
| `UI` | 디자인 시스템 매칭 + `REFERENCE DOCUMENTS` 섹션 삽입 | — | 스크린 세트 |
| `LOGO` | 타이포/트리트먼트 매칭 + AI 텍스트 한계 경고 | 순백 #FFFFFF | 로고 변형 |
| `PIXELART_*` | `resolution×resolution`px(분석 추정), crisp edge, 제한 팔레트 | 순백(투명 금지) | 스프라이트 시트 |
| `ILLUSTRATION` | 참조 캐릭터 pixel-perfect 복제, 카메라·구도 스케치 후순위 | — | 셀 변형 |
| `CONCEPT` | 프로 게임 컨셉아트 품질·분위기 | — | 컨셉 변형 |

- **캐릭터 상세 섹션**(`buildCharacterDetailSection`): 분석의 신체 비율/손발/눈/얼굴/머리/의상/성별/연령을 `- Key: value` 목록으로 만들어 CHARACTER/ILLUSTRATION 프롬프트에 삽입. "MUST match exactly" 강조.
- **그리드 처리**: `pixelArtGrid !== '1x1'`이면 `getPixelArtGridInfo`로 rows×cols·프레임 수를 계산해 "N cells in RxC layout" + **"NO GRID LINES"**(셀 경계선 그리지 말 것) 지시를 넣는다. 그리드 레이아웃 정의·업스케일은 픽셀아트 문서 담당.
- **픽셀 해상도**: `parseResolutionEstimate(analysis.pixelart_specific.resolution_estimate)` — `\d+x\d+`에서 max 차원 추출, 16~512로 클램프(기본 128).

## ILLUSTRATION 세션의 특수성

- 카메라 설정을 basePrompt에 섞지 않고 `cameraSettings`로 별도 전달 → 프롬프트에서 "캐릭터 정확도 확보 후(AFTER) 적용, 외형 변경 금지" 섹션으로 처리(우선순위 하향).
- 참조 이미지의 **마지막 장이 구도 스케치**임을 명시(`conceptSketch.sketchPng`): "펜선·화풍을 베끼지 말고 배치 가이드로만 사용, 최종 화풍은 캐릭터 참조 기준". 스케치 분석(`conceptSketch.analysis`)이 있으면 `formatCompositionForPrompt`로 배치 규칙(좌우 스왑 금지 등) 삽입.
- 패널에서 이미 완성된 프롬프트를 만들기 때문에, Gemini 훅은 `sessionType === 'ILLUSTRATION'`이면 재가공하지 않고 그대로 전송한다.

## 추론 모드 prefix (thinkingPrefix)

- API에 native thinking 파라미터가 없어 **prompt-prefix 방식**으로 단계적 사고를 유도한다.
- `PREFIXES[sessionType]`에 세션별 3~4단계 한글 체크리스트(`[Thinking Mode]` 헤더). 예: character는 종/신체비율/고유특징 → 의상 시대정합 → 표정·포즈 일관성 → 종합 렌더.
- `buildPromptForSession`이 `thinkingMode`일 때 `THINKING_TYPE_BY_SESSION` 매핑으로 타입을 고르고(미매핑 시 `generic`) body 앞에 붙인다.

## 회귀 증상별 원인

| 증상 | 원인 |
|------|------|
| 캐릭터가 참조와 다르게 나옴 | `CHARACTER`/`ILLUSTRATION`은 참조 있을 때만 복제 프롬프트 적용. 참조 없거나 `useReferenceImages` off면 텍스트 기반 |
| 분석 신체 비율이 프롬프트에 없음 | `buildCharacterDetailSection`은 CHARACTER/ILLUSTRATION 경로에서만 삽입. 다른 세션은 미포함 |
| 그리드에 격자선이 그려짐 | "NO GRID LINES" 지시는 프롬프트 힌트일 뿐 — 모델이 무시할 수 있음. 후처리는 픽셀아트 그리드 분리 담당 |
| 구도 스케치 화풍이 결과에 섞임 | 스케치는 "배치 가이드로만" 지시. 마지막 reference 순서·`sketchPreamble` 확인 |
| 추론 모드 켰는데 prefix 없음 | `thinkingMode` 미전달 또는 `buildPromptForSession` 밖 경로. Gemini 훅 재적용 경로는 thinkingMode를 넘기지 않음 |
| 픽셀 해상도가 항상 128 | `analysis.pixelart_specific.resolution_estimate` 미존재/형식 불일치 시 기본값 |
| 한글이 그대로 프롬프트에 | 번역은 패널 `handleGenerate` 단계 — 빌더는 번역하지 않음 |
