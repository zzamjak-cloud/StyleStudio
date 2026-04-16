// 스타일 분석 결과
export interface StyleAnalysis {
  art_style: string;      // 화풍 (예: oil painting, anime, pixel art)
  technique: string;      // 기법 (예: thick impasto, cel shading)
  color_palette: string;  // 색상 특징
  lighting: string;       // 조명
  mood: string;          // 분위기
}

// 캐릭터 분석 결과
export interface CharacterAnalysis {
  gender: string;        // 성별
  age_group: string;     // 연령대
  hair: string;          // 머리 스타일과 색상 (고정 특징)
  eyes: string;          // 눈 색상과 형태 (고정 특징)
  face: string;          // 얼굴 특징 (고정 특징)
  outfit: string;        // 의상 (고정 특징)
  accessories: string;   // 액세서리나 특징적인 아이템
  body_proportions: string; // 등신대 비율 (예: 2-head, 3-head, realistic 8-head)
  limb_proportions: string; // 팔과 다리의 비례 (예: short stubby arms, normal proportions, elongated limbs)
  torso_shape: string;   // 몸통 형태 (예: compact rounded torso, rectangular body, slim waist)
  hand_style: string;    // 손 표현 방식 (예: simplified 3-finger, detailed 5-finger, mitten style)
  feet_style: string;    // 발 표현 방식 (예: simplified rounded feet, detailed toes, stubby paws, pointed shoes)
}

// 구도 분석 결과
export interface CompositionAnalysis {
  pose: string;              // 현재 포즈/자세
  angle: string;             // 카메라 앵글
  background: string;        // 배경 설명
  depth_of_field: string;    // 심도
}

// 픽셀아트 특화 분석 결과 (픽셀아트 타입일 때만 사용)
export interface PixelArtSpecificAnalysis {
  resolution_estimate: string;    // 추정 해상도 (예: "64x64", "128x128", "256x256")
  color_palette_count: string;    // 사용된 색상 수 (예: "4 colors", "16 colors", "32 colors")
  pixel_density: string;          // 픽셀 밀도 (예: "Low-res 8-bit", "Mid-res 16-bit", "Hi-res 32-bit")
  style_era: string;              // 스타일 시대 (예: "NES 8-bit", "SNES 16-bit", "GBA 32-bit", "Modern indie")
  perspective: string;            // 시점 (예: "Top-down", "Side-view", "Isometric", "Front-view")
  outline_style: string;          // 외곽선 스타일 (예: "Black 1px outlines", "Colored outlines", "No outlines")
  shading_technique: string;      // 음영 기법 (예: "Dithering", "Color banding", "Flat colors")
  anti_aliasing: string;          // 안티앨리어싱 사용 여부 (예: "None - pure pixels", "Selective AA on curves")
}

// UI 디자인 특화 분석 결과 (UI 타입일 때만 사용)
export interface UISpecificAnalysis {
  platform_type: string;   // 플랫폼 및 유형 (예: "Mobile App - Fintech Dashboard", "Desktop Web - E-commerce Landing")
  visual_style: string;    // 비주얼 스타일 (예: "Glassmorphism with Dark Mode", "Minimalist Flat Design")
  key_elements: string;    // 핵심 UI 요소 (예: "Credit card visual, transaction list, circular progress bar")
  color_theme: string;     // 색상 테마 (예: "Deep Navy (#1A1F3A) with Neon Green (#00FF88)")
}

// 로고 특화 분석 결과 (LOGO 타입일 때만 사용)
export interface LogoSpecificAnalysis {
  typography_style: string;      // 폰트 스타일 (예: "Cartoonish Bubble", "Blocky Bold", "Handwritten Script")
  text_warping: string;          // 텍스트 변형 (예: "Arched upward", "Fish-eye bulging", "Straight no warp")
  text_weight: string;           // 폰트 두께 (예: "Super Bold", "Chunky Thick", "Medium")
  edge_treatment: string;        // 모서리 처리 (예: "Rounded smooth", "Angular sharp", "Mixed")
  material_type: string;         // 재질 타입 (예: "Glossy Plastic/Candy", "Jelly/Gelatinous", "Metallic")
  rendering_style: string;       // 렌더링 스타일 (예: "2D Flat", "3D Rendered - deep extrude")
  surface_quality: string;       // 표면 품질 (예: "High-Gloss", "Matte", "Translucent")
  outline_style: string;         // 외곽선 스타일 (예: "Double thick outline - white + black")
  drop_shadow: string;           // 그림자 (예: "Soft subtle", "Hard strong", "Long dramatic")
  inner_effects: string;         // 내부 효과 (예: "Rim lighting on edges", "Inner glow fill")
  decorative_elements: string;   // 장식 요소 (예: "Sparkles/Stars around", "No decorations")
  color_vibrancy: string;        // 색상 채도 (예: "High Vibrant Neon", "Medium Saturated")
  color_count: string;           // 색상 개수 (예: "3 tri-color", "2 duo-tone")
  gradient_usage: string;        // 그라데이션 사용 (예: "Strong gradient across logo", "No gradient")
  genre_hint: string;            // 장르 힌트 (예: "Match-3 Puzzle", "RPG/Strategy", "Endless Runner/Action")
}

// 전체 분석 결과
export interface ImageAnalysisResult {
  style: StyleAnalysis;
  character: CharacterAnalysis;
  composition: CompositionAnalysis;
  negative_prompt: string; // 피해야 할 요소들 (예: realistic hands, detailed fingers, 8-head proportions)
  pixelart_specific?: PixelArtSpecificAnalysis; // 픽셀아트 타입일 때만 존재
  ui_specific?: UISpecificAnalysis; // UI 타입일 때만 존재
  logo_specific?: LogoSpecificAnalysis; // LOGO 타입일 때만 존재
}
