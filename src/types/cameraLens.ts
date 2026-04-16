// 카메라 렌즈/화각 프리셋 타입
export interface CameraLens {
  id: string;
  label: string;        // 한글 라벨
  prompt: string;       // 영어 프롬프트
  description: string;  // 설명
  category: 'none' | 'ultra-wide' | 'wide' | 'standard' | 'telephoto' | 'special';
}

// 카메라 렌즈/화각 프리셋 목록
export const CAMERA_LENSES: CameraLens[] = [
  {
    id: 'none',
    label: '선택 안함',
    prompt: '',
    description: '렌즈/화각을 지정하지 않습니다',
    category: 'none',
  },
  // 초광각 (Ultra-Wide)
  {
    id: '14mm',
    label: '14mm 초광각',
    prompt: '14mm ultra-wide angle lens, expansive field of view, dramatic perspective',
    description: '극도로 넓은 시야, 웅장한 건축물이나 광활한 풍경에 적합',
    category: 'ultra-wide',
  },
  {
    id: '16mm',
    label: '16mm 초광각',
    prompt: '16mm ultra-wide angle lens, wide field of view, cinematic landscape',
    description: '시네마틱한 풍경, 실내 전경, 웅장함을 표현할 때 사용',
    category: 'ultra-wide',
  },
  {
    id: '20mm',
    label: '20mm 광각',
    prompt: '20mm wide angle lens, environmental portrait, architectural photography',
    description: '풍경과 건축물, 환경 인물 사진에 적합한 넓은 화각',
    category: 'ultra-wide',
  },
  // 광각 (Wide)
  {
    id: '24mm',
    label: '24mm 광각',
    prompt: '24mm wide angle lens, street photography, travel photography',
    description: '여행 사진, 거리 사진에 이상적인 다용도 광각',
    category: 'wide',
  },
  {
    id: '28mm',
    label: '28mm 광각',
    prompt: '28mm wide angle lens, documentary style, environmental context',
    description: '다큐멘터리 스타일, 주변 환경을 포함한 촬영에 적합',
    category: 'wide',
  },
  {
    id: '35mm',
    label: '35mm 표준 광각',
    prompt: '35mm lens, natural perspective, street photography, snapshot style',
    description: '가장 자연스러운 스냅 사진 느낌, 거리 사진의 클래식',
    category: 'wide',
  },
  // 표준 (Standard)
  {
    id: '50mm',
    label: '50mm 표준',
    prompt: '50mm standard lens, natural field of view, classic portrait',
    description: '인간의 눈과 가장 비슷한 자연스러운 시야, 일상/인물 촬영',
    category: 'standard',
  },
  // 망원 (Telephoto)
  {
    id: '85mm',
    label: '85mm 인물용',
    prompt: '85mm portrait lens, shallow depth of field, beautiful bokeh, flattering perspective',
    description: '인물 사진의 왕, 아름다운 배경 흐림(보케)과 자연스러운 얼굴 비율',
    category: 'telephoto',
  },
  {
    id: '105mm',
    label: '105mm 망원',
    prompt: '105mm telephoto lens, compressed perspective, creamy bokeh, studio portrait',
    description: '스튜디오 인물, 제품 사진에 적합한 압축된 원근감',
    category: 'telephoto',
  },
  {
    id: '135mm',
    label: '135mm 망원',
    prompt: '135mm telephoto lens, strong background separation, dramatic compression',
    description: '강한 배경 분리, 드라마틱한 압축 효과로 피사체 강조',
    category: 'telephoto',
  },
  {
    id: '200mm',
    label: '200mm 초망원',
    prompt: '200mm super telephoto lens, extreme background blur, subject isolation',
    description: '스포츠, 야생동물 촬영, 극단적인 배경 흐림으로 피사체 분리',
    category: 'telephoto',
  },
  // 특수 렌즈 (Special)
  {
    id: 'macro',
    label: '매크로 (접사)',
    prompt: 'macro photography, extreme close-up, hyper-realistic details, 1:1 magnification',
    description: '꽃, 곤충, 물방울 등 작은 피사체의 세밀한 디테일을 극대화',
    category: 'special',
  },
  {
    id: 'fisheye',
    label: '어안 렌즈',
    prompt: 'fisheye lens, 180-degree field of view, spherical distortion, creative perspective',
    description: '180도 왜곡된 시야, 창의적이고 독특한 표현에 적합',
    category: 'special',
  },
  {
    id: 'tilt-shift',
    label: '틸트-시프트',
    prompt: 'tilt-shift lens, miniature effect, selective focus, architectural photography',
    description: '미니어처 효과, 선택적 초점으로 건축물이나 도시 풍경을 장난감처럼 표현',
    category: 'special',
  },
];

// ID로 카메라 렌즈 찾기
export function getCameraLensById(id: string): CameraLens | undefined {
  return CAMERA_LENSES.find(lens => lens.id === id);
}

// 카메라 렌즈 프롬프트 가져오기
export function getCameraLensPrompt(id: string): string {
  const lens = getCameraLensById(id);
  return lens?.prompt || '';
}
