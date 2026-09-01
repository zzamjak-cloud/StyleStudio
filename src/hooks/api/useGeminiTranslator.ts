import { logger } from '../../lib/logger';
import { GEMINI_FLASH_TEXT_MODEL } from '../../types/constants';
import { chatComplete } from '../../lib/api/openrouter';

/**
 * 한국어-영어 자동 번역 Hook (OpenRouter chat completions · Gemini Flash)
 *
 * 사용자가 한국어로 프롬프트를 입력하면 자동으로 영어로 번역하여 반환합니다.
 * 이미지 생성 API는 영어 프롬프트를 사용하지만, 사용자는 한국어로 입력할 수 있습니다.
 * 실패 시 원본 텍스트를 그대로 반환한다 (throw 안 함).
 */

export function useGeminiTranslator() {
  /**
   * 텍스트가 한국어를 포함하는지 확인
   */
  const containsKorean = (text: string): boolean => {
    const koreanRegex = /[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/;
    return koreanRegex.test(text);
  };

  /** 단일 프롬프트 번역 호출 공통부 — 실패 시 fallback 반환 */
  const translate = async (apiKey: string, prompt: string, fallback: string): Promise<string> => {
    try {
      const text = await chatComplete(apiKey, {
        model: GEMINI_FLASH_TEXT_MODEL,
        messages: [{ role: 'user', content: prompt }],
      });
      return text.trim() || fallback;
    } catch (error) {
      logger.error('❌ 번역 오류:', error);
      return fallback;
    }
  };

  /**
   * 영어 텍스트를 한국어로 번역 (화면 표시용)
   */
  const translateToKorean = async (apiKey: string, englishText: string): Promise<string> => {
    if (!englishText.trim()) {
      return '';
    }

    // 이미 한국어가 포함되어 있으면 그대로 반환
    if (containsKorean(englishText)) {
      return englishText;
    }

    logger.debug('🌐 영어 → 한국어 번역 시작 (화면 표시용)');

    const prompt = `You are a professional translator specializing in image generation prompts. Translate the following English AI image generation prompt into natural Korean.

IMPORTANT RULES:
1. Translate naturally and fluently in Korean
2. Keep technical terms in English if commonly used (e.g., "anime style", "chibi")
3. Make it easy to understand for Korean speakers
4. Output ONLY the Korean translation, no explanations
5. Preserve comma-separated format

English prompt to translate:
${englishText}

Korean translation:`;

    const translated = await translate(apiKey, prompt, englishText);
    logger.debug('✅ 한국어 번역 완료');
    return translated;
  };

  /**
   * 한국어 텍스트를 영어로 번역 (API 전달용)
   */
  const translateToEnglish = async (apiKey: string, koreanText: string): Promise<string> => {
    if (!koreanText.trim()) {
      return '';
    }

    // 한국어가 포함되어 있지 않으면 그대로 반환
    if (!containsKorean(koreanText)) {
      return koreanText;
    }

    logger.debug('🌐 한국어 → 영어 번역 시작:', koreanText);

    const prompt = `You are a professional translator specializing in image generation prompts. Translate the following Korean text into English for use in an AI image generation system.

IMPORTANT RULES:
1. Translate naturally and accurately
2. Keep technical terms and artistic terminology in English
3. Preserve the meaning and nuance
4. Output ONLY the English translation, no explanations
5. If the input is already in English, return it as-is
6. If the text contains both Korean and English, keep the English parts as-is and only translate the Korean parts

Korean text to translate:
${koreanText}

English translation:`;

    const translated = await translate(apiKey, prompt, koreanText);
    logger.debug('✅ 번역 완료:', translated);
    return translated;
  };

  /** `[번호]` 프리픽스 응답을 인덱스별 배열로 파싱 — 매칭 실패 시 해당 인덱스는 원본 유지 */
  const parseBatchResult = (translatedText: string, originals: string[]): string[] => {
    const lines = translatedText.split('\n').filter((line: string) => line.trim());
    const translations: string[] = [];

    for (let i = 0; i < originals.length; i++) {
      const linePrefix = `[${i + 1}]`;
      const matchingLine = lines.find((line: string) => line.startsWith(linePrefix));

      if (matchingLine) {
        translations.push(matchingLine.replace(linePrefix, '').trim());
      } else {
        translations.push(originals[i]);
      }
    }

    return translations;
  };

  /**
   * 여러 텍스트를 한 번에 영어로 번역 (API 호출 최적화)
   */
  const translateBatchToEnglish = async (
    apiKey: string,
    koreanTexts: string[]
  ): Promise<string[]> => {
    if (koreanTexts.length === 0) {
      return [];
    }

    logger.debug(`🌐 배치 번역 시작 (한국어→영어, ${koreanTexts.length}개 텍스트)`);

    const combinedText = koreanTexts.map((text, idx) => `[${idx + 1}] ${text}`).join('\n');

    const prompt = `You are a professional translator specializing in image generation prompts. Translate the following Korean texts into English for use in an AI image generation system. Keep the format exactly as shown with [number] prefix.

IMPORTANT RULES:
1. Translate each line naturally and accurately
2. Keep technical terms and artistic terminology in English
3. Preserve the meaning and nuance
4. Preserve the [number] prefix for each line
5. Output ONLY the translations, no explanations
6. If a text is already in English, return it as-is
7. If a text contains both Korean and English, keep the English parts as-is and only translate the Korean parts

Korean texts to translate:
${combinedText}

English translations (keep [number] prefix):`;

    const translatedText = await translate(apiKey, prompt, '');
    if (!translatedText) {
      return koreanTexts; // 실패 시 원본 반환
    }

    logger.debug('✅ 배치 번역 완료 (한국어→영어)');
    return parseBatchResult(translatedText, koreanTexts);
  };

  /**
   * 여러 텍스트를 한 번에 한국어로 번역 (API 호출 최적화)
   */
  const translateBatchToKorean = async (
    apiKey: string,
    englishTexts: string[]
  ): Promise<string[]> => {
    if (englishTexts.length === 0) {
      return [];
    }

    logger.debug(`🌐 배치 번역 시작 (${englishTexts.length}개 텍스트)`);

    const combinedText = englishTexts.map((text, idx) => `[${idx + 1}] ${text}`).join('\n');

    const prompt = `You are a professional translator. Translate the following English texts into natural Korean. Keep the format exactly as shown with [number] prefix.

IMPORTANT RULES:
1. Translate each line naturally and fluently in Korean
2. Keep technical terms in English if commonly used (e.g., "anime style", "chibi", "3D")
3. Preserve the [number] prefix for each line
4. Output ONLY the translations, no explanations
5. If a text already contains Korean, keep the existing Korean parts and only translate the English parts that need translation

English texts to translate:
${combinedText}

Korean translations (keep [number] prefix):`;

    const translatedText = await translate(apiKey, prompt, '');
    if (!translatedText) {
      return englishTexts; // 실패 시 원본 반환
    }

    logger.debug('✅ 배치 번역 완료');
    return parseBatchResult(translatedText, englishTexts);
  };

  return {
    translateToEnglish,
    translateToKorean,
    translateBatchToEnglish,
    translateBatchToKorean,
    containsKorean,
  };
}
