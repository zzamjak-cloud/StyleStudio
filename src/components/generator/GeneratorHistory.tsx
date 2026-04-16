import { useState } from 'react';
import { History, Pin, RotateCcw, Trash2 } from 'lucide-react';
import { GenerationHistoryEntry } from '../../types/session';
import { Resizer } from '../common/Resizer';
import { formatDateTime } from '../../utils/dateUtils';

interface GeneratorHistoryProps {
  generationHistory: GenerationHistoryEntry[];
  historyHeight: number;
  onHistoryResize: (delta: number) => void;
  onRestoreFromHistory: (e: React.MouseEvent, entry: GenerationHistoryEntry) => void;
  onTogglePin: (e: React.MouseEvent, entryId: string) => void;
  onDeleteHistory?: (entryId: string) => void;
}

export function GeneratorHistory({
  generationHistory,
  historyHeight,
  onHistoryResize,
  onRestoreFromHistory,
  onTogglePin,
  onDeleteHistory,
}: GeneratorHistoryProps) {
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const handleDeleteHistory = (e: React.MouseEvent, entryId: string) => {
    e.stopPropagation();
    setDeleteConfirm(entryId);
  };

  const confirmDelete = () => {
    if (deleteConfirm && onDeleteHistory) {
      onDeleteHistory(deleteConfirm);
      setDeleteConfirm(null);
    }
  };

  const cancelDelete = () => {
    setDeleteConfirm(null);
  };

  if (generationHistory.length === 0) {
    return null;
  }

  return (
    <>
      {/* Resizer - 히스토리 영역 상단 */}
      <Resizer onResize={onHistoryResize} direction="vertical" />

      <div
        className="border-t border-gray-200 bg-white p-4 overflow-y-auto"
        style={{ height: `${historyHeight}px` }}
      >
        <div className="flex items-center gap-2 mb-3">
          <History size={16} className="text-gray-600" />
          <h3 className="text-sm font-semibold text-gray-800">
            생성 히스토리 ({generationHistory.length})
          </h3>
        </div>
        <div className="grid grid-cols-8 gap-2">
          {generationHistory
            .slice()
            .sort((a, b) => {
              // 핀된 항목을 먼저 표시
              if (a.isPinned && !b.isPinned) return -1;
              if (!a.isPinned && b.isPinned) return 1;
              // 시간순 역순 (최신 먼저)
              return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
            })
            .map((entry) => {
              // 툴팁 텍스트 생성
              const tooltipParts = [
                `생성 시간: ${formatDateTime(entry.timestamp)}`,
                `비율: ${entry.settings.aspectRatio}`,
                `크기: ${entry.settings.imageSize}`,
              ];

              if (entry.settings.pixelArtGrid) {
                tooltipParts.push(`그리드: ${entry.settings.pixelArtGrid}`);
              }

              if (entry.settings.seed !== undefined) {
                tooltipParts.push(`Seed: ${entry.settings.seed}`);
              }

              if (entry.referenceDocumentIds && entry.referenceDocumentIds.length > 0) {
                tooltipParts.push(`📄 참조 문서: ${entry.referenceDocumentIds.length}개`);
              }

              const tooltipText = tooltipParts.join('\n');

              return (
                <div key={entry.id} className="group relative" title={tooltipText}>
                  {/* 핀 아이콘 (좌측 상단) */}
                  <button
                    onClick={(e) => onTogglePin(e, entry.id)}
                    className={`absolute top-1 left-1 z-10 p-1 rounded transition-all ${
                      entry.isPinned
                        ? 'bg-yellow-500 text-white'
                        : 'bg-black/50 text-white opacity-0 group-hover:opacity-100'
                    }`}
                    title={entry.isPinned ? '핀 해제' : '핀 고정'}
                  >
                    <Pin size={12} />
                  </button>

                  <div
                    className={`aspect-square bg-gray-100 rounded-md overflow-hidden border-2 transition-all ${
                      entry.isPinned
                        ? 'border-yellow-500'
                        : 'border-transparent group-hover:border-purple-500'
                    }`}
                  >
                    <img
                      src={entry.imageBase64}
                      alt={`Generated ${formatDateTime(entry.timestamp)}`}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-70 rounded-md transition-all flex items-center justify-center gap-2">
                    <button
                      onClick={(e) => onRestoreFromHistory(e, entry)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity p-2 bg-green-600 hover:bg-green-700 rounded text-white"
                      title="복원"
                    >
                      <RotateCcw size={16} />
                    </button>
                    {onDeleteHistory && (
                      <button
                        onClick={(e) => handleDeleteHistory(e, entry.id)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity p-2 bg-red-600 hover:bg-red-700 rounded text-white"
                        title="삭제"
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
        </div>
      </div>

      {/* 삭제 확인 다이얼로그 */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white border border-gray-200 rounded-lg p-6 shadow-xl max-w-sm w-full mx-4">
            <h3 className="text-lg font-semibold mb-2">히스토리 삭제</h3>
            <p className="text-gray-600 mb-6">
              이 생성 히스토리를 삭제하시겠습니까?
              <br />이 작업은 되돌릴 수 없습니다.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={cancelDelete}
                className="px-4 py-2 rounded-lg bg-gray-200 hover:bg-gray-300 transition-colors font-medium"
              >
                취소
              </button>
              <button
                onClick={confirmDelete}
                className="px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors font-medium"
              >
                삭제
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
