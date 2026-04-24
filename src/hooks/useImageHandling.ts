import { useState, useEffect, useRef } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { readFile } from '@tauri-apps/plugin-fs';
import { downscaleImage } from '../lib/utils/imageDownscale';
import { logger } from '../lib/logger';

/**
 * Tauri 이미지 로드 함수
 */
async function loadTauriImage(filePath: string): Promise<string | null> {
  try {
    const fileData = await readFile(filePath);

    // Uint8Array를 base64로 변환
    const base64 = btoa(
      Array.from(new Uint8Array(fileData))
        .map((b) => String.fromCharCode(b))
        .join('')
    );

    // 확장자에서 MIME 타입 추정
    const ext = filePath.split('.').pop()?.toLowerCase();
    const mimeType =
      ext === 'png'
        ? 'image/png'
        : ext === 'jpg' || ext === 'jpeg'
          ? 'image/jpeg'
          : ext === 'gif'
            ? 'image/gif'
            : ext === 'webp'
              ? 'image/webp'
              : 'image/png';

    return `data:${mimeType};base64,${base64}`;
  } catch (error) {
    logger.error('❌ Tauri 파일 읽기 오류:', error);
    return null;
  }
}

/**
 * 이미지 파일 확장자 확인
 */
function isImageFile(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase();
  return ext ? ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext) : false;
}

interface UseImageHandlingReturn {
  uploadedImages: string[];
  setUploadedImages: React.Dispatch<React.SetStateAction<string[]>>;
  handleImageSelect: (imageData: string) => void;
  handleRemoveImage: (index: number) => void;
  showLimitWarning: boolean;
  setShowLimitWarning: React.Dispatch<React.SetStateAction<boolean>>;
}

const MAX_IMAGES = 14;

/**
 * 이미지 업로드 및 드롭 처리 Hook
 */
export function useImageHandling(): UseImageHandlingReturn {
  const [uploadedImages, setUploadedImages] = useState<string[]>([]);
  const [showLimitWarning, setShowLimitWarning] = useState(false);
  const lastDropTimeRef = useRef(0);

  // 전역 드래그 앤 드롭 리스너
  useEffect(() => {
    let unlisten: (() => void | Promise<void>) | undefined;
    let isDisposed = false;
    let isUnlistenCalled = false;

    const safeUnlisten = (dispose?: () => void | Promise<void>) => {
      if (!dispose || isUnlistenCalled) return;
      isUnlistenCalled = true;
      try {
        Promise.resolve(dispose()).catch((error) => {
          logger.warn('드래그 리스너 비동기 해제 중 경고:', error);
        });
      } catch (error) {
        logger.warn('드래그 리스너 해제 중 경고:', error);
      }
    };

    const setupGlobalDropListener = async () => {
      try {
        const appWindow = getCurrentWindow();

        const dispose = await appWindow.onDragDropEvent(async (event) => {
          if (event.payload.type === 'drop') {
            // 중복 이벤트 방지: 500ms 이내 재호출 무시
            const now = Date.now();
            if (now - lastDropTimeRef.current < 500) {
              return;
            }
            lastDropTimeRef.current = now;

            const filePaths = event.payload.paths;

            if (filePaths && filePaths.length > 0) {
              // 이미지 파일만 필터링
              const imageFiles = filePaths.filter(isImageFile);

              // 순차적으로 이미지 로드 및 추가
              for (const filePath of imageFiles) {
                const imageData = await loadTauriImage(filePath);
                if (imageData) {
                  setUploadedImages((prev) => {
                    if (prev.length >= MAX_IMAGES) {
                      setShowLimitWarning(true);
                      return prev;
                    }
                    return [...prev, imageData];
                  });
                }
              }
            }
          }
        });

        if (isDisposed) {
          safeUnlisten(dispose);
          return;
        }
        unlisten = dispose;
      } catch (error) {
        logger.error('❌ [App] 전역 드롭 리스너 등록 실패:', error);
      }
    };

    setupGlobalDropListener();

    return () => {
      isDisposed = true;
      safeUnlisten(unlisten);
    };
  }, []);

  const handleImageSelect = async (imageData: string) => {
    // 업로드 시점에 다운스케일하여 IndexedDB·메모리·디코딩 비용을 일괄 절감
    const optimized = await downscaleImage(imageData, 1280, 0.85).catch(() => imageData);
    setUploadedImages((prev) => {
      if (prev.length >= MAX_IMAGES) {
        setShowLimitWarning(true);
        return prev;
      }
      return [...prev, optimized];
    });
  };

  const handleRemoveImage = (index: number) => {
    setUploadedImages((prev) => prev.filter((_, i) => i !== index));
  };

  return {
    uploadedImages,
    setUploadedImages,
    handleImageSelect,
    handleRemoveImage,
    showLimitWarning,
    setShowLimitWarning,
  };
}

