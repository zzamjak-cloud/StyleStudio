# 이미지 생성 API·입력 처리

이미지 생성을 실제로 수행하는 통합 훅과 모델 정의, 그리고 참조 이미지의 업로드·붙여넣기·다운스케일 처리를 정리한다. **v0.6부터 모든 모델(Gemini/OpenAI)이 OpenRouter Image API(`POST /api/v1/images`) 단일 경로**를 사용하며, `ImageGeneratorPanel.handleGenerate` 는 provider 분기 없이 `useImageGenerator.generateImage` 하나를 호출한다.

## 관련 파일

- `src/lib/api/openrouter.ts` — OpenRouter 공통 클라이언트. `chatComplete`(텍스트/비전), `generateImageViaOpenRouter`(이미지 생성), Bearer 헤더(`openrouterHeaders`).
- `src/hooks/api/imageModels.ts` — 모델 카탈로그(`IMAGE_MODELS`, OpenRouter 슬러그)·옵션 타입·`getImageModelDefinition`/`isOpenAIModel`/`getAvailableImageModels`/`normalizeImageModelId`/`DEFAULT_IMAGE_MODEL`.
- `src/hooks/api/useImageGenerator.ts` — 통합 생성 훅(`generateImage`). 프롬프트 조립 → Image API 호출 → JPEG 통일. `convertBase64ToJpeg`/`formatImageApiError` export.
- `src/components/generator/ImageUpload.tsx` — 참조 이미지 업로드 표면(Tauri).
- `src/hooks/useImageHandling.ts` — 업로드 이미지 배열 상태·전역 드롭 리스너·최대 14장.
- `src/hooks/useImagePaste.ts` — 클립보드 이미지 붙여넣기 훅.
- `src/lib/utils/imageDownscale.ts` — 업로드 즉시 다운스케일(`downscaleImage`).

## 모델 정의 (imageModels.ts)

```
ImageGenerationModel =
  | 'google/gemini-3-pro-image-preview'      // 나노바나나 프로
  | 'google/gemini-3.1-flash-image-preview'  // 나노바나나2
  | 'google/gemini-3.1-flash-lite-image'     // 나노바나나 2 라이트 (1K 전용)
  | 'openai/gpt-image-2'                     // 덕테이프
ImageModelDefinition = {
  id, label, provider: 'gemini'|'openai',
  supports: { aspectRatios, imageSizes, qualities }
}
```

- 비율은 전 모델 공통 5종(`1:1·16:9·9:16·4:3·3:4`). **극단 비율 1:3/3:1은 OpenRouter 미지원으로 제거.**
- `getAvailableImageModels()`: 통합 키 하나로 전 모델 사용 가능 — 인자 없음(기존 `hasOpenAIApiKey` 필터 제거).
- `normalizeImageModelId(id)`: 구버전 세션/히스토리에 저장된 레거시 ID(`gemini-3-pro-image-preview` 등)를 현재 슬러그로 매핑. 미매칭 시 기본 모델.
- `TILEMAP_FIXED_IMAGE_MODEL = 'openai/gpt-image-2'` (레이아웃 준수 때문 — 기존과 동일).

## 통합 생성 (useImageGenerator)

- 엔드포인트: `POST https://openrouter.ai/api/v1/images`, `Authorization: Bearer {OpenRouter Key}`.
- **요청 필드**: `model`(슬러그), `prompt`, `aspect_ratio`, Gemini 계열만 `resolution`('1K'|'2K'|'4K'), gpt-image 계열만 `quality`('low'|'medium'|'high'), 참조는 `input_references[]`(`{type:'image_url', image_url:{url: dataURL}}`).
- **참조 이미지 최대 14장**(`MAX_REFERENCE_IMAGES`) — 업로드 한도(14장)와 동일해져 "업로드 14장/전송 10장" 불일치가 해소됐다.
- **프롬프트 조립**: `sessionType === 'ILLUSTRATION'` 이면 완성 프롬프트 그대로, 아니면 `buildPromptForSession` 재조립(기존과 동일). `negativePrompt` 는 `Avoid: ...` 로 덧붙임(별도 API 필드 없음).
- **재시도**: 5xx(500/502/503) 시 최대 2회, 5초 간격. OpenRouter는 실패한 생성을 502로 반환하며 과금하지 않음. 4xx는 `formatImageApiError` 로 한국어 메시지 변환(401 키, 402 크레딧 부족, 403 안전 차단, 429 한도, 413 용량).
- **응답 파싱**: `data[0].b64_json`(+`media_type`) → `convertBase64ToJpeg`(흰 배경 합성, 0.92)로 **내부 표준 JPEG 통일** 후 `onComplete(jpegBase64)`. 투명이 필요한 흐름은 이후 `removeWhiteBackground` 단계가 처리.
- 콜백 인터페이스(`onProgress`/`onComplete`/`onError`)는 기존 두 훅과 동일하게 유지.

### OpenRouter 전환으로 제거된 기능

| 제거 항목 | 사유 |
|-----------|------|
| Seed / Temperature / Top-K / Top-P 고급 설정 | Image API 미지원 — UI·상태·히스토리 저장 모두 제거 |
| referenceStrength | 원래 미전달 dead 값 — 완전 제거 |
| OpenAI `/v1/images/edits` 마스크 편집(`editWithMask`) | OpenRouter 미지원 + 호출부 없던 dead code |
| Gemini 모델 가용성 GET 체크·`listGeminiModels()` 콘솔 유틸 | generativelanguage 전용 (`src/utils/checkGeminiModels.ts` 삭제) |
| 극단 비율 1:3 / 3:1 | OpenRouter 비율 enum 미지원 |
| `thought_signature` 멀티턴 (채팅) | Image API 미지원 → `wiki/chat/overview.md` 참고 |

## 참조 이미지 입력

### 업로드 (ImageUpload.tsx)
- `onImageSelect(dataUrl)` 콜백 하나만 받는 Tauri 전용 표면. **썸네일/제거/개수 제한 UI는 여기 없음**(상위에서 처리) — 도움말 모달에만 "최대 14개" 안내.
- 클릭 업로드: Tauri `open({ multiple, filters: png/jpg/jpeg/gif/webp })` → 각 파일 `readFile`→base64 data URL(`loadTauriImage`).
- 드래그드롭: `getCurrentWindow().onDragDropEvent`로 **호버 상태만** 추적. 실제 드롭 파일 처리는 앱 전역(`App.tsx`/`useImageHandling`).
- 붙여넣기: `useImagePaste({ onPaste })`.
- 투명→흰 변환: 업로드/붙여넣기 이미지를 흰 배경 캔버스에 합성 후 PNG로(`convertTransparentToWhite`), 실패 시 원본.

### 상태·드롭 (useImageHandling)
- `uploadedImages: string[]` + `MAX_IMAGES = 14`. 초과 시 `showLimitWarning`.
- 전역 Tauri `onDragDropEvent` 구독: `drop` 이벤트에서 이미지 확장자만 필터, **500ms 중복 이벤트 방지**(`lastDropTimeRef`), 순차 `loadTauriImage` 후 추가.
- `handleImageSelect`: 추가 전 `downscaleImage(data, 1280, 0.85)` 적용.
- `handleRemoveImage(index)`: 해당 인덱스 제거.

### 붙여넣기 (useImagePaste)
- 전역 `paste` 이벤트 구독(`enabled`일 때만). 클립보드 `items`에서 `image/*`만 처리, 있으면 `preventDefault`로 텍스트 붙여넣기 대신 이미지 우선.
- `FileReader`로 data URL화 → `downscaleImage(1280, 0.85)` → `onPaste`. `onPaste`는 ref로 보관해 리스너 재등록 방지.

### 다운스케일 (imageDownscale.ts)
- `downscaleImage(dataUrl, maxDim=1280, quality=0.85)`: 원본이 maxDim 이하면 그대로 반환(비용 0). PNG는 PNG 유지(투명 보존), 그 외 JPEG 재인코딩. 실패/에러 시 원본 반환.
- 목적: 큰 참조 이미지를 IndexedDB·메모리·디코딩·API 페이로드 전 구간에서 경량화.

## 회귀 증상별 원인

| 증상 | 원인 |
|------|------|
| 서버 에러 반복 | 참조/요청 페이로드 과대(20MB 경고 로깅). 5xx는 5초 간격 2회 재시도. 실패 생성은 502 + 미과금 |
| 결과가 항상 JPEG | 모든 모델 응답을 `convertBase64ToJpeg` 로 강제 JPEG화(저장 용량·썸네일 호환). 투명도는 흰 배경으로 합성됨 |
| "안전 시스템 차단" | 403/moderation — 참조/프롬프트 민감성. 프롬프트·참조 조정 후 재시도 |
| 402 에러 | OpenRouter 크레딧 부족 |
| 구세션 생성 시 모델 오류 | 레거시 모델 ID → `normalizeImageModelId` 로 정규화 (미매칭 시 기본 모델 fallback) |
| 드롭 시 이미지가 2장씩 추가 | 500ms 중복 방지(`lastDropTimeRef`)가 걸러줌. 미동작 시 여기 확인 |
| Ctrl+V가 텍스트만 붙음 | 클립보드에 이미지 item 없음. 이미지가 있으면 `preventDefault`로 이미지 우선 |
| 업로드 후 화질 저하 | 1280px/0.85 다운스케일(의도). 원본 유지 필요 시 `handleImageSelect`/paste 경로 조정 |
