import { useState, useCallback } from 'react';
import { ConceptSessionData } from '../types/concept';
import { useImageGenerator } from './api/useImageGenerator';
import { normalizeImageModelId } from './api/imageModels';
import { buildConceptBasePrompt, CONCEPT_SIZE_MAP } from '../lib/prompts/conceptPrompt';

interface ConceptGenerationParams {
  prompt: string;
  referenceImage?: string;
  gameGenres: string[];
  gamePlayStyle?: string;
  referenceGames?: string[];
  artStyles: string[];
  settings: ConceptSessionData['generationSettings'];
}

interface ConceptGenerationResult {
  prompt: string;
  imageBase64: string;
}

/** 컨셉 이미지 생성 훅 */
export function useConceptGeneration(apiKey: string) {
  const [isGenerating, setIsGenerating] = useState(false);
  const { generateImage } = useImageGenerator();

  const generateConcept = useCallback(async (params: ConceptGenerationParams): Promise<ConceptGenerationResult> => {
    setIsGenerating(true);

    try {
      // 프롬프트 자동 구성 + 그리드 베리에이션 (MCP 서버와 공유 — lib/prompts/conceptPrompt.ts)
      const finalPrompt = buildConceptBasePrompt({
        prompt: params.prompt,
        gameGenres: params.gameGenres,
        gamePlayStyle: params.gamePlayStyle,
        referenceGames: params.referenceGames,
        artStyles: params.artStyles,
        grid: params.settings.grid,
      });

      const selectedModel = normalizeImageModelId(params.settings.model);
      if (!apiKey.trim()) {
        throw new Error('OpenRouter API 키가 비어 있습니다. 설정에서 API 키를 확인해주세요.');
      }

      const imageBase64 = await new Promise<string>((resolve, reject) => {
        void generateImage(
          apiKey,
          {
            prompt: finalPrompt,
            referenceImages: params.referenceImage ? [params.referenceImage] : [],
            aspectRatio: params.settings.ratio,
            imageSize: CONCEPT_SIZE_MAP[params.settings.size],
            quality: params.settings.quality ?? 'medium',
            sessionType: 'CONCEPT',
            imageModel: selectedModel,
          },
          {
            onComplete: (generatedImageBase64) => {
              resolve(`data:image/jpeg;base64,${generatedImageBase64}`);
            },
            onError: (error) => {
              reject(error);
            },
          }
        );
      });

      return {
        prompt: finalPrompt,
        imageBase64
      };
    } finally {
      setIsGenerating(false);
    }
  }, [apiKey, generateImage]);

  return {
    isGenerating,
    generateConcept
  };
}