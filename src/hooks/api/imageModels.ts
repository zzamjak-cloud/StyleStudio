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
    },
  },
  /*
    아래 두 모델은 **OpenRouter 미등재**라 `pending`이다 (2026-09-09 확인).
    OpenAI 직접 API에는 `gpt-image-2.5-flare` / `gpt-image-2.5-sunburst`로 존재하며 품질 티어에
    xhigh·max가 추가됐다. 등재되면 다음을 **반드시 실측으로 확인하고** 값을 맞춘 뒤 `available`로
    바꾼다 — OpenRouter는 파라미터를 자체 정규화하므로 OpenAI 문서와 다를 수 있다:
      curl -s https://openrouter.ai/api/v1/images/models | jq '.data[] | select(.id|test("2.5"))'
    확인 항목: aspect_ratio enum · quality enum(xhigh/max 노출 여부) · n 상한 · input_references 상한.
  */
  {
    id: 'openai/gpt-image-2.5-flare',
    label: '덕테이프 2.5 플레어',
    provider: 'openai',
    availability: 'pending',
    annotationMode: 'composite',
    supports: {
      aspectRatios: GPT_IMAGE_ASPECT_RATIOS,
      imageSizes: ['1K'],
      qualities: ['low', 'medium', 'high', 'xhigh', 'max'],
      maxReferenceImages: 16,
      maxImagesPerRequest: 10,
    },
  },
  {
    id: 'openai/gpt-image-2.5-sunburst',
    label: '덕테이프 2.5 선버스트',
    provider: 'openai',
    availability: 'pending',
    annotationMode: 'composite',
    supports: {
      aspectRatios: GPT_IMAGE_ASPECT_RATIOS,
      imageSizes: ['1K'],
      qualities: ['low', 'medium', 'high', 'xhigh', 'max'],
      maxReferenceImages: 16,
      maxImagesPerRequest: 10,
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
 * 정확히 지키고**(타일맵을 이 모델로 고정한 이유와 같다) 세부 묘사도 앞선다. 이 상수 하나가
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
 * 2.5 계열이 등재되면 여기도 후보다. 다만 **실측 없이 바꾸지 말 것** — 이 값은 실제 생성
 * 결과로 정해졌고, 레이아웃 준수에 실패하면 타일 세트가 통째로 못 쓰게 된다.
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
