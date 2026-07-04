# 일러스트 (Illustration)

여러 캐릭터가 한 장면에 함께 등장하는 **다중 캐릭터 씬**을 생성하는 세션. 각 캐릭터마다 이름 + 참조 이미지(최대 3장)를 등록하고, 선택적으로 배경 참조 이미지(최대 5장)와 **구도 스케치**(`wiki/illustration/concept-sketch.md`)를 조합한다. `IllustrationSetupPanel` 은 이 **입력(setup) UI** 만 담당하고, 실제 이미지 생성은 App 레벨(`handleIllustrationGenerate`)에서 setup 데이터를 공용 다중 이미지 생성기에 넘겨 수행한다. 데이터는 `session.illustrationData` 에 저장.

## 관련 파일

- `src/components/illustration/IllustrationSetupPanel.tsx` — 셋업 패널(`IllustrationSetupPanel`). 캐릭터 섹션 + 배경 섹션 + 구도 스케치 섹션. **전역 드래그드롭 리스너 1개**로 위치 기반 드롭 타겟 판정(`findDropTargetAtPosition`), 이미지를 흰 배경으로 합성(`convertTransparentToWhite`) 후 캐릭터/배경에 추가
- `src/components/illustration/CharacterCard.tsx` — 캐릭터 카드(`CharacterCard`). 이름 인라인 편집, 이미지 그리드(최대 `MAX_IMAGES_PER_CHARACTER=3`), 파일선택 추가, 드롭 타겟 등록(`registerDropZone`)·하이라이트
- `src/components/illustration/BackgroundSection.tsx` — 배경 섹션(`BackgroundSection`). 이미지 최대 `MAX_BACKGROUND_IMAGES=5`, 드롭 영역 `'background'` 등록, 전체/개별 삭제
- `src/components/illustration/conceptSketch/ConceptSketchPanel.tsx` — 구도 스케치 모달(별도 문서)
- `src/types/illustration.ts` — `IllustrationSessionData`/`IllustrationCharacter`/`ConceptSketch` 등 + `ILLUSTRATION_LIMITS`
- `src/App.tsx` — `handleIllustrationDataChange`(세션 반영, :946), `handleIllustrationGenerate`(생성 오케스트레이션, :957). 캐릭터 이미지 flatten 을 참조로 전달

## 데이터 모델

```
IllustrationSessionData = {
  characters: IllustrationCharacter[],   // 최대 5명
  backgroundImages: string[],            // Base64 또는 IndexedDB 키, 최대 5장
  backgroundImageKeys?, backgroundAnalysis?, backgroundNegativePrompt?,
  conceptSketch?                         // 구도 스케치 (선택)
}
IllustrationCharacter = {
  id, name,                              // name = 프롬프트 참조용
  images: string[],                      // 참조 이미지 (최대 3장)
  imageKeys?, analysis?: IllustrationCharacterAnalysis, negativePrompt?
}
IllustrationCharacterAnalysis = { gender, age_group, hair, eyes, face, outfit, accessories,
  body_proportions, limb_proportions, torso_shape, hand_style,
  species_type, distinctive_features, color_scheme, silhouette_shape, personality_visual_cues }
BackgroundAnalysisResult = { environment_type, atmosphere, color_palette, lighting,
  time_of_day, weather, depth_layers, style_keywords }
ILLUSTRATION_LIMITS = { MAX_CHARACTERS:5, MAX_IMAGES_PER_CHARACTER:3, MAX_BACKGROUND_IMAGES:5 }
```

- `distinctive_features` 가 캐릭터 식별에 가장 중요(주석). 캐릭터당 3장 상한은 참조가 너무 많으면 품질이 떨어지기 때문(주석, illustration.ts:93).

## 통합 드래그드롭 (단일 리스너 + 위치 판정)

`IllustrationSetupPanel.tsx:126` — 카드마다 리스너를 두지 않고 **패널 전체에 Tauri `onDragDropEvent` 하나만** 등록:
- 자식(카드/배경)이 마운트 시 `registerDropZone(id, { type, id, element })` 로 자신의 DOM 요소를 `dropZonesRef`(Map)에 등록.
- `over`/`drop` 시 커서 좌표로 `findDropTargetAtPosition(x, y)`(:82)가 `getBoundingClientRect` 로 어느 zone 위인지 판정 → `activeDropTarget` 하이라이트.
- `drop` 시 이미지 파일만 필터(`isImageFile`), 남은 슬롯만큼 잘라 `readFile`→base64→`convertTransparentToWhite`(흰 배경 합성)→캐릭터/배경 배열에 추가.
- 리스너 해제는 async dispose 를 안전 처리(`safeUnlisten`, 중복 호출/언마운트 경쟁 방지).

## 캐릭터 / 배경 카드

- **CharacterCard**: 이름은 버튼 클릭→input 인라인 편집(Enter 저장/Esc 취소). 이미지 3장 상한, 파일선택은 `open({ multiple:true })`. 카드 상태 색: 드롭 타겟(보라)/이미지 있음(초록)/기본(회색). `showDropHighlight = isDragging && isDropTarget && canAddMore`.
- **BackgroundSection**: 이미지 0장이면 큰 드롭 영역, 있으면 20×20 썸네일 그리드. 색상은 teal 계열. 전체 삭제 버튼 제공.
- 두 컴포넌트 모두 `convertTransparentToWhite` 로 투명 PNG 를 흰 배경으로 변환(모델이 투명도를 잘못 해석하는 것 방지).

## 생성 (App 레벨 오케스트레이션)

`App.tsx:957` `handleIllustrationGenerate`:
- 이미지가 있는 캐릭터만 추려(`characters.filter(c => c.images.length > 0)`) 참조로 사용. 캐릭터가 하나도 이미지가 없으면 생성 버튼 비활성.
- `backgroundAnalysis`(lighting/atmosphere/environment_type/depth_layers)와 `backgroundNegativePrompt` 를 생성 파라미터에 반영. `art_style: 'illustration'`.
- 참조 이미지는 `characters.flatMap(c => c.images)` 로 평탄화해 전달(:1244). `conceptSketch` 가 있으면 그 분석 결과가 layout/perspective/placements 로 반영됨.

## 회귀 증상별 원인

| 증상 | 원인 |
|------|------|
| 여러 카드에 동시에 드롭 하이라이트 | zone 판정 오류 → `findDropTargetAtPosition` 은 커서 좌표로 단일 타겟만 반환 |
| 드롭했는데 이미지가 안 들어감 | 남은 슬롯 0 / 이미지 확장자 아님 / `disabled` → `remainingSlots`·`isImageFile` 확인 |
| 투명 PNG 가 검게/이상하게 생성됨 | `convertTransparentToWhite` 미적용 → 흰 배경 합성 필요 |
| 캐릭터 6명째 추가 안 됨 | `MAX_CHARACTERS=5` 상한(의도됨) |
| 캐릭터당 4장째 안 들어감 | `MAX_IMAGES_PER_CHARACTER=3` 상한(참조 품질 보호, 의도됨) |
| 언마운트 후 드래그 리스너 경고 | async dispose 경쟁 → `safeUnlisten` 중복 호출 가드 |
| 생성 버튼이 계속 비활성 | 이미지 등록된 캐릭터 0명 → `characters.some(c => c.images.length > 0)` 조건 |
| 스케치 분석이 생성에 반영 안 됨 | `conceptSketch.analysis` 없음(스케치만 저장, 분석 미실행) |
