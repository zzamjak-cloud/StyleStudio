# 구도 스케치 (Concept Sketch)

사용자가 **거친 도형으로 배치를 직접 그리고 라벨을 꽂으면**, 그 스케치를 **마지막 참조 이미지**로 붙이고 프롬프트가 "구도 가이드"라고 명시해 최종 생성에 반영하는 기능. AI(Gemini) 분석을 돌리면 `layout`/`perspective`/`placements` 등 **구도 정보(CompositionAnalysis)** 가 텍스트로도 함께 들어간다. 캔버스는 Konva(`react-konva`).

## 두 곳에서 쓴다 (모달은 하나)

`ConceptSketchPanel` 하나를 **두 진입점이 공유한다.** 복사해 두면 한쪽만 고쳤을 때 다른 쪽 구도 지시가 조용히 달라진다.

| 진입점 | 세션 | 라벨 | 영속성 |
|--------|------|------|--------|
| `IllustrationSetupPanel`의 "구도 스케치" 섹션 | ILLUSTRATION | **등록 캐릭터 버튼** — 이름을 그대로 꽂는다 | `illustrationData.conceptSketch`에 저장 |
| `GeneratorSettings`의 "구도 스케치" 섹션 | `SKETCH_ENABLED_SESSIONS` (아래) | **자유 텍스트** — "폭포", "왼손에 검" | **저장하지 않는다** (아래 참조) |

- `characters` prop이 **선택**이다. 비어 있으면 캐릭터 버튼 대신 자유 라벨 입력이 뜨고 헤더 문구도 바뀐다. `SketchLabel.characterId`가 원래 optional이라 자유 라벨이 그대로 들어맞는다.
- `aspectRatio` prop을 넘기면 **캔버스가 그 비율로 뜬다**(안 넘기면 기존 960x600). 스케치 프레임이 출력 비율과 같아야 "대상이 화면에서 얼마나 크게, 어디까지 보이는지"를 그린 대로 얻는다 — 16:10 고정 캔버스에 그려 놓고 1:1로 생성하면 프레이밍 의도가 그대로 깨진다.

## 스케치를 무엇으로 읽는가 — 세션마다 다르다

`lib/prompts/sketchGuide.ts`의 `SKETCH_GUIDE_KIND` 맵이 **지원 여부와 프롬프트 문구를 함께** 정한다(단일 출처). 여기 없는 세션은 버튼도 안 뜬다.

| kind | 세션 | 스케치에서 가져오는 것 |
|------|------|----------------------|
| `layout` | BASIC · STYLE · BACKGROUND · UI · PIXELART_BACKGROUND | 화면 **안에 무엇을 어디에** 배치할지 (placement·scale·framing) |
| `subject` | CHARACTER · PIXELART_CHARACTER · ICON · PIXELART_ICON | 대상 하나의 **포즈·방향·보이는 면** (limb placement, 어느 면이 정면인지, 실루엣, 크롭) |

`subject`가 생긴 이유: "무릎 굽힌 채 왼쪽을 보는 자세", "손잡이가 정면으로 오게" 같은 건 **말로 정확히 옮기기 어려운데 그림 한 장이면 끝난다.**

### subject 문구가 layout보다 훨씬 센 이유

캐릭터·아이콘 세션의 본문 프롬프트는 "참조 이미지를 **IDENTICAL하게 복제**하라"를 반복한다(`generateCharacterPrompt`). 거기에 거친 스케치를 참조로 끼워 넣으면 모델이 **그것까지 복제 대상**으로 읽어 캐릭터가 낙서처럼 나올 수 있다. 그래서 `subject` 문구는 두 가지를 명시적으로 끊어 준다:

- 이 마지막 장은 **참조 세트가 아니다** — 외형·화풍·색·선 두께·디테일 수준을 여기서 가져오지 말 것
- **정체성·디자인·의상·색·화풍은 나머지 참조에서** 온다 — 스케치가 그걸 바꿔서는 안 됨

> **제외한 세션**: LOGO(마크 형태 자체가 결과물이라 거친 스케치가 형태를 망칠 수 있다) · ILLUSTRATION(전용 스케치가 이미 있다) · TILEMAP(요구 레이아웃이 이미 고정이라 스케치가 방해).

### 왜 생성 패널에서는 저장하지 않는가

프롬프트(`additionalPrompt`)도 패널 상태라 세션 전환 시 사라진다. 스케치만 영속화하면 "프롬프트는 날아갔는데 스케치는 남은" 어긋난 상태가 된다. 게다가 `sketchPng`는 data URL이라 세션 파일이 커진다 — ILLUSTRATION이 이미 그 비용을 지고 있어 전 세션으로 퍼뜨릴 이유가 없다. 영속화가 필요해지면 `illustrationData.conceptSketch`처럼 세션 레벨로 올린다.

### 라벨은 PNG에 굽지 않는다 → 프롬프트에 좌표로 넣어야 한다

`handleSave`는 **라벨을 제외한 스케치 레이어만** export한다(재진입 시 라벨을 다시 드래그·제거할 수 있게 하려고). 즉 **모델은 라벨 텍스트를 보지 못한다.** 그래서 프롬프트에 `"왼손에 검" at (25%, 50%)` 형태로 직렬화해 넣는다. 이걸 빠뜨리면 라벨이 결과에 전혀 반영되지 않는다.

## 관련 파일

- `src/components/illustration/conceptSketch/ConceptSketchPanel.tsx` — 스케치 모달(`ConceptSketchPanel`). Konva `Stage`(2 Layer: 스케치/라벨), 펜·지우개·색상·굵기, 캐릭터 라벨(드래그 이동·✕ 제거), `handleAnalyze`(AI 분석)·`handleSave`
- `src/lib/sketch/analyzeSketch.ts` — `analyzeCompositionSketch`(기본 분석 모델 `DEFAULT_ANALYSIS_MODEL` 로 스케치→`CompositionAnalysis`), `formatCompositionForPrompt`(분석 결과를 프롬프트용 텍스트로)
- `src/lib/utils/annotationExport.ts` — `exportNodeToDataUrl`(Konva 노드→dataURL, 스케치 PNG 추출에 재사용)
- `src/types/illustration.ts` — `ConceptSketch`/`SketchLabel`/`CompositionAnalysis`/`CharacterPlacement`
- `src/components/illustration/IllustrationSetupPanel.tsx` — ILLUSTRATION 진입점. 스케치 섹션 UI + `handleSketchSave`/`handleSketchClear`
- `src/lib/prompts/sketchGuide.ts` — **`SKETCH_GUIDE_KIND`(지원 세션 + 문구 종류의 단일 출처)**, `buildSketchGuideSection`, `isSketchEnabledSession`
- `src/components/generator/ImageGeneratorPanel.tsx` — 일반 세션 진입점. `conceptSketch` 상태·마지막 reference 첨부·가이드 섹션 결합
- `src/components/generator/GeneratorSettings.tsx` — "구도 스케치" 섹션(그리기/편집/삭제 + 썸네일)

## 데이터 모델

```
ConceptSketch = {
  sketchPng,             // 배경 PNG + 펜 stroke 만 export (라벨 제외)
  labels: SketchLabel[], // 캐릭터 이름 라벨 (데이터로만 저장)
  analysis?: CompositionAnalysis
}
SketchLabel = { id, characterId?, text, x, y }   // x,y 0~1 정규화
CompositionAnalysis = {
  layout,                              // "rule of thirds, characters in foreground"
  perspective,                         // "low angle, three-quarter view"
  cameraDistance: 'close-up'|'medium'|'wide'|'extreme-wide',
  placements: CharacterPlacement[], backgroundElements: string[], moodHint
}
CharacterPlacement = { characterId, name, position{x,y,width,height}, pose?, facingDirection?, interactingWith? }
```

## 캔버스 구조 (Konva 2-Layer)

`ConceptSketchPanel.tsx:343` — Stage 크기 `STAGE_W=960 × STAGE_H=600`:
1. **스케치 레이어**(`sketchLayerRef`, **저장 export 대상**): 편집 진입 시 이전 `sketchPng` 를 `KonvaImage` 배경으로 복원(:344) + 펜 stroke. 지우개는 흰색 stroke + `destination-out`.
2. **라벨 레이어**(export 제외): `labels` 데이터로부터 매 렌더 그려짐. `Group`(`name="sketch-label"`)에 흰 박스 + 보라 텍스트 + 우상단 ✕ 버튼. `draggable` 로 이동(`onDragEnd` 에서 경계 클램프 후 0~1 정규화 저장), ✕ 클릭으로 제거.

**핵심 설계**: 라벨을 PNG 로 굽지 않고 데이터(`labels`)로만 저장 → 재진입 시 별도 객체로 다시 렌더되어 계속 드래그/제거 가능. 펜 stroke 는 PNG 로만 보존되어 추가 편집은 그 위에 누적.

- stroke 시작 시 라벨(Group) 위 클릭은 `findAncestor('.sketch-label')` 로 감지해 무시(라벨 드래그/제거 우선, :109).
- 색상 `COLORS = 검정 #1F2937 / 빨강 #FF3B30 / 파랑 #0A84FF / 초록 #34C759`, 굵기 `WIDTHS = [2,4,8]`.
- 단축키: Esc(닫기), Ctrl/Cmd+Z(undo). "스케치 새로 그리기"는 배경 PNG + stroke 를 모두 비운다.

## 라벨 추가

`addCharacterLabel`(:149) — 좌측 캐릭터 버튼 클릭 시 별도 입력 없이 **캐릭터 이름 그대로** 라벨 추가. 위치는 캔버스 중앙(0.4, 0.45) + 라벨 개수×0.04 오프셋으로 겹침 방지. `estimateTextWidth`(:42)로 한글(1.0)/영문(0.55) 폭을 추정해 박스 크기 계산(정확 측정 대신 단순 추정).

## AI 분석 (handleAnalyze)

`ConceptSketchPanel.tsx:168`:
- Gemini API Key 필요. `exportNodeToDataUrl(stageRef)` 로 **stage 전체**(라벨 포함) PNG 추출 → `analyzeCompositionSketch({ apiKey, sketchPng, labels, characters })` 호출 → `CompositionAnalysis` 를 `analysis` 상태에 저장.
- 결과는 하단에 `formatCompositionForPrompt(analysis)` 로 미리보기. 분석 없이 저장도 가능(스케치만 등록).

## 저장 (handleSave)

`ConceptSketchPanel.tsx:194`:
- **`sketchLayerRef` 만 export**(라벨 제외한 배경 PNG + 펜 stroke) → `sketchPng`.
- `onSave({ sketchPng, labels, analysis })` → `IllustrationSetupPanel.handleSketchSave` → `session.illustrationData.conceptSketch` 저장.
- 셋업 패널은 등록 배지·AI 분석완료 배지·미리보기(layout/perspective/캐릭터 배치 수)를 표시. 삭제는 `handleSketchClear`(confirm 후 `conceptSketch` 제거).

## 회귀 증상별 원인

| 증상 | 원인 |
|------|------|
| 저장된 스케치에 라벨이 구워져 이동 불가 | 라벨 포함 export → **`sketchLayerRef` 만** export, 라벨은 `labels` 데이터로 저장 |
| 라벨 위에서 그려져 stroke 가 생김 | `findAncestor('.sketch-label')` 감지 누락 → 라벨 클릭 시 stroke 무시 |
| 재진입 시 이전 펜 선이 사라짐 | `initial.sketchPng` 를 배경 `KonvaImage` 로 복원 안 함(:344) |
| 라벨 드래그가 캔버스 밖으로 나감 | `onDragEnd` 경계 클램프 누락(0~STAGE-box) |
| 분석 결과가 생성에 반영 안 됨 | `analyze` 미실행(스케치만 저장) 또는 App 생성 경로가 `conceptSketch.analysis` 미사용 |
| 한글 라벨 박스 폭이 짧아 글자 잘림 | `estimateTextWidth` CJK 폭 계산(한글=fontSize) 확인 |
| 분석 버튼 비활성 | Gemini API Key 없음 |
