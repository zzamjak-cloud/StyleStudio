// 참조 이미지 분석 훅 — OpenRouter chat completions(비전)로 Gemini 계열 모델을 호출한다.
// 프롬프트 선택 → 이미지 첨부 → JSON 파싱/검증 흐름은 기존과 동일.

import {
  STYLE_ANALYZER_PROMPT,
  MULTI_IMAGE_ANALYZER_PROMPT,
  REFINEMENT_ANALYZER_PROMPT,
  PIXELART_ANALYZER_PROMPT,
  BACKGROUND_ANALYZER_PROMPT,
  PIXELART_BACKGROUND_ANALYZER_PROMPT,
  TILEMAP_ANALYZER_PROMPT,
  UI_ANALYZER_PROMPT,
  LOGO_ANALYZER_PROMPT,
  ILLUSTRATION_CHARACTER_ANALYZER_PROMPT,
  ILLUSTRATION_BACKGROUND_ANALYZER_PROMPT,
} from '../../lib/gemini/analysisPrompt';
import { ImageAnalysisResult } from '../../types/analysis';
import { ANALYSIS_MODELS, DEFAULT_ANALYSIS_MODEL } from '../../types/constants';
import { SessionType } from '../../types/session';
import { IllustrationCharacterAnalysis, BackgroundAnalysisResult } from '../../types/illustration';
import { logger } from '../../lib/logger';
import { chatComplete, toImagePart, ChatContentPart } from '../../lib/api/openrouter';

interface AnalysisCallbacks {
  onProgress: (message: string) => void;
  onComplete: (result: ImageAnalysisResult) => void;
  onError: (error: Error) => void;
}

interface AnalysisOptions {
  previousAnalysis?: ImageAnalysisResult; // 기존 분석 결과 (분석 강화 모드용)
  model?: string; // 분석에 사용할 모델 (미지정 시 기본 모델)
}

// JSON 응답 잘림 방지
const ANALYSIS_MAX_TOKENS = 8192;

/** 저장된 (레거시 포함) 분석 모델 ID를 OpenRouter 슬러그로 정규화 */
function normalizeAnalysisModel(model: string | undefined): string {
  if (!model) return DEFAULT_ANALYSIS_MODEL;
  if (ANALYSIS_MODELS.some((m) => m.id === model)) return model;
  // 레거시 ID (예: 'gemini-3.7-flash') → 'google/' 접두어 부여
  if (!model.includes('/')) return `google/${model}`;
  return model;
}

/** 프롬프트 + 이미지 배열을 chat completions 사용자 메시지 콘텐츠로 변환 */
function buildVisionContent(prompt: string, imageBase64Array: string[]): ChatContentPart[] {
  return [{ type: 'text', text: prompt }, ...imageBase64Array.map(toImagePart)];
}

/** 모델 응답 텍스트에서 JSON 객체를 추출·클린업 후 파싱 */
function parseJsonFromText(text: string): unknown {
  let jsonText = text;

  // 1단계: ```json ``` 또는 ``` ``` 코드 블록 제거
  if (text.includes('```')) {
    const jsonBlockMatch =
      text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/```\s*([\s\S]*?)\s*```/);
    if (jsonBlockMatch) {
      jsonText = jsonBlockMatch[1];
    } else {
      jsonText = text.replace(/```json|```/g, '');
    }
  }

  // 2단계: JSON 객체만 추출 (첫 { 부터 마지막 } 까지)
  const firstBrace = jsonText.indexOf('{');
  const lastBrace = jsonText.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    jsonText = jsonText.substring(firstBrace, lastBrace + 1);
  }

  // 3단계: trailing commas 제거
  jsonText = jsonText.replace(/,(\s*[}\]])/g, '$1');

  return JSON.parse(jsonText.trim());
}

export function useGeminiAnalyzer() {
  const analyzeImages = async (
    apiKey: string,
    imageBase64Array: string[],
    callbacks: AnalysisCallbacks,
    sessionType?: SessionType,
    options?: AnalysisOptions
  ) => {
    try {
      // API Key 검증
      const cleanApiKey = String(apiKey || '').trim();
      if (!cleanApiKey) {
        throw new Error('API Key가 비어있습니다');
      }

      // 이미지 배열 검증
      if (!imageBase64Array || imageBase64Array.length === 0) {
        throw new Error('분석할 이미지가 없습니다');
      }

      logger.debug('📷 이미지 정보:');
      logger.debug('   - 이미지 개수:', imageBase64Array.length);

      callbacks.onProgress(`${imageBase64Array.length}개의 이미지를 분석 모델에 전송 중...`);

      // 프롬프트 선택 로직
      let analysisPrompt: string;
      let promptType: string;

      // LOGO 타입 체크 (최우선 순위)
      if (sessionType === 'LOGO') {
        analysisPrompt = LOGO_ANALYZER_PROMPT;
        promptType = 'LOGO';
      } else if (sessionType === 'UI') {
        analysisPrompt = UI_ANALYZER_PROMPT;
        promptType = 'UI';
      } else if (sessionType === 'BACKGROUND') {
        analysisPrompt = BACKGROUND_ANALYZER_PROMPT;
        promptType = 'BACKGROUND';
      } else if (sessionType === 'TILEMAP') {
        analysisPrompt = TILEMAP_ANALYZER_PROMPT;
        promptType = 'TILEMAP';
      } else if (sessionType === 'PIXELART_BACKGROUND') {
        analysisPrompt = PIXELART_BACKGROUND_ANALYZER_PROMPT;
        promptType = 'PIXELART_BACKGROUND';
      } else if (sessionType === 'PIXELART_CHARACTER' || sessionType === 'PIXELART_ICON') {
        analysisPrompt = PIXELART_ANALYZER_PROMPT;
        promptType = 'PIXELART';
      } else if (options?.previousAnalysis) {
        // 분석 강화 모드: 기존 분석 결과를 포함한 프롬프트 사용
        const previousAnalysisJson = JSON.stringify(options.previousAnalysis, null, 2);
        analysisPrompt = REFINEMENT_ANALYZER_PROMPT(previousAnalysisJson);
        promptType = 'REFINEMENT';
      } else {
        // 일반 분석 모드: 이미지 개수에 따라 프롬프트 선택
        analysisPrompt =
          imageBase64Array.length > 1 ? MULTI_IMAGE_ANALYZER_PROMPT : STYLE_ANALYZER_PROMPT;
        promptType = imageBase64Array.length > 1 ? 'MULTI_IMAGE' : 'SINGLE_IMAGE';
      }
      logger.debug('📋 프롬프트 선택:', promptType);

      const analysisModel = normalizeAnalysisModel(options?.model);
      logger.debug('🌐 분석 모델:', analysisModel);

      callbacks.onProgress('이미지를 분석하고 있습니다...');

      const text = await chatComplete(cleanApiKey, {
        model: analysisModel,
        messages: [{ role: 'user', content: buildVisionContent(analysisPrompt, imageBase64Array) }],
        maxTokens: ANALYSIS_MAX_TOKENS,
      });

      callbacks.onProgress('분석 결과를 처리하고 있습니다...');

      logger.debug('📝 추출된 텍스트:');
      logger.debug('   - 길이:', text.length);
      logger.debug('   - 시작:', text.substring(0, 100) + '...');

      // JSON 파싱
      let analysisResult: ImageAnalysisResult;
      try {
        analysisResult = parseJsonFromText(text) as ImageAnalysisResult;
        logger.debug('✅ JSON 파싱 성공');
      } catch (parseError) {
        logger.error('❌ JSON 파싱 실패:', parseError);
        logger.error('   - 원본 응답 (길이:', text.length, '):');
        logger.error(text);
        throw new Error('분석 결과를 JSON으로 파싱할 수 없습니다. 모델 응답 형식을 확인하세요.');
      }

      // 결과 검증
      if (
        !analysisResult.style ||
        !analysisResult.character ||
        !analysisResult.composition ||
        analysisResult.negative_prompt === undefined
      ) {
        logger.error('❌ 결과 형식 오류:');
        logger.error('   - style:', analysisResult.style);
        logger.error('   - character:', analysisResult.character);
        logger.error('   - composition:', analysisResult.composition);
        logger.error('   - negative_prompt:', analysisResult.negative_prompt);
        throw new Error('분석 결과가 올바른 형식이 아닙니다');
      }

      // 새로운 필드 검증 및 기본값 설정
      if (
        !analysisResult.character.body_proportions ||
        !analysisResult.character.limb_proportions ||
        !analysisResult.character.torso_shape ||
        !analysisResult.character.hand_style
      ) {
        logger.warn('⚠️ 일부 필드 누락 — 기본값 설정');
        if (!analysisResult.character.body_proportions) {
          analysisResult.character.body_proportions = 'not specified';
        }
        if (!analysisResult.character.limb_proportions) {
          analysisResult.character.limb_proportions = 'not specified';
        }
        if (!analysisResult.character.torso_shape) {
          analysisResult.character.torso_shape = 'not specified';
        }
        if (!analysisResult.character.hand_style) {
          analysisResult.character.hand_style = 'not specified';
        }
        if (!analysisResult.character.feet_style) {
          analysisResult.character.feet_style = 'not specified';
        }
      }

      logger.debug('✅ 분석 완료!');
      callbacks.onComplete(analysisResult);
    } catch (error) {
      logger.error('이미지 분석 오류:', error);
      callbacks.onError(
        error instanceof Error ? error : new Error('알 수 없는 오류가 발생했습니다')
      );
    }
  };

  /**
   * 일러스트 캐릭터 개별 분석
   * - 캐릭터 이름과 이미지 배열을 받아 해당 캐릭터의 고유 특징 추출
   */
  const analyzeIllustrationCharacter = async (
    apiKey: string,
    characterName: string,
    imageBase64Array: string[],
    onProgress?: (message: string) => void
  ): Promise<{ analysis: IllustrationCharacterAnalysis; negativePrompt: string }> => {
    const cleanApiKey = String(apiKey || '').trim();
    if (!cleanApiKey) {
      throw new Error('API Key가 비어있습니다');
    }

    if (!imageBase64Array || imageBase64Array.length === 0) {
      throw new Error('분석할 이미지가 없습니다');
    }

    logger.debug(`🎭 캐릭터 분석 시작: "${characterName}" (${imageBase64Array.length}장)`);
    onProgress?.(`"${characterName}" 캐릭터를 분석하고 있습니다...`);

    const text = await chatComplete(cleanApiKey, {
      model: DEFAULT_ANALYSIS_MODEL,
      messages: [
        {
          role: 'user',
          content: buildVisionContent(
            ILLUSTRATION_CHARACTER_ANALYZER_PROMPT(characterName),
            imageBase64Array
          ),
        },
      ],
      maxTokens: ANALYSIS_MAX_TOKENS,
    });

    const parsed = parseJsonFromText(text) as {
      character: IllustrationCharacterAnalysis;
      negative_prompt?: string;
    };

    logger.debug(`✅ 캐릭터 "${characterName}" 분석 완료`);

    return {
      analysis: parsed.character,
      negativePrompt: parsed.negative_prompt || '',
    };
  };

  /**
   * 일러스트 배경 스타일 분석
   * - 배경 이미지에서 환경, 분위기, 스타일 정보 추출
   */
  const analyzeIllustrationBackground = async (
    apiKey: string,
    imageBase64Array: string[],
    onProgress?: (message: string) => void
  ): Promise<{ analysis: BackgroundAnalysisResult; negativePrompt: string }> => {
    const cleanApiKey = String(apiKey || '').trim();
    if (!cleanApiKey) {
      throw new Error('API Key가 비어있습니다');
    }

    if (!imageBase64Array || imageBase64Array.length === 0) {
      throw new Error('분석할 이미지가 없습니다');
    }

    logger.debug(`🖼️ 배경 분석 시작: ${imageBase64Array.length}장`);
    onProgress?.('배경 스타일을 분석하고 있습니다...');

    const text = await chatComplete(cleanApiKey, {
      model: DEFAULT_ANALYSIS_MODEL,
      messages: [
        {
          role: 'user',
          content: buildVisionContent(ILLUSTRATION_BACKGROUND_ANALYZER_PROMPT, imageBase64Array),
        },
      ],
      maxTokens: ANALYSIS_MAX_TOKENS,
    });

    const parsed = parseJsonFromText(text) as {
      background: BackgroundAnalysisResult;
      negative_prompt?: string;
    };

    logger.debug('✅ 배경 분석 완료');

    return {
      analysis: parsed.background,
      negativePrompt: parsed.negative_prompt || '',
    };
  };

  return { analyzeImages, analyzeIllustrationCharacter, analyzeIllustrationBackground };
}
