import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Loader2, X, Image } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { readFile } from '@tauri-apps/plugin-fs';

// 최대 첨부 이미지 수
const MAX_IMAGES = 5;

interface ChatInputProps {
  onSend: (text: string, images: string[]) => void;
  isGenerating: boolean;
  disabled?: boolean;
}

/** 하단 입력 영역 (이미지 첨부 지원) */
export function ChatInput({ onSend, isGenerating, disabled }: ChatInputProps) {
  const [text, setText] = useState('');
  const [attachedImages, setAttachedImages] = useState<string[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // textarea 높이 자동 조절
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    // 최소 3줄 높이 설정 (줄당 약 24px)
    const minHeight = 24 * 3;
    const maxHeight = 24 * 10; // 최대 10줄까지 확장

    // 먼저 auto로 설정하여 scrollHeight를 정확히 측정
    textarea.style.height = 'auto';

    // scrollHeight가 minHeight보다 작으면 minHeight, 크면 실제 높이 적용 (maxHeight 제한)
    const newHeight = Math.max(minHeight, Math.min(textarea.scrollHeight, maxHeight));
    textarea.style.height = `${newHeight}px`;

    // 스크롤이 필요한 경우 overflow 설정
    if (textarea.scrollHeight > maxHeight) {
      textarea.style.overflowY = 'auto';
    } else {
      textarea.style.overflowY = 'hidden';
    }
  }, [text]);

  // Tauri 드래그 앤 드롭으로 이미지 파일 첨부
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const setup = async () => {
      const appWindow = getCurrentWindow();
      unlisten = await appWindow.onDragDropEvent(async (event) => {
        if (event.payload.type === 'drop') {
          const paths = event.payload.paths || [];
          for (const filePath of paths) {
            // 이미지 파일만 허용
            const ext = filePath.split('.').pop()?.toLowerCase();
            if (!ext || !['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(ext)) continue;

            try {
              const fileData = await readFile(filePath);
              const base64 = btoa(
                Array.from(new Uint8Array(fileData)).map(b => String.fromCharCode(b)).join('')
              );
              const mimeType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
              const dataUrl = `data:${mimeType};base64,${base64}`;

              setAttachedImages(prev => {
                if (prev.length >= MAX_IMAGES) return prev;
                return [...prev, dataUrl];
              });
            } catch (err) {
              console.error('파일 읽기 실패:', err);
            }
          }
        }
      });
    };

    setup();
    return () => { if (unlisten) unlisten(); };
  }, []);

  // 클립보드 붙여넣기로 이미지 첨부
  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of Array.from(items)) {
      if (!item.type.startsWith('image/')) continue;
      const file = item.getAsFile();
      if (!file) continue;

      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        setAttachedImages(prev => {
          if (prev.length >= MAX_IMAGES) return prev;
          return [...prev, result];
        });
      };
      reader.readAsDataURL(file);
    }
  }, []);

  // 이미지 제거
  const removeImage = useCallback((index: number) => {
    setAttachedImages(prev => prev.filter((_, i) => i !== index));
  }, []);

  // 메시지 전송
  const handleSend = useCallback(() => {
    const trimmedText = text.trim();
    if (!trimmedText && attachedImages.length === 0) return;
    if (isGenerating || disabled) return;

    onSend(trimmedText, attachedImages);
    setText('');
    setAttachedImages([]);
  }, [text, attachedImages, isGenerating, disabled, onSend]);

  // 키보드 이벤트: Enter로 전송, Shift+Enter로 줄바꿈
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const canSend = !isGenerating && !disabled && (text.trim().length > 0 || attachedImages.length > 0);

  return (
    <div className="bg-white border-t border-gray-200 px-4 py-3">
      {/* 첨부 이미지 미리보기 영역 */}
      {attachedImages.length > 0 && (
        <div className="flex gap-2 mb-2 flex-wrap">
          {attachedImages.map((img, idx) => (
            <div key={idx} className="relative group">
              <img
                src={img}
                alt={`첨부 ${idx + 1}`}
                className="h-16 w-16 rounded object-cover border border-gray-200"
              />
              <button
                onClick={() => removeImage(idx)}
                className="absolute -top-1.5 -right-1.5 p-0.5 rounded-full bg-red-500 text-white opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
          {attachedImages.length < MAX_IMAGES && (
            <div className="h-16 w-16 rounded border-2 border-dashed border-gray-300 flex items-center justify-center text-gray-400">
              <Image className="w-5 h-5" />
            </div>
          )}
        </div>
      )}

      {/* 입력 영역 */}
      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder="메시지를 입력하세요... (이미지를 붙여넣거나 드래그할 수 있습니다)"
          disabled={disabled}
          rows={3}
          className="flex-1 resize-none rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300 focus:border-transparent disabled:bg-gray-50 disabled:text-gray-400 min-h-[72px] overflow-y-auto"
        />
        <button
          onClick={handleSend}
          disabled={!canSend}
          className="flex-shrink-0 p-2.5 rounded-xl bg-purple-500 text-white hover:bg-purple-600 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
        >
          {isGenerating ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <Send className="w-5 h-5" />
          )}
        </button>
      </div>
    </div>
  );
}
