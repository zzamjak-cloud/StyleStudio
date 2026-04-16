import { useState } from 'react';
import { Session, SessionType } from '../types/session';
import { ImageAnalysisResult } from '../types/analysis';
import {
  createNewSession,
  updateSession,
  updateSessionInList,
  addSessionToList,
  persistSessions,
} from '../utils/sessionHelpers';
import { logger } from '../lib/logger';

interface SaveProgress {
  stage: 'idle' | 'saving' | 'complete';
  message: string;
  percentage: number;
  estimatedSecondsLeft: number;
}

interface UseSessionPersistenceProps {
  apiKey: string;
  currentSession: Session | null;
  sessions: Session[];
  setSessions: React.Dispatch<React.SetStateAction<Session[]>>;
  setCurrentSession: React.Dispatch<React.SetStateAction<Session | null>>;
  analysisResult: ImageAnalysisResult | null;
  uploadedImages: string[];
}

interface UseSessionPersistenceReturn {
  saveProgress: SaveProgress;
  saveSession: (sessionName: string, sessionType: SessionType) => Promise<void>;
}

/**
 * 세션 저장 및 지속성 관리 Hook
 */
export function useSessionPersistence(
  props: UseSessionPersistenceProps
): UseSessionPersistenceReturn {
  const [saveProgress, setSaveProgress] = useState<SaveProgress>({
    stage: 'idle',
    message: '',
    percentage: 0,
    estimatedSecondsLeft: 0,
  });

  /**
   * 세션 저장
   */
  const saveSession = async (sessionName: string, sessionType: SessionType) => {
    if (!props.analysisResult || props.uploadedImages.length === 0) {
      logger.warn('⚠️ 분석 결과가 없습니다');
      return;
    }

    try {
      setSaveProgress({
        stage: 'saving',
        message: '세션 저장 중...',
        percentage: 50,
        estimatedSecondsLeft: 0,
      });

      let sessionToSave: Session;
      let updatedSessions: Session[];

      if (props.currentSession) {
        // 기존 세션 업데이트
        sessionToSave = updateSession(props.currentSession, {
          name: sessionName,
          type: sessionType,
          referenceImages: props.uploadedImages,
          analysis: props.analysisResult,
          imageCount: props.uploadedImages.length,
        });
        updatedSessions = updateSessionInList(props.sessions, props.currentSession.id, sessionToSave);
      } else {
        // 새 세션 생성
        sessionToSave = createNewSession(
          props.analysisResult,
          props.uploadedImages,
          sessionType
        );
        sessionToSave.name = sessionName;
        sessionToSave.type = sessionType;
        updatedSessions = addSessionToList(props.sessions, sessionToSave);
      }

      props.setSessions(updatedSessions);
      await persistSessions(updatedSessions);

      setSaveProgress({
        stage: 'complete',
        message: '저장 완료!',
        percentage: 100,
        estimatedSecondsLeft: 0,
      });

      logger.info(
        `✅ 세션 "${sessionName}" ${props.currentSession ? '업데이트' : '저장'} 완료 (참조 이미지: ${props.uploadedImages.length}개)`
      );

      props.setCurrentSession(sessionToSave);

      setTimeout(() => {
        setSaveProgress({
          stage: 'idle',
          message: '',
          percentage: 0,
          estimatedSecondsLeft: 0,
        });
      }, 2000);
    } catch (error) {
      logger.error('❌ 세션 저장 오류:', error);
      setSaveProgress({
        stage: 'idle',
        message: '',
        percentage: 0,
        estimatedSecondsLeft: 0,
      });
    }
  };

  return {
    saveProgress,
    saveSession,
  };
}
