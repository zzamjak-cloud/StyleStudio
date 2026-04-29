// 일러스트 세션 전용 타입 정의

// 캐릭터 분석 결과 (일러스트 전용 확장)
export interface IllustrationCharacterAnalysis {
  gender: string;
  age_group: string;
  hair: string;
  eyes: string;
  face: string;
  outfit: string;
  accessories: string;
  body_proportions: string;
  limb_proportions: string;
  torso_shape: string;
  hand_style: string;
  // 일러스트 전용 확장 필드
  species_type: string;              // human/animal/creature/hybrid
  distinctive_features: string;      // 고유 식별 특징 (가장 중요)
  color_scheme: string;              // 캐릭터 고유 색상 팔레트
  silhouette_shape: string;          // 실루엣 형태
  personality_visual_cues: string;   // 성격을 나타내는 시각적 요소
}

// 일러스트 캐릭터
export interface IllustrationCharacter {
  id: string;
  name: string;                      // 캐릭터 이름 (프롬프트 참조용)
  images: string[];                  // Base64 이미지 또는 IndexedDB 키 (최대 5장)
  imageKeys?: string[];              // IndexedDB 키
  analysis?: IllustrationCharacterAnalysis; // 개별 분석 결과
  negativePrompt?: string;           // 피해야 할 요소
}

// 배경 분석 결과
export interface BackgroundAnalysisResult {
  environment_type: string;          // indoor/outdoor/fantasy/urban/nature
  atmosphere: string;                // 분위기와 무드
  color_palette: string;             // 색상 팔레트
  lighting: string;                  // warm/cool/dramatic/soft
  time_of_day: string;               // dawn/day/dusk/night/timeless
  weather: string;                   // 날씨 (해당 시)
  depth_layers: string;              // foreground/midground/background 구성
  style_keywords: string;            // 아트 스타일 키워드
}

// 사용자 구도 스케치에 배치된 캐릭터 라벨
export interface CharacterPlacement {
  characterId: string;
  name: string;
  // 0~1 정규화 좌표 (캔버스 비율 무관)
  position: { x: number; y: number; width: number; height: number };
  pose?: string;
  facingDirection?: 'left' | 'right' | 'front' | 'back';
  interactingWith?: string[]; // 다른 캐릭터 id
}

export interface CompositionAnalysis {
  layout: string;                       // "rule of thirds, characters in foreground"
  perspective: string;                  // "low angle, three-quarter view"
  cameraDistance: 'close-up' | 'medium' | 'wide' | 'extreme-wide';
  placements: CharacterPlacement[];
  backgroundElements: string[];
  moodHint: string;
}

export interface SketchLabel {
  id: string;
  characterId?: string; // 등록된 캐릭터와 연결 (없으면 자유 라벨)
  text: string;
  x: number; // 0~1 정규화
  y: number;
}

export interface ConceptSketch {
  sketchPng: string;        // 사용자 손으로 그린 구도 스케치 PNG (data URL)
  labels: SketchLabel[];    // 캐릭터 이름 라벨
  analysis?: CompositionAnalysis;
}

// 일러스트 세션 데이터
export interface IllustrationSessionData {
  characters: IllustrationCharacter[];  // 최대 5명
  backgroundImages: string[];            // Base64 이미지 또는 IndexedDB 키, 최대 5장
  backgroundImageKeys?: string[];        // IndexedDB 키
  backgroundAnalysis?: BackgroundAnalysisResult;
  backgroundNegativePrompt?: string;     // 배경 피해야 할 요소
  conceptSketch?: ConceptSketch;         // 구도 스케치 (선택, Phase 4 신규)
}

// 제한 상수
export const ILLUSTRATION_LIMITS = {
  MAX_CHARACTERS: 5,
  MAX_IMAGES_PER_CHARACTER: 3,  // 캐릭터당 최대 3장 (너무 많으면 참조 품질 저하)
  MAX_BACKGROUND_IMAGES: 5,
} as const;
