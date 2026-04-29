export type AspectRatioOption = '1:1' | '16:9' | '9:16' | '4:3' | '3:4' | '1:3' | '3:1';
export type ImageSizeOption = '1K' | '2K' | '4K';
export type ImageQualityOption = 'low' | 'medium' | 'high';

export type ImageGenerationModel =
  | 'gemini-3-pro-image-preview'
  | 'gemini-3.1-flash-image-preview'
  | 'gpt-image-2';

export type GeminiImageGenerationModel =
  | 'gemini-3-pro-image-preview'
  | 'gemini-3.1-flash-image-preview';

export interface ImageModelDefinition {
  id: ImageGenerationModel;
  label: string;
  provider: 'gemini' | 'openai';
  supports: {
    aspectRatios: AspectRatioOption[];
    imageSizes: ImageSizeOption[];
    qualities: ImageQualityOption[];
    geminiAdvancedControls: boolean;
  };
}

// Gemini는 표준 5종 + 극단적 비율 2종(1:3 세로 배너, 3:1 가로 파노라마) 지원
const GEMINI_ASPECT_RATIOS: AspectRatioOption[] = ['1:1', '16:9', '9:16', '4:3', '3:4', '1:3', '3:1'];
const OPENAI_ASPECT_RATIOS: AspectRatioOption[] = ['1:1', '16:9', '9:16'];

export const IMAGE_MODELS: ImageModelDefinition[] = [
  {
    id: 'gemini-3-pro-image-preview',
    label: '나노바나나 프로',
    provider: 'gemini',
    supports: {
      aspectRatios: GEMINI_ASPECT_RATIOS,
      imageSizes: ['1K', '2K', '4K'],
      qualities: ['medium'],
      geminiAdvancedControls: true,
    },
  },
  {
    id: 'gemini-3.1-flash-image-preview',
    label: '나노바나나2',
    provider: 'gemini',
    supports: {
      aspectRatios: GEMINI_ASPECT_RATIOS,
      imageSizes: ['1K', '2K', '4K'],
      qualities: ['medium'],
      geminiAdvancedControls: true,
    },
  },
  {
    id: 'gpt-image-2',
    label: '덕테이프',
    provider: 'openai',
    supports: {
      aspectRatios: OPENAI_ASPECT_RATIOS,
      imageSizes: ['1K'],
      qualities: ['low', 'medium', 'high'],
      geminiAdvancedControls: false,
    },
  },
];

export const GEMINI_IMAGE_MODELS = IMAGE_MODELS.filter(
  (model): model is ImageModelDefinition & { id: GeminiImageGenerationModel } => model.provider === 'gemini'
);

export const DEFAULT_IMAGE_MODEL: GeminiImageGenerationModel = 'gemini-3-pro-image-preview';

export function getImageModelDefinition(modelId: ImageGenerationModel): ImageModelDefinition {
  return IMAGE_MODELS.find((model) => model.id === modelId) ?? IMAGE_MODELS[0];
}

export function isOpenAIModel(modelId: ImageGenerationModel): boolean {
  return getImageModelDefinition(modelId).provider === 'openai';
}

export function getAvailableImageModels(hasOpenAIApiKey: boolean): ImageModelDefinition[] {
  return hasOpenAIApiKey ? IMAGE_MODELS : GEMINI_IMAGE_MODELS;
}
