# 분석 카드 컴포넌트

`ImageAnalysisResult` 의 각 섹션을 우측 패널에 카드로 렌더·인라인 편집하는 컴포넌트들. **공통 UI 는 `AnalysisCard<T>` 하나**이고, 섹션별 카드(Style/Character/Composition/Logo/UI)는 필드 정의(key·라벨·이모지)만 넘기는 얇은 래퍼다. 편집 상태는 `useFieldEditor` 훅이 관리하며, 저장 시 부모의 `onUpdate(updatedSection)` 콜백으로 갱신된 섹션 전체를 넘긴다. NegativePrompt·UnifiedPrompt 두 카드는 예외적으로 자체 구조를 가진다.

## 관련 파일

- `src/components/analysis/AnalysisCard.tsx` — 제네릭 공통 카드(`AnalysisCard<T>`). 헤더(아이콘·색상)·필드 목록·필드별 편집/저장/취소 버튼·textarea 자동 높이(`handleTextareaChange`, `AnalysisCard.tsx:49`)
- `src/hooks/useFieldEditor.ts` — 편집 중 필드(`editingField`)·입력값(`editedValue`) 상태, `startEdit`/`saveField`/`cancelEdit`
- `src/components/analysis/StyleCard.tsx` — 스타일 5필드
- `src/components/analysis/CharacterCard.tsx` — 캐릭터 12필드
- `src/components/analysis/CompositionCard.tsx` — 구도 4필드
- `src/components/analysis/LogoCard.tsx` — 로고 특화 15필드
- `src/components/analysis/UICard.tsx` — UI 특화 4필드
- `src/components/analysis/NegativePromptCard.tsx` — 부정 프롬프트(단일 string, 자체 편집 상태)
- `src/components/analysis/UnifiedPromptCard.tsx` — 통합 프롬프트(읽기전용, 복사 전용)

## 공통 카드 (`AnalysisCard<T>`)

`AnalysisCard.tsx:20`. props: `data: T`, `fields: {key, label, icon?}[]`, `onUpdate?(data: T)`, 색상 계열(`iconColor`/`borderColor`/`bgColor`/`hoverColor`/`focusColor`).

- 각 필드는 `data[key]` 를 표시(비편집 시 `bg-gray-50` div, `whitespace-pre-wrap`). 편집 버튼 → 해당 필드 textarea 전환.
- **동시 편집 1개만**: 편집 중이면 다른 필드 편집 버튼 `disabled`(`AnalysisCard.tsx:98`, `editingField !== null`).
- textarea 는 내용에 맞춰 높이 자동 조정, 최대 200px(`AnalysisCard.tsx:53`).
- 저장 시 `useFieldEditor.saveField` 가 `{...data, [editingField]: trimmedValue}` 를 만들어 `onUpdate` 로 전달(`useFieldEditor.ts:50`).

### `useFieldEditor<T>`

`useFieldEditor.ts:23`. `startEdit(field)` → `editedValue` 를 현재 값으로 초기화. `saveField` → trim 후 병합 객체를 `onUpdate` 로 넘기고 편집 종료. `cancelEdit` → 상태만 리셋. 값은 항상 **문자열**로 다룬다(`String(data[field] ?? '')`).

## 섹션별 카드와 편집 가능 필드

모두 `memo` 로 감싼 래퍼. 각 `fields` 배열의 `key` 가 편집 가능 필드다.

| 카드 | 컴포넌트 | 색상 | 편집 필드(key) |
|------|----------|------|----------------|
| 스타일 분석 | `StyleCard` | purple | `art_style`·`technique`·`color_palette`·`lighting`·`mood` |
| 캐릭터 분석 | `CharacterCard` | blue | `gender`·`age_group`·`hair`·`eyes`·`face`·`outfit`·`accessories`·`body_proportions`·`limb_proportions`·`torso_shape`·`hand_style`·`feet_style` |
| 구도 분석 | `CompositionCard` | green | `pose`·`angle`·`background`·`depth_of_field` |
| UI 디자인 분석 | `UICard` | pink | `platform_type`·`visual_style`·`key_elements`·`color_theme` |
| 로고 특화 분석 | `LogoCard` | red | `typography_style`·`text_warping`·`text_weight`·`edge_treatment`·`material_type`·`rendering_style`·`surface_quality`·`outline_style`·`drop_shadow`·`inner_effects`·`decorative_elements`·`color_vibrancy`·`color_count`·`gradient_usage`·`genre_hint` |

- 각 카드의 `onUpdate` 는 `App.tsx` 에서 `analysisResult` 의 해당 섹션만 교체한다(`App.tsx:1267`~`1305`).
- 라벨·이모지는 각 래퍼의 `fields` 정의에만 있다(예: `StyleCard.tsx:12`, `LogoCard.tsx:12`). 로고 `material_type` 라벨은 "재질 타입 (가장 중요!)".

## 부정 프롬프트 카드

`NegativePromptCard.tsx`. 다른 카드와 달리 **단일 문자열**(`negative_prompt`)을 편집하므로 `AnalysisCard`/`useFieldEditor` 를 안 쓰고 자체 `isEditing`/`editedPrompt` 상태(`NegativePromptCard.tsx:13`). 8행 textarea. 저장 시 `onUpdate(editedPrompt.trim())`(`NegativePromptCard.tsx:21`). `onUpdate` 없으면 저장 no-op(`:18`).

## 통합 프롬프트 카드

`UnifiedPromptCard.tsx`. **읽기전용** — 편집 불가. `buildUnifiedPrompt(analysis)`(`src/lib/promptBuilder.ts:6`)로 모든 섹션을 합쳐 `positivePrompt`/`negativePrompt` 두 문자열을 만들고, 각각 클립보드 복사 버튼만 제공(`navigator.clipboard.writeText`, 2초 체크 표시). 각 카드를 편집하면 `analysis` prop 갱신 → 통합 프롬프트가 자동 재계산된다. 복사되는 것은 **영어 원본**.

## 회귀 증상별 원인

| 증상 | 원인 |
|------|------|
| 다른 필드 편집 버튼이 비활성 | 이미 다른 필드 편집 중(`editingField !== null`, `AnalysisCard.tsx:98`). 정상 동작 — 저장/취소 먼저 |
| 편집 저장해도 통합 프롬프트 안 바뀜 | `onXxxUpdate` 콜백 미전달 → `analysisResult` state 미갱신 → `UnifiedPromptCard` 의 `analysis` prop 고정 |
| 부정 프롬프트 편집 저장 안 됨 | `onUpdate` prop 없음 → `handleSave` no-op(`NegativePromptCard.tsx:18`) |
| 필드 값에 `[object Object]` 표시 | 섹션 필드에 문자열 아닌 값 → `useFieldEditor` 는 `String()` 강제하지만 원본 데이터가 잘못 파싱됨 |
| textarea 가 안 커짐 | `handleTextareaChange`/`onFocus` 미연결 또는 200px 상한 도달(`AnalysisCard.tsx:53`) |
