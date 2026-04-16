/** 컨셉 세션 전용 데이터 */
export interface ConceptSessionData {
  // 참조 이미지 (1장)
  referenceImage?: string; // Base64 이미지 데이터

  // 게임 정보
  gameGenres: string[]; // 게임 장르 (하이퍼캐주얼, 퍼즐 등)
  gamePlayStyle?: string; // 게임 플레이 방식 설명
  referenceGames?: string[]; // 레퍼런스 게임 목록

  // 원하는 스타일
  artStyles: string[]; // 아트 스타일 (로우폴리, 카툰 등)

  // 생성 설정
  generationSettings: {
    model: 'nanobanana-pro' | 'nanobanana-2';
    ratio: '1:1' | '16:9' | '9:16' | '4:3' | '3:4';
    size: '1k' | '2k' | '3k';
    grid: '1x1' | '2x2' | '3x3' | '4x4';
  };

  // 생성 히스토리
  history: ConceptGenerationEntry[];
}

/** 컨셉 생성 히스토리 엔트리 */
export interface ConceptGenerationEntry {
  id: string;
  timestamp: string;
  prompt: string; // 사용된 프롬프트
  imageBase64: string; // 생성된 이미지
  settings: {
    model: string;
    ratio: string;
    size: string;
    grid: string;
  };
  gameInfo?: {
    genres: string[];
    playStyle?: string;
    referenceGames?: string[];
    artStyles: string[];
  };
}

/** 게임 장르 프리셋 */
export const GAME_GENRE_PRESETS = [
  '하이퍼 캐주얼',
  '하이브리드 캐주얼',
  '퍼즐',
  '아이들',
  '시뮬레이션',
  '4X',
  '타이쿤',
  '아케이드',
  '액션',
] as const;

/** 아트 스타일 프리셋 */
export const ART_STYLE_PRESETS = [
  '로우 폴리',
  '카툰 렌더',
  '셀 셰이딩',
  '소프트 3D',
  '플랫디자인',
  '벡터아트',
  '픽셀아트',
  '미니멀리즘',
  '비비드',
  '네온',
  '클레이',
  '병맛',
] as const;