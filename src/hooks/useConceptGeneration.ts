import { useState, useCallback } from 'react';
import { ConceptSessionData } from '../types/concept';
import { useGeminiImageGenerator, ImageGenerationModel } from './api/useGeminiImageGenerator';

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
  const { generateImage } = useGeminiImageGenerator();

  const generateConcept = useCallback(async (params: ConceptGenerationParams): Promise<ConceptGenerationResult> => {
    if (!apiKey.trim()) {
      throw new Error('API 키가 비어 있습니다. 설정에서 API 키를 확인해주세요.');
    }

    setIsGenerating(true);

    try {
      // 프롬프트 자동 구성
      let finalPrompt = params.prompt;

      if (!finalPrompt) {
        // 사용자가 프롬프트를 입력하지 않은 경우 자동 생성
        const promptParts: string[] = [];

        // 게임 장르
        if (params.gameGenres.length > 0) {
          promptParts.push(`${params.gameGenres.join(', ')} 게임 컨셉 아트`);
        }

        // 게임 플레이 방식
        if (params.gamePlayStyle) {
          promptParts.push(`게임 플레이: ${params.gamePlayStyle}`);
        }

        // 레퍼런스 게임
        if (params.referenceGames && params.referenceGames.length > 0) {
          promptParts.push(`${params.referenceGames.join(', ')} 스타일 참고`);
        }

        // 아트 스타일
        if (params.artStyles.length > 0) {
          promptParts.push(`${params.artStyles.join(', ')} 아트 스타일`);
        }

        // 기본 프롬프트
        if (promptParts.length === 0) {
          promptParts.push('모바일 게임 컨셉 아트');
        }

        finalPrompt = promptParts.join(', ');
      }

      // 그리드 설정에 따른 프롬프트 수정
      if (params.settings.grid !== '1x1') {
        const gridCount = params.settings.grid.split('x').map(Number)[0];
        const variations = gridCount * gridCount;
        finalPrompt += `, ${variations}개의 다양한 베리에이션`;
      }

      const modelMap: Record<ConceptSessionData['generationSettings']['model'], ImageGenerationModel> = {
        'nanobanana-pro': 'gemini-3-pro-image-preview',
        'nanobanana-2': 'gemini-3.1-flash-image-preview',
      };
      const sizeMap: Record<ConceptSessionData['generationSettings']['size'], '1K' | '2K' | '4K'> = {
        '1k': '1K',
        '2k': '2K',
        // 앱 UI의 3k 옵션은 공용 이미지 훅 규격에 맞춰 4K로 매핑
        '3k': '4K',
      };

      const imageBase64 = await new Promise<string>((resolve, reject) => {
        void generateImage(
          apiKey,
          {
            prompt: finalPrompt,
            referenceImages: params.referenceImage ? [params.referenceImage] : [],
            aspectRatio: params.settings.ratio,
            imageSize: sizeMap[params.settings.size],
            sessionType: 'CONCEPT',
            imageModel: modelMap[params.settings.model],
            temperature: 0.8,
            topK: 40,
            topP: 0.95,
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