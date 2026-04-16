/**
 * 환경별 로깅 유틸리티
 * 개발 모드에서만 상세 로그 출력, 프로덕션에서는 에러만 로깅
 */

const isDevelopment = import.meta.env.DEV;

interface LogLevel {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

export const logger: LogLevel = {
  /**
   * 개발 전용 상세 로그
   */
  debug: (...args: unknown[]) => {
    if (isDevelopment) {
      console.log(...args);
    }
  },

  /**
   * 일반 정보
   */
  info: (...args: unknown[]) => {
    if (isDevelopment) {
      console.log(...args);
    }
  },

  /**
   * 경고
   */
  warn: (...args: unknown[]) => {
    if (isDevelopment) {
      console.warn(...args);
    }
  },

  /**
   * 에러 (항상 로깅)
   */
  error: (...args: unknown[]) => {
    console.error(...args);
  },
};

