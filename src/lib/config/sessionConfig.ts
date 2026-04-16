import { SessionType } from '../../types/session';

export type PixelArtGridLayout = '1x1' | '2x2' | '3x3' | '4x4' | '6x6' | '8x8';

/**
 * 세션 타입별 설정
 */
export interface SessionConfig {
  /** 세션 타입 라벨 (한글) */
  label: string;

  /** 아이콘 이모지 */
  icon: string;

  /** 세션 설명 */
  description: string;

  /** 색상 설정 */
  colors: {
    /** 그리드 버튼 선택 시 */
    selected: string;
    /** 그리드 버튼 미선택 시 */
    unselected: string;
    /** 그리드 섹션 배경 */
    background: string;
    /** 그리드 섹션 보더 */
    border: string;
  };

  /** 그리드 레이아웃별 설명 */
  grids: Record<PixelArtGridLayout, string>;

  /** 추가 프롬프트 placeholder */
  promptPlaceholder: string;

  /** 그리드 라벨 */
  gridLabel: string;
}

/**
 * 세션 타입별 설정 데이터
 */
export const SESSION_CONFIG: Record<SessionType, SessionConfig> = {
  BASIC: {
    label: '채팅',
    icon: '💬',
    description: '이미지 생성 채팅 모드입니다',
    colors: {
      selected: 'bg-indigo-600 text-white border-indigo-700 shadow-lg',
      unselected: 'bg-white text-gray-700 border-indigo-200 hover:border-indigo-400',
      background: 'bg-gradient-to-r from-indigo-50 to-blue-50',
      border: 'border-indigo-200',
    },
    grids: {
      '1x1': '✨ 단일 이미지를 생성합니다',
      '2x2': '✨ 4가지 이미지를 생성합니다',
      '3x3': '✨ 9가지 이미지를 생성합니다',
      '4x4': '✨ 16가지 이미지를 생성합니다',
      '6x6': '✨ 36가지 이미지를 생성합니다',
      '8x8': '✨ 64가지 이미지를 생성합니다',
    },
    promptPlaceholder: '무엇을 만들고 싶으신가요?',
    gridLabel: '💬 채팅 그리드',
  },

  CHARACTER: {
    label: '캐릭터',
    icon: '👤',
    description: '캐릭터 디자인 및 포즈 바리에이션을 생성합니다',
    colors: {
      selected: 'bg-blue-600 text-white border-blue-700 shadow-lg',
      unselected: 'bg-white text-gray-700 border-blue-200 hover:border-blue-400',
      background: 'bg-gradient-to-r from-blue-50 to-cyan-50',
      border: 'border-blue-200',
    },
    grids: {
      '1x1': '✨ 단일 캐릭터 포즈를 생성합니다 (1024px 풀사이즈)',
      '2x2': '✨ 4가지 캐릭터 포즈 바리에이션을 생성합니다',
      '3x3': '✨ 9가지 캐릭터 포즈 세트를 생성합니다',
      '4x4': '✨ 16가지 다양한 캐릭터 포즈를 생성합니다',
      '6x6': '✨ 36가지 캐릭터 포즈 대형 세트를 생성합니다',
      '8x8': '✨ 64가지 캐릭터 포즈 초대형 세트를 생성합니다',
    },
    promptPlaceholder: '예: 손을 흔들며 뒤를 돌아보는 / looking back, waving hand',
    gridLabel: '👤 캐릭터 그리드',
  },

  BACKGROUND: {
    label: '배경',
    icon: '⛰️',
    description: '배경 및 환경 디자인을 생성합니다',
    colors: {
      selected: 'bg-green-600 text-white border-green-700 shadow-lg',
      unselected: 'bg-white text-gray-700 border-green-200 hover:border-green-400',
      background: 'bg-gradient-to-r from-green-50 to-emerald-50',
      border: 'border-green-200',
    },
    grids: {
      '1x1': '✨ 단일 배경을 생성합니다 (1024px 풀사이즈)',
      '2x2': '✨ 4가지 배경 바리에이션을 생성합니다',
      '3x3': '✨ 9가지 배경 세트를 생성합니다',
      '4x4': '✨ 16가지 다양한 배경을 생성합니다',
      '6x6': '✨ 36가지 배경 대형 세트를 생성합니다',
      '8x8': '✨ 64가지 배경 초대형 세트를 생성합니다',
    },
    promptPlaceholder: '예: 숲 속, 폭포가 있는 / forest with waterfall',
    gridLabel: '⛰️ 배경 그리드',
  },

  ICON: {
    label: '아이콘',
    icon: '🎨',
    description: '아이콘 및 아이템 디자인을 생성합니다',
    colors: {
      selected: 'bg-amber-600 text-white border-amber-700 shadow-lg',
      unselected: 'bg-white text-gray-700 border-amber-200 hover:border-amber-400',
      background: 'bg-gradient-to-r from-amber-50 to-orange-50',
      border: 'border-amber-200',
    },
    grids: {
      '1x1': '✨ 단일 아이콘을 생성합니다 (1024px 풀사이즈)',
      '2x2': '✨ 4가지 아이콘 바리에이션을 생성합니다',
      '3x3': '✨ 9개 아이콘 세트를 생성합니다',
      '4x4': '✨ 16개 아이콘 세트를 생성합니다',
      '6x6': '✨ 36개 아이콘 대형 세트를 생성합니다',
      '8x8': '✨ 64개 아이콘 초대형 세트를 생성합니다',
    },
    promptPlaceholder: '예: 불타는 검, 빛나는 / flaming sword, glowing',
    gridLabel: '🎨 아이콘 그리드',
  },

  STYLE: {
    label: '스타일',
    icon: '✨',
    description: '스타일 참조 및 일반 이미지를 생성합니다',
    colors: {
      selected: 'bg-purple-600 text-white border-purple-700 shadow-lg',
      unselected: 'bg-white text-gray-700 border-purple-200 hover:border-purple-400',
      background: 'bg-gradient-to-r from-purple-50 to-pink-50',
      border: 'border-purple-200',
    },
    grids: {
      '1x1': '✨ 단일 이미지를 생성합니다 (1024px 풀사이즈)',
      '2x2': '✨ 4가지 스타일 바리에이션을 생성합니다',
      '3x3': '✨ 9가지 스타일 작품 세트를 생성합니다',
      '4x4': '✨ 16가지 다양한 스타일 작품을 생성합니다',
      '6x6': '✨ 36가지 스타일 대형 세트를 생성합니다',
      '8x8': '✨ 64가지 스타일 초대형 세트를 생성합니다',
    },
    promptPlaceholder: '예: 밤 풍경, 비오는 날씨 / night scene, rainy weather',
    gridLabel: '✨ 스타일 그리드',
  },

  UI: {
    label: 'UI 디자인',
    icon: '📱',
    description: '게임/앱 UI 화면 디자인을 생성합니다',
    colors: {
      selected: 'bg-pink-600 text-white border-pink-700 shadow-lg',
      unselected: 'bg-white text-gray-700 border-pink-200 hover:border-pink-400',
      background: 'bg-gradient-to-r from-pink-50 to-rose-50',
      border: 'border-pink-200',
    },
    grids: {
      '1x1': '✨ 단일 UI 화면 (1024px)',
      '2x2': '✨ 4가지 UI 화면 바리에이션',
      '3x3': '✨ 9개 UI 화면 세트',
      '4x4': '✨ 16개 UI 화면 세트',
      '6x6': '✨ 36개 UI 화면 대형 세트',
      '8x8': '✨ 64개 UI 화면 초대형 세트',
    },
    promptPlaceholder: `UI 화면 종류를 설명하세요 (예: 로그인 화면, 상점 화면, 인벤토리 화면)`,
    gridLabel: '📱 UI 화면 그리드',
  },

  LOGO: {
    label: '로고',
    icon: '🔤',
    description: '로고 타이틀 디자인을 생성합니다',
    colors: {
      selected: 'bg-red-600 text-white border-red-700 shadow-lg',
      unselected: 'bg-white text-gray-700 border-red-200 hover:border-red-400',
      background: 'bg-gradient-to-r from-red-50 to-orange-50',
      border: 'border-red-200',
    },
    grids: {
      '1x1': '✨ 단일 로고를 생성합니다 (1024px 풀사이즈)',
      '2x2': '✨ 4가지 로고 재질/색상 바리에이션을 생성합니다',
      '3x3': '✨ 9가지 로고 스타일 옵션을 생성합니다',
      '4x4': '✨ 16가지 다양한 로고 스타일 옵션을 생성합니다 (A/B 테스트용)',
      '6x6': '✨ 36가지 로고 대형 바리에이션 세트를 생성합니다',
      '8x8': '✨ 64가지 로고 초대형 바리에이션 세트를 생성합니다',
    },
    promptPlaceholder: `로고 타이틀 텍스트와 스타일을 설명하세요 (예: "DRAGON POP" 젤리 재질, 버블 폰트)`,
    gridLabel: '🔤 로고 그리드',
  },

  ILLUSTRATION: {
    label: '일러스트',
    icon: '🎨',
    description: '여러 캐릭터가 등장하는 일러스트 씬을 생성합니다',
    colors: {
      selected: 'bg-violet-600 text-white border-violet-700 shadow-lg',
      unselected: 'bg-white text-gray-700 border-violet-200 hover:border-violet-400',
      background: 'bg-gradient-to-r from-violet-50 to-purple-50',
      border: 'border-violet-200',
    },
    grids: {
      '1x1': '✨ 단일 일러스트를 생성합니다 (1024px 풀사이즈)',
      '2x2': '✨ 4가지 씬 바리에이션을 생성합니다',
      '3x3': '✨ 9가지 씬 구성 세트를 생성합니다',
      '4x4': '✨ 16가지 다양한 씬 구성을 생성합니다',
      '6x6': '✨ 36가지 씬 대형 세트를 생성합니다',
      '8x8': '✨ 64가지 씬 초대형 세트를 생성합니다',
    },
    promptPlaceholder: `캐릭터 이름을 사용하여 씬을 설명하세요 (예: 라미가 토끼와 함께 꽃밭에서 놀고 있다)`,
    gridLabel: '🎨 일러스트 그리드',
  },

  PIXELART_CHARACTER: {
    label: '픽셀아트 캐릭터',
    icon: '🎮',
    description: '픽셀아트 캐릭터 및 애니메이션을 생성합니다',
    colors: {
      selected: 'bg-cyan-600 text-white border-cyan-700 shadow-lg',
      unselected: 'bg-white text-gray-700 border-cyan-200 hover:border-cyan-400',
      background: 'bg-gradient-to-r from-cyan-50 to-teal-50',
      border: 'border-cyan-200',
    },
    grids: {
      '1x1': '✨ 단일 이미지를 생성합니다 (1024px 풀사이즈)',
      '2x2': '✨ 4가지 바리에이션을 생성합니다 (예: 4방향 대기 자세)',
      '3x3': '✨ 9프레임 애니메이션을 생성합니다',
      '4x4': '✨ 완전한 애니메이션 시퀀스를 생성합니다 (예: 공격 동작 16프레임)',
      '6x6': '✨ 36프레임 복잡한 애니메이션을 생성합니다',
      '8x8': '✨ 64프레임 매우 상세한 애니메이션을 생성합니다',
    },
    promptPlaceholder: `애니메이션 동작을 설명하세요 (예: attack, walk, jump, idle)`,
    gridLabel: '🎮 픽셀아트 캐릭터 그리드',
  },

  PIXELART_BACKGROUND: {
    label: '픽셀아트 배경',
    icon: '🏞️',
    description: '픽셀아트 배경 및 씬을 생성합니다',
    colors: {
      selected: 'bg-cyan-600 text-white border-cyan-700 shadow-lg',
      unselected: 'bg-white text-gray-700 border-cyan-200 hover:border-cyan-400',
      background: 'bg-gradient-to-r from-cyan-50 to-teal-50',
      border: 'border-cyan-200',
    },
    grids: {
      '1x1': '✨ 단일 이미지를 생성합니다 (1024px 풀사이즈)',
      '2x2': '✨ 4가지 바리에이션을 생성합니다 (예: 시간대별 변화)',
      '3x3': '✨ 9가지 배경 타일을 생성합니다',
      '4x4': '✨ 16가지 배경 바리에이션을 생성합니다',
      '6x6': '✨ 36가지 배경 대형 세트를 생성합니다',
      '8x8': '✨ 64가지 배경 초대형 세트를 생성합니다',
    },
    promptPlaceholder: `배경 바리에이션을 설명하세요 (예: forest at different times, dungeon levels)`,
    gridLabel: '🏞️ 픽셀아트 배경 그리드',
  },

  PIXELART_ICON: {
    label: '픽셀아트 아이콘',
    icon: '💎',
    description: '픽셀아트 아이템 및 아이콘을 생성합니다',
    colors: {
      selected: 'bg-cyan-600 text-white border-cyan-700 shadow-lg',
      unselected: 'bg-white text-gray-700 border-cyan-200 hover:border-cyan-400',
      background: 'bg-gradient-to-r from-cyan-50 to-teal-50',
      border: 'border-cyan-200',
    },
    grids: {
      '1x1': '✨ 단일 이미지를 생성합니다 (1024px 풀사이즈)',
      '2x2': '✨ 4가지 아이콘 바리에이션을 생성합니다',
      '3x3': '✨ 9개 아이콘 세트를 생성합니다',
      '4x4': '✨ 16개 아이콘 세트를 생성합니다',
      '6x6': '✨ 36개 아이콘 대형 세트를 생성합니다',
      '8x8': '✨ 64개 아이콘 초대형 세트를 생성합니다',
    },
    promptPlaceholder: `픽셀아트 아이콘을 설명하세요 (예: health potion, mana crystal, gold coin)`,
    gridLabel: '💎 픽셀아트 아이콘 그리드',
  },

  CONCEPT: {
    label: '컨셉',
    icon: '🎨',
    description: '게임 컨셉 아트를 생성합니다',
    colors: {
      selected: 'bg-purple-600 text-white border-purple-700 shadow-lg',
      unselected: 'bg-white text-gray-700 border-purple-200 hover:border-purple-400',
      background: 'bg-gradient-to-r from-purple-50 to-pink-50',
      border: 'border-purple-200',
    },
    grids: {
      '1x1': '✨ 단일 컨셉 아트를 생성합니다',
      '2x2': '✨ 4가지 컨셉 바리에이션을 생성합니다',
      '3x3': '✨ 9가지 컨셉 세트를 생성합니다',
      '4x4': '✨ 16가지 다양한 컨셉을 생성합니다',
      '6x6': '✨ 36가지 컨셉 대형 세트를 생성합니다',
      '8x8': '✨ 64가지 컨셉 초대형 세트를 생성합니다',
    },
    promptPlaceholder: '비워두면 입력된 정보를 기반으로 자동 생성합니다...',
    gridLabel: '🎨 컨셉 그리드',
  },
};

/**
 * 세션 타입에 따른 그리드 버튼 스타일 반환
 */
export function getGridButtonStyle(sessionType: SessionType, isSelected: boolean): string {
  const config = SESSION_CONFIG[sessionType];
  return isSelected ? config.colors.selected : config.colors.unselected;
}

/**
 * 세션 타입과 그리드에 따른 설명 반환
 */
export function getGridDescription(sessionType: SessionType, grid: PixelArtGridLayout): string {
  return SESSION_CONFIG[sessionType].grids[grid];
}

/**
 * 세션 타입에 따른 추가 프롬프트 placeholder 반환
 */
export function getPromptPlaceholder(sessionType: SessionType, grid?: PixelArtGridLayout): string {
  const config = SESSION_CONFIG[sessionType];

  // UI, LOGO, PIXELART_* 타입은 그리드에 따라 동적 메시지 추가
  if (grid && (sessionType === 'UI' || sessionType === 'LOGO' || sessionType.startsWith('PIXELART_'))) {
    const gridInfo = config.grids[grid];
    return `${config.promptPlaceholder}\n→ ${gridInfo}`;
  }

  return config.promptPlaceholder;
}

/**
 * 세션 타입에 따른 그리드 라벨 반환
 */
export function getGridLabel(sessionType: SessionType): string {
  return SESSION_CONFIG[sessionType].gridLabel;
}

/**
 * 세션 타입에 따른 그리드 섹션 배경/보더 스타일 반환
 */
export function getGridSectionStyle(sessionType: SessionType): string {
  const config = SESSION_CONFIG[sessionType];
  return `${config.colors.background} ${config.colors.border}`;
}
