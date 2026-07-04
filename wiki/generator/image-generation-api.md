# 이미지 생성 API·입력 처리

이미지 생성을 실제로 수행하는 API 훅(Gemini/OpenAI)과 모델 정의, 그리고 참조 이미지의 업로드·붙여넣기·다운스케일 처리를 정리한다. 두 훅 모두 `onProgress`/`onComplete`/`onError` 콜백 인터페이스를 공유하며, `ImageGeneratorPanel.handleGenerate`가 provider에 따라 분기 호출한다.

## 관련 파일

- `src/hooks/api/imageModels.ts` — 모델 카탈로그(`IMAGE_MODELS`)·옵션 타입·`getImageModelDefinition`/`isOpenAIModel`/`getAvailableImageModels`/`DEFAULT_IMAGE_MODEL`.
- `src/hooks/api/useGeminiImageGenerator.ts` — Gemini `generateContent` 호출(`generateImage` → 내부 `generateImageInternal`).
- `src/hooks/api/useOpenAIImageGenerator.ts` — OpenAI images API(`generateImage`/`editWithMask`).
- `src/components/generator/ImageUpload.tsx` — 참조 이미지 업로드 표면(Tauri).
- `src/hooks/useImageHandling.ts` — 업로드 이미지 배열 상태·전역 드롭 리스너·최대 14장.
- `src/hooks/useImagePaste.ts` — 클립보드 이미지 붙여넣기 훅.
- `src/lib/utils/imageDownscale.ts` — 업로드 즉시 다운스케일(`downscaleImage`).

## 모델 정의 (imageModels.ts)

```
ImageGenerationModel = 'gemini-3-pro-image-preview' | 'gemini-3.1-flash-image-preview' | 'gpt-image-2'
ImageModelDefinition = {
  id, label, provider: 'gemini'|'openai',
  supports: { aspectRatios, imageSizes, qualities, geminiAdvancedControls }
}
```

- `IMAGE_MODELS`: 나노바나나 프로(gemini-3-pro)·나노바나나2(gemini-3.1-flash)·덕테이프(gpt-image-2).
- `getAvailableImageModels(hasOpenAIApiKey)`: OpenAI 키 없으면 Gemini 모델만(`GEMINI_IMAGE_MODELS`) 반환.
- `getImageModelDefinition(id)`: 미매칭 시 첫 모델 fallback. `isOpenAIModel(id)`로 provider 분기.
- 모델별 지원 비율/해상도/품질 표는 [settings.md](./settings.md#모델-선택).

## Gemini 생성 (useGeminiImageGenerator)

- 엔드포인트: `POST .../v1beta/models/{MODEL}:generateContent?key=...`.
- **재시도**: 500 에러 시 최대 2회, 5초 간격(`MAX_RETRIES`/`RETRY_DELAY_MS`). 500 이외/마지막 시도면 throw.
- **모델 가용성 체크**: `seed === undefined`(첫 생성 간주)일 때만 모델 GET으로 존재 확인, 실패 시 사용 가능 모델 목록 로깅.
- **요청 구성**: `contents[0].parts = [참조 이미지들..., { text: 프롬프트 }]`.
  - 참조 이미지는 **최대 10장**(`Math.min(len,10)`). data URL prefix 제거 후 `inline_data{mime_type,data}`. MIME는 data URL에서 추출(없으면 png).
  - 총 이미지 20MB 초과/요청 20MB 초과 시 경고 로깅(500 위험).
  - `sessionType === 'ILLUSTRATION'`이면 이미 완성된 프롬프트를 그대로 사용, 아니면 훅 내부에서 다시 `buildPromptForSession`으로 감싼다(패널과 이중 안전장치).
  - `negativePrompt`가 있으면 프롬프트 끝에 `Avoid: ...` 추가.
- **generationConfig**: `responseModalities:['IMAGE']`, `imageConfig{aspectRatio,imageSize}`, 값 있을 때만 `seed`/`temperature`/`topK`/`topP`.
- **referenceStrength 미전달**: Gemini 공식 미지원이라 주석 처리(`useGeminiImageGenerator.ts:245`). UI 값은 무시된다.
- **응답 파싱**: `candidates[0].content.parts`에서 `inlineData.data`(base64)를 이미지로, `text`를 텍스트 응답으로. 이미지 없으면 throw. 패널은 이를 `data:image/jpeg;base64,`로 감싼다.

## OpenAI 생성 (useOpenAIImageGenerator)

- 참조 이미지가 없으면 `POST /v1/images/generations`(JSON), 있으면 `POST /v1/images/edits`(FormData, `image[]` 최대 10장).
- 요청 필드: `model: 'gpt-image-2'`, `prompt`, `size`(=`mapToOpenAISize(aspectRatio)`), `quality`(기본 medium), `n:1`.
- **응답 정규화**: `data[0].b64_json` 우선, 없으면 `data[0].url`을 fetch해 base64화(`fetchImageUrlToBase64`, 16KB 청크).
- **JPEG 통일**: gpt-image-2는 PNG로 응답하지만, 자동 저장이 `.jpg` 확장자를 쓰므로 `convertBase64ToJpeg`로 흰 배경 위에 합성 후 JPEG(0.92)로 변환해 `onComplete`. OS 썸네일 헤더/확장자 일치 목적.
- **에러 한국어화**(`formatOpenAIError`): `moderation_blocked`(안전 차단, Gemini 전환 권유)·`content_policy_violation`·401(키)·429(한도)·413/too large(용량) 등 상세 메시지.
- **`editWithMask`**: 사용자 마스크(흰=편집/검=보존)로 `/v1/images/edits` 부분 편집(생성기 본 플로우 외 부분 편집용).

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
| 참조 11장 이상인데 일부만 반영 | 두 API 모두 **최대 10장** 전송(`Math.min(len,10)`). 업로드는 14장까지 되지만 전송은 10장 |
| Gemini 500 에러 반복 | 참조/요청 페이로드 과대(20MB 경고). 이미지 수·해상도 축소 필요. 500은 5초 간격 2회 재시도 |
| gpt-image-2 결과가 항상 JPEG | PNG 응답을 `convertBase64ToJpeg`로 강제 JPEG화(썸네일 호환). 투명도는 흰 배경으로 합성됨 |
| OpenAI "안전 시스템 차단" | `moderation_blocked` — 참조/프롬프트 민감성. Gemini 전환 권유 메시지 |
| 드롭 시 이미지가 2장씩 추가 | 500ms 중복 방지(`lastDropTimeRef`)가 걸러줌. 미동작 시 여기 확인 |
| Ctrl+V가 텍스트만 붙음 | 클립보드에 이미지 item 없음. 이미지가 있으면 `preventDefault`로 이미지 우선 |
| 업로드 후 화질 저하 | 1280px/0.85 다운스케일(의도). 원본 유지 필요 시 `handleImageSelect`/paste 경로 조정 |
| referenceStrength 무효 | Gemini API 미전달(주석 처리), OpenAI 파라미터에도 없음 |
