/**
 * 날짜/시간 포맷팅 유틸리티 함수들
 */

/**
 * 타임스탬프를 로케일 문자열로 변환
 * @param timestamp - 변환할 타임스탬프 (Date 객체, 문자열, 또는 숫자)
 * @param locale - 로케일 (기본값: 'ko-KR')
 * @param options - 포맷 옵션
 * @returns 포맷된 날짜/시간 문자열
 */
export function formatDateTime(
  timestamp: Date | string | number,
  locale: string = 'ko-KR',
  options?: Intl.DateTimeFormatOptions
): string {
  const date = new Date(timestamp);

  const defaultOptions: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  };

  return date.toLocaleString(locale, options || defaultOptions);
}

/**
 * 타임스탬프를 날짜만 표시 (시간 제외)
 * @param timestamp - 변환할 타임스탬프
 * @param locale - 로케일 (기본값: 'ko-KR')
 * @returns 포맷된 날짜 문자열
 */
export function formatDate(
  timestamp: Date | string | number,
  locale: string = 'ko-KR'
): string {
  const date = new Date(timestamp);
  return date.toLocaleDateString(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

/**
 * 타임스탬프를 시간만 표시 (날짜 제외)
 * @param timestamp - 변환할 타임스탬프
 * @param locale - 로케일 (기본값: 'ko-KR')
 * @returns 포맷된 시간 문자열
 */
export function formatTime(
  timestamp: Date | string | number,
  locale: string = 'ko-KR'
): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

/**
 * 상대 시간 표시 (예: "방금 전", "5분 전", "2시간 전")
 * @param timestamp - 변환할 타임스탬프
 * @returns 상대 시간 문자열
 */
export function formatRelativeTime(timestamp: Date | string | number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) {
    return '방금 전';
  } else if (diffMin < 60) {
    return `${diffMin}분 전`;
  } else if (diffHour < 24) {
    return `${diffHour}시간 전`;
  } else if (diffDay < 7) {
    return `${diffDay}일 전`;
  } else {
    // 7일 이상은 절대 시간 표시
    return formatDateTime(date);
  }
}

/**
 * 간단한 날짜/시간 표시 (예: "2026-01-12 14:30")
 * @param timestamp - 변환할 타임스탬프
 * @returns 간단한 포맷의 날짜/시간 문자열
 */
export function formatSimpleDateTime(timestamp: Date | string | number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');

  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

/**
 * 파일명에 사용할 수 있는 타임스탬프 문자열 생성
 * @param timestamp - 변환할 타임스탬프 (기본값: 현재 시간)
 * @returns 파일명용 타임스탬프 (예: "20260112_143052")
 */
export function formatTimestampForFilename(timestamp?: Date | string | number): string {
  const date = timestamp ? new Date(timestamp) : new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');

  return `${year}${month}${day}_${hours}${minutes}${seconds}`;
}

/**
 * ISO 8601 형식으로 변환 (예: "2026-01-12T14:30:52.123Z")
 * @param timestamp - 변환할 타임스탬프 (기본값: 현재 시간)
 * @returns ISO 8601 형식 문자열
 */
export function toISOString(timestamp?: Date | string | number): string {
  const date = timestamp ? new Date(timestamp) : new Date();
  return date.toISOString();
}

/**
 * Unix 타임스탬프(초)를 Date 객체로 변환
 * @param unixTimestamp - Unix 타임스탬프 (초 단위)
 * @returns Date 객체
 */
export function fromUnixTimestamp(unixTimestamp: number): Date {
  return new Date(unixTimestamp * 1000);
}

/**
 * Date 객체를 Unix 타임스탬프(초)로 변환
 * @param date - Date 객체
 * @returns Unix 타임스탬프 (초 단위)
 */
export function toUnixTimestamp(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}
