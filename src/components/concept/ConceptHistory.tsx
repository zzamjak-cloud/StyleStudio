import { useState, useCallback, useRef, useEffect } from 'react';
import { ChevronUp, Download, Trash2, Clock, Grid, Loader2 } from 'lucide-react';
import { ConceptGenerationEntry } from '../../types/concept';
import { save } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';

interface ConceptHistoryProps {
  history: ConceptGenerationEntry[];
  height: number;
  onHeightChange: (height: number) => void;
  onDelete: (id: string) => void;
  onSelect: (entry: ConceptGenerationEntry) => void;
  selectedEntryId?: string | null;
  isLoading?: boolean;
}

/** 컨셉 세션 하단 히스토리 패널 */
export function ConceptHistory({
  history,
  height,
  onHeightChange,
  onDelete,
  onSelect,
  selectedEntryId,
  isLoading = false,
}: ConceptHistoryProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [dragStartY, setDragStartY] = useState(0);
  const [dragStartHeight, setDragStartHeight] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);

  // 드래그 시작
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    setIsDragging(true);
    setDragStartY(e.clientY);
    setDragStartHeight(height);
    e.preventDefault();
  }, [height]);

  // 드래그 중
  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaY = dragStartY - e.clientY;
      const newHeight = Math.max(100, Math.min(600, dragStartHeight + deltaY));
      onHeightChange(newHeight);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, dragStartY, dragStartHeight, onHeightChange]);

  // 이미지 저장
  const handleSaveImage = useCallback(async (imageBase64: string) => {
    try {
      const timestamp = Date.now();
      const fileName = `concept-${timestamp}.jpg`;

      const filePath = await save({
        filters: [{ name: 'JPEG 이미지', extensions: ['jpg', 'jpeg'] }],
        defaultPath: fileName,
      });

      if (!filePath) return;

      // base64에서 바이너리 데이터로 변환
      const base64Data = imageBase64.includes(',')
        ? imageBase64.split(',')[1]
        : imageBase64;
      const binaryString = atob(base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      await writeFile(filePath, bytes);
    } catch (error) {
      console.error('이미지 저장 실패:', error);
    }
  }, []);

  return (
    <div
      ref={panelRef}
      className="bg-white border-t border-gray-200 flex flex-col"
      style={{ height: `${height}px` }}
    >
      {/* 드래그 핸들 */}
      <div
        className="h-2 bg-gray-100 hover:bg-gray-200 cursor-ns-resize flex items-center justify-center"
        onMouseDown={handleDragStart}
      >
        <div className="w-12 h-1 bg-gray-400 rounded-full" />
      </div>

      {/* 헤더 */}
      <div className="px-4 py-2 border-b border-gray-200 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-gray-600" />
          <h3 className="font-medium text-gray-800">생성 히스토리</h3>
          <span className="text-sm text-gray-500">({history.length}개)</span>
          {isLoading && (
            <span className="ml-2 inline-flex items-center gap-1 text-xs text-purple-700">
              <Loader2 className="w-3 h-3 animate-spin" />
              불러오는 중...
            </span>
          )}
        </div>
        <button
          onClick={() => onHeightChange(height === 100 ? 300 : 100)}
          className="p-1 hover:bg-gray-100 rounded transition-colors"
        >
          <ChevronUp
            className={`w-4 h-4 text-gray-600 transition-transform ${
              height === 100 ? 'rotate-180' : ''
            }`}
          />
        </button>
      </div>

      {/* 히스토리 목록 */}
      <div className={`flex-1 overflow-x-auto overflow-y-hidden ${isLoading ? 'opacity-70 pointer-events-none' : ''}`}>
        {history.length === 0 ? (
          <div className="h-full flex items-center justify-center text-gray-400">
            <p className="text-sm">아직 생성된 이미지가 없습니다</p>
          </div>
        ) : (
          <div className="flex gap-[10px] px-[10px] py-[6px] h-full items-stretch">
            {history.map((entry) => (
              <div
                key={entry.id}
                className={`group flex-shrink-0 rounded-lg border overflow-hidden transition-all cursor-pointer h-full ${
                  selectedEntryId === entry.id
                    ? 'border-purple-400 shadow-md ring-2 ring-purple-300'
                    : 'border-gray-200 hover:shadow-md'
                }`}
                onClick={() => onSelect(entry)}
              >
                <div className="relative h-full bg-gray-100">
                  <img
                    src={entry.imageBase64}
                    alt={entry.prompt || '생성 이미지'}
                    className="h-full w-auto object-contain block"
                  />

                  {/* 그리드 표시 */}
                  {entry.settings.grid !== '1x1' && (
                    <div className="absolute top-1 left-1 px-1.5 py-0.5 bg-black/50 text-white text-xs rounded flex items-center gap-1">
                      <Grid className="w-3 h-3" />
                      {entry.settings.grid}
                    </div>
                  )}

                  {/* 액션 버튼 (호버 시 표시) */}
                  <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSaveImage(entry.imageBase64);
                      }}
                      className="p-1.5 rounded bg-black/50 text-white hover:bg-black/70 transition-colors"
                    >
                      <Download className="w-3 h-3" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(entry.id);
                      }}
                      className="p-1.5 rounded bg-black/50 text-white hover:bg-red-600 transition-colors"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}