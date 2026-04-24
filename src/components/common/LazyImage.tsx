import { memo, useEffect, useState } from 'react';
import { loadImage } from '../../lib/imageStorage';

interface LazyImageProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  /** Base64 data URL 또는 IndexedDB 키 */
  src: string;
  /** 디코딩 전 placeholder className (기본: bg-gray-100) */
  placeholderClassName?: string;
}

/**
 * src가 data: URL이면 그대로 사용, 그 외에는 IndexedDB 키로 간주하여
 * 마운트 시 비동기로 base64로 변환한 뒤 표시한다.
 *
 * settings.json에서 분리되어 IndexedDB에 저장된 히스토리/메시지 이미지를
 * 즉시 메모리로 끌어올리지 않고, 실제 보이는 시점에만 디코딩하기 위한 컴포넌트.
 */
function LazyImageComponent({ src, placeholderClassName, className, ...rest }: LazyImageProps) {
  const isDataUrl = typeof src === 'string' && src.startsWith('data:');
  const [resolved, setResolved] = useState<string | null>(isDataUrl ? src : null);

  useEffect(() => {
    if (!src) {
      setResolved(null);
      return;
    }
    if (src.startsWith('data:')) {
      setResolved(src);
      return;
    }
    let cancelled = false;
    setResolved(null);
    loadImage(src).then((dataUrl) => {
      if (!cancelled && dataUrl) setResolved(dataUrl);
    });
    return () => {
      cancelled = true;
    };
  }, [src]);

  if (!resolved) {
    // 디코딩 전 placeholder — 부모가 정한 className/aspect를 유지
    return <div className={`${className ?? ''} ${placeholderClassName ?? 'bg-gray-100 animate-pulse'}`} />;
  }
  return <img src={resolved} className={className} {...rest} />;
}

export const LazyImage = memo(LazyImageComponent);
