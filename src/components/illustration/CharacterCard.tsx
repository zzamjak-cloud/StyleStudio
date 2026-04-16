import { useState, useRef, useEffect } from 'react';
import { User, Trash2, Plus, X } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { readFile } from '@tauri-apps/plugin-fs';
import { IllustrationCharacter } from '../../types/illustration';
import { ILLUSTRATION_LIMITS } from '../../types/illustration';
import { logger } from '../../lib/logger';

// 드롭 영역 정보 타입
interface DropZoneInfo {
  type: 'character' | 'background';
  id?: string;
  element: HTMLElement;
}

interface CharacterCardProps {
  character: IllustrationCharacter;
  onUpdate: (character: IllustrationCharacter) => void;
  onDelete: () => void;
  disabled?: boolean;
  // 드래그앤드롭 관련 props (부모에서 통합 관리)
  isDragging?: boolean;
  isDropTarget?: boolean;
  registerDropZone?: (id: string, info: DropZoneInfo) => void;
  unregisterDropZone?: (id: string) => void;
}

export function CharacterCard({
  character,
  onUpdate,
  onDelete,
  disabled = false,
  isDragging = false,
  isDropTarget = false,
  registerDropZone,
  unregisterDropZone,
}: CharacterCardProps) {
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(character.name);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  // 드롭 영역 등록/해제
  useEffect(() => {
    if (cardRef.current && registerDropZone) {
      registerDropZone(character.id, {
        type: 'character',
        id: character.id,
        element: cardRef.current,
      });
    }
    return () => {
      if (unregisterDropZone) {
        unregisterDropZone(character.id);
      }
    };
  }, [character.id, registerDropZone, unregisterDropZone]);

  // 이름 변경 시작
  const startNameEdit = () => {
    if (disabled) return;
    setIsEditingName(true);
    setNameValue(character.name);
    setTimeout(() => nameInputRef.current?.focus(), 0);
  };

  // 이름 변경 완료
  const finishNameEdit = () => {
    const trimmed = nameValue.trim();
    if (trimmed && trimmed !== character.name) {
      onUpdate({ ...character, name: trimmed });
    }
    setIsEditingName(false);
  };

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
    if (character.images.length >= ILLUSTRATION_LIMITS.MAX_IMAGES_PER_CHARACTER) {
      return;
    }

    try {
      const selected = await open({
        multiple: true,
        filters: [{ name: 'Image', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
      });

      if (!selected) return;

      const files = Array.isArray(selected) ? selected : [selected];
      const remainingSlots = ILLUSTRATION_LIMITS.MAX_IMAGES_PER_CHARACTER - character.images.length;
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
        onUpdate({
          ...character,
          images: [...character.images, ...newImages],
        });
      }
    } catch (error) {
      logger.error('파일 선택 오류:', error);
    }
  };

  // 개별 이미지 삭제
  const handleRemoveImage = (index: number) => {
    if (disabled) return;
    const newImages = character.images.filter((_, i) => i !== index);
    onUpdate({
      ...character,
      images: newImages,
    });
  };

  const canAddMore = character.images.length < ILLUSTRATION_LIMITS.MAX_IMAGES_PER_CHARACTER;
  const hasImages = character.images.length > 0;

  // 드래그 중이고 이 카드가 드롭 타겟인지 확인
  const showDropHighlight = isDragging && isDropTarget && !disabled && canAddMore;

  return (
    <div
      ref={cardRef}
      className={`bg-white border rounded-lg p-4 transition-all shadow-sm ${
        showDropHighlight
          ? 'border-violet-500 bg-violet-50 ring-2 ring-violet-500/50'
          : hasImages
          ? 'border-green-400 bg-green-50/50'
          : 'border-gray-200'
      }`}
    >
      {/* 헤더: 이름 + 삭제 버튼 */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <User size={18} className="text-violet-600 flex-shrink-0" />
          {isEditingName ? (
            <input
              ref={nameInputRef}
              type="text"
              value={nameValue}
              onChange={(e) => setNameValue(e.target.value)}
              onBlur={finishNameEdit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') finishNameEdit();
                if (e.key === 'Escape') setIsEditingName(false);
              }}
              className="flex-1 min-w-0 px-2 py-1 text-sm bg-white border border-violet-500 rounded text-gray-900 focus:outline-none focus:ring-2 focus:ring-violet-500"
              placeholder="캐릭터 이름"
            />
          ) : (
            <button
              onClick={startNameEdit}
              disabled={disabled}
              className="flex-1 min-w-0 text-left text-sm font-semibold text-gray-800 truncate hover:text-violet-600 transition-colors disabled:opacity-50"
            >
              {character.name || '이름 없음'}
            </button>
          )}
        </div>
        {/* 삭제 버튼 */}
        <button
          onClick={onDelete}
          disabled={disabled}
          className="p-1 hover:bg-red-100 rounded transition-colors disabled:opacity-50"
          title="캐릭터 삭제"
        >
          <Trash2 size={16} className="text-red-500" />
        </button>
      </div>

      {/* 이미지 그리드 */}
      <div className="flex flex-wrap gap-2 mb-2">
        {character.images.map((img, idx) => (
          <div
            key={idx}
            className="relative w-16 h-16 rounded-lg overflow-hidden border border-gray-200 shadow-sm group"
          >
            <img
              src={img}
              alt={`${character.name} ${idx + 1}`}
              className="w-full h-full object-cover"
            />
            {/* 삭제 버튼 (호버 시) */}
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
            className={`w-16 h-16 rounded-lg border-2 border-dashed flex flex-col items-center justify-center transition-colors disabled:opacity-50 ${
              showDropHighlight
                ? 'border-violet-500 bg-violet-100'
                : 'border-gray-300 hover:border-violet-500 hover:bg-violet-50 disabled:hover:border-gray-300 disabled:hover:bg-transparent'
            }`}
          >
            <Plus size={20} className={showDropHighlight ? 'text-violet-600' : 'text-gray-400'} />
            {showDropHighlight && (
              <span className="text-[10px] text-violet-600 font-medium mt-0.5">드롭</span>
            )}
          </button>
        )}
      </div>

      {/* 이미지 카운트 */}
      <span className="text-xs text-gray-500 font-medium">
        {character.images.length}/{ILLUSTRATION_LIMITS.MAX_IMAGES_PER_CHARACTER}장
      </span>
    </div>
  );
}
