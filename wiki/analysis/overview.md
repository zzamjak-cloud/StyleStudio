# 참조 이미지 분석 (Analysis)

참조 이미지를 Gemini Vision(`gemini-2.5-flash`)으로 분석해 화풍·캐릭터·구도·부정 프롬프트를 구조화한 **`ImageAnalysisResult`** 로 뽑아내고, 우측 패널에 통합 프롬프트를 표시하는 기능. 기본 화면은 **통합 프롬프트만 표시**하고, 통합 프롬프트 우측 상단의 돋보기 버튼으로 세부 분석 카드 모달을 열어 수정한다. 전체 흐름은 **이미지 업로드 → `analyzeImages` 호출(세션 타입별 프롬프트 선택) → Gemini 응답 JSON 파싱·검증 → `analysisResult` state 저장 → 통합 프롬프트 렌더 → 상세 카드 편집 시 state·세션 갱신 → 통합 프롬프트 즉시 갱신**이다. 분석 결과의 **권위는 `App.tsx` 의 `analysisResult` state**이며, 세션에 `analysis` 로 함께 저장된다(세션 복원 시 다시 로드). 프롬프트·JSON 스키마는 **세션 타입에 따라 완전히 달라진다**(캐릭터/배경/픽셀아트/UI/로고).

## 관련 파일

- `src/components/analysis/AnalysisPanel.tsx` — 분석 패널 컨테이너. 좌측 참조 이미지 그리드(추가·삭제·붙여넣기·도움말) + 우측 통합 프롬프트. 세부 분석 카드는 돋보기 버튼으로 여는 상세 모달에서 조건 렌더(`isBackgroundType`/`isUIType`/`isLogoType`)
- `src/components/analysis/AnalysisCard.tsx` — 공통 카드 UI(`AnalysisCard<T>`). 필드 목록·인라인 편집(textarea 자동 높이)
- `src/components/analysis/StyleCard.tsx`·`CharacterCard.tsx`·`CompositionCard.tsx`·`LogoCard.tsx`·`UICard.tsx` — `AnalysisCard` 를 필드 정의로 감싼 래퍼(`memo`)
- `src/components/analysis/NegativePromptCard.tsx` — 부정 프롬프트(단일 문자열, 자체 편집 상태)
- `src/components/analysis/UnifiedPromptCard.tsx` — 모든 카드를 합친 최종 프롬프트(`buildUnifiedPrompt`, 읽기전용 복사) + 세부 분석 모달 진입 버튼
- `src/lib/gemini/analysisPrompt.ts` — 세션 타입별 분석 프롬프트 10종(JSON 스키마 지시 포함) — [analysis-prompt.md](./analysis-prompt.md)
- `src/hooks/api/useGeminiAnalyzer.ts` — Gemini `generateContent` 호출·프롬프트 선택·JSON 파싱/클린업/검증(`analyzeImages`) — [analysis-prompt.md](./analysis-prompt.md)
- `src/types/analysis.ts` — `ImageAnalysisResult` 및 하위 타입 정의
- `src/hooks/useFieldEditor.ts` — 개별 필드 편집 상태 훅(제네릭) — [analysis-cards.md](./analysis-cards.md)
- `src/lib/analysisComparator.ts` — 이전↔현재 분석 해시 비교(`detectChangedSections`) — [analysis-prompt.md](./analysis-prompt.md)
- `src/lib/sketch/analyzeSketch.ts` — (별도) 일러스트 구도 스케치 분석. `types/illustration` 의 `CompositionAnalysis` 사용, 여기의 `ImageAnalysisResult` 와 무관
- `src/App.tsx` — `analysisResult` state 소유·`performAnalysis`·카드 `onUpdate` 콜백 배선
- `src/hooks/useAutoSave.ts` — 카드 편집 후 세션 저장(`detectChangedSections` 로 변경 섹션만 처리)

## 데이터 모델

```
ImageAnalysisResult = {
  style: StyleAnalysis,            // 항상 존재
  character: CharacterAnalysis,    // 항상 존재(단 UI/배경/로고 카드는 숨김)
  composition: CompositionAnalysis,// 항상 존재
  negative_prompt: string,         // 항상 존재
  pixelart_specific?: PixelArtSpecificAnalysis,  // PIXELART_* 타입일 때만
  ui_specific?: UISpecificAnalysis,              // UI 타입일 때만
  logo_specific?: LogoSpecificAnalysis,          // LOGO 타입일 때만
}
StyleAnalysis        = { art_style, technique, color_palette, lighting, mood }
CharacterAnalysis    = { gender, age_group, hair, eyes, face, outfit, accessories,
                         body_proportions, limb_proportions, torso_shape, hand_style, feet_style }
CompositionAnalysis  = { pose, angle, background, depth_of_field }
UISpecificAnalysis   = { platform_type, visual_style, key_elements, color_theme }
LogoSpecificAnalysis = { typography_style, text_warping, text_weight, edge_treatment,
                         material_type, rendering_style, surface_quality, outline_style,
                         drop_shadow, inner_effects, decorative_elements,
                         color_vibrancy, color_count, gradient_usage, genre_hint }
```

- 타입 정의: `src/types/analysis.ts:1`~`82`. `*_specific` 3종은 **옵셔널** — 해당 세션 타입에서만 프롬프트가 채우고, 카드도 그때만 렌더된다(`AnalysisPanel.tsx:229`,`237`).
- `character` 는 스키마상 항상 존재하지만 **UI/배경/로고 세션에서는 `CharacterCard` 를 렌더하지 않는다**(`AnalysisPanel.tsx:245`).

## 전체 흐름

1. **업로드**: `AnalysisPanel` 좌측 그리드. 파일 선택(`fileToBase64`)·클립보드 붙여넣기(`useImagePaste`, `AnalysisPanel.tsx:60`)로 `onAddImage`. 최대 14장(헤더 `{images.length}/14`, `AnalysisPanel.tsx:85`). 이미지 0개면 패널 자체가 `null` 렌더(`AnalysisPanel.tsx:72`).
2. **분석 트리거**: "이미지 분석 시작" 또는 분석 후 "분석 강화" 버튼 → `App.tsx` `performAnalysis`(`App.tsx:407`) → `analyzeImages(apiKey, uploadedImages, callbacks, currentSession?.type, options)`.
3. **프롬프트 선택 + 호출**: `useGeminiAnalyzer` 가 세션 타입으로 프롬프트를 고르고 Gemini `generateContent` 호출(상세: analysis-prompt.md). base64 → `inline_data` parts.
4. **파싱·검증**: 코드블록 제거 → `{`~`}` 추출 → trailing comma 제거 → `JSON.parse` → `style/character/composition/negative_prompt` 존재 검증, 캐릭터 신규 필드 기본값 보정(`useGeminiAnalyzer.ts:335`~`363`).
5. **state 저장**: `onComplete(result)` → `setAnalysisResult(result)` + 세션 저장(빈 세션 업데이트 / 강화 모드 업데이트 / 신규 세션 생성, `App.tsx:434`~`464`).
6. **렌더**: `AnalysisPanel` 이 우측 패널에 `UnifiedPromptCard` 만 렌더. 세부 카드 스택은 돋보기 버튼으로 여는 상세 모달에 렌더한다.
7. **편집**: 상세 모달 카드 편집 → 각 `onXxxUpdate` 콜백이 `analysisResult` 를 불변 갱신(`App.tsx`) → `useAutoSave` 가 변경 섹션만 세션에 반영 → `UnifiedPromptCard` 가 같은 state를 읽어 즉시 갱신.

## 세션 타입별 분석 차이

`useGeminiAnalyzer.ts:83`~`119` 의 프롬프트 선택 우선순위와 그 결과 렌더되는 카드:

| 세션 타입 | 프롬프트 상수 | 채워지는 `*_specific` | 렌더 카드 |
|-----------|---------------|----------------------|-----------|
| `LOGO` | `LOGO_ANALYZER_PROMPT` | `logo_specific` | 기본: UnifiedPrompt / 상세: Style · **Logo** · Composition · Negative (캐릭터 숨김) |
| `UI` | `UI_ANALYZER_PROMPT` | `ui_specific` | 기본: UnifiedPrompt / 상세: Style · **UI** · Composition · Negative (캐릭터 숨김) |
| `BACKGROUND` | `BACKGROUND_ANALYZER_PROMPT` | — | 기본: UnifiedPrompt / 상세: Style · Composition · Negative (캐릭터 숨김) |
| `PIXELART_BACKGROUND` | `PIXELART_BACKGROUND_ANALYZER_PROMPT` | — | 기본: UnifiedPrompt / 상세: Style · Composition · Negative (캐릭터 숨김) |
| `PIXELART_CHARACTER`·`PIXELART_ICON` | `PIXELART_ANALYZER_PROMPT` | `pixelart_specific`* | 기본: UnifiedPrompt / 상세: Style · Character · Composition · Negative |
| 그 외 + `previousAnalysis` 있음 | `REFINEMENT_ANALYZER_PROMPT(prev)` | — | 기본: UnifiedPrompt / 상세: 강화된 기존 카드 |
| 그 외 + 이미지 2장↑ | `MULTI_IMAGE_ANALYZER_PROMPT` | — | 기본: UnifiedPrompt / 상세: Style · Character · Composition · Negative |
| 그 외 + 이미지 1장 | `STYLE_ANALYZER_PROMPT` | — | 기본: UnifiedPrompt / 상세: Style · Character · Composition · Negative |

\* `pixelart_specific` 는 타입에 존재하지만 현재 전용 카드 컴포넌트가 없다(패널에 미렌더). `PixelArtSpecificPanel` 등 별도 렌더 경로는 이 카테고리 밖.

- **우선순위 주의**: LOGO/UI/배경/픽셀아트 타입 체크가 `previousAnalysis`(강화 모드)보다 앞선다 → 이 타입들은 강화 모드에서도 항상 전용 프롬프트를 쓴다(`useGeminiAnalyzer.ts:84`~`106`).
- **강화 모드 판정**: `isRefinementMode = currentSession && analysisResult && !isEmptySession`(`App.tsx:421`). 강화 시 기존 결과를 프롬프트에 주입(`previousAnalysis`).

## 회귀 증상별 원인

| 증상 | 원인 |
|------|------|
| 분석 후 패널이 안 뜸 / 흰 화면 | 참조 이미지 0개 → `AnalysisPanel` 이 `null` 렌더(`AnalysisPanel.tsx:72`). placeholder analysis만 있고 이미지 없을 때 발생(`App.tsx:57` 주석) |
| 캐릭터 카드가 안 보임 | UI/배경/로고 세션(`AnalysisPanel.tsx:245` 조건). 정상 동작 |
| 세부 분석 카드가 안 보임 | 기본 패널은 통합 프롬프트만 표시. 우측 상단 돋보기 버튼으로 상세 모달을 열어야 함 |
| 카드 수정 후 통합 프롬프트가 안 바뀜 | 상세 모달 카드가 `onXxxUpdate` 콜백을 못 받았거나 `analysisResult` state 불변 갱신 누락 |
| UI/로고 특화 카드 누락 | `ui_specific`/`logo_specific` 가 응답에 없음 → 전용 프롬프트가 안 걸렸거나(타입 오설정) 파싱 실패 |
| 분석 결과가 세션 재진입 시 사라짐 | 세션 저장 실패(`onComplete` 의 `persistSessions`) 또는 복원 로직(`App.tsx:389`)에서 placeholder 판정 |
| 강화 모드인데 전용 프롬프트로 감 | LOGO/UI/배경/픽셀아트는 의도적으로 강화보다 우선(`useGeminiAnalyzer.ts:84`) |
