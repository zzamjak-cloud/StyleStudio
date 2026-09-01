// 파일 최적화 유틸리티 함수

import { logger } from '../logger';
import { GEMINI_FLASH_TEXT_MODEL } from '../../types/constants';
import { chatComplete } from '../api/openrouter';

/**
 * 파일 크기 제한 상수 (토큰 기준으로 대략 계산)
 * 1 토큰 ≈ 4자 (한글 기준)
 */
export const MAX_FILE_SIZE_CHARS = 100000; // 10만자 (약 25,000 토큰)
export const SUMMARY_MAX_LENGTH = 500; // 요약 최대 길이 (자)

/**
 * 파일 내용을 토큰 수 기준으로 자르기
 * 대략적인 계산: 1 토큰 ≈ 4자 (한글 기준)
 */
export function truncateFileContent(content: string, maxChars: number = MAX_FILE_SIZE_CHARS): string {
  if (content.length <= maxChars) {
    return content;
  }

  // 문장 단위로 자르기 (마지막 문장이 잘리지 않도록)
  const truncated = content.substring(0, maxChars);
  const lastSentenceEnd = Math.max(
    truncated.lastIndexOf('。'),
    truncated.lastIndexOf('.'),
    truncated.lastIndexOf('!'),
    truncated.lastIndexOf('?'),
    truncated.lastIndexOf('\n')
  );

  if (lastSentenceEnd > maxChars * 0.8) {
    return truncated.substring(0, lastSentenceEnd + 1) + '\n\n[내용이 잘렸습니다. 전체 내용은 파일에서 확인하세요.]';
  }

  return truncated + '\n\n[내용이 잘렸습니다. 전체 내용은 파일에서 확인하세요.]';
}

/**
 * 파일 크기 검증
 */
export function validateFileSize(
  content: string
): {
  valid: boolean;
  truncated?: string;
  originalSize: number;
} {
  const originalSize = content.length;

  if (originalSize <= MAX_FILE_SIZE_CHARS) {
    return { valid: true, originalSize };
  }

  return {
    valid: false,
    truncated: truncateFileContent(content),
    originalSize,
  };
}

/**
 * 파일 내용 요약 생성 (AI 사용)
 */
export async function generateFileSummary(content: string, fileName: string, apiKey: string): Promise<string> {
  try {
    // 내용이 너무 짧으면 요약 불필요 (1000자 미만)
    if (content.length < 1000) {
      return content;
    }

    // 내용이 너무 길면 앞부분만 사용하여 요약
    const contentToSummarize =
      content.length > 50000 ? content.substring(0, 50000) + '\n\n[... 중간 생략 ...]' : content;

    const prompt = `다음 파일의 내용을 ${SUMMARY_MAX_LENGTH}자 이내로 요약해주세요. 주요 내용과 핵심 포인트를 포함하세요.

파일명: ${fileName}

파일 내용:
${contentToSummarize}

요약:`;

    logger.debug('📄 파일 요약 생성 시작:', fileName);

    // OpenRouter chat completions (Gemini Flash) 사용
    let summary = '';
    try {
      summary = (
        await chatComplete(apiKey, {
          model: GEMINI_FLASH_TEXT_MODEL,
          messages: [{ role: 'user', content: prompt }],
        })
      ).trim();
    } catch (apiError) {
      logger.error('❌ 요약 API 오류:', apiError);
      return generateSimpleSummary(content);
    }

    if (!summary) {
      logger.warn('⚠️ 요약 생성 실패, 간단 요약 사용');
      return generateSimpleSummary(content);
    }

    logger.debug('✅ 파일 요약 완료');

    // 요약 길이 제한
    return summary.length > SUMMARY_MAX_LENGTH ? summary.substring(0, SUMMARY_MAX_LENGTH) + '...' : summary;
  } catch (error) {
    logger.error('❌ 파일 요약 생성 실패:', error);
    // 요약 실패 시 간단한 요약 반환 (폴백)
    return generateSimpleSummary(content);
  }
}

/**
 * 간단한 텍스트 기반 요약 생성 (AI 없이)
 */
export function generateSimpleSummary(content: string, maxLength: number = SUMMARY_MAX_LENGTH): string {
  if (content.length <= maxLength) {
    return content;
  }

  // 첫 문단과 마지막 문단을 포함한 요약
  const lines = content.split('\n').filter((line) => line.trim().length > 0);

  if (lines.length <= 3) {
    return content.substring(0, maxLength) + '...';
  }

  const firstPart = lines.slice(0, 2).join('\n');
  const lastPart = lines.slice(-2).join('\n');
  const summary = `${firstPart}\n\n[... 중간 생략 ...]\n\n${lastPart}`;

  return summary.length > maxLength ? summary.substring(0, maxLength) + '...' : summary;
}
