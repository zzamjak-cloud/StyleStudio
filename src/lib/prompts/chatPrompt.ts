/**
 * 채팅(대화형 편집) 프롬프트 (순수 함수) — 앱 `useChatImageGeneration` 과 MCP 편집 체인(`mcp/src/chain.ts`)이 공유한다.
 *
 * OpenRouter Image API 에는 멀티턴이 없어서, 대화 맥락은 텍스트로 앞에 붙이고
 * "이어지는 편집"은 직전 생성 이미지를 참조 이미지로 첨부해 구현한다.
 */
import type { ChatGenerationSettings, ChatMessage } from '../../types/chat';
import type { ReferenceDocument } from '../../types/referenceDocument';
import { getPixelArtGridInfo } from '../../types/pixelart';
import { PIXELART_MODERN_STYLE_RULES } from './sessionPrompts';

/** 프롬프트에 결합할 최근 대화 턴 수 */
export const MAX_CONTEXT_TURNS = 6;

/** 사용자 메시지 앞에 그리드 힌트·픽셀아트 규칙을 prefix 로 결합해 모델이 반영하도록 유도 */
export function buildChatSettingsPrefix(
  settings: Pick<ChatGenerationSettings, 'pixelArtGrid' | 'pixelArtMode'> | undefined
): string {
  if (!settings) return '';
  const parts: string[] = [];
  if (settings.pixelArtGrid && settings.pixelArtGrid !== '1x1') {
    const info = getPixelArtGridInfo(settings.pixelArtGrid);
    parts.push(
      `[그리드 레이아웃: ${settings.pixelArtGrid} — 하나의 이미지 안에 ${info.totalFrames}개 프레임을 ${info.rows}행 ${info.cols}열로 균등 배치]`
    );
  }
  // 픽셀아트 모드: 픽셀아트 세션과 동일한 채색 규칙을 적용한다.
  if (settings.pixelArtMode) {
    parts.push(`🎮 PIXEL ART MODE\n${PIXELART_MODERN_STYLE_RULES}`);
  }
  return parts.length > 0 ? parts.join('\n\n') + '\n\n' : '';
}

/** 요약 + 최근 대화 텍스트를 프롬프트 컨텍스트로 결합 */
export function buildChatConversationContext(summary: string | undefined, messages: ChatMessage[]): string {
  const sections: string[] = [];
  if (summary) sections.push(`[이전 대화 요약]\n${summary}`);
  const recent = messages.filter((m) => m.role !== 'summary' && m.content?.trim()).slice(-MAX_CONTEXT_TURNS);
  if (recent.length > 0) {
    const lines = recent.map((m) => {
      const role = m.role === 'user' ? '사용자' : 'AI';
      const imageNote = m.images?.length ? ` [이미지 ${m.images.length}개]` : '';
      return `${role}: ${m.content}${imageNote}`;
    });
    sections.push(`[최근 대화]\n${lines.join('\n')}`);
  }
  return sections.length > 0 ? `${sections.join('\n\n')}\n\n위 대화 맥락을 반영하여 아래 요청을 수행하세요.\n\n---\n\n` : '';
}

/** 문서 컨텍스트는 요약 중심으로 주입 (요약이 없으면 앞 1500자) */
export function buildChatDocumentContext(documents: ReferenceDocument[] | undefined): string {
  return (documents ?? [])
    .map((d) => {
      const summarized = d.summary?.trim();
      const core = summarized && summarized.length > 0 ? summarized : d.content?.slice(0, 1500).trim();
      return core ? `[첨부 문서 핵심 요약: ${d.fileName}]\n${core}` : '';
    })
    .filter(Boolean)
    .join('\n\n');
}

/** 대화 맥락 + 설정 prefix + 문서 맥락 + 사용자 메시지 → 최종 프롬프트 */
export function composeChatPrompt(params: {
  conversationContext: string;
  settingsPrefix: string;
  userMessage: string;
  documents?: ReferenceDocument[];
}): string {
  const documentContext = buildChatDocumentContext(params.documents);
  // 문서만 첨부하고 빈 프롬프트로 전송한 경우 자동 템플릿 사용
  const trimmed = params.userMessage.trim();
  const basePrompt =
    trimmed.length === 0 && (params.documents?.length ?? 0) > 0
      ? '첨부된 기획 문서를 바탕으로 완성도 높은 모바일 캐주얼 게임의 인게임 이미지를 생성해주세요.'
      : params.userMessage;
  const withDocContext = documentContext ? `${documentContext}\n\n---\n\n${basePrompt}` : basePrompt;
  return params.conversationContext + (params.settingsPrefix ? params.settingsPrefix + withDocContext : withDocContext);
}
