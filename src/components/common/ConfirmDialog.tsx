import { X, AlertTriangle, Info, CheckCircle } from 'lucide-react';

export type ConfirmDialogType = 'warning' | 'info' | 'success' | 'danger';

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  type?: ConfirmDialogType;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * 커스텀 확인 다이얼로그 컴포넌트
 * window.confirm() 대체용 (Tauri 환경에서 안정적)
 */
export function ConfirmDialog({
  isOpen,
  title,
  message,
  type = 'info',
  confirmText = '확인',
  cancelText = '취소',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!isOpen) return null;

  // 타입별 아이콘 및 색상
  const getTypeStyles = () => {
    switch (type) {
      case 'warning':
        return {
          icon: <AlertTriangle size={24} className="text-yellow-600" />,
          titleColor: 'text-yellow-900',
          bgColor: 'bg-yellow-50',
          borderColor: 'border-yellow-300',
          confirmButtonColor: 'bg-yellow-600 hover:bg-yellow-700 text-white',
        };
      case 'danger':
        return {
          icon: <AlertTriangle size={24} className="text-red-600" />,
          titleColor: 'text-red-900',
          bgColor: 'bg-red-50',
          borderColor: 'border-red-300',
          confirmButtonColor: 'bg-red-600 hover:bg-red-700 text-white',
        };
      case 'success':
        return {
          icon: <CheckCircle size={24} className="text-green-600" />,
          titleColor: 'text-green-900',
          bgColor: 'bg-green-50',
          borderColor: 'border-green-300',
          confirmButtonColor: 'bg-green-600 hover:bg-green-700 text-white',
        };
      default: // info
        return {
          icon: <Info size={24} className="text-blue-600" />,
          titleColor: 'text-blue-900',
          bgColor: 'bg-blue-50',
          borderColor: 'border-blue-300',
          confirmButtonColor: 'bg-blue-600 hover:bg-blue-700 text-white',
        };
    }
  };

  const styles = getTypeStyles();

  // 배경 클릭 시 취소
  const handleBackgroundClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onCancel();
    }
  };

  // ESC 키로 취소
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onCancel();
    } else if (e.key === 'Enter') {
      onConfirm();
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 animate-in fade-in duration-200"
      onClick={handleBackgroundClick}
      onKeyDown={handleKeyDown}
    >
      <div
        className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className={`flex items-center gap-3 p-4 ${styles.bgColor} ${styles.borderColor} border-b rounded-t-lg`}>
          {styles.icon}
          <h3 className={`flex-1 text-lg font-semibold ${styles.titleColor}`}>
            {title}
          </h3>
          <button
            onClick={onCancel}
            className="p-1 rounded hover:bg-black/5 transition-colors"
            aria-label="닫기"
          >
            <X size={20} className="text-gray-500" />
          </button>
        </div>

        {/* 메시지 */}
        <div className="p-6">
          <p className="text-gray-700 whitespace-pre-wrap leading-relaxed">
            {message}
          </p>
        </div>

        {/* 버튼 */}
        <div className="flex gap-3 justify-end px-6 pb-6">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium transition-colors"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${styles.confirmButtonColor}`}
            autoFocus
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
