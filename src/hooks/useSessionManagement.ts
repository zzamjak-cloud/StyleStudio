import { useState, useEffect, startTransition } from 'react';
import { Session, GenerationHistoryEntry } from '../types/session';
import { ReferenceDocument } from '../types/referenceDocument';
import { ImageAnalysisResult } from '../types/analysis';
import {
  loadApiKey,
  saveApiKey,
  loadSessions,
  exportSessionToFile,
  importSessionFromFile,
} from '../lib/storage';
import {
  updateSession,
  updateSessionInList,
  addSessionToList,
  removeSessionFromList,
  persistSessions,
} from '../utils/sessionHelpers';
import { logger } from '../lib/logger';

interface UseSessionManagementReturn {
  apiKey: string;
  setApiKey: (key: string) => void;
  sessions: Session[];
  setSessions: React.Dispatch<React.SetStateAction<Session[]>>;
  currentSession: Session | null;
  setCurrentSession: React.Dispatch<React.SetStateAction<Session | null>>;
  showSettings: boolean;
  setShowSettings: (show: boolean) => void;
  initializeApp: () => Promise<void>;
  handleSaveApiKey: (newApiKey: string) => Promise<void>;
  handleSelectSession: (session: Session) => void;
  handleDeleteSession: (sessionId: string) => Promise<void>;
  handleExportSession: (session: Session) => Promise<void>;
  handleImportSession: () => Promise<void>;
  handleReorderSessions: (reorderedSessions: Session[]) => Promise<void>;
  handleHistoryAdd: (entry: GenerationHistoryEntry) => void;
  handleHistoryUpdate: (entryId: string, updates: Partial<GenerationHistoryEntry>) => void;
  handleHistoryDelete: (entryId: string) => void;
  handleDocumentAdd: (document: ReferenceDocument) => void;
  handleDocumentDelete: (documentId: string) => void;
  handleAutoSavePathChange: (path: string) => Promise<void>;
  saveSessionWithoutTranslation: (updatedAnalysis: ImageAnalysisResult) => Promise<void>;
}

/**
 * 세션 관리 Hook
 */
export function useSessionManagement(): UseSessionManagementReturn {
  const [apiKey, setApiKeyState] = useState('');
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSession, setCurrentSession] = useState<Session | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  // 앱 시작 시 API 키 및 세션 로드
  const initializeApp = async () => {
    try {
      const savedApiKey = await loadApiKey();
      if (savedApiKey) {
        setApiKeyState(savedApiKey);
      } else {
        setShowSettings(true);
      }

      const savedSessions = await loadSessions();
      setSessions(savedSessions);
    } catch (error) {
      logger.error('초기화 오류:', error);
      setShowSettings(true);
    }
  };

  useEffect(() => {
    initializeApp();
  }, []);

  const setApiKey = (key: string) => {
    setApiKeyState(key);
  };

  const handleSaveApiKey = async (newApiKey: string) => {
    try {
      await saveApiKey(newApiKey);
      setApiKeyState(newApiKey);
      logger.info('✅ API 키 저장 성공');
    } catch (error) {
      logger.error('❌ API 키 저장 오류:', error);
      throw error; // 상위 컴포넌트에서 처리하도록 에러 전파
    }
  };

  const handleSelectSession = (session: Session) => {
    setCurrentSession(session);
    // 세션 선택 시 이미지와 분석 결과도 함께 로드해야 함
    // 이 부분은 App.tsx에서 처리 (uploadedImages, analysisResult는 App.tsx의 상태)
  };

  const handleDeleteSession = async (sessionId: string) => {
    // 삭제되는 세션의 인덱스 찾기
    const deletedIndex = sessions.findIndex(s => s.id === sessionId);
    const updatedSessions = removeSessionFromList(sessions, sessionId);
    setSessions(updatedSessions);

    // 현재 세션이 삭제되는 경우, 다른 세션 선택
    if (currentSession?.id === sessionId) {
      if (updatedSessions.length === 0) {
        // 세션이 하나도 없으면 null
        setCurrentSession(null);
      } else if (deletedIndex > 0) {
        // 이전 세션 선택
        setCurrentSession(updatedSessions[deletedIndex - 1]);
      } else {
        // 이전 세션이 없으면 다음 세션 선택 (첫 번째가 삭제되면 새로운 첫 번째)
        setCurrentSession(updatedSessions[0]);
      }
    }

    try {
      await persistSessions(updatedSessions);
      logger.info('✅ 세션 삭제 성공');
    } catch (error) {
      logger.error('❌ 세션 삭제 오류:', error);
      throw error; // 상위 컴포넌트에서 처리하도록 에러 전파
    }
  };

  const handleExportSession = async (session: Session) => {
    try {
      await exportSessionToFile(session);
      logger.info(`✅ 세션 "${session.name}" 파일로 저장 완료`);
      // 성공 알림은 상위 컴포넌트에서 처리
    } catch (error) {
      logger.error('❌ 세션 내보내기 오류:', error);
      throw error; // 상위 컴포넌트에서 처리하도록 에러 전파
    }
  };

  const handleImportSession = async () => {
    try {
      const importedSessions = await importSessionFromFile();

      if (!importedSessions || importedSessions.length === 0) {
        logger.debug('❌ 불러온 세션이 없습니다');
        return;
      }

      logger.info(`📂 ${importedSessions.length}개 세션 처리 시작`);

      let updatedSessions = [...sessions];
      let lastValidSession: Session | null = null;
      const damagedSessions: string[] = [];

      // 각 세션 처리
      for (const importedSession of importedSessions) {
        // 중복 ID 확인 및 처리
        const isDuplicate = updatedSessions.some((s) => s.id === importedSession.id);
        if (isDuplicate) {
          const newId = Date.now().toString() + Math.random().toString(36).substring(2, 9);
          logger.debug(`   - 중복 ID 감지, 새 ID 생성: ${importedSession.id} → ${newId}`);
          importedSession.id = newId;
        }

        // 참조 이미지 검증 (Base64 데이터가 있는지 확인)
        const hasValidImages = importedSession.referenceImages.length > 0 &&
          importedSession.referenceImages.every(img => img.startsWith('data:'));

        if (importedSession.imageCount > 0 && !hasValidImages) {
          logger.warn(`   ⚠️ 세션 "${importedSession.name}"의 참조 이미지가 손상되었습니다`);
          damagedSessions.push(importedSession.name);
        }

        // 세션 추가
        updatedSessions = addSessionToList(updatedSessions, importedSession);
        lastValidSession = importedSession;

        logger.info(
          `   ✅ 세션 "${importedSession.name}" 추가 완료 (참조 이미지: ${importedSession.imageCount}개, 유효: ${hasValidImages})`
        );
      }

      // 세션 저장
      setSessions(updatedSessions);
      await persistSessions(updatedSessions);

      // 손상된 세션 알림
      if (damagedSessions.length > 0) {
        alert(
          `${damagedSessions.length}개 세션의 참조 이미지가 손상되었습니다:\n\n` +
          damagedSessions.map(name => `• ${name}`).join('\n') +
          `\n\n원인: 이전 버전으로 export한 파일이거나, 이미지 데이터가 누락되었습니다.\n\n` +
          `해결 방법:\n` +
          `1. 원본 PC에서 최신 버전으로 세션을 다시 export하세요\n` +
          `2. 참조 이미지를 다시 업로드하고 분석하세요`
        );
      }

      // 마지막 세션 선택 (강제)
      if (lastValidSession) {
        setCurrentSession(lastValidSession);
        logger.info(`✅ 총 ${importedSessions.length}개 세션 불러오기 완료, 마지막 세션 선택: "${lastValidSession.name}"`);
      }
    } catch (error) {
      logger.error('❌ 세션 가져오기 오류:', error);
      throw error; // 상위 컴포넌트에서 처리하도록 에러 전파
    }
  };

  const handleReorderSessions = async (reorderedSessions: Session[]) => {
    setSessions(reorderedSessions);
    try {
      await persistSessions(reorderedSessions);
    } catch (error) {
      logger.error('❌ 세션 순서 저장 오류:', error);
    }
  };

  const handleHistoryAdd = (entry: GenerationHistoryEntry) => {
    if (currentSession) {
      const updatedSession = updateSession(currentSession, {
        generationHistory: [...(currentSession.generationHistory || []), entry],
      });
      const updatedSessions = updateSessionInList(sessions, currentSession.id, updatedSession);

      // 배치 업데이트: 2회 리렌더링 → 1회로 최적화
      startTransition(() => {
        setCurrentSession(updatedSession);
        setSessions(updatedSessions);
      });

      persistSessions(updatedSessions);
    }
  };

  const handleHistoryUpdate = (entryId: string, updates: Partial<GenerationHistoryEntry>) => {
    if (currentSession) {
      const updatedSession = updateSession(currentSession, {
        generationHistory: (currentSession.generationHistory || []).map((entry) =>
          entry.id === entryId ? { ...entry, ...updates } : entry
        ),
      });
      const updatedSessions = updateSessionInList(sessions, currentSession.id, updatedSession);

      // 배치 업데이트: 2회 리렌더링 → 1회로 최적화
      startTransition(() => {
        setCurrentSession(updatedSession);
        setSessions(updatedSessions);
      });

      persistSessions(updatedSessions);
    }
  };

  const handleHistoryDelete = (entryId: string) => {
    if (currentSession) {
      const updatedSession = updateSession(currentSession, {
        generationHistory: (currentSession.generationHistory || []).filter(
          (entry) => entry.id !== entryId
        ),
      });
      const updatedSessions = updateSessionInList(sessions, currentSession.id, updatedSession);

      // 배치 업데이트: 2회 리렌더링 → 1회로 최적화
      startTransition(() => {
        setCurrentSession(updatedSession);
        setSessions(updatedSessions);
      });

      persistSessions(updatedSessions);
    }
  };

  const saveSessionWithoutTranslation = async (updatedAnalysis: ImageAnalysisResult) => {
    if (!currentSession || !apiKey) return;

    try {
      const updatedSession = updateSession(currentSession, {
        analysis: updatedAnalysis,
      });
      const updatedSessions = updateSessionInList(sessions, currentSession.id, updatedSession);

      // 배치 업데이트: 2회 리렌더링 → 1회로 최적화
      startTransition(() => {
        setSessions(updatedSessions);
        setCurrentSession(updatedSession);
      });

      await persistSessions(updatedSessions);
    } catch (error) {
      logger.error('❌ [프롬프트 수정] 세션 저장 오류:', error);
    }
  };

  const handleDocumentAdd = (document: ReferenceDocument) => {
    if (!currentSession) return;

    const updatedDocuments = [...(currentSession.referenceDocuments || []), document];
    const updatedSession = updateSession(currentSession, {
      referenceDocuments: updatedDocuments,
    });
    const updatedSessions = updateSessionInList(sessions, currentSession.id, updatedSession);

    // 배치 업데이트: 2회 리렌더링 → 1회로 최적화
    startTransition(() => {
      setSessions(updatedSessions);
      setCurrentSession(updatedSession);
    });

    persistSessions(updatedSessions);
    logger.debug('문서 추가됨:', document.fileName);
  };

  const handleDocumentDelete = (documentId: string) => {
    if (!currentSession) return;

    const updatedDocuments = (currentSession.referenceDocuments || []).filter(
      (doc) => doc.id !== documentId
    );
    const updatedSession = updateSession(currentSession, {
      referenceDocuments: updatedDocuments,
    });
    const updatedSessions = updateSessionInList(sessions, currentSession.id, updatedSession);

    // 배치 업데이트: 2회 리렌더링 → 1회로 최적화
    startTransition(() => {
      setSessions(updatedSessions);
      setCurrentSession(updatedSession);
    });

    persistSessions(updatedSessions);
    logger.debug('문서 삭제됨:', documentId);
  };

  const handleAutoSavePathChange = async (path: string) => {
    if (!currentSession) return;

    const updatedSession = updateSession(currentSession, {
      autoSavePath: path,
    });
    const updatedSessions = updateSessionInList(sessions, currentSession.id, updatedSession);

    // 배치 업데이트: 2회 리렌더링 → 1회로 최적화
    startTransition(() => {
      setSessions(updatedSessions);
      setCurrentSession(updatedSession);
    });

    await persistSessions(updatedSessions);
    logger.debug('✅ 자동 저장 폴더 변경됨:', path);
  };

  return {
    apiKey,
    setApiKey,
    sessions,
    setSessions,
    currentSession,
    setCurrentSession,
    showSettings,
    setShowSettings,
    initializeApp,
    handleSaveApiKey,
    handleSelectSession,
    handleDeleteSession,
    handleExportSession,
    handleImportSession,
    handleReorderSessions,
    handleHistoryAdd,
    handleHistoryUpdate,
    handleHistoryDelete,
    handleDocumentAdd,
    handleDocumentDelete,
    handleAutoSavePathChange,
    saveSessionWithoutTranslation,
  };
}

