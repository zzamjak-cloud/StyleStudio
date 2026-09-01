// OpenRouter Image API 기반 통합 이미지 생성 훅.
// 기존 useGeminiImageGenerator / useOpenAIImageGenerator 를 대체한다 — 모든 모델이
// 동일한 엔드포인트(/api/v1/images)를 사용하므로 provider 분기는 파라미터 매핑에만 남는다.

import { SessionType } from '../../types/session';
import { ReferenceDocument } from '../../types/referenceDocument';
import { logger } from '../../lib/logger';
import { PixelArtGridLayout } from '../../types/pixelart';
import { ImageAnalysisResult } from '../../types/analysis';
import { buildPromptForSession } from '../../lib/prompts/sessionPrompts';
import { generateImageViaOpenRouter } from '../../lib/api/openrouter';
import {
  AspectRatioOption,
  ImageGenerationModel,
  ImageQualityOption,
  ImageSizeOption,
  DEFAULT_IMAGE_MODEL,
  getImageModelDefinition,
  normalizeImageModelId,
} from './imageModels';

// 두 provider 모두 참조 이미지 14장까지 수용 (OpenRouter input_references 한도: gemini 14 / gpt 16)
const MAX_REFERENCE_IMAGES = 14;

export interface ImageGenerationParams {
  prompt: string; // 서술적 문장 권장
  referenceImages?: string[]; // base64/data URL 이미지 배열
  aspectRatio?: AspectRatioOption;
  imageSize?: ImageSizeOption; // Gemini 계열 전용 (resolution)
  quality?: ImageQualityOption; // gpt-image 계열 전용
  negativePrompt?: string; // 피해야 할 요소
  sessionType?: SessionType;
  analysis?: ImageAnalysisResult; // 이미지 분석 결과 (픽셀아트 해상도 추출용)
  pixelArtGrid?: PixelArtGridLayout; // 픽셀아트 그리드 레이아웃 (선택)
  referenceDocuments?: ReferenceDocument[]; // 참조 문서 (UI 세션 전용)
  imageModel?: ImageGenerationModel; // 이미지 생성 모델
}

export interface GenerationCallbacks {
  onProgress?: (status: string) => void;
  onComplete: (imageBase64: string, textResponse?: string) => void;
  onError: (error: Error) => void;
}

// PNG 응답을 내부 표준 JPEG로 통일 (저장 용량 절감 + 기존 저장/썸네일 파이프라인 유지).
// 투명 배경이 필요한 세션은 이후 단계(removeWhiteBackground)에서 흰색을 다시 걷어낸다.
export async function convertBase64ToJpeg(base64: string, sourceMime: string): Promise<string> {
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

// OpenRouter/업스트림 에러를 사용자 친화적 한국어 메시지로 변환
export function formatImageApiError(status: number, errorText: string): string {
  let parsed: { error?: { code?: string | number; message?: string } } | null = null;
  try {
    parsed = JSON.parse(errorText);
  } catch {
    // 파싱 실패 — raw 텍스트 그대로 사용
  }
  const rawMessage = parsed?.error?.message ?? errorText;

  if (status === 401) {
    return '🔑 OpenRouter API Key가 올바르지 않거나 만료되었습니다. 설정에서 키를 확인하세요.';
  }
  if (status === 402) {
    return '💳 OpenRouter 크레딧이 부족합니다. openrouter.ai에서 잔액을 확인하세요.';
  }
  if (status === 403 || /moderation|content_policy/i.test(rawMessage)) {
    return [
      '🚫 안전 시스템이 이번 요청을 차단했습니다.',
      '',
      '대안:',
      '• 참조 이미지를 보다 일반적인 스타일로 교체',
      '• 프롬프트의 단어를 다듬어 재시도',
      '• 다른 모델로 전환하여 다시 시도',
    ].join('\n');
  }
  if (status === 429) {
    return '⏳ 요청이 너무 많습니다. 잠시 후 다시 시도하세요.';
  }
  if (status === 413 || /too large|payload/i.test(rawMessage)) {
    return '📦 전송한 이미지 용량이 한도를 초과했습니다. 참조 이미지 수를 줄이거나 해상도를 낮춰 재시도하세요.';
  }
  return `이미지 생성 API 오류 (${status}): ${rawMessage}`;
}

export function useImageGenerator() {
  const generateImage = async (
    apiKey: string,
    params: ImageGenerationParams,
    callbacks: GenerationCallbacks
  ) => {
    // Retry 로직: 5xx 에러 시 최대 2번 재시도 (OpenRouter는 실패한 생성을 502로 반환)
    const MAX_RETRIES = 2;
    const RETRY_DELAY_MS = 5000;

    try {
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          if (attempt > 0) {
            logger.warn(`🔄 재시도 중... (${attempt}/${MAX_RETRIES})`);
            callbacks.onProgress?.(`재시도 중... (${attempt}/${MAX_RETRIES})`);
            await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
          }

          return await generateImageInternal(apiKey, params, callbacks);
        } catch (error) {
          const errorMessage = (error as Error).message;
          const isServerError = /\((?:5\d{2})\)/.test(errorMessage);

          // 5xx 에러가 아니거나 마지막 시도면 에러 던지기
          if (!isServerError || attempt === MAX_RETRIES) {
            throw error;
          }
          logger.warn(`⚠️ 서버 에러 발생. ${RETRY_DELAY_MS / 1000}초 후 재시도합니다...`);
        }
      }
    } catch (error) {
      logger.error('이미지 생성 오류:', error);
      callbacks.onError(
        error instanceof Error ? error : new Error('알 수 없는 오류가 발생했습니다')
      );
    }
  };

  const generateImageInternal = async (
    apiKey: string,
    params: ImageGenerationParams,
    callbacks: GenerationCallbacks
  ) => {
    const cleanApiKey = String(apiKey || '').trim();
    if (!cleanApiKey) {
      throw new Error('API Key가 비어있습니다');
    }

    const modelId = normalizeImageModelId(params.imageModel ?? DEFAULT_IMAGE_MODEL);
    const modelDef = getImageModelDefinition(modelId);

    logger.debug('🎨 이미지 생성 시작');
    logger.debug('   - 모델:', modelId);
    logger.debug('   - 프롬프트 길이:', params.prompt.length);
    logger.debug('   - 참조 이미지 개수:', params.referenceImages?.length || 0);
    logger.debug('   - 비율:', params.aspectRatio || '1:1');

    callbacks.onProgress?.('이미지 생성 요청 중...');

    // 참조 이미지 수집 (최대 14장)
    const hasReferenceImages = !!params.referenceImages && params.referenceImages.length > 0;
    const inputReferences = hasReferenceImages
      ? params.referenceImages!.slice(0, MAX_REFERENCE_IMAGES)
      : undefined;

    if (inputReferences) {
      const totalSizeKB = inputReferences.reduce(
        (sum, img) => sum + ((img.includes(',') ? img.split(',')[1] : img).length * 0.75) / 1024,
        0
      );
      logger.debug(`   - 참조 이미지 ${inputReferences.length}장, 총 ${totalSizeKB.toFixed(2)} KB`);
      if (totalSizeKB > 20000) {
        logger.warn('⚠️ 경고: 참조 이미지 크기가 매우 큽니다. 서버 에러가 발생할 수 있습니다.');
      }
    }

    // 프롬프트 구성 (참조 이미지가 있으면 일관성 강조)
    // ILLUSTRATION 세션은 ImageGeneratorPanel에서 이미 buildPromptForSession을 호출했으므로 재처리 안함
    let fullPrompt: string;
    if (params.sessionType === 'ILLUSTRATION') {
      fullPrompt = params.prompt;
    } else {
      fullPrompt = buildPromptForSession({
        basePrompt: params.prompt,
        hasReferenceImages,
        sessionType: params.sessionType,
        pixelArtGrid: params.pixelArtGrid,
        analysis: params.analysis,
        referenceDocuments: params.referenceDocuments,
      });
    }

    // Negative Prompt가 있으면 프롬프트에 명시 (Image API에 별도 필드 없음)
    if (params.negativePrompt && params.negativePrompt.trim()) {
      fullPrompt += `\n\nAvoid: ${params.negativePrompt}`;
    }

    callbacks.onProgress?.(`${modelDef.label} 모델이 이미지를 생성하고 있습니다...`);

    let generated;
    try {
      generated = await generateImageViaOpenRouter(cleanApiKey, {
        model: modelId,
        prompt: fullPrompt,
        aspectRatio: params.aspectRatio || '1:1',
        // Gemini 계열만 resolution 지원, gpt-image 계열만 quality 지원
        resolution: modelDef.provider === 'gemini' ? params.imageSize || '2K' : undefined,
        quality: modelDef.provider === 'openai' ? params.quality ?? 'medium' : undefined,
        inputReferences,
      });
    } catch (error) {
      // "API 오류 (status): body" 형식에서 status 추출 후 사용자 메시지로 변환
      const message = (error as Error).message ?? String(error);
      const statusMatch = message.match(/\((\d{3})\)/);
      if (statusMatch) {
        const status = parseInt(statusMatch[1], 10);
        // 5xx는 재시도 로직이 원본 메시지 형식에 의존하므로 그대로 전달
        if (status >= 500) throw error;
        throw new Error(formatImageApiError(status, message.replace(/^.*?\):\s*/, '')));
      }
      throw error;
    }

    callbacks.onProgress?.('이미지 생성 완료, 변환 중...');

    // 내부 표준 JPEG로 통일 (기존 Gemini/OpenAI 경로와 동일한 파이프라인 유지)
    const jpegBase64 = await convertBase64ToJpeg(generated.base64, generated.mediaType);

    logger.debug('✅ 이미지 생성 완료!');
    callbacks.onComplete(jpegBase64);
  };

  return { generateImage };
}
