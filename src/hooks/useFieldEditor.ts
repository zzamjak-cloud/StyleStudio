import { useState } from 'react';
import { logger } from '../lib/logger';

/**
 * 개별 필드 편집을 위한 커스텀 훅
 * 제네릭 타입으로 모든 분석 타입(StyleAnalysis, CharacterAnalysis, CompositionAnalysis)에서 사용 가능
 */

interface UseFieldEditorProps<T> {
  analysisData: T;
  onUpdate: (updated: T) => void;
}

interface UseFieldEditorReturn<T> {
  editingField: keyof T | null;
  editedValue: string;
  setEditedValue: (value: string) => void;
  startEdit: (field: keyof T) => void;
  saveField: () => Promise<void>;
  cancelEdit: () => void;
}

export function useFieldEditor<T extends Record<string, any>>(
  props: UseFieldEditorProps<T>
): UseFieldEditorReturn<T> {
  const [editingField, setEditingField] = useState<keyof T | null>(null);
  const [editedValue, setEditedValue] = useState('');

  /**
   * 편집 모드 진입
   */
  const startEdit = (field: keyof T) => {
    logger.debug('✏️ [useFieldEditor] 편집 시작:', field);
    setEditingField(field);
    setEditedValue(String(props.analysisData[field] || ''));
  };

  /**
   * 필드 저장
   */
  const saveField = async () => {
    if (!editingField) {
      logger.warn('⚠️ [useFieldEditor] 편집 중인 필드가 없습니다.');
      return;
    }

    try {
      const trimmedValue = editedValue.trim();

      const updatedAnalysis = {
        ...props.analysisData,
        [editingField]: trimmedValue,
      };
      props.onUpdate(updatedAnalysis);
      logger.debug('✅ [useFieldEditor] 분석 결과 업데이트 완료');

      setEditingField(null);
      setEditedValue('');
    } catch (error) {
      logger.error('❌ [useFieldEditor] 저장 오류:', error);
    }
  };

  /**
   * 편집 취소
   */
  const cancelEdit = () => {
    setEditingField(null);
    setEditedValue('');
  };

  return {
    editingField,
    editedValue,
    setEditedValue,
    startEdit,
    saveField,
    cancelEdit,
  };
}
