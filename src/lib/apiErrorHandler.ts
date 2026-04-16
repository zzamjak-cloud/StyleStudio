import { logger } from './logger';

/**
 * API 에러 타입 정의
 */
export interface ApiError {
  message: string;
  code?: string;
  status?: number;
  details?: unknown;
}

/**
 * API 에러를 파싱하여 표준화된 에러 객체로 변환
 */
export function parseApiError(error: unknown): ApiError {
  if (error instanceof Error) {
    // 네트워크 에러 또는 일반 에러
    return {
      message: error.message,
      details: error,
    };
  }

  if (typeof error === 'object' && error !== null) {
    const errorObj = error as Record<string, unknown>;
    
    // Gemini API 에러 형식
    if (errorObj.error) {
      const apiError = errorObj.error as Record<string, unknown>;
      return {
        message: (apiError.message as string) || '알 수 없는 API 에러',
        code: (apiError.code as string) || undefined,
        status: (apiError.status as number) || undefined,
        details: apiError,
      };
    }

    // 일반 객체 에러
    return {
      message: (errorObj.message as string) || '알 수 없는 에러',
      code: (errorObj.code as string) || undefined,
      status: (errorObj.status as number) || undefined,
      details: errorObj,
    };
  }

  // 알 수 없는 타입의 에러
  return {
    message: String(error) || '알 수 없는 에러',
    details: error,
  };
}

/**
 * API 에러를 사용자 친화적인 메시지로 변환
 */
export function getUserFriendlyErrorMessage(error: ApiError): string {
  // Gemini API 에러 코드별 메시지
  if (error.code) {
    switch (error.code) {
      case 'INVALID_ARGUMENT':
        return '잘못된 요청입니다. 입력값을 확인해주세요.';
      case 'PERMISSION_DENIED':
        return '권한이 없습니다. API 키를 확인해주세요.';
      case 'NOT_FOUND':
        return '요청한 리소스를 찾을 수 없습니다.';
      case 'RESOURCE_EXHAUSTED':
        return 'API 할당량이 초과되었습니다. 잠시 후 다시 시도해주세요.';
      case 'UNAUTHENTICATED':
        return '인증에 실패했습니다. API 키를 확인해주세요.';
      case 'DEADLINE_EXCEEDED':
        return '요청 시간이 초과되었습니다. 다시 시도해주세요.';
      case 'INTERNAL':
        return '서버 내부 오류가 발생했습니다. 잠시 후 다시 시도해주세요.';
      case 'UNAVAILABLE':
        return '서비스를 사용할 수 없습니다. 잠시 후 다시 시도해주세요.';
      default:
        return error.message || '알 수 없는 오류가 발생했습니다.';
    }
  }

  // HTTP 상태 코드별 메시지
  if (error.status) {
    switch (error.status) {
      case 400:
        return '잘못된 요청입니다. 입력값을 확인해주세요.';
      case 401:
        return '인증에 실패했습니다. API 키를 확인해주세요.';
      case 403:
        return '권한이 없습니다. API 키를 확인해주세요.';
      case 404:
        return '요청한 리소스를 찾을 수 없습니다.';
      case 429:
        return '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.';
      case 500:
        return '서버 내부 오류가 발생했습니다. 잠시 후 다시 시도해주세요.';
      case 503:
        return '서비스를 사용할 수 없습니다. 잠시 후 다시 시도해주세요.';
      default:
        return error.message || '알 수 없는 오류가 발생했습니다.';
    }
  }

  // 일반 에러 메시지
  return error.message || '알 수 없는 오류가 발생했습니다.';
}

/**
 * API 에러를 로깅하고 사용자 친화적인 메시지 반환
 */
export function handleApiError(error: unknown): string {
  const apiError = parseApiError(error);
  const userMessage = getUserFriendlyErrorMessage(apiError);

  logger.error('❌ API 에러:', {
    message: apiError.message,
    code: apiError.code,
    status: apiError.status,
    details: apiError.details,
  });

  return userMessage;
}

/**
 * API 응답에서 에러를 추출
 */
export async function extractErrorFromResponse(response: Response): Promise<ApiError> {
  try {
    const errorText = await response.text();
    let errorData: unknown;

    try {
      errorData = JSON.parse(errorText);
    } catch {
      errorData = { message: errorText };
    }

    const errorObj = typeof errorData === 'object' && errorData !== null 
      ? errorData as Record<string, unknown>
      : { message: String(errorData) };

    return parseApiError({
      ...errorObj,
      status: response.status,
    });
  } catch (error) {
    return parseApiError({
      message: `HTTP ${response.status}: ${response.statusText}`,
      status: response.status,
      details: error,
    });
  }
}

