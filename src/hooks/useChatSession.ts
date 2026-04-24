import { useCallback, useRef, useEffect, useMemo } from 'react';
import { Session } from '../types/session';
import { ChatMessage, ChatGenerationSettings, ChatSessionData, estimateTokenCount } from '../types/chat';
import { ReferenceDocument } from '../types/referenceDocument';
import { updateSession } from '../utils/sessionHelpers';
import { deleteImage } from '../lib/imageStorage';
import { logger } from '../lib/logger';

// 요약 임계값: 총 토큰 수가 이 값을 초과하면 요약 필요
const SUMMARIZATION_THRESHOLD = 30000;
// 요약 후 유지할 최근 메시지 수
export const RECENT_MESSAGES_TO_KEEP = 5;

interface UseChatSessionReturn {
  messages: ChatMessage[];
  attachedDocuments: ReferenceDocument[];
  settings: ChatGenerationSettings;
  summary: string | undefined;
  summarizedUpTo: number | undefined;
  totalTokenCount: number;
  needsSummarization: boolean;
  addMessage: (role: 'user' | 'assistant', content: string, images?: string[], isGeneratedImage?: boolean, imageSignatures?: string[], documents?: ReferenceDocument[]) => void;
  deleteMessage: (messageId: string) => void;
  setAttachedDocuments: (documents: ReferenceDocument[]) => void;
  updateSettings: (settings: Partial<ChatGenerationSettings>) => void;
  clearMessages: () => void;
  markSummarized: (summary: string, upToIndex: number) => void;
}

export function useChatSession(
  session: Session,
  onSessionUpdate: (session: Session) => void
): UseChatSessionReturn {
  const chatData = session.chatData;
  // 파생값을 useMemo로 안정화하여 자식(ChatPanel/ChatAISettings/ChatMessage)의 memo 효과를 보존
  const messages = useMemo<ChatMessage[]>(
    () => chatData?.messages ?? [],
    [chatData?.messages]
  );
  const attachedDocuments = useMemo<ReferenceDocument[]>(
    () => chatData?.attachedDocuments ?? [],
    [chatData?.attachedDocuments]
  );
  const settings = useMemo<ChatGenerationSettings>(
    () => ({
      aspectRatio: '1:1',
      imageModel: 'gemini-3-pro-image-preview',
      imageSize: '1K',
      pixelArtGrid: '1x1',
      ...chatData?.settings,
    }),
    [chatData?.settings]
  );
  const summary = chatData?.summary;
  const summarizedUpTo = chatData?.summarizedUpTo;
  const totalTokenCount = chatData?.totalTokenCount ?? 0;
  const needsSummarization = totalTokenCount > SUMMARIZATION_THRESHOLD;

  // 최신 session을 항상 참조할 수 있도록 ref 사용 (클로저 문제 방지)
  const sessionRef = useRef(session);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  const onSessionUpdateRef = useRef(onSessionUpdate);
  useEffect(() => {
    onSessionUpdateRef.current = onSessionUpdate;
  }, [onSessionUpdate]);

  // 최신 session에서 chatData를 읽어 업데이트하는 내부 헬퍼
  const updateChatData = useCallback((updates: Partial<ChatSessionData>) => {
    const latestSession = sessionRef.current;
    const currentChatData = latestSession.chatData ?? {
      messages: [],
      totalTokenCount: 0,
      settings: {
        aspectRatio: '1:1' as const,
        imageModel: 'gemini-3-pro-image-preview' as const,
        imageSize: '1K' as const,
        pixelArtGrid: '1x1' as const,
      },
    };
    const updatedSession = updateSession(latestSession, {
      chatData: { ...currentChatData, ...updates },
    });
    // ref도 즉시 갱신하여 연속 호출 시 최신 상태 반영
    sessionRef.current = updatedSession;
    onSessionUpdateRef.current(updatedSession);
  }, []);

  // 새 메시지를 채팅에 추가하고 토큰 수를 갱신
  const addMessage = useCallback((
    role: 'user' | 'assistant',
    content: string,
    images?: string[],
    isGeneratedImage?: boolean,
    imageSignatures?: string[],
    documents?: ReferenceDocument[]
  ) => {
    const newMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role,
      content,
      images,
      timestamp: new Date().toISOString(),
      isGeneratedImage,
      imageSignatures,
      documents,
    };
    newMessage.tokenCount = estimateTokenCount(newMessage);

    // ref에서 최신 메시지 배열을 읽어 추가 (클로저 문제 방지)
    const latestChatData = sessionRef.current.chatData;
    const currentMessages = latestChatData?.messages ?? [];
    const currentTokenCount = latestChatData?.totalTokenCount ?? 0;

    const updatedMessages = [...currentMessages, newMessage];
    const updatedTokenCount = currentTokenCount + (newMessage.tokenCount ?? 0);
    updateChatData({ messages: updatedMessages, totalTokenCount: updatedTokenCount });
    logger.debug(`💬 채팅 메시지 추가 [${role}]: 토큰 ${newMessage.tokenCount}, 총 ${updatedTokenCount}`);
  }, [updateChatData]);

  // 특정 메시지를 ID로 삭제하고 토큰 수를 갱신
  const deleteMessage = useCallback((messageId: string) => {
    const latestChatData = sessionRef.current.chatData;
    const currentMessages = latestChatData?.messages ?? [];
    const targetMessage = currentMessages.find(m => m.id === messageId);
    if (!targetMessage) return;

    // IndexedDB orphan 정리: 메시지에 첨부/생성된 이미지 키도 함께 제거
    if (targetMessage.images && targetMessage.images.length > 0) {
      const sessionId = sessionRef.current.id;
      for (let i = 0; i < targetMessage.images.length; i++) {
        void deleteImage(`${sessionId}-chat-${messageId}-${i}`).catch(() => {});
      }
    }

    const updatedMessages = currentMessages.filter(m => m.id !== messageId);
    const currentTokenCount = latestChatData?.totalTokenCount ?? 0;
    const updatedTokenCount = Math.max(0, currentTokenCount - (targetMessage.tokenCount ?? 0));
    updateChatData({ messages: updatedMessages, totalTokenCount: updatedTokenCount });
    logger.debug(`🗑️ 채팅 메시지 삭제: ${messageId}`);
  }, [updateChatData]);

  // 현재 채팅 입력창에 첨부된 문서 목록 저장
  const setAttachedDocuments = useCallback((documents: ReferenceDocument[]) => {
    updateChatData({ attachedDocuments: documents });
  }, [updateChatData]);

  // 이미지 생성 설정(화면비, 크기, 그리드, 프리셋 등)을 부분 업데이트
  const updateSettings = useCallback((newSettings: Partial<ChatGenerationSettings>) => {
    const latestSettings: ChatGenerationSettings = {
      aspectRatio: '1:1',
      imageModel: 'gemini-3-pro-image-preview',
      imageSize: '1K',
      pixelArtGrid: '1x1',
      ...sessionRef.current.chatData?.settings,
    };
    updateChatData({ settings: { ...latestSettings, ...newSettings } });
  }, [updateChatData]);

  // 모든 메시지와 요약 정보를 초기화
  const clearMessages = useCallback(() => {
    updateChatData({ messages: [], totalTokenCount: 0, summary: undefined, summarizedUpTo: undefined });
    logger.info('🧹 채팅 메시지 전체 삭제');
  }, [updateChatData]);

  // 요약 완료 후 요약된 메시지의 이미지 데이터를 제거하여 저장 공간 절약
  const markSummarized = useCallback((newSummary: string, upToIndex: number) => {
    const latestMessages = sessionRef.current.chatData?.messages ?? [];
    const updatedMessages = latestMessages.map((msg, idx) => {
      if (idx <= upToIndex && msg.images && msg.images.length > 0) {
        return { ...msg, images: undefined, imageSignatures: undefined, tokenCount: Math.ceil((msg.content?.length ?? 0) / 2) };
      }
      return msg;
    });
    const newTotalTokenCount = updatedMessages.reduce((sum, msg) => sum + (msg.tokenCount ?? 0), 0);
    updateChatData({ messages: updatedMessages, summary: newSummary, summarizedUpTo: upToIndex, totalTokenCount: newTotalTokenCount });
    logger.info(`📝 대화 요약 완료: ${upToIndex + 1}개 메시지 요약됨`);
  }, [updateChatData]);

  return {
    messages, attachedDocuments, settings, summary, summarizedUpTo, totalTokenCount,
    needsSummarization, addMessage, deleteMessage, setAttachedDocuments, updateSettings, clearMessages, markSummarized,
  };
}
