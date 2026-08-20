# 이미지 어노테이션 (부분 편집)

채팅에서 생성된 AI 이미지 위에 **색상 펜으로 영역을 표시하고 색상별 지시문을 입력**해 부분 편집을 요청하는 기능. 핵심 설계: 모델에 **색상 라인이 그려진 합성본을 주지 않는다**. 합성본을 reference 로 보내면 결과물이 컬러 라인을 그대로 모방하기 때문. 대신 **깨끗한 원본만 reference 로 전송**하고, 각 색상 stroke 의 bounding box 를 **정규화 좌표(가로/세로 %)로 텍스트 prompt 에 직렬화**해 "이 영역만 이렇게 편집하라"는 지시로 전달한다. 모달은 Konva(`react-konva`) 캔버스로 구현.

## 관련 파일

- `src/components/chat/annotation/ImageAnnotator.tsx` — 어노테이션 모달(`ImageAnnotator`). Konva `Stage`(3개 Layer: 원본/펜/마스크), 펜·지우개·색상·굵기 툴바, 우측 색상별 지시문 입력, `handleSubmit` 에서 `AnnotationResult` 조립
- `src/types/annotation.ts` — `AnnotationStroke`/`AnnotationResult`/`ColorRegion` 타입, `ANNOTATION_COLORS`, `serializeColorInstructions`(색상별 지시문→좌표 포함 자연어), `getColorLabel`
- `src/lib/utils/annotationExport.ts` — Konva 노드 → dataURL 추출(`exportNodeToDataUrl`), 마스크를 OpenAI edits 규격(편집=흰색/보존=검정 binary)으로 정규화(`normalizeMaskToOpenAI`)
- `src/components/chat/ChatPanel.tsx` — `handleAnnotationSubmit`(:193): `AnnotationResult` 를 편집 prompt 로 직렬화해 `handleSend(prompt, [원본])` 호출. 진입 조건은 **OpenAI Key 존재 + `isGeneratedImage`**

## 데이터 모델

```
AnnotationStroke = { id, tool, points:[x1,y1,...], color, strokeWidth, isMaskingStroke }
ColorRegion = { x, y, w, h }   // 0~1 정규화 bounding box
AnnotationResult = {
  compositePng,        // 어노테이션 합성본 JPEG (디버그/이력용, 모델엔 미전송)
  maskPng,             // OpenAI 정밀 편집용 흑백 마스크
  textAnnotations,     // 텍스트 라벨 (현재 미사용, [])
  originalImageRef,    // 추적용 메시지 ID/키
  originalImage,       // 깨끗한 원본 data URL (실제 reference)
  colorInstructions,   // { hex(소문자): 지시문 }
  usedColors,          // 실제 사용된 색 hex[]
  colorRegions,        // { hex: ColorRegion } stroke bounding box
  globalInstructions   // 공통 지시문
}
ANNOTATION_COLORS = 빨강 #ff3b30 / 노랑 #ffcc00 / 파랑 #0a84ff / 초록 #34c759
```

## 캔버스 구조 (Konva 3-Layer)

`ImageAnnotator.tsx` Stage 내부:
1. **원본 레이어**(`listening={false}`) — `KonvaImage` 로 배경 이미지. 이미지는 `MAX_CANVAS_DIM=1280` 기준으로 다운스케일해 **논리 좌표계(stageSize)** 결정.
2. **펜 레이어**(`paintLayerRef`) — 사용자 stroke. 지우개는 `globalCompositeOperation='destination-out'`.
3. **마스크 레이어**(`maskLayerRef`, `opacity=0.0001`) — `isMaskingStroke` 인 stroke 를 흰색으로 그림. OpenAI 정밀 편집(마스크 기반) 시 추출용. 화면엔 사실상 안 보임.

- 색상은 항상 소문자 hex 로 비교/저장. `usedColors`는 지우개 제외 실제 사용 색 집합 → 해당 색만 지시문 textarea 활성화.
- 단축키: Esc(닫기), Ctrl/Cmd+Z(마지막 stroke undo).

### 논리 좌표계 / 표시 배율 분리 (화면 맞춤 + 줌)

- **stageSize 는 논리 좌표계**(원본 해상도, 최대 1280 다운스케일)로 유지하고, 화면에는 `viewScale = fitScale × zoom` 배율로 표시.
  - `fitScale`: 캔버스 컨테이너(ResizeObserver 추적) 안에 이미지 전체가 들어가는 최대 배율(1 초과 안 함) → **이미지가 항상 화면 안에 다 보임**.
  - `zoom`: 사용자 줌(0.25x~4x). 우상단 오버레이 버튼(확대/축소/화면 맞춤) + Ctrl(Cmd)+휠. 휠 줌은 React `onWheel` 이 passive 라 네이티브 리스너(`{passive:false}`)로 등록.
- Stage 는 `width/height = stageSize × viewScale` + `scaleX/scaleY = viewScale` 로 렌더. 포인터 좌표는 `stage.getRelativePointerPosition()` 으로 논리 좌표로 역변환해 stroke 저장 → `colorRegions` 정규화(÷stageSize)는 배율과 무관하게 정합.
- **export 시 `pixelRatio = stageSize.width / 표시폭`** 을 넘겨 composite/마스크를 논리 해상도 그대로 추출 → `downscaledOriginal`(stageSize 크기)과 마스크 치수 일치 유지.
- 캔버스 래퍼는 `flex 중앙정렬 + overflow` 조합이 아니라 **자식 `m-auto`** 방식 — 전자는 컨테이너보다 큰 자식의 위/왼쪽이 스크롤 불가로 잘리는 flexbox 함정.

## 제출 흐름 (handleSubmit)

`ImageAnnotator.tsx` `handleSubmit`:
1. 검증: stroke 도 지시문도 없으면 alert 후 중단.
2. `compositePng`(stage JPEG), `rawMask`(마스크 레이어) → 역배율 `pixelRatio` 로 논리 해상도 추출 → `normalizeMaskToOpenAI` 로 흑백 binary 마스크.
3. **깨끗한 원본** 다운스케일본 생성: stageSize 크기 canvas 에 흰 배경 + 원본 이미지만 그려 JPEG(0.9). 컬러 라인 없음.
4. **색상별 bounding box 계산**: 각 펜 stroke 의 points(논리 좌표)를 순회해 색상별 min/max → stageSize 로 나눠 0~1 `colorRegions` 로 정규화.
5. `AnnotationResult` 조립 후 `onSubmit`.

## 프롬프트 직렬화

`ChatPanel.handleAnnotationSubmit`(:193)에서:
- `serializeColorInstructions(colorInstructions, usedColors, colorRegions)`(annotation.ts:70): 지시문이 채워진 색상만, region 이 있으면 `- 🔴 영역 (가로 x1~x2%, 세로 y1~y2%): 지시문` 형태로 좌표 포함해 나열. 끝에 "명시되지 않은 영역은 원본 유지" 문장 추가.
- 최종 prompt: `[부분 편집 — 지정 영역만 편집]` 헤더 + 좌표 안내 + 색상별 지시 + "결과에 마커/라인/박스 등 어노테이션 흔적 금지" 경고.
- `handleSend(promptText, [result.originalImage])` — **원본만** reference 로 전달. 모델 분기(Gemini/OpenAI)는 `settings.imageModel` 로 채팅과 동일 경로 처리.

## 마스크 정규화 (normalizeMaskToOpenAI)

`annotationExport.ts:28` — OpenAI `/v1/images/edits` 사양(편집=흰색, 보존=검정):
- 검정 배경 canvas 에 마스크 stroke(흰색) 합성 → `getImageData` 로 픽셀 순회 → **alpha > 16 이면 흰색, 아니면 검정**으로 binary 화 → PNG.
- (현재 채팅 편집 경로는 좌표 텍스트 방식이 주력이라 마스크는 OpenAI 정밀 편집 시에만 사용.)

## 회귀 증상별 원인

| 증상 | 원인 |
|------|------|
| 결과 이미지에 컬러 라인/마커가 그대로 나옴 | 합성본을 reference 로 전송 → **깨끗한 원본만** 전송 + 좌표는 텍스트로(`originalImage` 사용) |
| 편집 영역이 엉뚱한 곳에 적용 | `colorRegions` 정규화 오류(stroke points→stage 크기 나눗셈) 확인 |
| 사용 안 한 색상 지시문이 전송됨 | `usedColors` 필터 누락 → `serializeColorInstructions` 가 채워진 항목만 포함 |
| 지시문 textarea 가 계속 비활성 | 해당 색으로 실제 그리지 않음(`usedColors` 미포함) |
| 어노테이션 버튼(연필) 안 보임 | OpenAI Key 없음 또는 `isGeneratedImage=false`(user 첨부 이미지) |
| OpenAI 마스크 편집이 반대로 적용 | 마스크 흑백 반전 → `normalizeMaskToOpenAI` 편집=흰색 규칙 확인 |
| 큰 이미지에서 캔버스 느림/메모리 | `MAX_CANVAS_DIM=1280` 다운스케일 누락 |
| 이미지가 모달 화면에 다 안 들어오고 잘림 | fit 배율(`fitScale`) 미적용 또는 캔버스 래퍼가 `flex 중앙정렬+overflow` 로 회귀(자식 `m-auto` 여야 함) |
| 확대 상태에서 그린 선이 엉뚱한 위치에 찍힘 | 포인터 좌표를 `getPointerPosition`(화면 좌표)으로 저장 → `getRelativePointerPosition`(논리 좌표) 사용해야 함 |
| 줌 후 마스크/composite 해상도가 달라짐 | export 시 역배율 `pixelRatio` 누락 → 논리 해상도(stageSize) 기준으로 추출해야 함 |
