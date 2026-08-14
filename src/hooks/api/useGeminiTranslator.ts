import { logger } from '../../lib/logger';
import { GEMINI_FLASH_TEXT_MODEL } from '../../types/constants';

/**
 * Gemini API를 사용한 한국어-영어 자동 번역 Hook
 *
 * 사용자가 한국어로 프롬프트를 입력하면 자동으로 영어로 번역하여 반환합니다.
 * 이미지 생성 API는 영어 프롬프트를 사용하지만, 사용자는 한국어로 입력할 수 있습니다.
 */

export function useGeminiTranslator() {
  /**
   * 텍스트가 한국어를 포함하는지 확인
   */
  const containsKorean = (text: string): boolean => {
    const koreanRegex = /[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/;
    return koreanRegex.test(text);
  };

  /**
   * 영어 텍스트를 한국어로 번역 (화면 표시용)
   */
  const translateToKorean = async (
    apiKey: string,
    englishText: string
  ): Promise<string> => {
    try {
      if (!englishText.trim()) {
        return '';
      }

      // 이미 한국어가 포함되어 있으면 그대로 반환
      if (containsKorean(englishText)) {
        return englishText;
      }

      logger.debug('🌐 영어 → 한국어 번역 시작 (화면 표시용)');

      // Gemini 3.7 Flash API 사용
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_FLASH_TEXT_MODEL}:generateContent?key=${apiKey}`;

      const requestBody = {
        contents: [
          {
            parts: [
              {
                text: `You are a professional translator specializing in image generation prompts. Translate the following English AI image generation prompt into natural Korean.

IMPORTANT RULES:
1. Translate naturally and fluently in Korean
2. Keep technical terms in English if commonly used (e.g., "anime style", "chibi")
3. Make it easy to understand for Korean speakers
4. Output ONLY the Korean translation, no explanations
5. Preserve comma-separated format

English prompt to translate:
${englishText}

Korean translation:`,
              },
            ],
          },
        ],
        // Gemini 3.x: temperature/topK/topP 지원 중단으로 generationConfig 제거
      };

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('❌ 번역 API 오류:', response.status, errorText);
        return englishText;
      }

      const result = await response.json();
      const translatedText =
        result.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || englishText;

      logger.debug('✅ 한국어 번역 완료');
      return translatedText;
    } catch (error) {
      logger.error('❌ 번역 오류:', error);
      return englishText;
    }
  };

  /**
   * 한국어 텍스트를 영어로 번역 (API 전달용)
   */
  const translateToEnglish = async (
    apiKey: string,
    koreanText: string
  ): Promise<string> => {
    try {
      if (!koreanText.trim()) {
        return '';
      }

      // 한국어가 포함되어 있지 않으면 그대로 반환
      if (!containsKorean(koreanText)) {
        return koreanText;
      }

      logger.debug('🌐 한국어 → 영어 번역 시작:', koreanText);

      // Gemini 3.7 Flash API 사용
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_FLASH_TEXT_MODEL}:generateContent?key=${apiKey}`;

      const requestBody = {
        contents: [
          {
            parts: [
              {
                text: `You are a professional translator specializing in image generation prompts. Translate the following Korean text into English for use in an AI image generation system.

IMPORTANT RULES:
1. Translate naturally and accurately
2. Keep technical terms and artistic terminology in English
3. Preserve the meaning and nuance
4. Output ONLY the English translation, no explanations
5. If the input is already in English, return it as-is
6. If the text contains both Korean and English, keep the English parts as-is and only translate the Korean parts

Korean text to translate:
${koreanText}

English translation:`,
              },
            ],
          },
        ],
        // Gemini 3.x: temperature/topK/topP 지원 중단으로 generationConfig 제거
      };

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('❌ 번역 API 오류:', response.status, errorText);
        // 번역 실패 시 원본 텍스트 반환
        return koreanText;
      }

      const result = await response.json();
      const translatedText =
        result.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || koreanText;

      logger.debug('✅ 번역 완료:', translatedText);
      return translatedText;
    } catch (error) {
      logger.error('❌ 번역 오류:', error);
      // 오류 발생 시 원본 텍스트 반환
      return koreanText;
    }
  };

  /**
   * 여러 텍스트를 한 번에 영어로 번역 (API 호출 최적화)
   */
  const translateBatchToEnglish = async (
    apiKey: string,
    koreanTexts: string[]
  ): Promise<string[]> => {
    try {
      if (koreanTexts.length === 0) {
        return [];
      }

      logger.debug(`🌐 배치 번역 시작 (한국어→영어, ${koreanTexts.length}개 텍스트)`);

      // 모든 텍스트를 하나의 프롬프트로 결합
      const combinedText = koreanTexts
        .map((text, idx) => `[${idx + 1}] ${text}`)
        .join('\n');

      const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_FLASH_TEXT_MODEL}:generateContent?key=${apiKey}`;

      const requestBody = {
        contents: [
          {
            parts: [
              {
                text: `You are a professional translator specializing in image generation prompts. Translate the following Korean texts into English for use in an AI image generation system. Keep the format exactly as shown with [number] prefix.

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

English translations (keep [number] prefix):`,
              },
            ],
          },
        ],
        // Gemini 3.x: temperature/topK/topP 지원 중단으로 generationConfig 제거
      };

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('❌ 배치 번역 API 오류:', response.status, errorText);
        return koreanTexts; // 실패 시 원본 반환
      }

      const result = await response.json();
      const translatedText = result.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';

      // 결과를 파싱하여 배열로 변환
      const lines = translatedText.split('\n').filter((line: string) => line.trim());
      const translations: string[] = [];

      for (let i = 0; i < koreanTexts.length; i++) {
        const linePrefix = `[${i + 1}]`;
        const matchingLine = lines.find((line: string) => line.startsWith(linePrefix));

        if (matchingLine) {
          // [숫자] 제거하고 텍스트만 추출
          translations.push(matchingLine.replace(linePrefix, '').trim());
        } else {
          // 매칭 실패 시 원본 사용
          translations.push(koreanTexts[i]);
        }
      }

      logger.debug('✅ 배치 번역 완료 (한국어→영어)');
      return translations;
    } catch (error) {
      logger.error('❌ 배치 번역 오류:', error);
      return koreanTexts; // 오류 시 원본 반환
    }
  };

  /**
   * 여러 텍스트를 한 번에 한국어로 번역 (API 호출 최적화)
   */
  const translateBatchToKorean = async (
    apiKey: string,
    englishTexts: string[]
  ): Promise<string[]> => {
    try {
      if (englishTexts.length === 0) {
        return [];
      }

      logger.debug(`🌐 배치 번역 시작 (${englishTexts.length}개 텍스트)`);

      // 모든 텍스트를 하나의 프롬프트로 결합
      const combinedText = englishTexts
        .map((text, idx) => `[${idx + 1}] ${text}`)
        .join('\n');

      const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_FLASH_TEXT_MODEL}:generateContent?key=${apiKey}`;

      const requestBody = {
        contents: [
          {
            parts: [
              {
                text: `You are a professional translator. Translate the following English texts into natural Korean. Keep the format exactly as shown with [number] prefix.

IMPORTANT RULES:
1. Translate each line naturally and fluently in Korean
2. Keep technical terms in English if commonly used (e.g., "anime style", "chibi", "3D")
3. Preserve the [number] prefix for each line
4. Output ONLY the translations, no explanations
5. If a text already contains Korean, keep the existing Korean parts and only translate the English parts that need translation

English texts to translate:
${combinedText}

Korean translations (keep [number] prefix):`,
              },
            ],
          },
        ],
        // Gemini 3.x: temperature/topK/topP 지원 중단으로 generationConfig 제거
      };

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('❌ 배치 번역 API 오류:', response.status, errorText);
        return englishTexts; // 실패 시 원본 반환
      }

      const result = await response.json();
      const translatedText = result.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';

      // 결과를 파싱하여 배열로 변환
      const lines = translatedText.split('\n').filter((line: string) => line.trim());
      const translations: string[] = [];

      for (let i = 0; i < englishTexts.length; i++) {
        const linePrefix = `[${i + 1}]`;
        const matchingLine = lines.find((line: string) => line.startsWith(linePrefix));

        if (matchingLine) {
          // [숫자] 제거하고 텍스트만 추출
          translations.push(matchingLine.replace(linePrefix, '').trim());
        } else {
          // 매칭 실패 시 원본 사용
          translations.push(englishTexts[i]);
        }
      }

      logger.debug('✅ 배치 번역 완료');
      return translations;
    } catch (error) {
      logger.error('❌ 배치 번역 오류:', error);
      return englishTexts; // 오류 시 원본 반환
    }
  };

  return {
    translateToEnglish,
    translateToKorean,
    translateBatchToEnglish,
    translateBatchToKorean,
    containsKorean,
  };
}
