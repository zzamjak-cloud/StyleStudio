import { useState } from 'react';
import { Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import type { ChatMessage as ChatMessageType } from '../../types/chat';

interface ChatMessageProps {
  message: ChatMessageType;
  onDelete: (id: string) => void;
  onImageClick?: (imageBase64: string) => void;
}

/** 개별 채팅 메시지 렌더링 컴포넌트 */
export function ChatMessage({ message, onDelete, onImageClick }: ChatMessageProps) {
  // 요약 메시지의 펼침/접힘 상태
  const [expanded, setExpanded] = useState(false);

  const isUser = message.role === 'user';
  const isSummary = message.role === 'summary';

  // 타임스탬프 포맷
  const formattedTime = new Date(message.timestamp).toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
  });

  // 요약 메시지 렌더링
  if (isSummary) {
    return (
      <div className="flex justify-start">
        <div className="max-w-[80%] bg-amber-50 border border-amber-200 rounded-lg p-3">
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 text-xs font-medium text-amber-700 hover:text-amber-900 transition-colors"
          >
            <span>이전 대화 요약</span>
            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
          {expanded && (
            <p className="mt-2 text-sm text-amber-800 whitespace-pre-wrap">{message.content}</p>
          )}
          <p className="text-xs text-gray-400 mt-1">{formattedTime}</p>
        </div>
      </div>
    );
  }

  // 일반 메시지 (user / assistant) 렌더링
  const bubbleClass = isUser
    ? 'bg-blue-500 text-white rounded-2xl rounded-br-md'
    : 'bg-white border border-gray-200 rounded-2xl rounded-bl-md';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className="group relative max-w-[80%]">
        {/* 삭제 버튼 */}
        <button
          onClick={() => onDelete(message.id)}
          className="absolute -top-2 -right-2 p-1 rounded-full bg-white border border-gray-200 shadow-sm opacity-0 group-hover:opacity-100 transition-opacity z-10 hover:bg-red-50"
        >
          <Trash2 className="w-3 h-3 text-gray-400 hover:text-red-500" />
        </button>

        {/* 메시지 버블 */}
        <div className={`px-4 py-2.5 ${bubbleClass}`}>
          {/* 텍스트 내용 */}
          {message.content && (
            <p className="text-sm whitespace-pre-wrap">{message.content}</p>
          )}

          {/* 이미지 첨부 */}
          {message.images && message.images.length > 0 && (
            <div className={`flex flex-wrap gap-2 ${message.content ? 'mt-2' : ''}`}>
              {message.images.map((img, idx) => (
                <img
                  key={idx}
                  src={img}
                  alt={`${isUser ? '첨부' : '생성'} 이미지 ${idx + 1}`}
                  className="max-h-48 rounded-lg cursor-pointer hover:opacity-90 transition-opacity"
                  onClick={() => onImageClick?.(img)}
                />
              ))}
            </div>
          )}
        </div>

        {/* 타임스탬프 */}
        <p className={`text-xs text-gray-400 mt-1 ${isUser ? 'text-right' : 'text-left'}`}>
          {formattedTime}
        </p>
      </div>
    </div>
  );
}
