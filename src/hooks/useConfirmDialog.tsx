import { useState, useCallback } from 'react';
import { ConfirmDialog, ConfirmDialogType } from '../components/common/ConfirmDialog';

interface ConfirmOptions {
  title: string;
  message: string;
  type?: ConfirmDialogType;
  confirmText?: string;
  cancelText?: string;
}

interface ConfirmDialogState extends ConfirmOptions {
  isOpen: boolean;
  resolver?: (value: boolean) => void;
}

/**
 * 커스텀 확인 다이얼로그 Hook
 *
 * @example
 * const { confirmDialog, confirm } = useConfirmDialog();
 *
 * const handleDelete = async () => {
 *   const confirmed = await confirm({
 *     title: '삭제 확인',
 *     message: '정말 삭제하시겠습니까?',
 *     type: 'danger',
 *   });
 *
 *   if (confirmed) {
 *     // 삭제 로직 실행
 *   }
 * };
 *
 * return (
 *   <>
 *     <button onClick={handleDelete}>삭제</button>
 *     {confirmDialog}
 *   </>
 * );
 */
export function useConfirmDialog() {
  const [state, setState] = useState<ConfirmDialogState>({
    isOpen: false,
    title: '',
    message: '',
    type: 'info',
    confirmText: '확인',
    cancelText: '취소',
  });

  /**
   * 확인 다이얼로그 표시 (Promise 반환)
   */
  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      setState({
        ...options,
        isOpen: true,
        resolver: resolve,
      });
    });
  }, []);

  /**
   * 확인 버튼 클릭
   */
  const handleConfirm = useCallback(() => {
    state.resolver?.(true);
    setState((prev) => ({ ...prev, isOpen: false, resolver: undefined }));
  }, [state.resolver]);

  /**
   * 취소 버튼 클릭
   */
  const handleCancel = useCallback(() => {
    state.resolver?.(false);
    setState((prev) => ({ ...prev, isOpen: false, resolver: undefined }));
  }, [state.resolver]);

  /**
   * ConfirmDialog 컴포넌트 렌더링
   */
  const ConfirmDialogComponent = () => {
    if (!state.isOpen) return null;

    return (
      <ConfirmDialog
        isOpen={state.isOpen}
        title={state.title}
        message={state.message}
        type={state.type}
        confirmText={state.confirmText}
        cancelText={state.cancelText}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    );
  };

  return {
    /**
     * 확인 다이얼로그를 표시하고 사용자 응답을 Promise로 반환
     */
    confirm,

    /**
     * JSX에 포함할 ConfirmDialog 컴포넌트
     */
    ConfirmDialog: ConfirmDialogComponent,
  };
}
