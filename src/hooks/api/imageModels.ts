// 이미지 생성 모델 카탈로그 — OpenRouter Image API(/api/v1/images) 슬러그 기준.
//
// **모델별 지원 파라미터는 추측하지 말고 https://openrouter.ai/api/v1/images/models 응답을 그대로 옮긴다.**
// 예전에는 전 모델에 최소공통 5종 비율만 열어 뒀는데, 실제로는 모델마다 지원 범위가 크게 다르고
// 특히 덕테이프(gpt-image-2)가 가장 넓다. 최소공통으로 깎으면 주력 모델의 기능을 못 쓰게 된다.
//
// 2026-09-09 실측(OpenRouter `supported_parameters`):
//   openai/gpt-image-2      aspect_ratio 9종(+auto) · quality auto/low/medium/high · background auto|opaque
//                           · n 1~10 · input_references 0~16 · output_compression · streaming ✓ · resolution ✗
//   gemini-3-pro-image      aspect_ratio 10종 · resolution 1K/2K/4K · n 1 고정 · input_references 0~14
//   gemini-3.1-flash-image  aspect_ratio 14종(1:4·1:8·4:1·8:1 포함) · resolution 512/1K/2K/4K · n 1 · refs 0~14
//   gemini-3.1-flash-lite   aspect_ratio 14종 · resolution 1K · n 1 · refs 0~14
//
// **마스크/인페인팅은 어떤 모델도 지원하지 않는다.** OpenRouter Image API에는 mask 필드가 없고
// `/api/v1/images/edits` 엔드포인트 자체가 존재하지 않는다(2026-09-09 확인). 부분 편집을 어떻게
// 처리하는지는 `AnnotationMode` 주석 참조.
// seed·temperature·topK·topP도 이 4개 모델의 supported_parameters에 없어 전달하지 않는다.

/**
 * 노출하는 비율 집합.
 *
 * OpenRouter가 flash 계열에 열어 주는 초극단 비율(1:4·1:8·4:1·8:1)은 넣지 않았다 — 일부 모델만
 * 지원해 모델을 바꿀 때마다 선택이 튕기고, 게임 아트 용도에서 쓰임새가 드물다. 필요해지면
 * 해당 모델의 `aspectRatios`에만 추가하면 된다(UI는 데이터를 따라간다).
 */
export type AspectRatioOption =
  | '1:1'
  | '3:2'
  | '2:3'
  | '4:3'
  | '3:4'
  | '4:5'
  | '5:4'
  | '16:9'
  | '9:16'
  | '21:9';

export type ImageSizeOption = '1K' | '2K' | '4K';

/**
 * 품질 티어. `xhigh`·`max`는 gpt-image-2.5 계열에서 추가된 값이다.
 * 모델이 지원하지 않는 값은 `supports.qualities`에 없으므로 UI에 뜨지 않는다.
 */
export type ImageQualityOption = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/**
 * 부분 편집(어노테이션)을 모델에 전달하는 방식.
 *
 * 마스크 인페인팅은 OpenRouter에 없으므로 두 방식 다 "프롬프트로 영역을 알려주는" 우회다.
 * 어느 쪽이 통하는지는 **모델 계열마다 다르다.**
 *
 * - `coordinates` (나노바나나/Gemini): 색상 마커가 그려진 합성본을 reference로 주면 결과물이
 *   그 마커를 **그대로 모방해 그린다.** 그래서 깨끗한 원본만 보내고 stroke의 bounding box를
 *   정규화 좌표(가로/세로 %) 텍스트로 직렬화해 전달한다. 마커를 "보여주지 않는" 대신 위치
 *   정확도를 잃는 거래다.
 * - `composite` (덕테이프/gpt-image 계열): 지시 준수도가 높아 합성본을 직접 줄 수 있다.
 *   "색상 마커는 편집할 영역을 가리키는 표시일 뿐이니 결과에 그리지 말라"는 지시가 통하므로,
 *   모델이 편집 영역을 **픽셀 단위로** 본다 — 좌표 텍스트보다 훨씬 정확하다. 좌표 직렬화도
 *   보조로 함께 보내 지시를 이중화한다.
 *
 * 어느 쪽이든 마스크 밖 보존은 모델의 지시 준수에 달려 있다(API가 강제해 주지 않는다).
 */
export type AnnotationMode = 'composite' | 'coordinates';

/**
 * 카탈로그 등재 상태.
 *
 * `pending`은 **모델은 존재하지만 OpenRouter에 아직 등재되지 않은** 상태다. 정의를 미리 넣어
 * 두고 UI에서만 감춘다 — 등재되는 날 이 한 값을 `available`로 바꾸면 드롭다운·비율·품질이
 * 전부 따라온다. `getAvailableImageModels()`가 이 값을 걸러낸다.
 */
export type ModelAvailability = 'available' | 'pending';

export type ImageGenerationModel =
  | 'google/gemini-3-pro-image-preview'
  | 'google/gemini-3.1-flash-image-preview'
  | 'google/gemini-3.1-flash-lite-image'
  | 'openai/gpt-image-2'
  | 'openai/gpt-image-2.5-flare'
  | 'openai/gpt-image-2.5-sunburst';

export type GeminiImageGenerationModel =
  | 'google/gemini-3-pro-image-preview'
  | 'google/gemini-3.1-flash-image-preview'
  | 'google/gemini-3.1-flash-lite-image';

export interface ImageModelDefinition {
  id: ImageGenerationModel;
  label: string;
  provider: 'gemini' | 'openai';
  /** `pending`이면 드롭다운에 뜨지 않는다 — 위 `ModelAvailability` 주석 참조 */
  availability: ModelAvailability;
  /** 부분 편집 전달 방식 — 위 `AnnotationMode` 주석 참조 */
  annotationMode: AnnotationMode;
  supports: {
    aspectRatios: AspectRatioOption[];
    /** `resolution` 파라미터가 없는 모델(gpt-image 계열)은 1K 한 종만 둔다 */
    imageSizes: ImageSizeOption[];
    qualities: ImageQualityOption[];
    /** OpenRouter `input_references` 상한 */
    maxReferenceImages: number;
    /** OpenRouter `n` 상한. 1이면 한 번에 한 장만 나온다 */
    maxImagesPerRequest: number;
    /**
     * OpenRouter `background: 'transparent'` 지원 여부 — 알파 PNG를 직접 받을 수 있는가.
     * gpt-image-2의 background enum은 `auto|opaque`뿐이라 2.5 계열만 true다.
     */
    transparentBackground: boolean;
  };
}

/** gpt-image 계열 공통 비율 (OpenRouter 실측). 'auto'는 사용자가 고를 값이 아니라 제외 */
const GPT_IMAGE_ASPECT_RATIOS: AspectRatioOption[] = [
  '1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16', '21:9',
];

/** Gemini 계열 공통 비율 (OpenRouter 실측, 초극단 비율 제외) */
const GEMINI_ASPECT_RATIOS: AspectRatioOption[] = [
  '1:1', '3:2', '2:3', '4:3', '3:4', '4:5', '5:4', '16:9', '9:16', '21:9',
];

export const IMAGE_MODELS: ImageModelDefinition[] = [
  {
    id: 'openai/gpt-image-2',
    label: '덕테이프',
    provider: 'openai',
    availability: 'available',
    annotationMode: 'composite',
    supports: {
      aspectRatios: GPT_IMAGE_ASPECT_RATIOS,
      // resolution 파라미터가 없다 — 실제 픽셀은 비율에서 결정된다
      imageSizes: ['1K'],
      qualities: ['low', 'medium', 'high'],
      maxReferenceImages: 16,
      maxImagesPerRequest: 10,
      transparentBackground: false,
    },
  },
  /*
    2026-09-12 OpenRouter 등재 확인 후 `available`로 전환 (`/api/v1/images/models` 실측):
      aspect_ratio  1:1 3:2 2:3 4:3 3:4 16:9 9:16 21:9 auto   → gpt-image-2와 동일
      quality       auto low medium high xhigh max            → xhigh·max 노출 확인
      background    auto transparent opaque                   → **2.5만 transparent 지원**
      n 1~10 · input_references 0~16 · output_compression 0~100 · streaming ✓ · resolution ✗
    두 티어는 파라미터가 완전히 같고 토큰 단가도 같다. 차이는 정밀(sunburst) vs 속도(flare)뿐.
    재확인: curl -s https://openrouter.ai/api/v1/images/models | jq '.data[] | select(.id|test("2.5"))'
  */
  {
    id: 'openai/gpt-image-2.5-flare',
    label: '덕테이프 2.5 플레어',
    provider: 'openai',
    availability: 'available',
    annotationMode: 'composite',
    supports: {
      aspectRatios: GPT_IMAGE_ASPECT_RATIOS,
      imageSizes: ['1K'],
      qualities: ['low', 'medium', 'high', 'xhigh', 'max'],
      maxReferenceImages: 16,
      maxImagesPerRequest: 10,
      transparentBackground: true,
    },
  },
  {
    id: 'openai/gpt-image-2.5-sunburst',
    label: '덕테이프 2.5 선버스트',
    provider: 'openai',
    availability: 'available',
    annotationMode: 'composite',
    supports: {
      aspectRatios: GPT_IMAGE_ASPECT_RATIOS,
      imageSizes: ['1K'],
      qualities: ['low', 'medium', 'high', 'xhigh', 'max'],
      maxReferenceImages: 16,
      maxImagesPerRequest: 10,
      transparentBackground: true,
    },
  },
  {
    id: 'google/gemini-3-pro-image-preview',
    label: '나노바나나 프로',
    provider: 'gemini',
    availability: 'available',
    annotationMode: 'coordinates',
    supports: {
      aspectRatios: GEMINI_ASPECT_RATIOS,
      imageSizes: ['1K', '2K', '4K'],
      qualities: ['medium'],
      maxReferenceImages: 14,
      maxImagesPerRequest: 1,
      transparentBackground: false,
    },
  },
  {
    id: 'google/gemini-3.1-flash-image-preview',
    label: '나노바나나2',
    provider: 'gemini',
    availability: 'available',
    annotationMode: 'coordinates',
    supports: {
      aspectRatios: GEMINI_ASPECT_RATIOS,
      imageSizes: ['1K', '2K', '4K'],
      qualities: ['medium'],
      maxReferenceImages: 14,
      maxImagesPerRequest: 1,
      transparentBackground: false,
    },
  },
  {
    id: 'google/gemini-3.1-flash-lite-image',
    label: '나노바나나 2 라이트',
    provider: 'gemini',
    availability: 'available',
    annotationMode: 'coordinates',
    supports: {
      aspectRatios: GEMINI_ASPECT_RATIOS,
      // OpenRouter 기준 라이트 모델은 1K만 지원
      imageSizes: ['1K'],
      qualities: ['medium'],
      maxReferenceImages: 14,
      maxImagesPerRequest: 1,
      transparentBackground: false,
    },
  },
];

export const GEMINI_IMAGE_MODELS = IMAGE_MODELS.filter(
  (model): model is ImageModelDefinition & { id: GeminiImageGenerationModel } => model.provider === 'gemini'
);

/**
 * 앱 전역 기본 이미지 모델 — 덕테이프(gpt-image-2).
 *
 * 나노바나나 프로에서 바꿨다. 덕테이프는 프롬프트가 요구하는 **레이아웃과 지시를 훨씬
 * 정확히 지키고**(타일맵을 이 모델로 고정한 이유와 같다) 세부 묘사도 앞선다.
 *
 * 2.5 계열이 파라미터상 상위 호환(xhigh·max, 투명 배경)이라 한때 기본값을 선버스트로
 * 옮겼지만, 실제 생성물에서 재질 스케일과 변형 랜덤성이 무너져 되돌렸다(근거는
 * `TILEMAP_FIXED_IMAGE_MODEL` 주석). 2.5는 드롭다운에 남아 있으니 필요한 작업에서
 * 사용자가 직접 고르면 된다. 이 상수 하나가
 * 새 세션(생성·대화형·컨셉)의 드롭다운 초기값과 `normalizeImageModelId`의 폴백을 함께
 * 정한다 — 세션별로 하드코딩해 두면 한 곳만 바꿨을 때 세션마다 기본값이 달라진다.
 *
 * **기존 세션은 저장된 모델을 그대로 유지한다.** 이 값은 새로 만드는 세션에만 적용된다.
 */
export const DEFAULT_IMAGE_MODEL: ImageGenerationModel = 'openai/gpt-image-2';

/**
 * TILEMAP 세션 고정 모델 — 덕테이프(gpt-image-2).
 *
 * 타일맵은 프롬프트가 요구하는 **레이아웃**을 정확히 지켜야 한다(변형 모드는 NxN 그리드,
 * 룰타일 모드는 머티리얼 시트 3패널). 나노바나나 계열은 이 레이아웃을 자주 무시해
 * 사용할 수 없는 결과를 내지만 덕테이프는 거의 실수 없이 지킨다. 그래서 모델 선택을
 * 없애고 이 값으로 고정한다 — `GeneratorSettings`도 TILEMAP에서 모델 드롭다운을 숨긴다.
 *
 * **2.5 선버스트로 올렸다가 2026-09-12에 되돌렸다.** 같은 gpt-image 계열이고 파라미터도
 * 동일하지만, 변형 세트를 실제로 뽑아 보니 두 가지가 무너졌다:
 *   1. **재질 스케일** — 참조 이미지를 줬는데도 같은 재질을 3~4배 확대한 것처럼 그렸다.
 *      잔돌 디테일이 뭉개져 타일로 쓸 밀도가 나오지 않는다.
 *   2. **변형 랜덤성** — 같은 형상(모서리 홈 등)이 8칸 전부 같은 위치에 반복됐다.
 *      변형 세트의 존재 이유가 사라진다.
 * 2.5를 다시 후보로 올리려면 이 두 가지를 실제 생성물로 먼저 확인할 것. 품질 티어를
 * 올리는 것만으로는 스케일 문제가 해결되지 않는다(티어가 아니라 구도 해석의 차이다).
 */
export const TILEMAP_FIXED_IMAGE_MODEL: ImageGenerationModel = 'openai/gpt-image-2';

/** OpenRouter 이전(v0.5.x 이하)에 저장된 모델 ID → 현재 슬러그 매핑 */
const LEGACY_MODEL_ID_MAP: Record<string, ImageGenerationModel> = {
  'gemini-3-pro-image-preview': 'google/gemini-3-pro-image-preview',
  'gemini-3.1-flash-image-preview': 'google/gemini-3.1-flash-image-preview',
  'gemini-3.1-flash-lite-image': 'google/gemini-3.1-flash-lite-image',
  'gpt-image-2': 'openai/gpt-image-2',
};

/**
 * 세션/히스토리에 저장된 (레거시 포함) 모델 ID를 현재 슬러그로 정규화.
 *
 * `pending` 모델도 통과시킨다 — 등재됐다가 되돌리는 순서에서 사용자가 고른 모델이 조용히
 * 기본값으로 바뀌지 않도록 하기 위해서다.
 */
export function normalizeImageModelId(modelId: string | undefined): ImageGenerationModel {
  if (!modelId) return DEFAULT_IMAGE_MODEL;
  if (IMAGE_MODELS.some((model) => model.id === modelId)) {
    return modelId as ImageGenerationModel;
  }
  return LEGACY_MODEL_ID_MAP[modelId] ?? DEFAULT_IMAGE_MODEL;
}

export function getImageModelDefinition(modelId: string): ImageModelDefinition {
  const normalized = normalizeImageModelId(modelId);
  return IMAGE_MODELS.find((model) => model.id === normalized) ?? IMAGE_MODELS[0];
}

export function isOpenAIModel(modelId: string): boolean {
  return getImageModelDefinition(modelId).provider === 'openai';
}

/**
 * 부분 편집(어노테이션)을 이 모델에 어떻게 전달해야 하는지.
 * 호출부가 provider를 직접 비교하지 않도록 판단을 여기 한 곳에 둔다 — 2.5 계열이 늘어나도
 * 호출부는 그대로다.
 */
export function getAnnotationMode(modelId: string): AnnotationMode {
  return getImageModelDefinition(modelId).annotationMode;
}

/**
 * 드롭다운에 띄울 모델 — OpenRouter 통합 키 하나로 다 쓸 수 있으므로 provider 필터는 없고,
 * **미등재(`pending`) 모델만** 걸러낸다.
 */
export function getAvailableImageModels(): ImageModelDefinition[] {
  return IMAGE_MODELS.filter((model) => model.availability === 'available');
}

/**
 * TILEMAP 세션에서 고를 수 있는 모델 — 덕테이프(gpt-image) 계열만.
 *
 * 나노바나나 계열은 타일맵이 요구하는 레이아웃(변형 NxN 그리드 / 룰타일 3패널)을 자주 무시해
 * 쓸 수 없는 결과를 낸다. 그래서 전체 목록 대신 이 목록을 준다 — 계열 안에서 2.0/2.5를
 * 비교해 볼 수는 있어야 하되, 레이아웃을 못 지키는 모델이 섞이면 안 된다.
 * 기본값은 `TILEMAP_FIXED_IMAGE_MODEL`(실제 생성물로 검증된 유일한 값).
 */
export function getTilemapImageModels(): ImageModelDefinition[] {
  return getAvailableImageModels().filter((model) => model.provider === 'openai');
}

/** TILEMAP에서 이 모델을 쓸 수 있는가 (히스토리 복원 등으로 들어온 값 방어용) */
export function isTilemapCompatibleModel(modelId: string): boolean {
  return getTilemapImageModels().some((model) => model.id === normalizeImageModelId(modelId));
}

/** `background: 'transparent'`를 직접 보낼 수 있는 모델인지 (알파 PNG 네이티브 생성) */
export function supportsTransparentBackground(modelId: string): boolean {
  return getImageModelDefinition(modelId).supports.transparentBackground;
}

/**
 * 모델이 지원하지 않는 품질이 저장돼 있으면 안전한 값으로 되돌린다.
 * 모델 교체(예: 2.5의 `max` → 나노바나나)로 API가 400을 내는 걸 막는다.
 */
export function normalizeImageQuality(
  modelId: string,
  quality: string | undefined
): ImageQualityOption {
  const { qualities } = getImageModelDefinition(modelId).supports;
  if (quality && qualities.includes(quality as ImageQualityOption)) {
    return quality as ImageQualityOption;
  }
  return qualities.includes('medium') ? 'medium' : qualities[0];
}
