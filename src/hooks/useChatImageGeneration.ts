import { useState, useCallback } from 'react';
import { Session } from '../types/session';
import { ChatMessage, ChatGenerationSettings } from '../types/chat';
import { getPixelArtGridInfo } from '../types/pixelart';
import { ReferenceDocument } from '../types/referenceDocument';
import { logger } from '../lib/logger';

// 사용자 메시지 앞에 스타일·그리드 힌트를 prefix로 결합해 Gemini가 해당 속성을 반영하도록 유도
function buildSettingsPrefix(settings: ChatGenerationSettings | undefined): string {
  if (!settings) return '';
  const parts: string[] = [];

  const stylePreset = settings.stylePreset;
  const style = stylePreset === 'custom' ? settings.customStyle?.trim() : stylePreset;
  if (style) {
    parts.push(`[스타일: ${style}]`);
  }

  if (settings.pixelArtGrid && settings.pixelArtGrid !== '1x1') {
    const info = getPixelArtGridInfo(settings.pixelArtGrid);
    parts.push(
      `[그리드 레이아웃: ${settings.pixelArtGrid} — 하나의 이미지 안에 ${info.totalFrames}개 프레임을 ${info.rows}행 ${info.cols}열로 균등 배치]`
    );
  }

  return parts.length > 0 ? parts.join(' ') + '\n\n' : '';
}

// 최대 재시도 횟수
const MAX_RETRIES = 2;
// 재시도 대기 시간 (ms)
const RETRY_DELAY = 5000;

interface GenerationResult {
  content: string;
  images: string[];
  imageSignatures: string[]; // AI 생성 이미지의 thought_signature (images와 1:1 대응)
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

  // multi-turn contents 배열 구성
  const buildContents = useCallback((additionalUserText?: string, additionalUserImages?: string[]) => {
    const contents: Array<{ role: string; parts: Array<Record<string, unknown>> }> = [];

    // 요약이 있으면 첫 번째 컨텍스트로 추가
    if (chatData?.summary) {
      contents.push({
        role: 'user',
        parts: [{ text: `[이전 대화 요약]\n${chatData.summary}\n\n위 내용은 이전 대화의 요약입니다. 이 맥락을 기반으로 대화를 이어가주세요.` }],
      });
      contents.push({
        role: 'model',
        parts: [{ text: '네, 이전 대화 내용을 이해했습니다. 이어서 도와드리겠습니다.' }],
      });
    }

    // 요약 이후의 메시지들만 포함
    const startIndex = (chatData?.summarizedUpTo ?? -1) + 1;
    const messages = chatData?.messages?.slice(startIndex) ?? [];

    for (const msg of messages) {
      if (msg.role === 'summary') continue;
      const parts: Array<Record<string, unknown>> = [];
      if (msg.content) {
        parts.push({ text: msg.content });
      }
      if (msg.images && msg.images.length > 0) {
        if (msg.isGeneratedImage && msg.imageSignatures) {
          // AI 생성 이미지: thought_signature와 함께 전송
          for (let i = 0; i < msg.images.length; i++) {
            const img = msg.images[i];
            const signature = msg.imageSignatures[i];
            const base64Data = img.includes(',') ? img.split(',')[1] : img;
            // AI 생성 이미지는 JPEG이므로 mime_type을 올바르게 설정
            const part: Record<string, unknown> = {
              inline_data: { mime_type: 'image/jpeg', data: base64Data },
            };
            if (signature) {
              part.thought_signature = signature;
            }
            parts.push(part);
          }
        } else if (msg.isGeneratedImage) {
          // thought_signature 없는 AI 생성 이미지 (레거시) — 텍스트 설명으로 대체
          parts.push({ text: `[이전에 생성한 이미지 ${msg.images.length}개]` });
        } else {
          // 사용자가 첨부한 이미지는 원본 MIME 타입 유지 (보통 PNG)
          for (const img of msg.images) {
            const base64Data = img.includes(',') ? img.split(',')[1] : img;
            // 원본 이미지의 MIME 타입 추출 시도
            const mimeMatch = img.match(/data:([^;]+);base64/);
            const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';
            parts.push({ inline_data: { mime_type: mimeType, data: base64Data } });
          }
        }
      }
      if (parts.length > 0) {
        contents.push({ role: msg.role === 'user' ? 'user' : 'model', parts });
      }
    }

    // 현재 사용자 메시지 추가
    if (additionalUserText || (additionalUserImages && additionalUserImages.length > 0)) {
      const userParts: Array<Record<string, unknown>> = [];
      if (additionalUserText) {
        userParts.push({ text: additionalUserText });
      }
      if (additionalUserImages) {
        for (const img of additionalUserImages) {
          const base64Data = img.includes(',') ? img.split(',')[1] : img;
          // 사용자가 첨부한 이미지의 MIME 타입 추출 (PNG가 기본값)
          const mimeMatch = img.match(/data:([^;]+);base64/);
          const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';
          userParts.push({ inline_data: { mime_type: mimeType, data: base64Data } });
        }
      }
      contents.push({ role: 'user', parts: userParts });
    }

    return contents;
  }, [chatData]);

  // 채팅 기반 이미지/텍스트 생성
  const generateFromChat = useCallback(async (
    userMessage: string,
    userImages?: string[],
    userDocuments?: ReferenceDocument[]
  ): Promise<GenerationResult> => {
    console.log('🎨 generateFromChat 호출됨');
    if (!apiKey) throw new Error('API 키가 설정되지 않았습니다.');

    setIsGenerating(true);
    setGenerationStatus('응답 생성 중...');

    const settings = chatData?.settings;
    const imageModel = settings?.imageModel ?? 'gemini-3-pro-image-preview';
    const aspectRatio = settings?.aspectRatio ?? '1:1';
    const imageSize = settings?.imageSize ?? '1K';

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

    const effectiveUserMessage = prefix ? prefix + withDocContext : withDocContext;

    // 사용자 이미지 + 문서 추출 이미지 합산하여 Gemini에 참조로 전달
    const allImages = [...(userImages ?? []), ...documentImages];
    const contents = buildContents(effectiveUserMessage, allImages.length > 0 ? allImages : undefined);

    const requestBody = {
      contents,
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
        imageConfig: { aspectRatio, imageSize },
      },
    };

    logger.debug('🎨 Chat 이미지 생성 요청:', {
      imageModel,
      aspectRatio,
      imageSize,
      pixelArtGrid: settings?.pixelArtGrid,
      stylePreset: settings?.stylePreset,
      customStyle: settings?.customStyle,
      prefixApplied: !!prefix,
    });

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        if (attempt > 0) {
          setGenerationStatus(`재시도 중... (${attempt}/${MAX_RETRIES})`);
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
        }

        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${imageModel}:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
          }
        );

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          const errorMessage = (errorData as Record<string, Record<string, string>>)?.error?.message || `HTTP ${response.status}`;
          if (response.status >= 500 && attempt < MAX_RETRIES) {
            logger.warn(`⚠️ 서버 에러 (${response.status}), 재시도 예정...`);
            lastError = new Error(errorMessage);
            continue;
          }
          throw new Error(errorMessage);
        }

        const data = await response.json();
        const candidate = (data as Record<string, Array<Record<string, Record<string, Array<Record<string, unknown>>>>>>)?.candidates?.[0];
        if (!candidate?.content?.parts) {
          throw new Error('응답에서 콘텐츠를 찾을 수 없습니다.');
        }

        let textContent = '';
        const generatedImages: string[] = [];
        const imageSignatures: string[] = [];

        for (const part of candidate.content.parts) {
          if (part.text) {
            textContent += part.text as string;
          }
          if (part.inlineData) {
            const inlineData = part.inlineData as Record<string, string>;
            // Gemini API는 JPEG를 반환하므로 MIME 타입을 강제로 설정
            // API가 잘못된 mimeType을 반환하는 경우를 대비
            const mimeType = 'image/jpeg';
            generatedImages.push(`data:${mimeType};base64,${inlineData.data}`);
            // thought_signature 보존 (다음 요청 시 이미지 재전송에 필요)
            imageSignatures.push((part.thoughtSignature as string) ?? '');
          }
        }

        setIsGenerating(false);
        setGenerationStatus('');
        return { content: textContent, images: generatedImages, imageSignatures, isGeneratedImage: generatedImages.length > 0 };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt >= MAX_RETRIES) break;
      }
    }

    setIsGenerating(false);
    setGenerationStatus('');
    throw lastError || new Error('이미지 생성에 실패했습니다.');
  }, [apiKey, chatData, buildContents]);

  // 메시지 요약 (Gemini 2.5 Flash 사용)
  const summarizeMessages = useCallback(async (
    messagesToSummarize: ChatMessage[],
    existingSummary?: string
  ): Promise<string> => {
    if (!apiKey) throw new Error('API 키가 설정되지 않았습니다.');

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
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseModalities: ['TEXT'] },
          }),
        }
      );

      if (!response.ok) throw new Error(`요약 실패: HTTP ${response.status}`);

      const data = await response.json();
      const text = (data as Record<string, Array<Record<string, Record<string, Array<Record<string, string>>>>>>)
        ?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error('요약 응답이 비어있습니다.');

      logger.info('📝 대화 요약 생성 완료');
      return text;
    } catch (error) {
      logger.error('❌ 대화 요약 실패:', error);
      throw error;
    }
  }, [apiKey]);

  return { isGenerating, generationStatus, generateFromChat, summarizeMessages };
}
