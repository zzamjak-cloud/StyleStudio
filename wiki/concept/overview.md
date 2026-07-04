# 컨셉 아트 (Concept)

모바일 게임의 **컨셉 아트**를 장르·아트스타일·플레이방식·레퍼런스게임·참조이미지를 조합해 생성하는 세션. 좌측 패널에 게임 정보를 입력하고, 우측 패널에서 프롬프트(선택)와 생성 설정을 지정해 이미지를 만든다. 프롬프트를 비우면 입력된 게임 정보로 **자동 프롬프트를 조립**한다. 생성 결과는 하단 히스토리에 쌓이고, 히스토리 항목을 클릭하면 당시 설정·게임정보·프롬프트가 복원된다. 데이터는 `session.conceptData`, 이미지는 세션별 폴더에 자동 저장.

## 관련 파일

- `src/components/concept/ConceptPanel.tsx` — 컨셉 세션 메인(`ConceptPanel`, memo). `conceptData` 로컬 상태 + `useConceptGeneration`. 생성(`handleGenerate`)·히스토리 삭제/선택·자동저장(`autoSaveConceptImage`). 좌7:우3 분할 + 하단 히스토리
- `src/components/concept/ConceptLeftPanel.tsx` — 좌측 입력(`ConceptLeftPanel`, memo). 참조/생성 이미지(드래그드롭·붙여넣기·파일선택), 장르/스타일 드롭다운(프리셋 + localStorage 커스텀), 게임 플레이 방식 textarea, 레퍼런스 게임 목록
- `src/components/concept/ConceptRightPanel.tsx` — 우측 생성(`ConceptRightPanel`, memo). 프롬프트 textarea, 생성 버튼, 모델/비율/크기/품질/그리드 설정, 2K/3K 비용 경고
- `src/components/concept/ConceptHistory.tsx` — 하단 히스토리(`ConceptHistory`, memo). 드래그로 높이 조절(100~600px), 가로 스크롤 썸네일, 저장/삭제, 선택 하이라이트
- `src/hooks/useConceptGeneration.ts` — 생성 훅(`useConceptGeneration`). 자동 프롬프트 조립 + Gemini/OpenAI 분기 호출
- `src/types/concept.ts` — `ConceptSessionData`/`ConceptGenerationEntry`, `GAME_GENRE_PRESETS`, `ART_STYLE_PRESETS`

## 데이터 모델

```
ConceptSessionData = {
  referenceImage?,               // 참조 이미지 1장 (Base64)
  gameGenres: string[],          // 장르 (하이퍼캐주얼, 퍼즐 ...)
  gamePlayStyle?,                // 플레이 방식 설명
  referenceGames?: string[],     // 레퍼런스 게임
  artStyles: string[],           // 아트 스타일 (로우폴리, 카툰 ...)
  generationSettings: {
    model, ratio: '1:1'|'16:9'|'9:16'|'4:3'|'3:4'|'1:3'|'3:1',
    size: '1k'|'2k'|'3k', quality?, grid: '1x1'|'2x2'|'3x3'|'4x4'
  },
  history: ConceptGenerationEntry[]
}
ConceptGenerationEntry = { id, timestamp, prompt, imageBase64, settings, gameInfo? }
GAME_GENRE_PRESETS = 하이퍼 캐주얼 / 하이브리드 캐주얼 / 퍼즐 / 아이들 / 시뮬레이션 / 4X / 타이쿤 / 아케이드 / 액션
ART_STYLE_PRESETS = 로우 폴리 / 카툰 렌더 / 셀 셰이딩 / 소프트 3D / 플랫디자인 / 벡터아트 / 픽셀아트 / 미니멀리즘 / 비비드 / 네온 / 클레이 / 병맛
```

- 컨셉의 크기는 소문자 `1k/2k/3k`. 공용 이미지 훅 규격(`1K/2K/4K`)과 다르므로 **`sizeMap` 으로 매핑**(3k→4K, `useConceptGeneration.ts:74`). 모델별 지원 크기도 4K→3k 로 역매핑(`ConceptPanel.tsx:127`, `ConceptRightPanel.tsx:32`).

## 자동 프롬프트 조립

`useConceptGeneration.ts:28` `generateConcept`:
- 사용자 프롬프트가 있으면 그대로 사용. 비어 있으면 게임정보로 조립: `"{장르} 게임 컨셉 아트"`, `"게임 플레이: {방식}"`, `"{레퍼런스게임} 스타일 참고"`, `"{아트스타일} 아트 스타일"` 을 콤마로 연결. 전부 비면 `"모바일 게임 컨셉 아트"`.
- 그리드가 `1x1` 이 아니면 `", {N×N}개의 다양한 베리에이션"` 을 프롬프트에 덧붙여 한 이미지에 여러 안 생성.
- Gemini 호출은 `sessionType: 'CONCEPT'`, `temperature: 0.8`, `topK: 40`, `topP: 0.95`, 참조 이미지 1장. 결과는 `data:image/jpeg;base64,` prefix 로 반환.

## 좌측 패널 (입력)

`ConceptLeftPanel.tsx`:
- **이미지 입력 3경로**: Tauri `onDragDropEvent` 드래그드롭(:181), `useImagePaste` 붙여넣기(:221), Tauri `open` 파일선택(:228). 모두 base64 data URL 로 변환해 `onReferenceImageChange`. 참조 원본 + 생성 결과를 나란히 표시.
- **장르/스타일**: 프리셋 + **localStorage 커스텀**(`stylestudio-custom-genres`/`stylestudio-custom-styles`). 드롭다운의 `__custom__` 선택 시 입력 팝업(`CustomInputPopup`). 커스텀 항목은 개별 삭제 가능.
- **게임 플레이 방식**은 uncontrolled textarea(`defaultValue` + ref) — 세션 저장 지연을 막기 위해 `onGamePlayStyleDraftChange` 로 draft ref 만 갱신하고, 생성/저장 시점에 ref 값을 읽는다(`ConceptPanel.gamePlayStyleDraftRef`).

## 우측 패널 (생성 설정)

`ConceptRightPanel.tsx`:
- 프롬프트 textarea 도 uncontrolled(ref). 히스토리 선택 시 `promptValue` 를 ref 에 직접 반영(:62).
- 모델 옵션: `나노바나나 프로`(gemini-3-pro-image-preview) / `나노바나나 2`(gemini-3.1-flash-image-preview) / `덕테이프`(gpt-image-2, OpenAI Key 있을 때만).
- 비율·크기·그리드는 `getImageModelDefinition(settings.model)` 의 지원 목록 기준으로 활성화. 크기 2K/3K 클릭 시 **비용 경고 팝업**(2K≈4배, 3K≈9배) 확인 후 적용.

## 세션 저장 정책

`ConceptPanel.tsx` — 매 입력마다 저장하지 않고 **ref 기반 명시적 저장**:
- 상태는 로컬 `conceptData`. `saveToSession`(:83)은 이미지 생성·히스토리 삭제 시점에만 호출.
- **언마운트 시 경량 저장**(:92): `onSessionSaveOnly`(있으면) 로 `startTransition`/`setCurrentSession` 을 우회해 딜레이 없이 저장.
- 히스토리 삭제 시 IndexedDB orphan 정리: `deleteImage("{session.id}-concept-{id}")`.
- 모델 변경으로 지원 안 하는 비율/크기가 되면 effect 로 첫 지원값으로 자동 보정(:116). OpenAI Key 없이 `gpt-image-2` 면 Gemini 로 폴백(:107).

## 히스토리

`ConceptHistory.tsx`:
- 드래그 핸들로 패널 높이 100~600px 조절, 토글 버튼으로 100↔300 스냅.
- 썸네일은 `LazyImage`(키면 IndexedDB lazy 디코딩), 그리드≠1x1 이면 배지 표시.
- 항목 클릭 → `onSelect` → `handleHistorySelect`(`ConceptPanel.tsx:261`): `requestAnimationFrame` 으로 로딩 UI 먼저 반영 후 모델/비율/크기/그리드/게임정보/프롬프트를 복원(유효성 화이트리스트 검사). 저장은 `save` 다이얼로그, 키면 `loadImage` 복원 후 저장.

## 회귀 증상별 원인

| 증상 | 원인 |
|------|------|
| 3K 선택 시 이미지 훅에서 크기 오류 | UI 는 `3k` 인데 훅은 `4K` 필요 → `sizeMap`(3k→4K) 매핑 |
| 게임 플레이 방식이 생성에 반영 안 됨 | uncontrolled textarea → 생성 시 `gamePlayStyleDraftRef.current` 읽기 필요 |
| 세션 전환 후 입력값 사라짐 | 매 입력 저장 안 함 → 언마운트 경량 저장/명시 저장 경로 확인 |
| 히스토리 복원 시 모델이 기본값으로 | `entry.settings.model` 이 화이트리스트 밖 → pro 로 fallback(의도됨) |
| 커스텀 장르/스타일이 세션마다 사라짐 | localStorage 저장 실패 → `CUSTOM_GENRES_KEY`/`CUSTOM_STYLES_KEY` |
| OpenAI Key 없이 덕테이프 생성 실패 | 모델 폴백 미동작 → `ConceptPanel.tsx:107` effect |
| 히스토리 삭제 후 저장 용량 안 줄어듦 | IndexedDB orphan 미정리 → `deleteImage("{id}-concept-{entryId}")` |
| 지원 안 하는 비율 선택 상태 유지 | 모델 변경 후 자동 보정 effect 누락(`ConceptPanel.tsx:116`) |
