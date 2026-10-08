/**
 * 컨셉 세션 프롬프트 (순수 함수) — 앱 `useConceptGeneration` 과 MCP 서버(`mcp/src/concept.ts`)가 공유한다.
 * 세션 템플릿(`buildPromptForSession` CONCEPT)은 이 결과를 basePrompt 로 받아 참조 이미지가 있을 때만 감싼다.
 */
import type { ConceptSessionData } from '../../types/concept';

export interface ConceptPromptInput {
  /** 사용자가 직접 쓴 프롬프트 — 있으면 자동 구성 대신 그대로 쓴다 */
  prompt?: string;
  gameGenres: string[];
  gamePlayStyle?: string;
  referenceGames?: string[];
  artStyles: string[];
  grid: ConceptSessionData['generationSettings']['grid'];
}

/** 컨셉 프롬프트 자동 구성 + 그리드 베리에이션 문구 */
export function buildConceptBasePrompt(input: ConceptPromptInput): string {
  let finalPrompt = input.prompt ?? '';

  if (!finalPrompt) {
    const parts: string[] = [];
    if (input.gameGenres.length > 0) parts.push(`${input.gameGenres.join(', ')} 게임 컨셉 아트`);
    if (input.gamePlayStyle) parts.push(`게임 플레이: ${input.gamePlayStyle}`);
    if (input.referenceGames && input.referenceGames.length > 0) parts.push(`${input.referenceGames.join(', ')} 스타일 참고`);
    if (input.artStyles.length > 0) parts.push(`${input.artStyles.join(', ')} 아트 스타일`);
    if (parts.length === 0) parts.push('모바일 게임 컨셉 아트');
    finalPrompt = parts.join(', ');
  }

  // 그리드 설정에 따른 프롬프트 수정
  if (input.grid !== '1x1') {
    const gridCount = input.grid.split('x').map(Number)[0];
    finalPrompt += `, ${gridCount * gridCount}개의 다양한 베리에이션`;
  }
  return finalPrompt;
}

/** 컨셉 UI 크기 → 이미지 API resolution (앱 UI 의 3k 는 공용 규격에 맞춰 4K) */
export const CONCEPT_SIZE_MAP: Record<ConceptSessionData['generationSettings']['size'], '1K' | '2K' | '4K'> = {
  '1k': '1K',
  '2k': '2K',
  '3k': '4K',
};
