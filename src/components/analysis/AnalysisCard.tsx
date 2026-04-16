import { LucideIcon, Edit2, Save, X } from 'lucide-react';
import { useFieldEditor } from '../../hooks/useFieldEditor';

interface AnalysisCardProps<T> {
  title: string;
  icon: LucideIcon;
  iconColor: string;
  borderColor: string;
  bgColor: string;
  hoverColor: string;
  focusColor: string;
  data: T;
  fields: Array<{ key: keyof T; label: string; icon?: string }>;
  onUpdate?: (data: T) => void;
}

/**
 * 공통 분석 카드 컴포넌트
 */
export function AnalysisCard<T extends Record<string, any>>({
  title,
  icon: Icon,
  iconColor,
  borderColor,
  bgColor,
  hoverColor,
  focusColor,
  data,
  fields,
  onUpdate,
}: AnalysisCardProps<T>) {
  const {
    editingField,
    editedValue,
    setEditedValue,
    startEdit,
    saveField,
    cancelEdit,
  } = useFieldEditor<T>({
    analysisData: data,
    onUpdate: (updated) => {
      if (onUpdate) {
        onUpdate(updated);
      }
    },
  });

  // Textarea 자동 높이 조정
  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const target = e.target;
    setEditedValue(target.value);
    target.style.height = 'auto';
    target.style.height = `${Math.min(target.scrollHeight, 200)}px`;
  };

  return (
    <div className={`bg-white rounded-xl shadow-lg p-6 border-2 ${borderColor}`}>
      {/* 헤더 */}
      <div className="flex items-center gap-3 mb-4">
        <div className={`p-2 ${bgColor} rounded-lg`}>
          <Icon size={24} className={iconColor} />
        </div>
        <h3 className="text-xl font-bold text-gray-800">{title}</h3>
      </div>

      {/* 필드 목록 */}
      <div className="space-y-3">
        {fields.map(({ key, label, icon: fieldIcon }) => (
          <div key={String(key)} className="flex flex-col">
            {/* 라벨 + 편집/저장/취소 버튼 */}
            <div className="flex items-center justify-between mb-1">
              <label className="text-sm font-semibold text-gray-600 flex items-center gap-2">
                {fieldIcon && <span>{fieldIcon}</span>}
                <span>{label}</span>
              </label>

              {editingField === key ? (
                <div className="flex items-center gap-1">
                  <button
                    onClick={saveField}
                    className="p-1.5 bg-green-500 hover:bg-green-600 text-white rounded transition-colors"
                    title="저장"
                  >
                    <Save size={14} />
                  </button>
                  <button
                    onClick={cancelEdit}
                    className="p-1.5 bg-gray-300 hover:bg-gray-400 text-gray-700 rounded transition-colors"
                    title="취소"
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => startEdit(key)}
                  className={`p-1.5 text-gray-400 ${hoverColor} rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed`}
                  disabled={editingField !== null}
                  title="편집"
                >
                  <Edit2 size={14} />
                </button>
              )}
            </div>

            {/* 필드 값 */}
            {editingField === key ? (
              <textarea
                value={editedValue}
                onChange={handleTextareaChange}
                className={`w-full px-3 py-2 border-2 ${focusColor} rounded-lg
                           focus:outline-none focus:ring-2 ${focusColor}
                           resize-none overflow-y-auto`}
                style={{ minHeight: '60px', maxHeight: '200px' }}
                autoFocus
                onFocus={(e) => {
                  e.target.style.height = 'auto';
                  e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`;
                }}
              />
            ) : (
              <div className="px-3 py-2 bg-gray-50 rounded-lg text-gray-700 whitespace-pre-wrap break-words">
                {String(data[key] ?? '')}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
