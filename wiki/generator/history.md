# 생성 히스토리 (GeneratorHistory)

생성된 이미지를 썸네일 그리드로 쌓아두고, 즐겨찾기(핀)·설정 복원·삭제를 제공하는 하단 패널. 히스토리 데이터는 세션에 귀속되며(`GenerationHistoryEntry[]`) 부모 `ImageGeneratorPanel`이 `onHistoryAdd`/`onHistoryUpdate`/`onHistoryDelete`로 세션 저장소에 반영한다. 이 컴포넌트는 표시·상호작용만 담당(`React.memo`).

## 관련 파일

- `src/components/generator/GeneratorHistory.tsx` — 히스토리 그리드 UI. 정렬(`sortedHistory`)·핀/복원/삭제 버튼·삭제 확인 모달·리사이저.
- `src/components/generator/ImageGeneratorPanel.tsx` — 히스토리 적립(`handleGenerate`의 `onComplete`, `ImageGeneratorPanel.tsx:692`)·복원(`handleRestoreFromHistory`)·핀 토글(`handleTogglePin`)·리사이즈(`handleHistoryResize`).
- `src/types/session.ts` — `GenerationHistoryEntry`·`GenerationSettings`.
- `src/types/constants.ts` — `HISTORY_PANEL.DEFAULT_HEIGHT`(192).
- `src/lib/config/paths.ts` — 자동 저장 경로.

## 데이터 모델

```
GenerationHistoryEntry = {
  id,                       // gen-{timestamp}-{rand}
  timestamp,                // ISO 8601
  prompt,                   // 최종(영어) 프롬프트
  negativePrompt?, additionalPrompt?,   // additionalPrompt는 원본(한글/영어)
  imageBase64,              // 생성 이미지 data URL
  settings: GenerationSettings,
  isPinned?,                // 즐겨찾기
  referenceDocumentIds?     // 참조 문서 ID (UI 세션)
}
GenerationSettings = {
  aspectRatio, imageSize, seed?, temperature?, topK?, topP?,
  referenceStrength?, useReferenceImages,
  pixelArtGrid?, cameraAngle?, cameraLens?, thinkingMode?
}
```

## 적립 (onHistoryAdd)

- 생성 완료 시 `handleGenerate`의 `onComplete`에서 엔트리를 만들어 `onHistoryAdd`로 전달한다.
- `id`는 `gen-{Date.now()}-{random}`. `imageBase64`에는 자동 저장 전의 data URL(JPEG)이 그대로 들어간다.
- `settings`에는 당시 옵션 전체가 스냅샷된다. `cameraAngle`/`cameraLens`는 `'none'`이면 `undefined`로 정규화해 저장.

## 정렬·렌더

- `sortedHistory`(`useMemo`): **핀 우선(`isPinned`) → timestamp 내림차순**. 매 렌더 재정렬을 피하려 메모이즈.
- 8열 정사각 썸네일 그리드(`grid-cols-8`). 각 썸네일은 `LazyImage`(`loading="lazy"`, `decoding="async"`, `object-cover`).
- 히스토리가 비면 컴포넌트는 `null` 반환.
- 각 썸네일 `title`(툴팁): 생성 시각·비율·해상도·(있으면)픽셀 그리드·seed·참조 문서 수를 개행으로 조합.

## 상호작용

- **핀/즐겨찾기 토글**: 좌상단 `Pin` 버튼 → `onTogglePin(e, entryId)` → 부모 `handleTogglePin`이 `onHistoryUpdate(entryId, { isPinned: !prev })`. 핀 엔트리는 노란 배지+테두리, 비핀은 호버 시 노출.
- **복원**: 호버 시 초록 `RotateCcw` 버튼 → `onRestoreFromHistory(e, entry)` → 부모 `handleRestoreFromHistory`가 `settings`(비율·해상도·seed·temperature·topK·topP·referenceStrength·pixelArtGrid·cameraAngle·cameraLens)·`additionalPrompt`·이미지를 현재 상태로 복원. 이미지 참조는 `resolveStoredImage`로 복원. 복원 후 "설정이 복원되었습니다" alert(자동 재생성 아님).
- **삭제**: 호버 시 빨강 `Trash2` 버튼(부모가 `onDeleteHistory` 전달한 경우만). 즉시 삭제가 아니라 확인 모달(`deleteConfirm`) 경유.

## 리사이즈

- 패널 상단 `Resizer`(`direction="vertical"`) → `onHistoryResize(delta)` → 부모 `handleHistoryResize`가 `historyHeight`를 120~600px로 클램프(`ImageGeneratorPanel.tsx:518`).
- 초기 높이 `HISTORY_PANEL.DEFAULT_HEIGHT`(192px). 인라인 `height`로 적용.

## 자동 저장 경로

- 히스토리 적립과 별개로, 생성 완료 시 `autoSaveImage`가 파일도 저장한다.
- 경로: `getSessionImageFolder(sessionName)` → `~/Downloads/AI_Gen/{정제된 세션명}/`.
- 파일명: `style-studio-{timestamp}.jpg`(투명 배경 대상 세션은 `.png` — 현재 대상 없음).
- 히스토리의 `imageBase64`(메모리/세션 저장소)와 디스크 파일은 독립. 히스토리 삭제는 디스크 파일을 지우지 않는다.

## 회귀 증상별 원인

| 증상 | 원인 |
|------|------|
| 핀 눌러도 안 고정됨 | 부모가 `onHistoryUpdate` 미전달 — `handleTogglePin`이 early return |
| 삭제 버튼이 없음 | 부모가 `onDeleteHistory` 미전달 — 삭제 버튼 자체를 렌더 안 함 |
| 복원했는데 이미지가 안 바뀜/재생성됨 | 복원은 설정+이미지 상태 세팅만 함(재생성 아님). 사용자가 "이미지 생성"을 눌러야 새로 생성 |
| 복원 후 카메라 프리셋이 'none' | 저장 시 `'none'`을 `undefined`로 정규화 → 복원 시 `?? 'none'` 되돌림. 원래 미선택이면 정상 |
| 히스토리 순서가 시간순이 아님 | 핀 엔트리가 항상 앞으로 정렬됨(의도) |
| 히스토리 삭제해도 폴더에 파일 남음 | 디스크 자동 저장 파일은 히스토리와 독립 — 수동 삭제 필요 |
