// 이미지 생성 모델 카탈로그 — OpenRouter Image API(/api/v1/images) 슬러그 기준.
// 모델별 지원 파라미터는 https://openrouter.ai/api/v1/images/models 응답을 따른다.
// (Gemini 계열: aspect_ratio·resolution·input_references / gpt-image-2: aspect_ratio·quality·input_references)
// seed·temperature·topK·topP·마스크 편집은 OpenRouter Image API가 지원하지 않아 제거되었다.

export type AspectRatioOption = '1:1' | '16:9' | '9:16' | '4:3' | '3:4';
export type ImageSizeOption = '1K' | '2K' | '4K';
export type ImageQualityOption = 'low' | 'medium' | 'high';

export type ImageGenerationModel =
  | 'google/gemini-3-pro-image-preview'
  | 'google/gemini-3.1-flash-image-preview'
  | 'google/gemini-3.1-flash-lite-image'
  | 'openai/gpt-image-2';

export type GeminiImageGenerationModel =
  | 'google/gemini-3-pro-image-preview'
  | 'google/gemini-3.1-flash-image-preview'
  | 'google/gemini-3.1-flash-lite-image';

export interface ImageModelDefinition {
  id: ImageGenerationModel;
  label: string;
  provider: 'gemini' | 'openai';
  supports: {
    aspectRatios: AspectRatioOption[];
    imageSizes: ImageSizeOption[];
    qualities: ImageQualityOption[];
  };
}

// OpenRouter에서 모든 모델이 표준 5종 비율을 지원한다 (극단 비율 1:3/3:1은 미지원으로 제거)
const STANDARD_ASPECT_RATIOS: AspectRatioOption[] = ['1:1', '16:9', '9:16', '4:3', '3:4'];

export const IMAGE_MODELS: ImageModelDefinition[] = [
  {
    id: 'google/gemini-3-pro-image-preview',
    label: '나노바나나 프로',
    provider: 'gemini',
    supports: {
      aspectRatios: STANDARD_ASPECT_RATIOS,
      imageSizes: ['1K', '2K', '4K'],
      qualities: ['medium'],
    },
  },
  {
    id: 'google/gemini-3.1-flash-image-preview',
    label: '나노바나나2',
    provider: 'gemini',
    supports: {
      aspectRatios: STANDARD_ASPECT_RATIOS,
      imageSizes: ['1K', '2K', '4K'],
      qualities: ['medium'],
    },
  },
  {
    id: 'google/gemini-3.1-flash-lite-image',
    label: '나노바나나 2 라이트',
    provider: 'gemini',
    supports: {
      aspectRatios: STANDARD_ASPECT_RATIOS,
      // OpenRouter 기준 라이트 모델은 1K만 지원
      imageSizes: ['1K'],
      qualities: ['medium'],
    },
  },
  {
    id: 'openai/gpt-image-2',
    label: '덕테이프',
    provider: 'openai',
    supports: {
      aspectRatios: STANDARD_ASPECT_RATIOS,
      imageSizes: ['1K'],
      qualities: ['low', 'medium', 'high'],
    },
  },
];

export const GEMINI_IMAGE_MODELS = IMAGE_MODELS.filter(
  (model): model is ImageModelDefinition & { id: GeminiImageGenerationModel } => model.provider === 'gemini'
);

export const DEFAULT_IMAGE_MODEL: GeminiImageGenerationModel = 'google/gemini-3-pro-image-preview';

/**
 * TILEMAP 세션 고정 모델 — 덕테이프(gpt-image-2).
 *
 * 타일맵은 프롬프트가 요구하는 **레이아웃**을 정확히 지켜야 한다(변형 모드는 NxN 그리드,
 * 룰타일 모드는 머티리얼 시트 3패널). 나노바나나 계열은 이 레이아웃을 자주 무시해
 * 사용할 수 없는 결과를 내지만 덕테이프는 거의 실수 없이 지킨다. 그래서 모델 선택을
 * 없애고 이 값으로 고정한다 — `GeneratorSettings`도 TILEMAP에서 모델 드롭다운을 숨긴다.
 */
export const TILEMAP_FIXED_IMAGE_MODEL: ImageGenerationModel = 'openai/gpt-image-2';

/** OpenRouter 이전(v0.5.x 이하)에 저장된 모델 ID → 현재 슬러그 매핑 */
const LEGACY_MODEL_ID_MAP: Record<string, ImageGenerationModel> = {
  'gemini-3-pro-image-preview': 'google/gemini-3-pro-image-preview',
  'gemini-3.1-flash-image-preview': 'google/gemini-3.1-flash-image-preview',
  'gemini-3.1-flash-lite-image': 'google/gemini-3.1-flash-lite-image',
  'gpt-image-2': 'openai/gpt-image-2',
};

/** 세션/히스토리에 저장된 (레거시 포함) 모델 ID를 현재 슬러그로 정규화 */
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

/** OpenRouter 통합 키 하나로 모든 모델을 쓸 수 있으므로 필터 없이 전체 반환 */
export function getAvailableImageModels(): ImageModelDefinition[] {
  return IMAGE_MODELS;
}
