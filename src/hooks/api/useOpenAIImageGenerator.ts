import { logger } from '../../lib/logger';
import {
  AspectRatioOption,
  ImageQualityOption,
  ImageSizeOption,
} from './imageModels';

interface OpenAIGenerationParams {
  prompt: string;
  aspectRatio?: AspectRatioOption;
  imageSize?: ImageSizeOption;
  quality?: ImageQualityOption;
  referenceImages?: string[];
}

interface OpenAIGenerationCallbacks {
  onProgress?: (status: string) => void;
  onComplete: (imageBase64: string, textResponse?: string) => void;
  onError: (error: Error) => void;
}

function mapToOpenAISize(aspectRatio: AspectRatioOption = '1:1'): string {
  if (aspectRatio === '16:9' || aspectRatio === '4:3') {
    return '1792x1024';
  }
  if (aspectRatio === '9:16' || aspectRatio === '3:4') {
    return '1024x1792';
  }
  return '1024x1024';
}

function mapQuality(quality?: ImageQualityOption): 'low' | 'medium' | 'high' {
  return quality ?? 'medium';
}

function extractBase64FromImagesPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const obj = payload as Record<string, unknown>;

  const directData = obj.data as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(directData) && directData[0]) {
    const first = directData[0];
    const b64 = first.b64_json;
    if (typeof b64 === 'string' && b64.length > 0) {
      return b64;
    }
  }

  return null;
}

async function fetchImageUrlToBase64(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`이미지 URL 로딩 실패 (${response.status})`);
  }

  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  // Chunking to avoid stack/argument limits.
  const chunkSize = 0x4000; // 16KB
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(bytes.length, i + chunkSize));
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

function dataUrlToBlob(dataUrl: string): Blob {
  const matches = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!matches) {
    throw new Error('유효하지 않은 Data URL 형식입니다');
  }
  const mimeType = matches[1];
  const base64 = matches[2];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

export function useOpenAIImageGenerator() {
  const generateImage = async (
    apiKey: string,
    params: OpenAIGenerationParams,
    callbacks: OpenAIGenerationCallbacks
  ) => {
    try {
      const cleanApiKey = apiKey.trim();
      if (!cleanApiKey) {
        throw new Error('OpenAI API Key가 비어있습니다');
      }

      callbacks.onProgress?.('OpenAI 이미지 생성 요청 중...');

      const size = mapToOpenAISize(params.aspectRatio);
      const quality = mapQuality(params.quality);

      const requestBody = {
        model: 'gpt-image-2',
        prompt: params.prompt,
        size,
        quality,
        n: 1,
      };

      const hasReferenceImages = (params.referenceImages?.length ?? 0) > 0;
      let response: Response;
      if (hasReferenceImages && params.referenceImages) {
        const formData = new FormData();
        formData.append('model', 'gpt-image-2');
        formData.append('prompt', params.prompt);
        formData.append('size', size);
        formData.append('quality', quality);
        formData.append('n', '1');

        const maxImages = Math.min(params.referenceImages.length, 10);
        for (let i = 0; i < maxImages; i++) {
          const blob = dataUrlToBlob(params.referenceImages[i]);
          formData.append('image[]', blob, `reference-${i + 1}.png`);
        }

        response = await fetch('https://api.openai.com/v1/images/edits', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${cleanApiKey}`,
          },
          body: formData,
        });
      } else {
        response = await fetch('https://api.openai.com/v1/images/generations', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${cleanApiKey}`,
          },
          body: JSON.stringify(requestBody),
        });
      }

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('❌ OpenAI API 오류:', response.status, errorText);
        throw new Error(`OpenAI API 오류 (${response.status}): ${errorText}`);
      }

      callbacks.onProgress?.('OpenAI가 이미지를 생성하고 있습니다...');

      const result = await response.json();
      let imageBase64 = extractBase64FromImagesPayload(result);
      if (!imageBase64) {
        const url = (result as any)?.data?.[0]?.url;
        if (typeof url === 'string' && url.length > 0) {
          imageBase64 = await fetchImageUrlToBase64(url);
        }
      }
      if (!imageBase64) {
        throw new Error('OpenAI 응답에서 이미지 데이터를 찾을 수 없습니다 (b64_json 또는 url)');
      }

      callbacks.onComplete(imageBase64);
    } catch (error) {
      callbacks.onError(error instanceof Error ? error : new Error(String(error)));
    }
  };

  return { generateImage };
}
