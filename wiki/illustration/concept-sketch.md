# 구도 스케치 (Concept Sketch)

일러스트 세션에서 사용자가 **거친 도형으로 인물 위치를 직접 그리고 캐릭터 이름 라벨을 배치**하면, AI(Gemini)가 스케치를 분석해 `layout`/`perspective`/`placements` 등 **구도 정보(CompositionAnalysis)** 를 추출해 최종 이미지 생성에 반영하는 기능. 캔버스는 Konva(`react-konva`)로 구현하며, `IllustrationSetupPanel` 의 "구도 스케치" 섹션에서 모달로 연다. 선택 기능(Phase 4).

## 관련 파일

- `src/components/illustration/conceptSketch/ConceptSketchPanel.tsx` — 스케치 모달(`ConceptSketchPanel`). Konva `Stage`(2 Layer: 스케치/라벨), 펜·지우개·색상·굵기, 캐릭터 라벨(드래그 이동·✕ 제거), `handleAnalyze`(AI 분석)·`handleSave`
- `src/lib/sketch/analyzeSketch.ts` — `analyzeCompositionSketch`(Gemini 로 스케치→`CompositionAnalysis`), `formatCompositionForPrompt`(분석 결과를 프롬프트용 텍스트로)
- `src/lib/utils/annotationExport.ts` — `exportNodeToDataUrl`(Konva 노드→dataURL, 스케치 PNG 추출에 재사용)
- `src/types/illustration.ts` — `ConceptSketch`/`SketchLabel`/`CompositionAnalysis`/`CharacterPlacement`
- `src/components/illustration/IllustrationSetupPanel.tsx` — 스케치 섹션 UI + `handleSketchSave`/`handleSketchClear`(:37)

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
