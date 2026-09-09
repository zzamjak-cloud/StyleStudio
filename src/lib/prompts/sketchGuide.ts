// 구도 스케치를 프롬프트 지시문으로 바꾸는 곳.
//
// 스케치는 **마지막 참조 이미지**로 붙고, 여기서 만든 문구가 "그 마지막 장을 어떻게 쓸지"를
// 모델에게 알려준다. 두 가지를 반드시 말해야 한다:
//   1. 스케치의 **펜선·화풍·색은 결과에 옮기지 말 것** — 안 그러면 거친 낙서가 그대로 그려진다.
//   2. 스케치에서 **무엇을 가져올 것인지** — 이게 세션 종류에 따라 완전히 다르다.
//
// 그리고 라벨은 `sketchPng`에 굽지 않으므로(재진입 시 드래그·제거를 위해 데이터로만 보관)
// **모델은 라벨 텍스트를 보지 못한다.** 좌표와 함께 텍스트로 넣어 줘야 반영된다.

import { SessionType } from '../../types/session';
import { ConceptSketch } from '../../types/illustration';
import { formatCompositionForPrompt } from '../sketch/analyzeSketch';

/**
 * 스케치를 무엇으로 읽어야 하는가.
 *
 * - `layout` — 화면 **안에 무엇을 어디에 배치할지**. 배경·UI처럼 여러 요소가 한 화면을
 *   나눠 갖는 세션.
 * - `subject` — 대상 하나의 **포즈·방향·보이는 면**. 캐릭터·아이템처럼 대상 하나가 화면을
 *   채우는 세션. "무릎 굽힌 채 왼쪽을 보는 자세", "손잡이가 정면으로 오게" 같은 건 말로
 *   정확히 옮기기 어려운데 그림 한 장이면 끝난다 — 이게 이쪽을 지원하는 이유다.
 *
 * **이 맵이 스케치 지원 여부의 유일한 출처다.** 여기 없는 세션은 버튼도 안 뜬다.
 */
const SKETCH_GUIDE_KIND: Partial<Record<SessionType, 'layout' | 'subject'>> = {
  BASIC: 'layout',
  STYLE: 'layout',
  BACKGROUND: 'layout',
  UI: 'layout',
  PIXELART_BACKGROUND: 'layout',
  CHARACTER: 'subject',
  PIXELART_CHARACTER: 'subject',
  ICON: 'subject',
  PIXELART_ICON: 'subject',
  // LOGO는 뺐다 — 마크 형태 자체가 결과물이라 거친 스케치가 형태를 오히려 망칠 수 있다.
  // ILLUSTRATION은 `IllustrationSetupPanel`이 캐릭터 라벨까지 붙는 전용 스케치를 이미 갖고 있다.
  // TILEMAP은 프롬프트가 요구하는 레이아웃이 이미 고정이라 스케치가 방해가 된다.
};

/** 구도 스케치를 쓸 수 있는 세션 */
export const SKETCH_ENABLED_SESSIONS = Object.keys(SKETCH_GUIDE_KIND) as SessionType[];

export function isSketchEnabledSession(sessionType: SessionType): boolean {
  return sessionType in SKETCH_GUIDE_KIND;
}

/** 세션 종류에 따라 "스케치에서 무엇을 가져올지" 문구를 고른다 */
function guideBody(kind: 'layout' | 'subject'): string {
  if (kind === 'layout') {
    return [
      ' Use it ONLY as a layout guide — match the placement, scale and framing of the shapes it indicates.',
      ' The final image must be rendered in the intended art style, not the sketch style.',
    ].join('');
  }
  /*
    subject 문구가 layout보다 훨씬 강한 이유:

    캐릭터·아이콘 세션의 본문 프롬프트는 "참조 이미지를 IDENTICAL하게 복제하라"고 반복해서
    지시한다. 거기에 거친 스케치를 참조로 끼워 넣으면 모델이 **그것까지 복제 대상**으로 읽어
    캐릭터가 낙서처럼 나올 수 있다. 그래서 (a) 스케치는 참조 세트가 아니라는 것과
    (b) 정체성은 나머지 참조에서 온다는 것을 명시적으로 끊어 준다.
  */
  return [
    ' It is NOT one of the subject reference images — do NOT copy its appearance, art style, colors,',
    ' proportions of line weight, or level of detail from it, and do NOT treat it as how the subject looks.',
    ' Use it ONLY to determine: the pose and limb placement, the orientation of the body or object',
    ' (which side or face is turned toward the viewer), the silhouette within the frame, and how much of',
    ' the subject is visible (crop and framing).',
    ' The identity, design, outfit, colors and art style come from the OTHER reference images —',
    ' the sketch must not alter them in any way.',
  ].join('');
}

/**
 * 스케치 가이드 섹션을 만든다. 스케치가 없거나 지원하지 않는 세션이면 빈 문자열.
 *
 * 반환값은 최종 프롬프트 **뒤에 덧붙일** 블록이다(앞에 빈 줄 2개 포함).
 */
export function buildSketchGuideSection(
  sessionType: SessionType,
  sketch: ConceptSketch | null | undefined
): string {
  const kind = SKETCH_GUIDE_KIND[sessionType];
  if (!kind || !sketch?.sketchPng) return '';

  // 라벨은 PNG에 없다 — 좌표와 함께 텍스트로 넣어야 모델이 안다
  const labelHint =
    sketch.labels.length > 0
      ? `\nLabels in the sketch mark what belongs where: ${sketch.labels
          .map((l) => `"${l.text}" at (${Math.round(l.x * 100)}%, ${Math.round(l.y * 100)}%)`)
          .join(', ')}. Apply those at those positions; do not draw the label text itself.`
      : '';
  const analysisHint = sketch.analysis ? `\n${formatCompositionForPrompt(sketch.analysis)}` : '';

  return (
    '\n\n📎 The LAST reference image is a USER SKETCH (a rough hand drawing).' +
    ' DO NOT copy its pen lines, and do not render any of its strokes in the output.' +
    guideBody(kind) +
    labelHint +
    analysisHint
  );
}
