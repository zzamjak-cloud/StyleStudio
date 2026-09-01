import { useState, useCallback } from 'react';
import { Session } from '../types/session';
import { ChatMessage, ChatGenerationSettings } from '../types/chat';
import { getPixelArtGridInfo } from '../types/pixelart';
import { ReferenceDocument } from '../types/referenceDocument';
import { logger } from '../lib/logger';
import { loadImage } from '../lib/imageStorage';
import { GEMINI_FLASH_TEXT_MODEL } from '../types/constants';
import { chatComplete, generateImageViaOpenRouter } from '../lib/api/openrouter';
import { getImageModelDefinition, normalizeImageModelId } from './api/imageModels';
import { convertBase64ToJpeg, formatImageApiError } from './api/useImageGenerator';

// 사용자 메시지 앞에 그리드 힌트를 prefix로 결합해 모델이 반영하도록 유도
function buildSettingsPrefix(settings: ChatGenerationSettings | undefined): string {
  if (!settings) return '';
  const parts: string[] = [];

  if (settings.pixelArtGrid && settings.pixelArtGrid !== '1x1') {
    const info = getPixelArtGridInfo(settings.pixelArtGrid);
    parts.push(
      `[그리드 레이아웃: ${settings.pixelArtGrid} — 하나의 이미지 안에 ${info.totalFrames}개 프레임을 ${info.rows}행 ${info.cols}열로 균등 배치]`
    );
  }

  return parts.length > 0 ? parts.join('\n\n') + '\n\n' : '';
}

// 최대 재시도 횟수
const MAX_RETRIES = 2;
// 재시도 대기 시간 (ms)
const RETRY_DELAY = 5000;
// 프롬프트에 결합할 최근 대화 턴 수 (Image API는 멀티턴 대화가 없어 텍스트로 맥락 전달)
const MAX_CONTEXT_TURNS = 6;
// 참조 이미지 상한 (OpenRouter input_references 한도)
const MAX_REFERENCES = 14;

interface GenerationResult {
  content: string;
  images: string[];
  imageSignatures: string[]; // 레거시 필드 — OpenRouter 전환 후 항상 빈 배열 (저장 포맷 호환용)
  isGeneratedImage: boolean;
}

interface UseChatImageGenerationReturn {
  isGenerating: boolean;
  generationStatus: string;
  generateFromChat: (userMessage: string, userImages?: string[], userDocuments?: ReferenceDocument[]) => Promise<GenerationResult>;
  summarizeMessages: (messages: ChatMessage[], existingSummary?: string) => Promise<string>;
}

export function useChatImageGeneration(
  session: Session,
  apiKey: string
): UseChatImageGenerationReturn {
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationStatus, setGenerationStatus] = useState('');
  const chatData = session.chatData;

  // 요약 + 최근 대화 텍스트를 프롬프트 컨텍스트로 결합
  // (기존 Gemini 멀티턴 contents는 OpenRouter Image API가 지원하지 않아 텍스트 요약으로 대체)
  const buildConversationContext = useCallback((): string => {
    const sections: string[] = [];

    if (chatData?.summary) {
      sections.push(`[이전 대화 요약]\n${chatData.summary}`);
    }

    const startIndex = (chatData?.summarizedUpTo ?? -1) + 1;
    const messages = (chatData?.messages?.slice(startIndex) ?? []).filter(
      (m) => m.role !== 'summary' && m.content?.trim()
    );
    const recent = messages.slice(-MAX_CONTEXT_TURNS);
    if (recent.length > 0) {
      const lines = recent.map((m) => {
        const role = m.role === 'user' ? '사용자' : 'AI';
        const imageNote = m.images?.length ? ` [이미지 ${m.images.length}개]` : '';
        return `${role}: ${m.content}${imageNote}`;
      });
      sections.push(`[최근 대화]\n${lines.join('\n')}`);
    }

    return sections.length > 0
      ? `${sections.join('\n\n')}\n\n위 대화 맥락을 반영하여 아래 요청을 수행하세요.\n\n---\n\n`
      : '';
  }, [chatData]);

  // 직전 생성 이미지를 참조로 복원 (이어지는 편집이 직전 결과를 기준으로 하도록)
  const resolveLatestGeneratedImage = useCallback(async (): Promise<string | null> => {
    const startIndex = (chatData?.summarizedUpTo ?? -1) + 1;
    const messages = chatData?.messages?.slice(startIndex) ?? [];
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === 'summary' || !msg.isGeneratedImage) continue;
      const img = msg.images?.[msg.images.length - 1];
      if (!img) continue;
      if (img.startsWith('data:')) return img;
      return (await loadImage(img)) ?? null;
    }
    return null;
  }, [chatData]);

  // 채팅 기반 이미지 생성 (OpenRouter Image API)
  const generateFromChat = useCallback(async (
    userMessage: string,
    userImages?: string[],
    userDocuments?: ReferenceDocument[]
  ): Promise<GenerationResult> => {
    setIsGenerating(true);
    setGenerationStatus('응답 생성 중...');

    const settings = chatData?.settings;
    const imageModel = normalizeImageModelId(settings?.imageModel);
    const modelDef = getImageModelDefinition(imageModel);
    if (!apiKey) {
      setIsGenerating(false);
      setGenerationStatus('');
      throw new Error('OpenRouter API 키가 설정되지 않았습니다.');
    }
    const aspectRatio = settings?.aspectRatio ?? '1:1';
    const imageSize = settings?.imageSize ?? '1K';
    const imageQuality = settings?.imageQuality ?? 'medium';

    // 스타일 프리셋·그리드는 API 파라미터가 아니라 프롬프트 prefix로 결합하여 전달
    const prefix = buildSettingsPrefix(settings);

    // v0.4.4: 문서 컨텍스트는 요약 중심으로 주입 (토큰 절약 + 핵심 정보 유지)
    const documentContext = (userDocuments ?? [])
      .map((d) => {
        const summarized = d.summary?.trim();
        const fallback = d.content?.slice(0, 1500).trim();
        const coreContent = summarized && summarized.length > 0 ? summarized : fallback;
        if (!coreContent) return '';
        return `[첨부 문서 핵심 요약: ${d.fileName}]\n${coreContent}`;
      })
      .filter(Boolean)
      .join('\n\n');

    const documentImages = (userDocuments ?? []).flatMap((d) => d.extractedImages ?? []);

    // 문서만 첨부하고 빈 프롬프트로 전송한 경우 자동 템플릿 사용
    const trimmed = userMessage.trim();
    const isDocumentOnly = trimmed.length === 0 && (userDocuments?.length ?? 0) > 0;
    const basePrompt = isDocumentOnly
      ? '첨부된 기획 문서를 바탕으로 완성도 높은 모바일 캐주얼 게임의 인게임 이미지를 생성해주세요.'
      : userMessage;

    const withDocContext = documentContext
      ? `${documentContext}\n\n---\n\n${basePrompt}`
      : basePrompt;

    const conversationContext = buildConversationContext();
    const effectiveUserMessage =
      conversationContext + (prefix ? prefix + withDocContext : withDocContext);

    // 참조 이미지: 직전 생성 이미지(기준 이미지) + 사용자 첨부 + 문서 추출 이미지
    const latestGenerated = await resolveLatestGeneratedImage();
    const allImages = [
      ...(latestGenerated ? [latestGenerated] : []),
      ...(userImages ?? []),
      ...documentImages,
    ].slice(0, MAX_REFERENCES);

    logger.debug('🎨 Chat 이미지 생성 요청:', {
      imageModel,
      aspectRatio,
      imageSize,
      referenceCount: allImages.length,
      pixelArtGrid: settings?.pixelArtGrid,
      prefixApplied: !!prefix,
    });

    let lastError: Error | null = null;

    try {
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          if (attempt > 0) {
            setGenerationStatus(`재시도 중... (${attempt}/${MAX_RETRIES})`);
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
          }

          setGenerationStatus(`${modelDef.label} 모델이 이미지를 생성하고 있습니다...`);

          const generated = await generateImageViaOpenRouter(apiKey, {
            model: imageModel,
            prompt: effectiveUserMessage,
            aspectRatio,
            resolution: modelDef.provider === 'gemini' ? imageSize : undefined,
            quality: modelDef.provider === 'openai' ? imageQuality : undefined,
            inputReferences: allImages.length > 0 ? allImages : undefined,
          });

          // 내부 표준 JPEG로 통일 (자동 저장/썸네일 파이프라인 호환)
          const jpegBase64 = await convertBase64ToJpeg(generated.base64, generated.mediaType);

          setIsGenerating(false);
          setGenerationStatus('');
          return {
            content: '',
            images: [`data:image/jpeg;base64,${jpegBase64}`],
            imageSignatures: [],
            isGeneratedImage: true,
          };
        } catch (error) {
          const message = (error as Error).message ?? String(error);
          const statusMatch = message.match(/\((\d{3})\)/);
          const status = statusMatch ? parseInt(statusMatch[1], 10) : 0;

          if (status >= 500 && attempt < MAX_RETRIES) {
            logger.warn(`⚠️ 서버 에러 (${status}), 재시도 예정...`);
            lastError = error as Error;
            continue;
          }

          // 사용자 친화적 메시지로 변환
          if (status > 0 && status < 500) {
            throw new Error(formatImageApiError(status, message.replace(/^.*?\):\s*/, '')));
          }
          throw error;
        }
      }
    } catch (error) {
      setIsGenerating(false);
      setGenerationStatus('');
      throw error;
    }

    setIsGenerating(false);
    setGenerationStatus('');
    throw lastError || new Error('이미지 생성에 실패했습니다.');
  }, [apiKey, chatData, buildConversationContext, resolveLatestGeneratedImage]);

  // 메시지 요약 (Gemini Flash · chat completions)
  const summarizeMessages = useCallback(async (
    messagesToSummarize: ChatMessage[],
    existingSummary?: string
  ): Promise<string> => {
    if (!apiKey) throw new Error('OpenRouter API 키가 설정되지 않았습니다.');

    const conversationText = messagesToSummarize
      .filter(m => m.role !== 'summary')
      .map(m => {
        const role = m.role === 'user' ? '사용자' : 'AI';
        const imageNote = m.images?.length ? ` [이미지 ${m.images.length}개 포함]` : '';
        return `${role}: ${m.content}${imageNote}`;
      })
      .join('\n');

    const prompt = existingSummary
      ? `다음은 이전 대화 요약과 이후 추가된 대화입니다. 전체 맥락을 하나의 요약으로 통합해주세요.\n\n[이전 요약]\n${existingSummary}\n\n[추가 대화]\n${conversationText}\n\n한국어로 핵심 내용을 3-5문장으로 요약해주세요. 이미지 생성 요청과 결과도 포함해주세요.`
      : `다음 대화를 한국어로 핵심 내용 3-5문장으로 요약해주세요. 이미지 생성 요청과 결과도 포함해주세요.\n\n${conversationText}`;

    try {
      const text = await chatComplete(apiKey, {
        model: GEMINI_FLASH_TEXT_MODEL,
        messages: [{ role: 'user', content: prompt }],
      });

      logger.info('📝 대화 요약 생성 완료');
      return text;
    } catch (error) {
      logger.error('❌ 대화 요약 실패:', error);
      throw error;
    }
  }, [apiKey]);

  return { isGenerating, generationStatus, generateFromChat, summarizeMessages };
}
