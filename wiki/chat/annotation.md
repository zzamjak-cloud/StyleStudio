# 이미지 어노테이션 (부분 편집)

채팅에서 생성된 AI 이미지 위에 **색상 펜으로 영역을 표시하고 색상별 지시문을 입력**해 부분 편집을 요청하는 기능. 모달은 Konva(`react-konva`) 캔버스로 구현.

## 왜 마스크 인페인팅이 아닌가

**쓸 수가 없다.** OpenRouter Image API에는 mask 필드가 없고 `/api/v1/images/edits` 엔드포인트 자체가 존재하지 않는다(2026-09-09 재확인). gpt-image-2.5 선버스트가 OpenAI 직접 API에서 인페인팅을 지원하지만 그건 OpenRouter 경로로 오지 않는다.

그래서 두 방식 다 "편집할 영역을 **프롬프트로** 알려주는" 우회이고, 어느 쪽이 통하는지가 **모델 계열마다 다르다.** 판정은 `getAnnotationMode(modelId)` 한 곳에서만 한다 — 호출부가 모델 ID를 직접 비교하면 2.5 계열이 늘 때 조용히 깨진다.

| 모드 | 대상 | 모델에 주는 것 | 이유 |
|------|------|---------------|------|
| `coordinates` | 나노바나나(Gemini) | **깨끗한 원본만** + stroke bounding box를 정규화 좌표(%) 텍스트로 직렬화 | 합성본을 주면 결과물이 **색상 마커를 그대로 모방해 그린다.** 마커를 안 보여주는 대신 위치 정확도를 잃는 거래 |
| `composite` | 덕테이프(gpt-image 계열) | **합성본 + 깨끗한 원본** 둘 다 + 좌표 직렬화(보조) | 지시 준수도가 높아 "마커는 위치 표시일 뿐 그리지 말라"가 통한다. 모델이 편집 영역을 **픽셀 단위로** 보므로 좌표 텍스트보다 정확하다 |

> 좌표 직렬화는 원래 **Gemini 제약을 우회하려고** 만든 것이다. 덕테이프가 기본 모델이 되면서(v0.7.2) 덕테이프에까지 그 제약을 적용할 이유가 없어져 분기가 생겼다.

- **composite 모드의 프롬프트는 첨부 순서로 이미지를 지칭하면 안 된다.** `generateFromChat`이 참조 배열 맨 앞에 "직전 생성 이미지"를 자동으로 끼워 넣으므로 `handleAnnotationSubmit`이 넘긴 것이 첫 번째가 아니다. 순서 대신 **마커 유무**로 두 이미지를 구분해 설명한다.
- 같은 이미지가 참조에 중복으로 들어가지 않도록 `allImages`를 `Set`으로 거른다 — 부분 편집은 원본을 명시적으로 첨부하는데 그게 보통 `latestGenerated`와 같은 데이터다.
- 어느 모드든 **마스크 밖 보존은 모델의 지시 준수에 달려 있다.** API가 강제해 주지 않는다.
- `AnnotationResult.maskPng`(OpenAI edits 규격 흑백 마스크)는 계속 생성하지만 **소비처가 없다.** 인페인팅이 열리는 날을 위해 남겨 둔 것이다 — 지우지 말 것.

## 관련 파일

- `src/components/chat/annotation/ImageAnnotator.tsx` — 어노테이션 모달(`ImageAnnotator`). Konva `Stage`(3개 Layer: 원본/펜/마스크), 펜·지우개·색상·굵기 툴바, 우측 색상별 지시문 입력, `handleSubmit` 에서 `AnnotationResult` 조립
- `src/types/annotation.ts` — `AnnotationStroke`/`AnnotationResult`/`ColorRegion` 타입, `ANNOTATION_COLORS`, `serializeColorInstructions`(색상별 지시문→좌표 포함 자연어), `getColorLabel`
- `src/lib/utils/annotationExport.ts` — Konva 노드 → dataURL 추출(`exportNodeToDataUrl`), 마스크를 OpenAI edits 규격(편집=흰색/보존=검정 binary)으로 정규화(`normalizeMaskToOpenAI`)
- `src/components/chat/ChatPanel.tsx` — `handleAnnotationSubmit`: `getAnnotationMode(settings.imageModel)`로 **모드 분기**. `composite`면 `handleSend(prompt, [합성본, 원본])`, `coordinates`면 `handleSend(prompt, [원본])`. 진입 조건은 **API Key 존재 + `isGeneratedImage`**
- `src/hooks/api/imageModels.ts` — `AnnotationMode`·`getAnnotationMode()`. 모델별 판정은 여기에만 둔다

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
| 어노테이션 버튼(연필) 안 보임 | API Key 없음 또는 `isGeneratedImage=false`(user 첨부 이미지) |
| OpenAI 마스크 편집이 반대로 적용 | 마스크 흑백 반전 → `normalizeMaskToOpenAI` 편집=흰색 규칙 확인 |
| 큰 이미지에서 캔버스 느림/메모리 | `MAX_CANVAS_DIM=1280` 다운스케일 누락 |
| 이미지가 모달 화면에 다 안 들어오고 잘림 | fit 배율(`fitScale`) 미적용 또는 캔버스 래퍼가 `flex 중앙정렬+overflow` 로 회귀(자식 `m-auto` 여야 함) |
| 확대 상태에서 그린 선이 엉뚱한 위치에 찍힘 | 포인터 좌표를 `getPointerPosition`(화면 좌표)으로 저장 → `getRelativePointerPosition`(논리 좌표) 사용해야 함 |
| 줌 후 마스크/composite 해상도가 달라짐 | export 시 역배율 `pixelRatio` 누락 → 논리 해상도(stageSize) 기준으로 추출해야 함 |
