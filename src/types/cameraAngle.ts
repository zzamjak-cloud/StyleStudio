// 카메라 앵글 프리셋 타입
export interface CameraAngle {
  id: string;
  label: string;        // 한글 라벨
  prompt: string;       // 영어 프롬프트
  description: string;  // 설명
}

// 카메라 앵글 프리셋 목록 (20개)
export const CAMERA_ANGLES: CameraAngle[] = [
  {
    id: 'none',
    label: '선택 안함',
    prompt: '',
    description: '카메라 앵글을 지정하지 않습니다',
  },
  {
    id: 'eye-level',
    label: '눈높이 앵글',
    prompt: 'eye-level shot, camera at eye height, natural perspective',
    description: '피사체와 같은 눈높이에서 촬영한 자연스러운 앵글',
  },
  {
    id: 'high-angle',
    label: '하이 앵글',
    prompt: 'high-angle shot, looking down from above, elevated camera position',
    description: '위에서 아래로 내려다보는 앵글',
  },
  {
    id: 'low-angle',
    label: '로우 앵글',
    prompt: 'low-angle shot, looking up from below, camera below subject',
    description: '아래에서 위로 올려다보는 앵글 (힘과 위엄 표현)',
  },
  {
    id: 'birds-eye',
    label: '버드아이 뷰',
    prompt: "bird's-eye view, aerial shot, directly from above, top-down perspective",
    description: '완전히 위에서 내려다보는 조감도 시점',
  },
  {
    id: 'worms-eye',
    label: '개미 시점',
    prompt: "worm's-eye view, extreme low angle, looking straight up from ground level",
    description: '바닥에서 올려다보는 극단적인 로우 앵글',
  },
  {
    id: 'dutch-angle',
    label: '더치 앵글',
    prompt: 'dutch angle, tilted camera, canted angle, diagonal framing',
    description: '카메라를 기울여 긴장감과 불안정함을 표현',
  },
  {
    id: 'profile',
    label: '측면 뷰',
    prompt: 'profile shot, side view, 90-degree angle from subject',
    description: '피사체의 옆면을 보여주는 측면 앵글',
  },
  {
    id: 'three-quarter',
    label: '3/4 뷰',
    prompt: 'three-quarter view, 45-degree angle, partial profile',
    description: '정면과 측면 사이의 45도 각도',
  },
  {
    id: 'rear-view',
    label: '후면 뷰',
    prompt: 'rear view, from behind, back shot',
    description: '피사체의 뒷면을 보여주는 앵글',
  },
  {
    id: 'over-shoulder',
    label: '오버 더 숄더',
    prompt: 'over-the-shoulder shot, OTS, from behind character looking forward',
    description: '캐릭터의 어깨 너머로 보는 시점',
  },
  {
    id: 'pov',
    label: '1인칭 시점',
    prompt: 'point of view shot, POV, first-person perspective, subjective camera',
    description: '캐릭터가 보는 것을 그대로 보여주는 1인칭 시점',
  },
  {
    id: 'rule-of-thirds',
    label: '3분할 구도',
    prompt: 'rule of thirds composition, subject positioned at intersection points',
    description: '화면을 9등분하여 교차점에 피사체 배치',
  },
  {
    id: 'center-framing',
    label: '중앙 구도',
    prompt: 'center framing, centered composition, subject in the middle',
    description: '피사체를 화면 정중앙에 배치',
  },
  {
    id: 'symmetrical',
    label: '대칭 구도',
    prompt: 'symmetrical framing, balanced composition, mirror-like arrangement',
    description: '좌우 또는 상하 대칭을 이루는 구도',
  },
  {
    id: 'asymmetrical',
    label: '비대칭 구도',
    prompt: 'asymmetrical framing, off-center composition, dynamic balance',
    description: '의도적으로 비대칭을 활용한 역동적인 구도',
  },
  {
    id: 'golden-ratio',
    label: '황금 비율',
    prompt: 'golden ratio composition, fibonacci spiral, golden section',
    description: '황금 비율(1:1.618)을 활용한 조화로운 구도',
  },
  {
    id: 'leading-lines',
    label: '리딩 라인',
    prompt: 'leading lines composition, guiding lines toward subject',
    description: '선을 이용하여 시선을 피사체로 유도',
  },
  {
    id: 'frame-within-frame',
    label: '프레임 속 프레임',
    prompt: 'frame within a frame, nested framing, natural frame',
    description: '창문, 문, 아치 등을 활용한 이중 프레임 구도',
  },
  {
    id: 'negative-space',
    label: '네거티브 스페이스',
    prompt: 'negative space composition, minimalist, empty space around subject',
    description: '여백을 활용하여 피사체를 강조',
  },
  {
    id: 'fill-frame',
    label: '프레임 채우기',
    prompt: 'fill the frame, tight framing, close-up, subject fills entire frame',
    description: '피사체로 화면 전체를 채우는 밀착 구도',
  },
];

// ID로 카메라 앵글 찾기
export function getCameraAngleById(id: string): CameraAngle | undefined {
  return CAMERA_ANGLES.find(angle => angle.id === id);
}

// 카메라 앵글 프롬프트 가져오기
export function getCameraAnglePrompt(id: string): string {
  const angle = getCameraAngleById(id);
  return angle?.prompt || '';
}
