import { useState, useRef, useEffect, useCallback } from 'react';
import { X, Download, MessageCircle, Loader2 } from 'lucide-react';
import { save } from '@tauri-apps/plugin-dialog';
import { writeFile, exists, mkdir } from '@tauri-apps/plugin-fs';
import { join, downloadDir } from '@tauri-apps/api/path';
import type { Session } from '../../types/session';
import { useChatSession, RECENT_MESSAGES_TO_KEEP } from '../../hooks/useChatSession';
import { useChatImageGeneration } from '../../hooks/useChatImageGeneration';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { ChatAISettings } from './ChatAISettings';
import { logger } from '../../lib/logger';

interface ChatPanelProps {
  session: Session;
  apiKey: string;
  onSessionUpdate: (session: Session) => void;
}

/** 채팅 패널 메인 컴포넌트 */
export function ChatPanel({ session, apiKey, onSessionUpdate }: ChatPanelProps) {
  const {
    messages,
    summary,
    needsSummarization,
    settings,
    addMessage,
    deleteMessage,
    updateSettings,
    markSummarized,
  } = useChatSession(session, onSessionUpdate);

  const { isGenerating, generateFromChat, summarizeMessages } = useChatImageGeneration(session, apiKey);

  // 이미지 미리보기 모달 상태
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  // 메시지 스크롤 영역 ref
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // 새 메시지 추가 시 하단으로 자동 스크롤
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }, [messages.length]);

  // 메시지 전송 핸들러
  const handleSend = useCallback(async (text: string, images: string[]) => {
    // 1. 사용자 메시지 즉시 추가
    addMessage('user', text, images.length > 0 ? images : undefined);

    try {
      // 2. AI 응답 생성
      const result = await generateFromChat(text, images.length > 0 ? images : undefined);

      console.log('🔍 ChatPanel - AI 응답 결과:', {
        hasContent: !!result.content,
        imageCount: result.images?.length || 0,
        isGeneratedImage: result.isGeneratedImage,
        firstImagePrefix: result.images?.[0]?.substring(0, 30),
      });

      // 3. AI 응답 메시지 추가 (imageSignatures 포함하여 다음 요청 시 thought_signature 전송 가능)
      addMessage(
        'assistant',
        result.content,
        result.images.length > 0 ? result.images : undefined,
        result.isGeneratedImage,
        result.imageSignatures.length > 0 ? result.imageSignatures : undefined,
      );

      // 3-1. 생성된 이미지가 있으면 자동 저장
      if (result.isGeneratedImage && result.images.length > 0) {
        console.log('🎯 ChatPanel - 자동 저장 시작, 이미지 개수:', result.images.length);
        for (const imageBase64 of result.images) {
          try {
            const savedPath = await autoSaveImage(imageBase64);
            console.log('✅ ChatPanel - 자동 저장 성공:', savedPath);
            logger.debug('💾 채팅 이미지 자동 저장 완료:', savedPath);
          } catch (error) {
            console.error('❌ ChatPanel - 자동 저장 실패:', error);
            logger.error('❌ 채팅 이미지 자동 저장 실패:', error);
            // 자동 저장 실패해도 채팅은 계속
          }
        }
      } else {
        console.log('⚠️ ChatPanel - 자동 저장 건너뜀:', {
          isGeneratedImage: result.isGeneratedImage,
          hasImages: result.images?.length > 0,
        });
      }

      // 4. 요약 필요 여부 확인 후 처리
      if (needsSummarization) {
        const totalMessages = messages.length + 2; // user + assistant 추가분
        const summarizeUpToIndex = totalMessages - RECENT_MESSAGES_TO_KEEP - 1;
        if (summarizeUpToIndex >= 0) {
          const messagesToSummarize = messages.slice(0, summarizeUpToIndex + 1);
          if (messagesToSummarize.length > 0) {
            try {
              const summaryText = await summarizeMessages(messagesToSummarize, summary);
              markSummarized(summaryText, summarizeUpToIndex);
            } catch (err) {
              console.error('요약 실패:', err);
            }
          }
        }
      }
    } catch (error) {
      // 5. 에러 발생 시 에러 메시지 추가
      const errorMessage = error instanceof Error ? error.message : '알 수 없는 오류';
      addMessage('assistant', `오류가 발생했습니다: ${errorMessage}`);
    }
  }, [addMessage, generateFromChat, needsSummarization, messages, summary, summarizeMessages, markSummarized]); // autoSaveImage 제거

  // 자동 저장 함수 (배경에서 자동으로 저장)
  const autoSaveImage = useCallback(async (imageBase64: string) => {
    console.log('🔄 autoSaveImage 함수 호출됨');
    console.log('   - 입력 데이터 prefix:', imageBase64.substring(0, 50));

    try {
      // 다운로드 디렉터리의 AI_Gen 폴더 경로 계산
      const downloadPath = await downloadDir();
      console.log('📁 다운로드 디렉터리:', downloadPath);

      const savePath = await join(downloadPath, 'AI_Gen');
      console.log('📁 저장 경로:', savePath);

      // 폴더가 없으면 생성
      try {
        const folderExists = await exists(savePath);
        console.log('📁 폴더 존재 여부:', folderExists);
        if (!folderExists) {
          await mkdir(savePath, { recursive: true });
          console.log('✅ AI_Gen 폴더 생성 완료');
          logger.debug('📁 AI_Gen 폴더 생성됨');
        }
      } catch (error) {
        // 폴더가 없으면 생성 시도
        console.log('⚠️ exists 실패, 폴더 생성 시도:', error);
        await mkdir(savePath, { recursive: true });
        console.log('✅ AI_Gen 폴더 생성 완료 (재시도)');
        logger.debug('📁 AI_Gen 폴더 생성됨 (exists 실패 후)');
      }

      // 파일명 생성 (JPEG로 저장)
      const timestamp = Date.now();
      const fileName = `chat-image-${timestamp}.jpg`;
      const fullPath = await join(savePath, fileName);

      console.log('💾 저장할 파일 경로:', fullPath);
      logger.debug('💾 자동 저장 시작:', fullPath);

      // base64 데이터에서 순수 데이터 추출
      const base64Data = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64;
      const binaryString = atob(base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      console.log('📊 바이너리 데이터 크기:', bytes.length, 'bytes');

      // 파일 저장
      await writeFile(fullPath, bytes);
      console.log('✅ 파일 저장 성공:', fullPath);
      logger.debug('✅ 이미지 자동 저장 완료:', fullPath);

      return fullPath;
    } catch (error) {
      console.error('❌ autoSaveImage 오류 상세:', error);
      logger.error('❌ 자동 저장 오류:', error);
      throw error;
    }
  }, []);

  // 이미지 저장 (Tauri 다이얼로그 + 파일 쓰기)
  const handleSaveImage = useCallback(async (imageBase64: string) => {
    console.log('🔍 handleSaveImage 호출됨');
    console.log('   - 이미지 데이터 prefix:', imageBase64.substring(0, 50));

    try {
      // Gemini API는 JPEG 형식으로 이미지를 생성하므로 JPG로 저장
      const timestamp = Date.now();
      console.log('📝 save 다이얼로그 오픈 시도...');

      const filePath = await save({
        filters: [{ name: 'JPEG 이미지', extensions: ['jpg', 'jpeg'] }],
        defaultPath: `chat-image-${timestamp}.jpg`,
      });

      console.log('📝 선택된 파일 경로:', filePath);
      if (!filePath) {
        console.log('⚠️ 사용자가 저장 취소');
        return;
      }

      // base64 데이터에서 순수 데이터 추출
      const base64Data = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64;
      const binaryString = atob(base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      console.log('📊 저장할 데이터 크기:', bytes.length, 'bytes');
      await writeFile(filePath, bytes);
      console.log('✅ 수동 저장 성공:', filePath);
    } catch (err) {
      console.error('❌ 수동 저장 실패 상세:', err);
    }
  }, []);

  return (
    <div className="flex h-full">
      {/* 좌측 채팅 영역 */}
      <div className="flex-1 flex flex-col">
        {/* 메시지 영역 */}
        <div
          ref={scrollContainerRef}
          className="flex-1 overflow-y-auto px-4 py-6 space-y-4 bg-gradient-to-b from-gray-50 to-white"
        >
          {/* 요약 배너 */}
          {summary && (
            <ChatMessage
              message={{
                id: 'summary',
                role: 'summary',
                content: summary,
                timestamp: new Date().toISOString(),
              }}
              onDelete={() => {}}
              onImageClick={setPreviewImage}
            />
          )}

          {/* 빈 상태 */}
          {messages.length === 0 && !summary && (
            <div className="flex flex-col items-center justify-center h-full text-gray-400">
              <MessageCircle className="w-12 h-12 mb-3 opacity-50" />
              <p className="text-sm text-center leading-relaxed">
                대화를 시작해보세요!
                <br />
                이미지 생성을 요청하거나 이미지를 첨부하여 대화할 수 있습니다.
              </p>
            </div>
          )}

          {/* 메시지 목록 */}
          {messages.map((msg) => (
            <ChatMessage
              key={msg.id}
              message={msg}
              onDelete={deleteMessage}
              onImageClick={setPreviewImage}
            />
          ))}

          {/* 생성 중 인디케이터 */}
          {isGenerating && (
            <div className="flex justify-start">
              <div className="max-w-[80%] px-4 py-3 rounded-2xl rounded-bl-md bg-white border border-gray-200 shadow-sm">
                <div className="flex items-center gap-2 text-gray-500">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-sm">응답 생성 중...</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 하단 입력 영역 */}
        <ChatInput
          onSend={handleSend}
          isGenerating={isGenerating}
          disabled={!apiKey}
        />
      </div>

      {/* 우측 AI 설정 패널 */}
      <ChatAISettings
        settings={settings}
        onSettingsChange={updateSettings}
      />

      {/* 이미지 미리보기 모달 */}
      {previewImage && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center"
          onClick={() => setPreviewImage(null)}
        >
          {/* 닫기 버튼 */}
          <button
            onClick={() => setPreviewImage(null)}
            className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
          >
            <X className="w-6 h-6" />
          </button>

          {/* 저장 버튼 */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleSaveImage(previewImage);
            }}
            className="absolute top-4 right-16 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
          >
            <Download className="w-6 h-6" />
          </button>

          {/* 이미지 */}
          <img
            src={previewImage}
            alt="미리보기"
            className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
