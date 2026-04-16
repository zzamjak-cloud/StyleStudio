/**
 * 애플리케이션 전역 상수 정의
 */

// ============================================
// 이미지 생성 기본값
// ============================================

/**
 * Gemini 이미지 생성 기본 파라미터
 */
export const IMAGE_GENERATION_DEFAULTS = {
  /** 기본 종횡비 */
  ASPECT_RATIO: '1:1' as const,
  /** 기본 이미지 크기 */
  IMAGE_SIZE: '1K' as const,
  /** 기본 픽셀 아트 그리드 레이아웃 */
  PIXEL_ART_GRID: '1x1' as const,
  /** 참조 이미지 사용 여부 */
  USE_REFERENCE_IMAGES: true,
} as const;

/**
 * Gemini 고급 설정 기본값
 */
export const ADVANCED_SETTINGS_DEFAULTS = {
  /** Temperature (창의성) - 0.0 ~ 2.0 */
  TEMPERATURE: 1.0,
  /** Top-K (샘플링 범위) - 1 ~ 100 */
  TOP_K: 40,
  /** Top-P (누적 확률) - 0.0 ~ 1.0 */
  TOP_P: 0.95,
  /** 참조 이미지 강도 - 0.0 ~ 2.0 */
  REFERENCE_STRENGTH: 1.0,
} as const;

/**
 * 고급 설정 범위 제한
 */
export const ADVANCED_SETTINGS_LIMITS = {
  /** Temperature 범위 */
  TEMPERATURE: { MIN: 0.0, MAX: 2.0, STEP: 0.1 },
  /** Top-K 범위 */
  TOP_K: { MIN: 1, MAX: 100, STEP: 1 },
  /** Top-P 범위 */
  TOP_P: { MIN: 0.0, MAX: 1.0, STEP: 0.05 },
  /** 참조 이미지 강도 범위 */
  REFERENCE_STRENGTH: { MIN: 0.0, MAX: 2.0, STEP: 0.1 },
} as const;

// ============================================
// UI 레이아웃 상수
// ============================================

/**
 * 히스토리 패널 관련 상수
 */
export const HISTORY_PANEL = {
  /** 기본 높이 (px) */
  DEFAULT_HEIGHT: 192,
  /** 최소 높이 (px) */
  MIN_HEIGHT: 100,
  /** 최대 높이 (px) */
  MAX_HEIGHT: 600,
  /** 그리드 컬럼 수 */
  GRID_COLUMNS: 8,
} as const;

/**
 * 줌 레벨 옵션 (%)
 */
export const ZOOM_LEVELS = [50, 75, 100, 125, 150, 200] as const;

/**
 * 이미지 크기별 픽셀 해상도
 */
export const IMAGE_SIZE_PIXELS = {
  '1K': 1024,
  '2K': 2048,
  '4K': 4096,
} as const;

// ============================================
// 파일 관련 상수
// ============================================

/**
 * 참조 이미지 제한
 */
export const REFERENCE_IMAGES = {
  /** 최대 참조 이미지 수 */
  MAX_COUNT: 10,
  /** 최대 파일 크기 (MB) */
  MAX_FILE_SIZE_MB: 10,
  /** 최대 파일 크기 (바이트) */
  MAX_FILE_SIZE_BYTES: 10 * 1024 * 1024,
  /** 지원하는 이미지 형식 */
  SUPPORTED_FORMATS: ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'] as const,
} as const;

/**
 * 참조 문서 제한 (UI 세션 전용)
 */
export const REFERENCE_DOCUMENTS = {
  /** 최대 참조 문서 수 */
  MAX_COUNT: 5,
  /** 최대 파일 크기 (MB) */
  MAX_FILE_SIZE_MB: 20,
  /** 최대 파일 크기 (바이트) */
  MAX_FILE_SIZE_BYTES: 20 * 1024 * 1024,
  /** 지원하는 문서 형식 */
  SUPPORTED_FORMATS: [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'text/csv',
    'text/markdown',
    'text/plain',
  ] as const,
  /** 지원하는 파일 확장자 */
  SUPPORTED_EXTENSIONS: ['pdf', 'xlsx', 'xls', 'csv', 'md', 'txt'] as const,
} as const;

/**
 * 이미지 압축 설정
 */
export const IMAGE_COMPRESSION = {
  /** JPEG 품질 (0.0 ~ 1.0) */
  JPEG_QUALITY: 0.8,
  /** PNG 품질 (0.0 ~ 1.0) */
  PNG_QUALITY: 0.92,
  /** 썸네일 최대 크기 (px) */
  THUMBNAIL_MAX_SIZE: 200,
  /** 프리뷰 최대 크기 (px) */
  PREVIEW_MAX_SIZE: 1024,
} as const;

// ============================================
// 시간 관련 상수
// ============================================

/**
 * 타임아웃 설정 (밀리초)
 */
export const TIMEOUTS = {
  /** API 요청 타임아웃 */
  API_REQUEST: 120000, // 2분
  /** 이미지 생성 타임아웃 */
  IMAGE_GENERATION: 300000, // 5분
  /** 파일 업로드 타임아웃 */
  FILE_UPLOAD: 60000, // 1분
  /** 디바운스 기본값 */
  DEBOUNCE_DEFAULT: 300, // 0.3초
  /** 툴팁 표시 지연 */
  TOOLTIP_DELAY: 500, // 0.5초
} as const;

/**
 * 재시도 설정
 */
export const RETRY_CONFIG = {
  /** 최대 재시도 횟수 */
  MAX_ATTEMPTS: 3,
  /** 초기 지연 시간 (밀리초) */
  INITIAL_DELAY: 1000,
  /** 지연 시간 증가 배율 */
  BACKOFF_MULTIPLIER: 2,
} as const;

// ============================================
// 세션 관련 상수
// ============================================

/**
 * 세션 제한
 */
export const SESSION_LIMITS = {
  /** 최대 세션 수 */
  MAX_SESSIONS: 50,
  /** 최대 히스토리 항목 수 (세션당) */
  MAX_HISTORY_PER_SESSION: 100,
  /** 자동 저장 간격 (밀리초) */
  AUTO_SAVE_INTERVAL: 5000, // 5초
} as const;

/**
 * 로컬 스토리지 키
 */
export const STORAGE_KEYS = {
  /** 세션 데이터 */
  SESSIONS: 'sessions',
  /** 설정 */
  SETTINGS: 'settings',
  /** API 키 */
  API_KEY: 'gemini_api_key',
  /** 자동 저장 경로 */
  AUTO_SAVE_PATH: 'auto_save_path',
  /** 테마 설정 */
  THEME: 'theme',
} as const;

// ============================================
// 프롬프트 관련 상수
// ============================================

/**
 * 프롬프트 제한
 */
export const PROMPT_LIMITS = {
  /** 최대 프롬프트 길이 */
  MAX_LENGTH: 5000,
  /** 최소 프롬프트 길이 */
  MIN_LENGTH: 1,
  /** 권장 프롬프트 길이 */
  RECOMMENDED_LENGTH: 500,
} as const;

// ============================================
// API 관련 상수
// ============================================

/**
 * Gemini API 엔드포인트
 */
export const GEMINI_API = {
  /** 기본 URL */
  BASE_URL: 'https://generativelanguage.googleapis.com',
  /** 모델 버전 */
  MODEL_VERSION: 'gemini-3-pro',
  /** 이미지 생성 모델 */
  IMAGE_MODEL: 'imagen-3.0-generate-001',
} as const;

/**
 * 에러 메시지
 */
export const ERROR_MESSAGES = {
  /** API 키 없음 */
  NO_API_KEY: 'API 키가 설정되지 않았습니다',
  /** 네트워크 오류 */
  NETWORK_ERROR: '네트워크 연결을 확인해주세요',
  /** 파일 크기 초과 */
  FILE_TOO_LARGE: '파일 크기가 너무 큽니다',
  /** 지원하지 않는 파일 형식 */
  UNSUPPORTED_FORMAT: '지원하지 않는 파일 형식입니다',
  /** 최대 참조 이미지 수 초과 */
  TOO_MANY_IMAGES: '참조 이미지는 최대 {{max}}개까지 추가할 수 있습니다',
  /** 이미지 생성 실패 */
  GENERATION_FAILED: '이미지 생성에 실패했습니다',
  /** 저장 실패 */
  SAVE_FAILED: '저장에 실패했습니다',
} as const;

// ============================================
// 개발 모드 상수
// ============================================

/**
 * 개발 모드 설정
 */
export const DEV_CONFIG = {
  /** 로그 레벨 */
  LOG_LEVEL: 'debug' as const,
  /** API 모킹 활성화 */
  ENABLE_MOCKING: false,
  /** 성능 프로파일링 활성화 */
  ENABLE_PROFILING: false,
} as const;
