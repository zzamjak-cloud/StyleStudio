import { useEffect, useRef } from 'react';
import { downscaleImage } from '../lib/utils/imageDownscale';

interface UseImagePasteOptions {
  /** 붙여넣기 활성화 여부 (해당 화면이 표시 중일 때만 true로) */
  enabled?: boolean;
  /** 클립보드 이미지를 data URL(base64)로 변환한 뒤 호출되는 콜백 */
  onPaste: (dataUrl: string) => void;
}

/**
 * 클립보드(Ctrl+V)로 복사된 이미지 파일을 잡아 base64 data URL 로 전달하는 훅.
 *
 * - 전역 `paste` 이벤트를 구독하여 페이지 어디서 Ctrl+V를 눌러도 반응.
 * - 텍스트 입력 중(INPUT/TEXTAREA/contentEditable)일 때는 클립보드에 이미지가
 *   없으면 기본 텍스트 붙여넣기를 방해하지 않도록 패스.
 */
export function useImagePaste({ enabled = true, onPaste }: UseImagePasteOptions) {
  // onPaste가 매 렌더마다 새 함수여도 리스너 재등록을 피하기 위해 ref로 보관
  const onPasteRef = useRef(onPaste);
  useEffect(() => {
    onPasteRef.current = onPaste;
  }, [onPaste]);

  useEffect(() => {
    if (!enabled) return;

    const handler = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      const imageItems = Array.from(items).filter((it) => it.type.startsWith('image/'));
      if (imageItems.length === 0) return;

      // 텍스트 입력 요소에서 발생한 paste 이벤트라도, 이미지가 들어있으면 텍스트가 아니라 이미지 처리를 우선
      e.preventDefault();

      for (const item of imageItems) {
        const file = item.getAsFile();
        if (!file) continue;

        const reader = new FileReader();
        reader.onload = async () => {
          const result = reader.result;
          if (typeof result === 'string') {
            // 클립보드 이미지도 업로드 시점에 다운스케일하여 비용 누적 방지
            const optimized = await downscaleImage(result, 1280, 0.85).catch(() => result);
            onPasteRef.current(optimized);
          }
        };
        reader.readAsDataURL(file);
      }
    };

    window.addEventListener('paste', handler);
    return () => window.removeEventListener('paste', handler);
  }, [enabled]);
}
