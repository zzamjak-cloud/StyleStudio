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

export function mapToOpenAISize(aspectRatio: AspectRatioOption = '1:1'): string {
  if (aspectRatio === '16:9' || aspectRatio === '4:3' || aspectRatio === '3:1') {
    return '1792x1024';
  }
  if (aspectRatio === '9:16' || aspectRatio === '3:4' || aspectRatio === '1:3') {
    return '1024x1792';
  }
  return '1024x1024';
}

function mapQuality(quality?: ImageQualityOption): 'low' | 'medium' | 'high' {
  return quality ?? 'medium';
}

interface ExtractedImagePayload {
  base64: string;
  mimeType: string;
}

function extractBase64FromImagesPayload(payload: unknown): ExtractedImagePayload | null {
  if (!payload || typeof payload !== 'object') return null;
  const obj = payload as Record<string, unknown>;

  const directData = obj.data as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(directData) && directData[0]) {
    const first = directData[0];
    const b64 = first.b64_json;
    if (typeof b64 === 'string' && b64.length > 0) {
      // gpt-image-2는 별도 mime_type을 반환하지 않으므로 PNG로 가정
      const mimeType = typeof first.mime_type === 'string' ? (first.mime_type as string) : 'image/png';
      return { base64: b64, mimeType };
    }
  }

  return null;
}

// gpt-image-2는 PNG로 응답하지만 채팅 자동 저장이 .jpg 확장자를 사용하므로
// Gemini와 동일한 "내부 표준 JPEG"로 통일하여 OS 썸네일 생성을 보장
async function convertBase64ToJpeg(base64: string, sourceMime: string): Promise<string> {
  const sourceDataUrl = `data:${sourceMime};base64,${base64}`;
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('이미지 디코딩 실패'));
    image.src = sourceDataUrl;
  });

  const width = img.naturalWidth || img.width;
  const height = img.naturalHeight || img.height;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas 2D 컨텍스트 생성 실패');
  }
  // JPEG는 알파 채널을 지원하지 않으므로 흰색 배경 위에 합성
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);

  const jpegDataUrl = canvas.toDataURL('image/jpeg', 0.92);
  const commaIndex = jpegDataUrl.indexOf(',');
  if (commaIndex === -1) {
    throw new Error('JPEG 변환 결과가 유효하지 않습니다');
  }
  return jpegDataUrl.slice(commaIndex + 1);
}

async function fetchImageUrlToBase64(url: string): Promise<ExtractedImagePayload> {
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

  const mimeType = response.headers.get('content-type') ?? 'image/png';
  return { base64: btoa(binary), mimeType };
}

// OpenAI API 에러 응답을 사용자에게 친절한 한국어 메시지로 변환
function formatOpenAIError(status: number, errorText: string): string {
  let parsed: { error?: { code?: string; message?: string; type?: string } } | null = null;
  try {
    parsed = JSON.parse(errorText);
  } catch {
    // 파싱 실패 — raw 텍스트 그대로 사용
  }
  const code = parsed?.error?.code;
  const type = parsed?.error?.type;
  const rawMessage = parsed?.error?.message ?? errorText;

  if (code === 'moderation_blocked') {
    return [
      '🚫 OpenAI(덕테이프) 안전 시스템이 이번 요청을 차단했습니다.',
      '',
      '가능한 원인:',
      '• 참조 이미지에 어린이/민감한 인물 묘사가 포함된 경우 (gpt-image-2는 매우 보수적)',
      '• 폭력·성적·차별적 키워드가 프롬프트에 포함된 경우',
      '• 실존 인물·캐릭터의 사실적 재현 시도',
      '',
      '대안:',
      '• 나노바나나 프로(Gemini) 모델로 전환하여 다시 시도',
      '• 참조 이미지를 보다 일반적인 스타일로 교체',
      '• 프롬프트의 단어를 다듬어 재시도',
    ].join('\n');
  }
  if (code === 'content_policy_violation') {
    return '🚫 콘텐츠 정책 위반으로 요청이 거부되었습니다. 프롬프트나 참조 이미지를 조정한 뒤 다시 시도하세요.';
  }
  if (status === 401) {
    return '🔑 OpenAI API Key가 올바르지 않거나 만료되었습니다. 설정에서 키를 확인하세요.';
  }
  if (status === 429) {
    return '⏳ OpenAI 사용량 한도를 초과했거나 요청이 너무 많습니다. 잠시 후 다시 시도하세요.';
  }
  if (status === 413 || (typeof rawMessage === 'string' && /too large|payload/i.test(rawMessage))) {
    return '📦 전송한 이미지 용량이 OpenAI 한도를 초과했습니다. 참조 이미지 수를 줄이거나 해상도를 낮춰 재시도하세요.';
  }
  return `OpenAI API 오류 (${status}${type ? ` · ${type}` : ''}): ${rawMessage}`;
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

interface OpenAIEditParams {
  prompt: string;
  baseImage: string; // data URL or base64 (jpeg/png)
  maskImage: string; // data URL (PNG with binary mask: white=edit, black=preserve)
  size?: string;     // OpenAI size string. 미지정 시 baseImage 크기에 맞춰 결정
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
        throw new Error(formatOpenAIError(response.status, errorText));
      }

      callbacks.onProgress?.('OpenAI가 이미지를 생성하고 있습니다...');

      const result = await response.json();
      let extracted = extractBase64FromImagesPayload(result);
      if (!extracted) {
        const url = (result as any)?.data?.[0]?.url;
        if (typeof url === 'string' && url.length > 0) {
          extracted = await fetchImageUrlToBase64(url);
        }
      }
      if (!extracted) {
        throw new Error('OpenAI 응답에서 이미지 데이터를 찾을 수 없습니다 (b64_json 또는 url)');
      }

      // 채팅/일러스트 자동 저장은 .jpg 확장자를 사용하므로 PNG 응답을 JPEG로 통일.
      // (OS 썸네일 생성기가 헤더와 확장자 일치를 요구함)
      callbacks.onProgress?.('JPEG로 변환 중...');
      const jpegBase64 = await convertBase64ToJpeg(extracted.base64, extracted.mimeType);
      callbacks.onComplete(jpegBase64);
    } catch (error) {
      callbacks.onError(error instanceof Error ? error : new Error(String(error)));
    }
  };

  // 사용자 어노테이션 마스크와 함께 OpenAI /v1/images/edits API로 부분 편집
  const editWithMask = async (
    apiKey: string,
    params: OpenAIEditParams,
    callbacks: OpenAIGenerationCallbacks
  ) => {
    try {
      const cleanApiKey = apiKey.trim();
      if (!cleanApiKey) {
        throw new Error('OpenAI API Key가 비어있습니다');
      }

      callbacks.onProgress?.('OpenAI 부분 편집 요청 중...');

      const baseDataUrl = params.baseImage.startsWith('data:')
        ? params.baseImage
        : `data:image/jpeg;base64,${params.baseImage}`;

      const formData = new FormData();
      formData.append('model', 'gpt-image-2');
      formData.append('prompt', params.prompt);
      if (params.size) formData.append('size', params.size);
      formData.append('n', '1');
      formData.append('image', dataUrlToBlob(baseDataUrl), 'base.png');
      formData.append('mask', dataUrlToBlob(params.maskImage), 'mask.png');

      const response = await fetch('https://api.openai.com/v1/images/edits', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cleanApiKey}`,
        },
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('❌ OpenAI 편집 API 오류:', response.status, errorText);
        throw new Error(formatOpenAIError(response.status, errorText));
      }

      callbacks.onProgress?.('편집 결과를 처리 중...');

      const result = await response.json();
      let extracted = extractBase64FromImagesPayload(result);
      if (!extracted) {
        const url = (result as any)?.data?.[0]?.url;
        if (typeof url === 'string' && url.length > 0) {
          extracted = await fetchImageUrlToBase64(url);
        }
      }
      if (!extracted) {
        throw new Error('OpenAI 편집 응답에서 이미지 데이터를 찾을 수 없습니다');
      }

      callbacks.onProgress?.('JPEG로 변환 중...');
      const jpegBase64 = await convertBase64ToJpeg(extracted.base64, extracted.mimeType);
      callbacks.onComplete(jpegBase64);
    } catch (error) {
      callbacks.onError(error instanceof Error ? error : new Error(String(error)));
    }
  };

  return { generateImage, editWithMask };
}
