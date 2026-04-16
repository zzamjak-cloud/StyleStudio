import { ImageAnalysisResult } from '../types/analysis';

/**
 * 분석 결과를 통합 프롬프트로 변환 (영어 원본 사용)
 */
export function buildUnifiedPrompt(analysis: ImageAnalysisResult): {
  positivePrompt: string;
  negativePrompt: string;
} {
  const parts: string[] = [];

  // 1. 스타일 정보
  if (analysis.style) {
    const styleParts: string[] = [];

    if (analysis.style.art_style) styleParts.push(analysis.style.art_style);
    if (analysis.style.technique) styleParts.push(analysis.style.technique);
    if (analysis.style.color_palette) styleParts.push(analysis.style.color_palette);
    if (analysis.style.lighting) styleParts.push(analysis.style.lighting);
    if (analysis.style.mood) styleParts.push(analysis.style.mood);

    if (styleParts.length > 0) {
      parts.push(styleParts.join(', '));
    }
  }

  // 2. 캐릭터 정보 (고정 특징만)
  if (analysis.character) {
    const characterParts: string[] = [];

    if (analysis.character.gender) characterParts.push(analysis.character.gender);
    if (analysis.character.age_group) characterParts.push(analysis.character.age_group);
    if (analysis.character.hair) characterParts.push(analysis.character.hair);
    if (analysis.character.eyes) characterParts.push(analysis.character.eyes);
    if (analysis.character.face) characterParts.push(analysis.character.face);
    if (analysis.character.outfit) characterParts.push(analysis.character.outfit);
    if (analysis.character.accessories) characterParts.push(analysis.character.accessories);

    // 신체 비율 (매우 중요! - 순서대로 명시)
    if (analysis.character.body_proportions) characterParts.push(analysis.character.body_proportions);
    if (analysis.character.limb_proportions) characterParts.push(analysis.character.limb_proportions);
    if (analysis.character.torso_shape) characterParts.push(analysis.character.torso_shape);
    if (analysis.character.hand_style) characterParts.push(analysis.character.hand_style);
    if (analysis.character.feet_style) characterParts.push(analysis.character.feet_style);

    if (characterParts.length > 0) {
      parts.push(characterParts.join(', '));
    }
  }

  // Positive Prompt 생성
  const positivePrompt = parts.filter(Boolean).join(', ');

  // Negative Prompt
  const negativePrompt = analysis.negative_prompt || '';

  return {
    positivePrompt,
    negativePrompt,
  };
}

/**
 * 프롬프트에 사용자 입력 추가 (동적 요소)
 */
export function buildDynamicPrompt(
  basePrompt: string,
  userInput: string,
  composition?: {
    pose?: string;
    angle?: string;
    background?: string;
  }
): string {
  const parts: string[] = [basePrompt];

  // 사용자 입력 (포즈, 표정, 상황 등)
  if (userInput.trim()) {
    parts.push(userInput.trim());
  }

  // 구도 정보 (선택적)
  if (composition) {
    const compParts: string[] = [];
    if (composition.pose) compParts.push(composition.pose);
    if (composition.angle) compParts.push(composition.angle);
    if (composition.background) compParts.push(composition.background);

    if (compParts.length > 0) {
      parts.push(compParts.join(', '));
    }
  }

  return parts.filter(Boolean).join(', ');
}
