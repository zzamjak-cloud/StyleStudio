import { useRef, useEffect } from 'react';
import { Mountain, Plus, Trash2, X } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { readFile } from '@tauri-apps/plugin-fs';
import { ILLUSTRATION_LIMITS } from '../../types/illustration';
import { logger } from '../../lib/logger';

// 드롭 영역 정보 타입
interface DropZoneInfo {
  type: 'character' | 'background';
  id?: string;
  element: HTMLElement;
}

interface BackgroundSectionProps {
  images: string[];
  onImagesChange: (images: string[]) => void;
  disabled?: boolean;
  // 드래그앤드롭 관련 props (부모에서 통합 관리)
  isDragging?: boolean;
  isDropTarget?: boolean;
  registerDropZone?: (id: string, info: DropZoneInfo) => void;
  unregisterDropZone?: (id: string) => void;
}

export function BackgroundSection({
  images,
  onImagesChange,
  disabled = false,
  isDragging = false,
  isDropTarget = false,
  registerDropZone,
  unregisterDropZone,
}: BackgroundSectionProps) {
  const sectionRef = useRef<HTMLDivElement>(null);

  // 드롭 영역 등록/해제
  useEffect(() => {
    if (sectionRef.current && registerDropZone) {
      registerDropZone('background', {
        type: 'background',
        element: sectionRef.current,
      });
    }
    return () => {
      if (unregisterDropZone) {
        unregisterDropZone('background');
      }
    };
  }, [registerDropZone, unregisterDropZone]);

  // 투명 배경을 흰색으로 변환
  const convertTransparentToWhite = (dataUrl: string): Promise<string> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas context를 가져올 수 없습니다'));
          return;
        }
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => reject(new Error('이미지 로드 실패'));
      img.src = dataUrl;
    });
  };

  // 이미지 추가 (파일 선택 다이얼로그)
  const handleAddImages = async () => {
    if (disabled) return;
    if (images.length >= ILLUSTRATION_LIMITS.MAX_BACKGROUND_IMAGES) {
      return;
    }

    try {
      const selected = await open({
        multiple: true,
        filters: [{ name: 'Image', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
      });

      if (!selected) return;

      const files = Array.isArray(selected) ? selected : [selected];
      const remainingSlots = ILLUSTRATION_LIMITS.MAX_BACKGROUND_IMAGES - images.length;
      const filesToProcess = files.slice(0, remainingSlots);

      const newImages: string[] = [];

      for (const filePath of filesToProcess) {
        try {
          const fileData = await readFile(filePath);
          const base64 = btoa(
            Array.from(new Uint8Array(fileData))
              .map((b) => String.fromCharCode(b))
              .join('')
          );
          const ext = filePath.split('.').pop()?.toLowerCase();
          const mimeType = ext === 'png' ? 'image/png' :
                          ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' :
                          ext === 'gif' ? 'image/gif' :
                          ext === 'webp' ? 'image/webp' : 'image/png';
          const dataUrl = `data:${mimeType};base64,${base64}`;

          const convertedImage = await convertTransparentToWhite(dataUrl);
          newImages.push(convertedImage);
        } catch (error) {
          logger.error('이미지 로드 실패:', filePath, error);
        }
      }

      if (newImages.length > 0) {
        onImagesChange([...images, ...newImages]);
      }
    } catch (error) {
      logger.error('파일 선택 오류:', error);
    }
  };

  // 개별 이미지 삭제
  const handleRemoveImage = (index: number) => {
    if (disabled) return;
    onImagesChange(images.filter((_, i) => i !== index));
  };

  // 전체 삭제
  const handleClearAll = () => {
    if (disabled) return;
    onImagesChange([]);
  };

  const hasImages = images.length > 0;
  const canAddMore = images.length < ILLUSTRATION_LIMITS.MAX_BACKGROUND_IMAGES;

  // 드래그 중이고 이 섹션이 드롭 타겟인지 확인
  const showDropHighlight = isDragging && isDropTarget && !disabled && canAddMore;

  return (
    <div
      ref={sectionRef}
      className={`bg-white border rounded-lg p-4 transition-all shadow-sm ${
        showDropHighlight
          ? 'border-teal-500 bg-teal-50 ring-2 ring-teal-500/50'
          : hasImages
          ? 'border-green-400 bg-green-50/50'
          : 'border-gray-200'
      }`}
    >
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Mountain size={18} className="text-teal-600" />
          <span className="text-sm font-semibold text-gray-800">배경 스타일</span>
          <span className="text-xs text-gray-400">(선택사항)</span>
        </div>
        {/* 전체 삭제 버튼 */}
        {images.length > 0 && (
          <button
            onClick={handleClearAll}
            disabled={disabled}
            className="p-1 hover:bg-red-100 rounded transition-colors disabled:opacity-50"
            title="모두 삭제"
          >
            <Trash2 size={14} className="text-red-500" />
          </button>
        )}
      </div>

      {/* 이미지가 없을 때: 드롭 영역 */}
      {images.length === 0 ? (
        <div
          onClick={handleAddImages}
          className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
            showDropHighlight
              ? 'border-teal-500 bg-teal-100 ring-2 ring-teal-500/50'
              : isDragging
              ? 'border-teal-400 bg-teal-50'
              : disabled
              ? 'border-gray-300 opacity-50 cursor-not-allowed'
              : 'border-gray-300 hover:border-teal-500 hover:bg-teal-50'
          }`}
        >
          <Mountain size={32} className={`mx-auto mb-2 ${showDropHighlight ? 'text-teal-600' : 'text-gray-400'}`} />
          <p className={`text-sm font-medium ${showDropHighlight ? 'text-teal-700' : 'text-gray-500'}`}>
            {showDropHighlight ? '여기에 드롭하세요!' : '배경 참조 이미지를 추가하세요'}
          </p>
          <p className="text-xs text-gray-400 mt-1">
            클릭하거나 드래그하여 이미지 추가
          </p>
        </div>
      ) : (
        <>
          {/* 이미지 그리드 */}
          <div className="flex flex-wrap gap-2 mb-2">
            {images.map((img, idx) => (
              <div
                key={idx}
                className="relative w-20 h-20 rounded-lg overflow-hidden border border-gray-200 shadow-sm group"
              >
                <img
                  src={img}
                  alt={`배경 ${idx + 1}`}
                  className="w-full h-full object-cover"
                />
                <button
                  onClick={() => handleRemoveImage(idx)}
                  disabled={disabled}
                  className="absolute top-0 right-0 p-0.5 bg-red-500 rounded-bl opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-0"
                >
                  <X size={12} className="text-white" />
                </button>
              </div>
            ))}
            {/* 이미지 추가 버튼 */}
            {canAddMore && (
              <button
                onClick={handleAddImages}
                disabled={disabled}
                className={`w-20 h-20 rounded-lg border-2 border-dashed flex flex-col items-center justify-center transition-colors disabled:opacity-50 ${
                  showDropHighlight
                    ? 'border-teal-500 bg-teal-100'
                    : 'border-gray-300 hover:border-teal-500 hover:bg-teal-50 disabled:hover:border-gray-300 disabled:hover:bg-transparent'
                }`}
              >
                <Plus size={24} className={showDropHighlight ? 'text-teal-600' : 'text-gray-400'} />
                {showDropHighlight && (
                  <span className="text-[10px] text-teal-600 font-medium mt-0.5">드롭</span>
                )}
              </button>
            )}
          </div>

          {/* 이미지 카운트 */}
          <span className="text-xs text-gray-500 font-medium">
            {images.length}/{ILLUSTRATION_LIMITS.MAX_BACKGROUND_IMAGES}장
          </span>
        </>
      )}
    </div>
  );
}
