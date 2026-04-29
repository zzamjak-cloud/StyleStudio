// GPT-Image-2 / Gemini의 추론 기반 생성을 유도하는 prompt prefix.
// API에 native thinking 파라미터가 없으므로 prompt-prefix 방식으로 단계적 사고를 유도한다.
// 향후 모델이 native thinkingConfig을 노출하면 이 모듈을 그 자리로 확장한다.

export type ThinkingSessionType =
  | 'chat'
  | 'illustration'
  | 'background'
  | 'character'
  | 'icon'
  | 'logo'
  | 'ui'
  | 'style'
  | 'concept'
  | 'pixelart'
  | 'generic';

const PREFIXES: Record<ThinkingSessionType, string> = {
  chat: [
    '[Thinking Mode]',
    '이미지를 생성하기 전에 다음 단계로 사고하라:',
    '1) 사용자 의도와 핵심 시각 요소를 추출',
    '2) 텍스트/타이포그래피와 구도의 일관성 검증',
    '3) 시대/문화/물리 고증 단서 반영',
    '4) 위 검토를 종합한 뒤 렌더',
  ].join('\n'),

  illustration: [
    '[Thinking Mode]',
    '일러스트 생성 전 다음 순서로 검토하라:',
    '1) 캐릭터 외형(신체 비율, 의상, 색상 팔레트) 일관성',
    '2) 배경과 시대/장르 고증',
    '3) 카메라 구도·시점·라이팅의 정합성',
    '4) 위 검토를 종합한 뒤 최종 렌더',
  ].join('\n'),

  background: [
    '[Thinking Mode]',
    '배경 생성 전 다음 단계로 사고하라:',
    '1) 시대적 배경과 건축/소품 고증',
    '2) 원근/조명/색감의 일관성',
    '3) 깊이감과 분위기 톤 정렬',
    '4) 위 검토를 종합한 뒤 렌더',
  ].join('\n'),

  character: [
    '[Thinking Mode]',
    '캐릭터 생성 전 다음 순서로 사고하라:',
    '1) 종(種), 신체 비율, 고유 식별 특징 점검',
    '2) 의상/소품의 시대·장르 정합성',
    '3) 표정·포즈가 캐릭터성과 일관되는지 검증',
    '4) 위 검토를 종합한 뒤 렌더',
  ].join('\n'),

  icon: [
    '[Thinking Mode]',
    '아이콘 생성 전 다음 단계를 거쳐라:',
    '1) 의미 전달의 명료성 (한 눈에 식별)',
    '2) 시각 메타포 단순화',
    '3) 컬러 팔레트와 외곽선 일관성',
    '4) 위 검토를 종합한 뒤 렌더',
  ].join('\n'),

  logo: [
    '[Thinking Mode]',
    '로고 생성 전 다음 단계로 검토하라:',
    '1) 브랜드 톤·산업 정합성',
    '2) 단순성/식별성/스케일 가변성',
    '3) 타이포그래피와 심볼의 균형',
    '4) 위 검토를 종합한 뒤 렌더',
  ].join('\n'),

  ui: [
    '[Thinking Mode]',
    'UI 모형 생성 전 다음 단계로 사고하라:',
    '1) 사용자 흐름과 정보 위계',
    '2) 텍스트 가독성과 정보 밀도',
    '3) 컴포넌트 정렬·여백·반응형 가능성',
    '4) 위 검토를 종합한 뒤 렌더',
  ].join('\n'),

  style: [
    '[Thinking Mode]',
    '스타일 적용 전 다음 단계로 검토하라:',
    '1) 참조 스타일의 핵심 시각 요소(선/색/질감) 추출',
    '2) 대상 콘텐츠와의 정합성 검증',
    '3) 일관된 톤·질감 유지',
    '4) 위 검토를 종합한 뒤 렌더',
  ].join('\n'),

  concept: [
    '[Thinking Mode]',
    '컨셉 이미지 생성 전 다음 순서로 사고하라:',
    '1) 키워드 → 시각 모티프 분해',
    '2) 분위기·시대·장르 고증',
    '3) 구도와 카메라 의도',
    '4) 위 검토를 종합한 뒤 렌더',
  ].join('\n'),

  pixelart: [
    '[Thinking Mode]',
    '픽셀아트 생성 전 다음 단계로 검토하라:',
    '1) 그리드 단위와 픽셀 정렬',
    '2) 제한된 팔레트의 일관성',
    '3) 실루엣 식별성',
    '4) 위 검토를 종합한 뒤 렌더',
  ].join('\n'),

  generic: [
    '[Thinking Mode]',
    '이미지 생성 전 다음 순서로 사고하라:',
    '1) 핵심 의도와 시각 요소 분해',
    '2) 구도/조명/색감의 정합성',
    '3) 위 검토를 종합한 뒤 렌더',
  ].join('\n'),
};

export function buildThinkingPrefix(sessionType: ThinkingSessionType = 'generic'): string {
  return PREFIXES[sessionType] ?? PREFIXES.generic;
}
