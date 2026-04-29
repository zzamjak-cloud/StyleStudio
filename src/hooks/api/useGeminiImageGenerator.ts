import { SessionType } from '../../types/session';
import { ReferenceDocument } from '../../types/referenceDocument';
import { logger } from '../../lib/logger';
import { PixelArtGridLayout } from '../../types/pixelart';
import { ImageAnalysisResult } from '../../types/analysis';
import { buildPromptForSession } from '../../lib/prompts/sessionPrompts';
import {
  DEFAULT_IMAGE_MODEL,
  GEMINI_IMAGE_MODELS,
  GeminiImageGenerationModel,
} from './imageModels';

// Gemini API 타입 정의
interface GeminiPart {
  inline_data?: {
    mime_type: string;
    data: string;
  };
  text?: string;
}

interface GeminiImageConfig {
  aspectRatio: '1:1' | '16:9' | '9:16' | '4:3' | '3:4' | '1:3' | '3:1';
  imageSize: '1K' | '2K' | '4K';
}

interface GeminiGenerationConfig {
  responseModalities: string[];
  imageConfig: GeminiImageConfig;
  seed?: number;
  temperature?: number;
  topK?: number;
  topP?: number;
}

export type ImageGenerationModel = GeminiImageGenerationModel;
export const IMAGE_MODELS = GEMINI_IMAGE_MODELS;

interface ImageGenerationParams {
  prompt: string; // 서술적 문장 권장
  referenceImages?: string[]; // base64 이미지 배열 (최대 14개)
  aspectRatio?: '1:1' | '16:9' | '9:16' | '4:3' | '3:4' | '1:3' | '3:1';
  imageSize?: '1K' | '2K' | '4K'; // Gemini 3 Pro만 지원
  negativePrompt?: string; // 피해야 할 요소
  sessionType?: SessionType; // 세션 타입 (CHARACTER/STYLE)
  analysis?: ImageAnalysisResult; // 이미지 분석 결과 (픽셀아트 해상도 추출용)
  pixelArtGrid?: PixelArtGridLayout; // 픽셀아트 그리드 레이아웃 (선택)
  referenceDocuments?: ReferenceDocument[]; // 참조 문서 (UI 세션 전용)
  imageModel?: GeminiImageGenerationModel; // 이미지 생성 모델

  // 고급 설정
  seed?: number; // 재현성을 위한 시드 값
  temperature?: number; // 창의성 제어 (0.0 ~ 2.0)
  topK?: number; // 샘플링 다양성
  topP?: number; // 누적 확률 임계값 (0.0 ~ 1.0)
  referenceStrength?: number; // 참조 이미지 영향력 (0.0 ~ 1.0, 높을수록 참조 이미지를 강하게 따름)
}

interface GenerationCallbacks {
  onProgress?: (status: string) => void;
  onComplete: (imageBase64: string, textResponse?: string) => void;
  onError: (error: Error) => void;
}

export function useGeminiImageGenerator() {
  const generateImage = async (
    apiKey: string,
    params: ImageGenerationParams,
    callbacks: GenerationCallbacks
  ) => {
    // Retry 로직: 500 에러 시 최대 2번 재시도
    const MAX_RETRIES = 2;
    const RETRY_DELAY_MS = 5000; // 5초 대기 (Rate Limiting 대응)

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        if (attempt > 0) {
          logger.warn(`🔄 재시도 중... (${attempt}/${MAX_RETRIES})`);
          callbacks.onProgress?.(`재시도 중... (${attempt}/${MAX_RETRIES})`);
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
        }

        return await generateImageInternal(apiKey, params, callbacks);
      } catch (error) {
        const errorMessage = (error as Error).message;
        const is500Error = errorMessage.includes('500');

        // 500 에러가 아니거나 마지막 시도면 에러 던지기
        if (!is500Error || attempt === MAX_RETRIES) {
          throw error;
        }

        // 500 에러면 재시도
        logger.warn(`⚠️ 500 에러 발생. ${RETRY_DELAY_MS / 1000}초 후 재시도합니다...`);
      }
    }

    // 이 코드는 실행되지 않지만 TypeScript를 위해 추가
    throw new Error('최대 재시도 횟수 초과');
  };

  const generateImageInternal = async (
    apiKey: string,
    params: ImageGenerationParams,
    callbacks: GenerationCallbacks
  ) => {
    try {
      // API Key 검증
      const cleanApiKey = String(apiKey || '').trim();
      if (!cleanApiKey) {
        throw new Error('API Key가 비어있습니다');
      }

      logger.debug('🎨 이미지 생성 시작');
      logger.debug('   - 프롬프트 길이:', params.prompt.length);
      logger.debug('   - 참조 이미지 개수:', params.referenceImages?.length || 0);
      logger.debug('   - 비율:', params.aspectRatio || '1:1');
      logger.debug('   - 크기:', params.imageSize || '2K');

      callbacks.onProgress?.('이미지 생성 요청 중...');

      // 이미지 생성 모델 선택
      const MODEL_NAME = params.imageModel || DEFAULT_IMAGE_MODEL;
      logger.debug(`📦 사용 모델: ${MODEL_NAME}`);

      // 첫 시도 시 모델 사용 가능 여부 확인
      if (params.seed === undefined) {
        // Seed가 없을 때만 확인 (첫 생성으로 간주)
        try {
          const checkUrl = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}?key=${cleanApiKey}`;
          const checkResponse = await fetch(checkUrl);

          if (!checkResponse.ok) {
            logger.error(`❌ 모델 "${MODEL_NAME}"을 사용할 수 없습니다! (${checkResponse.status})`);
            logger.error('💡 사용 가능한 모델 확인 방법:');
            logger.error('   1. 콘솔에서: listGeminiModels() 실행');
            logger.error('   2. 직접 확인: https://ai.google.dev/gemini-api/docs/models/gemini');

            // 모든 모델 리스트 조회
            const listUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${cleanApiKey}`;
            const listResponse = await fetch(listUrl);
            if (listResponse.ok) {
              const result = await listResponse.json();
              const imageModels = result.models?.filter((m: any) =>
                m.name.toLowerCase().includes('image') ||
                m.name.toLowerCase().includes('vision') ||
                m.supportedGenerationMethods?.includes('generateContent')
              ) || [];

              if (imageModels.length > 0) {
                logger.error('📋 사용 가능한 이미지 생성 모델:');
                imageModels.slice(0, 5).forEach((model: any) => {
                  logger.error(`   - ${model.name.replace('models/', '')}`);
                });
              }
            }
          } else {
            logger.debug(`✅ 모델 "${MODEL_NAME}" 사용 가능 확인됨`);
          }
        } catch (checkError) {
          logger.warn('⚠️ 모델 확인 실패 (계속 진행):', checkError);
        }
      }

      // Gemini API 엔드포인트
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${cleanApiKey}`;

      // contents 배열 구성: [참조 이미지들..., 프롬프트]
      const parts: GeminiPart[] = [];

      // 1. 참조 이미지가 있으면 먼저 추가 (최대 10개)
      const hasReferenceImages = params.referenceImages && params.referenceImages.length > 0;

      if (hasReferenceImages && params.referenceImages) {
        const maxImages = Math.min(params.referenceImages.length, 10);
        logger.debug(`   - 참조 이미지 ${maxImages}개 추가 중...`);

        let totalImageSize = 0;
        for (let i = 0; i < maxImages; i++) {
          const imageBase64 = params.referenceImages[i];

          // Base64에서 data URL prefix 제거
          const base64Data = imageBase64.includes(',')
            ? imageBase64.split(',')[1]
            : imageBase64;

          // MIME 타입 추출
          const mimeMatch = imageBase64.match(/data:([^;]+);base64/);
          const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';

          // 이미지 크기 로깅 (KB 단위)
          const imageSizeKB = (base64Data.length * 0.75) / 1024; // Base64는 원본의 약 1.33배
          totalImageSize += imageSizeKB;
          logger.debug(`     [${i + 1}] ${mimeType}, ${imageSizeKB.toFixed(2)} KB`);

          parts.push({
            inline_data: {
              mime_type: mimeType,
              data: base64Data,
            },
          });
        }
        logger.debug(`   - 총 이미지 크기: ${totalImageSize.toFixed(2)} KB`);

        // 경고: 이미지가 너무 크면 500 에러 발생 가능
        if (totalImageSize > 20000) { // 20MB 이상
          logger.warn(`⚠️ 경고: 참조 이미지 크기가 매우 큽니다 (${totalImageSize.toFixed(2)} KB). 500 에러가 발생할 수 있습니다.`);
          logger.warn('   해결책: 참조 이미지 개수를 줄이거나 이미지 크기를 줄이세요.');
        }
      }


      // 2. 프롬프트 추가 (참조 이미지가 있으면 일관성 강조)
      // ILLUSTRATION 세션은 ImageGeneratorPanel에서 이미 buildPromptForSession을 호출했으므로 재처리 안함
      let fullPrompt: string;
      if (params.sessionType === 'ILLUSTRATION') {
        // ILLUSTRATION 세션: 이미 완성된 프롬프트 사용
        fullPrompt = params.prompt;
      } else {
        fullPrompt = buildPromptForSession({
          basePrompt: params.prompt,
          hasReferenceImages: hasReferenceImages || false,
          sessionType: params.sessionType,
          pixelArtGrid: params.pixelArtGrid,
          analysis: params.analysis,
          referenceDocuments: params.referenceDocuments,
        });
      }


      // Negative Prompt가 있으면 프롬프트에 명시
      if (params.negativePrompt && params.negativePrompt.trim()) {
        fullPrompt += `\n\nAvoid: ${params.negativePrompt}`;
      }

      parts.push({ text: fullPrompt });

      // generationConfig 구성
      const imageConfig: GeminiImageConfig = {
        aspectRatio: params.aspectRatio || '1:1',
        imageSize: params.imageSize || '2K',
      };

      // 참조 이미지 영향력 (참조 이미지가 있을 때만)
      // ⚠️ 주의: referenceStrength는 현재 Gemini API에서 공식 지원되지 않음 (2025-12-30 기준)
      // UI에는 표시되지만 실제 API 호출 시에는 사용되지 않음
      // if (hasReferenceImages && params.referenceStrength !== undefined) {
      //   imageConfig.referenceStrength = params.referenceStrength;
      //   logger.debug('   - Reference Strength:', params.referenceStrength);
      // }

      const generationConfig: GeminiGenerationConfig = {
        responseModalities: ['IMAGE'], // 이미지만 응답
        imageConfig,
      };

      // 고급 설정 추가 (값이 있을 때만)
      if (params.seed !== undefined) {
        generationConfig.seed = params.seed;
        logger.debug('   - Seed:', params.seed);
      }
      if (params.temperature !== undefined) {
        generationConfig.temperature = params.temperature;
        logger.debug('   - Temperature:', params.temperature);
      }
      if (params.topK !== undefined) {
        generationConfig.topK = params.topK;
        logger.debug('   - Top-K:', params.topK);
      }
      if (params.topP !== undefined) {
        generationConfig.topP = params.topP;
        logger.debug('   - Top-P:', params.topP);
      }

      const requestBody = {
        contents: [{ parts }],
        generationConfig,
      };

      // 디버깅: 요청 내용 요약
      logger.debug('🌐 API 요청 전송...');
      logger.debug('   - parts 개수:', parts.length);
      logger.debug('   - generationConfig:', JSON.stringify(generationConfig, null, 2));
      const imagePartsCount = parts.filter(p => 'inline_data' in p).length;
      const textPartsCount = parts.filter(p => 'text' in p).length;
      logger.debug('   - 이미지 parts:', imagePartsCount);
      logger.debug('   - 텍스트 parts:', textPartsCount);

      // 요청 페이로드 크기 확인
      const requestBodyString = JSON.stringify(requestBody);
      const requestSizeMB = requestBodyString.length / (1024 * 1024);
      logger.debug(`   - 요청 페이로드 크기: ${requestSizeMB.toFixed(2)} MB`);

      if (requestSizeMB > 20) {
        logger.error(`❌ 요청이 너무 큽니다 (${requestSizeMB.toFixed(2)} MB)! Gemini API 제한을 초과했을 가능성이 높습니다.`);
        logger.error('   해결책:');
        logger.error('   1. 참조 이미지 개수를 1-2개로 줄이세요');
        logger.error('   2. 이미지 해상도를 낮추세요 (예: 512x512 이하)');
        logger.error('   3. 포즈 가이드를 제거하고 텍스트만으로 시도하세요');
      }

      callbacks.onProgress?.('Gemini가 이미지를 생성하고 있습니다...');

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('❌ API 오류:', response.status, errorText);

        // 에러 상세 정보 파싱
        try {
          const errorJson = JSON.parse(errorText);
          if (errorJson.error) {
            logger.error('   - 에러 코드:', errorJson.error.code);
            logger.error('   - 에러 메시지:', errorJson.error.message);
            logger.error('   - 에러 상태:', errorJson.error.status);
          }
        } catch (e) {
          // JSON 파싱 실패 시 무시
        }

        throw new Error(`API 오류 (${response.status}): ${errorText}`);
      }

      callbacks.onProgress?.('이미지 생성 완료, 로딩 중...');

      const result = await response.json();
      logger.debug('✅ Gemini 응답 수신');

      // 응답 파싱: candidates[0].content.parts[]
      const responseParts = result.candidates?.[0]?.content?.parts || [];

      let imageBase64 = '';
      let textResponse = '';

      for (const part of responseParts) {
        if (part.inlineData) {
          imageBase64 = part.inlineData.data;
          logger.debug('   - 이미지 데이터 수신 (길이:', imageBase64.length, ')');
        } else if (part.text) {
          textResponse += part.text;
        }
      }

      if (!imageBase64) {
        logger.error('❌ 생성된 이미지 없음');
        logger.error('   - 응답:', JSON.stringify(result, null, 2));
        throw new Error('생성된 이미지가 없습니다');
      }

      logger.debug('✅ 이미지 생성 완료!');
      callbacks.onComplete(imageBase64, textResponse);
    } catch (error) {
      logger.error('이미지 생성 오류:', error);
      callbacks.onError(
        error instanceof Error ? error : new Error('알 수 없는 오류가 발생했습니다')
      );
    }
  };

  return { generateImage };
}
