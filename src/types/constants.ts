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
  /** API 키 (OpenRouter 통합 키) */
  API_KEY: 'openrouter_api_key',
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

/** 최신 Flash 텍스트/분석 모델 (OpenRouter 슬러그) */
export const GEMINI_FLASH_TEXT_MODEL = 'google/gemini-3.7-flash';

/**
 * 참조 이미지 분석에 사용 가능한 모델 목록 (OpenRouter 슬러그)
 * - flash: 빠르고 저렴, 대부분의 분석에 충분
 * - pro: 추론 깊이가 필요한 다중 이미지·복잡한 구조화 분석용 (고비용)
 */
export const ANALYSIS_MODELS = [
  { id: GEMINI_FLASH_TEXT_MODEL, label: 'Gemini 3.7 Flash', description: '최신 Flash · 기본' },
  { id: 'google/gemini-3.6-flash', label: 'Gemini 3.6 Flash', description: '이전 Flash · 안정' },
  { id: 'google/gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro', description: '정밀 분석 · 고비용' },
] as const;

export type AnalysisModelId = (typeof ANALYSIS_MODELS)[number]['id'];

/** 기본 분석 모델 */
export const DEFAULT_ANALYSIS_MODEL: AnalysisModelId = GEMINI_FLASH_TEXT_MODEL;

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
