import { useState, useCallback, useEffect, useRef, startTransition } from 'react';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { Sidebar } from './components/common/Sidebar';
import { EmptyState } from './components/common/EmptyState';
import { ImageUpload } from './components/generator/ImageUpload';
import { AnalysisPanel } from './components/analysis/AnalysisPanel';
import { ImageGeneratorPanel } from './components/generator/ImageGeneratorPanel';
import { SettingsModal } from './components/common/SettingsModal';
import { SaveSessionModal } from './components/common/SaveSessionModal';
import { NewSessionModal } from './components/common/NewSessionModal';
import { UpdateModal } from './components/common/UpdateModal';
import { IllustrationSetupPanel } from './components/illustration';
import { ChatPanel } from './components/chat';
import { ConceptPanel } from './components/concept/ConceptPanel';
import { useGeminiAnalyzer } from './hooks/api/useGeminiAnalyzer';
import { useAutoSave } from './hooks/useAutoSave';
import { useAutoUpdate } from './hooks/useAutoUpdate';
import { ProgressIndicator } from './components/common/ProgressIndicator';
import { ImageAnalysisResult } from './types/analysis';
import { Session, SessionType } from './types/session';
import { IllustrationSessionData } from './types/illustration';
import { useImageHandling } from './hooks/useImageHandling';
import { useSessionManagement } from './hooks/useSessionManagement';
import { useSessionPersistence } from './hooks/useSessionPersistence';
import { useFolderManagement } from './hooks/useFolderManagement';
import {
  createNewSession,
  updateSession,
  updateSessionInList,
  addSessionToList,
  persistSessions,
} from './utils/sessionHelpers';
import { logger } from './lib/logger';
import { exportFolderToFile, importFromFile } from './lib/storage';

function App() {
  const [showSaveSession, setShowSaveSession] = useState(false);
  const [showNewSession, setShowNewSession] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<ImageAnalysisResult | null>(null);
  const [currentView, setCurrentView] = useState<'analysis' | 'generator'>('analysis');
  const [refineConfirm, setRefineConfirm] = useState(false);
  const [damagedSessionsWarning, setDamagedSessionsWarning] = useState<string | null>(null);
  const [errorDialog, setErrorDialog] = useState<{ title: string; message: string } | null>(null);
  const [infoDialog, setInfoDialog] = useState<{ title: string; message: string } | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);

  // Import 진행 상태
  const [importProgress, setImportProgress] = useState({
    stage: 'idle' as 'idle' | 'translating' | 'saving' | 'complete',
    message: '',
    percentage: 0,
    estimatedSecondsLeft: 0,
  });

  // 폴더 삭제 Undo 기능
  const [deletedFolderBackup, setDeletedFolderBackup] = useState<{
    folders: typeof folders;
    sessions: Session[];
    sessionFolderMap: Record<string, string | null>;
    deletedFolderName: string;
  } | null>(null);
  const [undoToast, setUndoToast] = useState<string | null>(null);

  // 커스텀 훅 사용
  const { uploadedImages, setUploadedImages, handleImageSelect, handleRemoveImage, showLimitWarning, setShowLimitWarning } =
    useImageHandling();

  const {
    apiKey,
    sessions,
    setSessions,
    currentSession,
    setCurrentSession,
    showSettings,
    setShowSettings,
    handleSaveApiKey,
    handleSelectSession,
    handleDeleteSession,
    handleExportSession,
    handleReorderSessions,
    handleHistoryAdd,
    handleHistoryUpdate,
    handleHistoryDelete,
    handleDocumentAdd,
    handleDocumentDelete,
    handleAutoSavePathChange,
    saveSessionWithoutTranslation,
  } = useSessionManagement();
  const { analyzeImages } = useGeminiAnalyzer();

  // 폴더 관리 Hook
  const {
    folders,
    currentFolderId,
    folderPath,
    sessionFolderMap,
    initializeFolders,
    getCurrentFolderSessions,
    getCurrentFolderSubfolders,
    createFolder,
    renameFolder,
    deleteFolder,
    navigateToFolder,
    navigateBack,
    moveSessionToFolder,
    moveFolderToFolder,
    reorderFolders,
    getCurrentFolderIdForNewSession,
    importFolderData,
    restoreFolderData,
  } = useFolderManagement();

  // 자동 업데이트
  const {
    status: updateStatus,
    update,
    progress: updateProgress,
    error: updateError,
    downloadAndInstall,
    dismissUpdate,
  } = useAutoUpdate();

  // 폴더 데이터 초기화
  useEffect(() => {
    initializeFolders();
  }, []);

  // Ctrl+Z로 폴더 삭제 되돌리기
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      // Ctrl+Z 또는 Cmd+Z 감지
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && deletedFolderBackup) {
        e.preventDefault();

        // 폴더 데이터 복원
        await restoreFolderData(deletedFolderBackup.folders, deletedFolderBackup.sessionFolderMap);

        // 세션 데이터 복원
        setSessions(deletedFolderBackup.sessions);
        await persistSessions(deletedFolderBackup.sessions);

        // 토스트 메시지
        setInfoDialog({
          title: '복원 완료',
          message: `"${deletedFolderBackup.deletedFolderName}" 폴더가 복원되었습니다.`
        });

        // 백업 및 토스트 초기화
        setDeletedFolderBackup(null);
        setUndoToast(null);

        logger.info('✅ 폴더 삭제 되돌리기 완료:', deletedFolderBackup.deletedFolderName);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [deletedFolderBackup, restoreFolderData, setSessions]);

  // 현재 폴더의 세션과 하위 폴더
  const currentFolderSessions = getCurrentFolderSessions(sessions);
  const currentFolderSubfolders = getCurrentFolderSubfolders();

  // 폴더 진입 시 첫 번째 세션 또는 폴더 자동 선택
  useEffect(() => {
    // 현재 폴더의 세션 중 첫 번째 세션 선택
    if (currentFolderSessions.length > 0) {
      // 현재 선택된 세션이 현재 폴더에 없으면 첫 번째 세션 선택
      const currentSessionInFolder = currentFolderSessions.find(s => s.id === currentSession?.id);
      if (!currentSessionInFolder) {
        setSelectedFolderId(null);
        setCurrentSession(currentFolderSessions[0]);
        // 세션의 분석 결과와 이미지도 로드
        setAnalysisResult(currentFolderSessions[0].analysis);
        setUploadedImages(currentFolderSessions[0].referenceImages || []);
        logger.debug('📂 폴더 진입: 첫 번째 세션 선택:', currentFolderSessions[0].name);
      }
    } else if (currentFolderSubfolders.length > 0) {
      // 세션이 없고 하위 폴더가 있으면 첫 번째 폴더 선택 (폴더 도움말 표시)
      // 현재 세션 초기화 (다른 폴더의 세션이 보이지 않도록)
      setCurrentSession(null);
      setAnalysisResult(null);
      setUploadedImages([]);
      setSelectedFolderId(currentFolderSubfolders[0].id);
      logger.debug('📂 폴더 진입: 첫 번째 하위 폴더 선택:', currentFolderSubfolders[0].name);
    } else {
      // 세션도 폴더도 없으면 빈 상태
      // 현재 세션 초기화 (다른 폴더의 세션이 보이지 않도록)
      setCurrentSession(null);
      setAnalysisResult(null);
      setUploadedImages([]);
      setSelectedFolderId(null);
      logger.debug('📂 빈 폴더 진입');
    }
  }, [currentFolderId, currentFolderSessions.length, currentFolderSubfolders.length]);

  // 세션 저장 및 지속성 관리
  const { saveProgress, saveSession } = useSessionPersistence({
    apiKey,
    currentSession,
    sessions,
    setSessions,
    setCurrentSession,
    analysisResult,
    uploadedImages,
  });

  // 자동 저장 Hook
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSessionsRef = useRef<Session[] | null>(null);
  const sessionsRef = useRef(sessions);
  useEffect(() => { sessionsRef.current = sessions; }, [sessions]);

  const flushPendingSessions = useCallback(async () => {
    if (!pendingSessionsRef.current) return;

    const sessionsToPersist = pendingSessionsRef.current;
    pendingSessionsRef.current = null;

    try {
      await persistSessions(sessionsToPersist);
    } catch (error) {
      logger.error('❌ [세션 업데이트] 지연 저장 오류:', error);
    }
  }, []);

  const handleSessionUpdate = useCallback(
    (session: Session) => {
      // ref 기반으로 최신 sessions를 참조하여 콜백 안정성 확보
      // (sessions/currentSession 의존성 제거 → memo 컴포넌트 불필요 재렌더링 방지)
      const currentSessions = sessionsRef.current;
      const sessionExists = currentSessions.some(s => s.id === session.id);
      const updatedSessions = sessionExists
        ? updateSessionInList(currentSessions, session.id, session)
        : addSessionToList(currentSessions, session);

      startTransition(() => {
        setCurrentSession(prev => prev?.id === session.id ? session : prev);
        setSessions(updatedSessions);
      });

      pendingSessionsRef.current = updatedSessions;
      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current);
      }
      persistTimerRef.current = setTimeout(() => {
        void flushPendingSessions();
      }, 1000);
    },
    [flushPendingSessions]
  );

  // 경량 저장 전용 함수 (세션 전환 시 언마운트 cleanup용)
  // React 상태를 업데이트하지 않고 디스크에만 저장하여 렉 방지
  const handleSessionSaveOnly = useCallback(
    (session: Session) => {
      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current);
      }
      // React 상태 업데이트 없이 디스크에만 비동기 저장
      const updatedSessions = updateSessionInList(sessionsRef.current, session.id, session);
      pendingSessionsRef.current = updatedSessions;
      persistTimerRef.current = setTimeout(() => {
        void flushPendingSessions();
      }, 100);
    },
    [flushPendingSessions]
  );

  useEffect(() => {
    return () => {
      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current);
      }
      void flushPendingSessions();
    };
  }, [flushPendingSessions]);

  const { progress } = useAutoSave({
    currentSession,
    analysisResult,
    apiKey,
    uploadedImages,
    onSessionUpdate: handleSessionUpdate,
    autoSaveEnabled: true,
    autoSaveDelay: 1000,
  });

  // 1. 앱 시작 시 첫 번째 세션 자동 선택 및 손상된 세션 확인
  useEffect(() => {
    // currentSession이 없고 현재 폴더에 세션이 있을 때만 실행
    // 현재 폴더 기준으로 세션 선택 (다른 폴더 세션 표시 방지)
    if (currentFolderSessions.length > 0 && !currentSession) {
      const firstSession = currentFolderSessions[0];
      setCurrentSession(firstSession);
      logger.info('✅ 현재 폴더의 첫 번째 세션 자동 선택:', firstSession.name);

      // 손상된 세션 확인 (참조 이미지가 없는데 imageCount가 있는 경우)
      const damagedSessions = sessions.filter(
        (s) => s.imageCount > 0 && s.referenceImages.length === 0
      );

      if (damagedSessions.length > 0) {
        logger.warn(`⚠️ 손상된 세션 발견: ${damagedSessions.length}개`);
        logger.warn('   세션 목록:', damagedSessions.map((s) => s.name).join(', '));

        // 사용자에게 경고 (한 번만 표시)
        setTimeout(() => {
          setDamagedSessionsWarning(
            `참조 이미지가 손상된 세션이 ${damagedSessions.length}개 발견되었습니다.\n\n` +
              `손상된 세션:\n${damagedSessions.map((s) => `- ${s.name}`).join('\n')}\n\n` +
              `원인:\n` +
              `- IndexedDB 데이터가 삭제되었거나\n` +
              `- 다른 PC에서 export한 파일을 import했을 때\n\n` +
              `해결 방법:\n` +
              `1. 원본 PC에서 최신 버전으로 세션을 다시 export하세요\n` +
              `2. 또는 해당 세션의 참조 이미지를 다시 업로드하고 분석하세요`
          );
        }, 1000);
      }
    }
  }, [sessions]); // sessions가 로드될 때만 실행 (currentSession 의존성 제거)

  // 2. currentSession 변경 시 uploadedImages와 analysisResult 복원
  useEffect(() => {
    if (currentSession) {
      setUploadedImages(currentSession.referenceImages);
      setAnalysisResult(currentSession.analysis);
      logger.info('✅ 세션 데이터 복원:', currentSession.name);
      logger.debug('   - 참조 이미지:', currentSession.referenceImages.length, '개');
      logger.debug('   - 분석 결과:', currentSession.analysis ? '존재' : '없음');

      // 참조 이미지 검증
      if (currentSession.referenceImages.length === 0 && currentSession.imageCount > 0) {
        logger.warn('⚠️ 참조 이미지가 손상되었습니다. ImageKeys:', currentSession.imageKeys);
      }
    } else {
      // 세션이 없으면 초기화
      setUploadedImages([]);
      setAnalysisResult(null);
      logger.info('✅ 세션 데이터 초기화');
    }
  }, [currentSession]); // currentSession이 변경될 때 실행

  // 실제 분석 수행 함수
  const performAnalysis = async () => {
    setIsAnalyzing(true);

    // 빈 세션인지 확인 (모든 필드가 빈 문자열인 경우)
    const isEmptySession = currentSession &&
      currentSession.analysis &&
      currentSession.analysis.style.art_style === '' &&
      currentSession.analysis.style.technique === '' &&
      currentSession.analysis.character.gender === '' &&
      currentSession.analysis.character.age_group === '' &&
      currentSession.analysis.composition.pose === '' &&
      currentSession.analysis.composition.angle === '' &&
      currentSession.analysis.negative_prompt === '';

    const isRefinementMode = currentSession && analysisResult && !isEmptySession;

    await analyzeImages(
      apiKey,
      uploadedImages,
      {
        onProgress: (message) => {
          logger.debug('📊 진행 상황:', message);
        },
        onComplete: async (result) => {
          setAnalysisResult(result);
          setIsAnalyzing(false);

          try {
            if (isEmptySession && currentSession) {
              // 빈 세션인 경우 기존 세션 업데이트
              const updatedSession = updateSession(currentSession, {
                analysis: result,
                referenceImages: uploadedImages,
                imageCount: uploadedImages.length,
              });
              const updatedSessions = updateSessionInList(sessions, currentSession.id, updatedSession);
              setSessions(updatedSessions);
              setCurrentSession(updatedSession);
              await persistSessions(updatedSessions);
            } else if (isRefinementMode && currentSession) {
              // 분석 강화 모드 - 기존 세션 업데이트
              const updatedSession = updateSession(currentSession, {
                analysis: result,
                referenceImages: uploadedImages,
                imageCount: uploadedImages.length,
              });
              const updatedSessions = updateSessionInList(sessions, currentSession.id, updatedSession);
              setSessions(updatedSessions);
              setCurrentSession(updatedSession);
              await persistSessions(updatedSessions);
            } else {
              // 신규 세션 생성
              const newSession = createNewSession(result, uploadedImages);
              const updatedSessions = addSessionToList(sessions, newSession);
              setSessions(updatedSessions);
              setCurrentSession(newSession);
              await persistSessions(updatedSessions);
            }
          } catch (error) {
            logger.error('❌ [분석 후] 세션 저장 오류:', error);
          }
        },
        onError: (error) => {
          setIsAnalyzing(false);
          logger.error('❌ 분석 오류:', error);
          setErrorDialog({
            title: '분석 오류',
            message: error.message
          });
        },
      },
      currentSession?.type, // sessionType 전달
      isRefinementMode ? { previousAnalysis: analysisResult } : undefined
    );
  };

  const handleAnalyze = async () => {
    if (!apiKey) {
      setInfoDialog({
        title: 'API 키 필요',
        message: 'API 키를 먼저 설정해주세요'
      });
      setShowSettings(true);
      return;
    }

    if (uploadedImages.length === 0) {
      setInfoDialog({
        title: '이미지 업로드 필요',
        message: '이미지를 먼저 업로드해주세요'
      });
      return;
    }

    // 빈 세션인지 확인 (모든 필드가 빈 문자열인 경우)
    const isEmptySession = currentSession &&
      currentSession.analysis &&
      currentSession.analysis.style.art_style === '' &&
      currentSession.analysis.style.technique === '' &&
      currentSession.analysis.character.gender === '' &&
      currentSession.analysis.character.age_group === '' &&
      currentSession.analysis.composition.pose === '' &&
      currentSession.analysis.composition.angle === '' &&
      currentSession.analysis.negative_prompt === '';

    const isRefinementMode = currentSession && analysisResult && !isEmptySession;

    if (isRefinementMode) {
      const hasNewImages = uploadedImages.length > currentSession.imageCount;

      if (!hasNewImages) {
        setInfoDialog({
          title: '신규 이미지 필요',
          message: '신규 이미지가 없습니다. 이미지를 추가한 후 다시 분석해주세요.'
        });
        return;
      }

      // 커스텀 다이얼로그 표시
      setRefineConfirm(true);
      return;
    }

    // 즉시 분석 수행
    await performAnalysis();
  };

  // 분석 강화 확인 핸들러
  const confirmRefine = async () => {
    setRefineConfirm(false);
    await performAnalysis();
  };

  const cancelRefine = () => {
    setRefineConfirm(false);
  };

  const handleSettingsClick = useCallback(() => {
    setShowSettings(true);
  }, [setShowSettings]);

  // 세션 이름 변경 핸들러
  const handleRenameSession = useCallback(async (sessionId: string, newName: string) => {
    const sessionIndex = sessions.findIndex(s => s.id === sessionId);
    if (sessionIndex === -1) return;

    const updatedSession = { ...sessions[sessionIndex], name: newName, updatedAt: new Date().toISOString() };
    const updatedSessions = [...sessions];
    updatedSessions[sessionIndex] = updatedSession;

    setSessions(updatedSessions);
    if (currentSession?.id === sessionId) {
      setCurrentSession(updatedSession);
    }
    await persistSessions(updatedSessions);
    logger.info('✅ 세션 이름 변경:', newName);
  }, [sessions, currentSession, setSessions, setCurrentSession]);

  // 세션 선택 핸들러 (폴더 선택 해제)
  const handleSelectSessionWithFolderDeselect = useCallback((session: Session) => {
    setSelectedFolderId(null);
    handleSelectSession(session);
  }, [handleSelectSession]);

  // 폴더 선택 핸들러
  const handleSelectFolder = useCallback((folderId: string | null) => {
    setSelectedFolderId(folderId);
  }, []);

  // 폴더 진입 핸들러 (폴더 선택 해제)
  const handleNavigateToFolder = useCallback((folderId: string | null) => {
    setSelectedFolderId(null);
    navigateToFolder(folderId);
  }, [navigateToFolder]);

  // 폴더 뒤로가기 핸들러 (폴더 선택 해제)
  const handleNavigateBack = useCallback(() => {
    setSelectedFolderId(null);
    navigateBack();
  }, [navigateBack]);

  // 폴더 내보내기 핸들러
  const handleExportFolder = useCallback(async (folderId: string) => {
    const folder = folders.find(f => f.id === folderId);
    if (!folder) {
      logger.error('❌ 내보낼 폴더를 찾을 수 없습니다:', folderId);
      return;
    }

    try {
      await exportFolderToFile(folder, folders, sessions, sessionFolderMap);
      logger.info('✅ 폴더 내보내기 완료:', folder.name);
    } catch (error) {
      logger.error('❌ 폴더 내보내기 오류:', error);
      setErrorDialog({
        title: '폴더 내보내기 오류',
        message: '폴더를 내보내는 중 오류가 발생했습니다.'
      });
    }
  }, [folders, sessions, sessionFolderMap]);

  // 통합 불러오기 핸들러 (세션/폴더 모두 처리)
  const handleImport = useCallback(async () => {
    try {
      // 진행 상태 시작
      setImportProgress({
        stage: 'translating',
        message: '파일 선택 중...',
        percentage: 0,
        estimatedSecondsLeft: 0,
      });

      const result = await importFromFile();

      // 취소된 경우
      if (result.sessions.length === 0 && !result.folderData) {
        logger.debug('❌ 불러오기 취소됨');
        setImportProgress({ stage: 'idle', message: '', percentage: 0, estimatedSecondsLeft: 0 });
        return;
      }

      // 폴더 파일인 경우
      if (result.type === 'folder' && result.folderData) {
        const folderData = result.folderData;

        setImportProgress({
          stage: 'translating',
          message: `"${folderData.folder.name}" 폴더 구조 복원 중...`,
          percentage: 20,
          estimatedSecondsLeft: 0,
        });

        // 폴더 ID 매핑을 위해 importFolderData 호출
        const { newFolderIdMap } = await importFolderData(
          folderData.folder,
          folderData.subfolders,
          folderData.sessionFolderMap,
          currentFolderId // 현재 폴더 아래에 배치
        );

        // 세션 추가 (새 폴더 ID로 매핑된 상태로)
        if (folderData.sessions.length > 0) {
          let updatedSessions = [...sessions];
          let lastSession: Session | null = null;
          const totalSessions = folderData.sessions.length;

          for (let i = 0; i < folderData.sessions.length; i++) {
            const importedSession = folderData.sessions[i];

            // 진행 상태 업데이트
            setImportProgress({
              stage: 'saving',
              message: `세션 복원 중... (${i + 1}/${totalSessions})`,
              percentage: 20 + Math.round((i / totalSessions) * 70),
              estimatedSecondsLeft: 0,
            });

            // 중복 ID 처리
            const isDuplicate = updatedSessions.some(s => s.id === importedSession.id);
            if (isDuplicate) {
              const newId = Date.now().toString() + Math.random().toString(36).substring(2, 9);
              logger.debug(`   - 중복 ID 감지, 새 ID 생성: ${importedSession.id} → ${newId}`);

              // 세션-폴더 매핑도 새 ID로 업데이트
              const oldFolderId = folderData.sessionFolderMap[importedSession.id];
              if (oldFolderId && newFolderIdMap[oldFolderId]) {
                await moveSessionToFolder(newId, newFolderIdMap[oldFolderId]);
              }

              importedSession.id = newId;
            } else {
              // 기존 ID 유지, 폴더 매핑만 업데이트
              const oldFolderId = folderData.sessionFolderMap[importedSession.id];
              if (oldFolderId && newFolderIdMap[oldFolderId]) {
                await moveSessionToFolder(importedSession.id, newFolderIdMap[oldFolderId]);
              }
            }

            updatedSessions = addSessionToList(updatedSessions, importedSession);
            lastSession = importedSession;
          }

          setImportProgress({
            stage: 'saving',
            message: '데이터 저장 중...',
            percentage: 95,
            estimatedSecondsLeft: 0,
          });

          setSessions(updatedSessions);
          await persistSessions(updatedSessions);

          if (lastSession) {
            setCurrentSession(lastSession);
          }
        }

        logger.info(`✅ 폴더 불러오기 완료: ${folderData.folder.name}`);
        logger.info(`   - 하위 폴더: ${folderData.subfolders.length}개`);
        logger.info(`   - 세션: ${folderData.sessions.length}개`);

        // 완료 상태
        setImportProgress({
          stage: 'complete',
          message: '불러오기 완료!',
          percentage: 100,
          estimatedSecondsLeft: 0,
        });

        setTimeout(() => {
          setImportProgress({ stage: 'idle', message: '', percentage: 0, estimatedSecondsLeft: 0 });
          setInfoDialog({
            title: '폴더 불러오기 완료',
            message: `"${folderData.folder.name}" 폴더를 불러왔습니다.\n\n하위 폴더: ${folderData.subfolders.length}개\n세션: ${folderData.sessions.length}개`
          });
        }, 1000);
        return;
      }

      // 세션 파일인 경우 (기존 로직)
      const importedSessions = result.sessions;
      if (importedSessions.length === 0) {
        setImportProgress({ stage: 'idle', message: '', percentage: 0, estimatedSecondsLeft: 0 });
        return;
      }

      logger.info(`📂 ${importedSessions.length}개 세션 처리 시작`);

      setImportProgress({
        stage: 'translating',
        message: `${importedSessions.length}개 세션 처리 중...`,
        percentage: 10,
        estimatedSecondsLeft: 0,
      });

      let updatedSessions = [...sessions];
      let lastValidSession: Session | null = null;
      const damagedSessions: string[] = [];
      const totalSessions = importedSessions.length;

      // 각 세션 처리
      for (let i = 0; i < importedSessions.length; i++) {
        const importedSession = importedSessions[i];

        // 진행 상태 업데이트
        setImportProgress({
          stage: 'saving',
          message: `세션 복원 중... (${i + 1}/${totalSessions})`,
          percentage: 10 + Math.round((i / totalSessions) * 80),
          estimatedSecondsLeft: 0,
        });

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

        // 현재 폴더에 세션 추가
        if (currentFolderId) {
          await moveSessionToFolder(importedSession.id, currentFolderId);
        }

        // 세션 추가
        updatedSessions = addSessionToList(updatedSessions, importedSession);
        lastValidSession = importedSession;

        logger.info(
          `   ✅ 세션 "${importedSession.name}" 추가 완료 (참조 이미지: ${importedSession.imageCount}개, 유효: ${hasValidImages})`
        );
      }

      // 세션 저장
      setImportProgress({
        stage: 'saving',
        message: '데이터 저장 중...',
        percentage: 95,
        estimatedSecondsLeft: 0,
      });

      setSessions(updatedSessions);
      await persistSessions(updatedSessions);

      // 완료 상태
      setImportProgress({
        stage: 'complete',
        message: '불러오기 완료!',
        percentage: 100,
        estimatedSecondsLeft: 0,
      });

      setTimeout(() => {
        setImportProgress({ stage: 'idle', message: '', percentage: 0, estimatedSecondsLeft: 0 });
      }, 1500);

      // 손상된 세션 알림
      if (damagedSessions.length > 0) {
        setErrorDialog({
          title: '세션 손상 경고',
          message: `${damagedSessions.length}개 세션의 참조 이미지가 손상되었습니다:\n\n` +
            damagedSessions.map(name => `• ${name}`).join('\n') +
            `\n\n원인: 이전 버전으로 export한 파일이거나, 이미지 데이터가 누락되었습니다.\n\n` +
            `해결 방법:\n` +
            `1. 원본 PC에서 최신 버전으로 세션을 다시 export하세요\n` +
            `2. 참조 이미지를 다시 업로드하고 분석하세요`
        });
      }

      // 마지막 세션 선택 (강제)
      if (lastValidSession) {
        setCurrentSession(lastValidSession);
        logger.info(`✅ 총 ${importedSessions.length}개 세션 불러오기 완료, 마지막 세션 선택: "${lastValidSession.name}"`);
      }
    } catch (error) {
      logger.error('❌ 불러오기 오류:', error);
      setImportProgress({ stage: 'idle', message: '', percentage: 0, estimatedSecondsLeft: 0 });
      setErrorDialog({
        title: '불러오기 오류',
        message: '파일을 불러오는 중 오류가 발생했습니다.'
      });
    }
  }, [currentFolderId, sessions, importFolderData, moveSessionToFolder, setSessions, setCurrentSession]);

  const handleSaveSessionClick = useCallback(() => {
    if (!analysisResult || uploadedImages.length === 0) {
      setInfoDialog({
        title: '분석 결과 없음',
        message: '분석 결과가 없습니다'
      });
      return;
    }
    setShowSaveSession(true);
  }, [analysisResult, uploadedImages]);

  const handleReset = useCallback(() => {
    // 신규 세션 모달 표시
    setShowNewSession(true);
  }, []);

  const handleNewSession = useCallback(async (name: string, type: SessionType) => {
    // 빈 분석 결과 생성 (임시 세션용)
    const emptyAnalysis: ImageAnalysisResult = {
      style: {
        art_style: '',
        technique: '',
        color_palette: '',
        lighting: '',
        mood: '',
      },
      character: {
        gender: '',
        age_group: '',
        hair: '',
        eyes: '',
        face: '',
        outfit: '',
        accessories: '',
        body_proportions: '',
        limb_proportions: '',
        torso_shape: '',
        hand_style: '',
        feet_style: '',
      },
      composition: {
        pose: '',
        angle: '',
        background: '',
        depth_of_field: '',
      },
      negative_prompt: '',
    };

    // 빈 세션 생성
    const newSession = createNewSession(emptyAnalysis, [], type);
    // 세션 이름 설정
    newSession.name = name;
    // 현재 폴더 ID 설정
    newSession.folderId = getCurrentFolderIdForNewSession();

    // ILLUSTRATION 세션인 경우 초기 데이터 설정
    if (type === 'ILLUSTRATION') {
      newSession.illustrationData = {
        characters: [],
        backgroundImages: [],
      };
    }

    // BASIC 세션인 경우 초기 데이터 설정
    if (type === 'BASIC') {
      newSession.chatData = {
        messages: [],
        totalTokenCount: 0,
        settings: {
          aspectRatio: '1:1',
          imageModel: 'gemini-3-pro-image-preview',
        },
      };
    }

    // CONCEPT 세션인 경우 초기 데이터 설정
    if (type === 'CONCEPT') {
      newSession.conceptData = {
        gameGenres: [],
        artStyles: [],
        generationSettings: {
          model: 'nanobanana-pro',
          ratio: '9:16',
          size: '1k',
          grid: '1x1',
        },
        history: [],
      };
    }

    const updatedSessions = addSessionToList(sessions, newSession);
    setSessions(updatedSessions);
    setCurrentSession(newSession);
    persistSessions(updatedSessions);

    // 세션-폴더 매핑 저장
    if (newSession.folderId !== null) {
      await moveSessionToFolder(newSession.id, newSession.folderId);
    }

    // 상태 초기화
    setUploadedImages([]);
    setAnalysisResult(null);
    setCurrentView('analysis');
  }, [sessions, setSessions, setCurrentSession, setUploadedImages, getCurrentFolderIdForNewSession, moveSessionToFolder]);

  // ILLUSTRATION 세션의 illustrationData 업데이트 핸들러
  const handleIllustrationDataChange = useCallback(async (illustrationData: IllustrationSessionData) => {
    if (!currentSession || currentSession.type !== 'ILLUSTRATION') return;

    const updatedSession = updateSession(currentSession, { illustrationData });
    const updatedSessions = updateSessionInList(sessions, currentSession.id, updatedSession);
    setSessions(updatedSessions);
    setCurrentSession(updatedSession);
    await persistSessions(updatedSessions);
  }, [currentSession, sessions, setSessions, setCurrentSession]);

  // ILLUSTRATION 세션에서 이미지 생성 화면으로 이동
  const handleIllustrationGenerate = useCallback(() => {
    if (!currentSession || currentSession.type !== 'ILLUSTRATION') return;

    // 최소 1개 이상의 캐릭터가 있고, 해당 캐릭터에 이미지가 있어야 함
    const charactersWithImages = currentSession.illustrationData?.characters.filter(c => c.images.length > 0) || [];
    if (charactersWithImages.length === 0) {
      setInfoDialog({
        title: '캐릭터 필요',
        message: '최소 1개 이상의 캐릭터와 참조 이미지가 필요합니다.\n\n캐릭터를 추가하고 이미지를 등록해주세요.'
      });
      return;
    }

    // ILLUSTRATION 세션용 더미 분석 결과 생성 (기존 흐름 유지를 위해)
    const dummyAnalysis: ImageAnalysisResult = {
      style: {
        art_style: 'illustration',
        technique: 'multi-character composition',
        color_palette: 'varies per character',
        lighting: currentSession.illustrationData?.backgroundAnalysis?.lighting || 'natural',
        mood: currentSession.illustrationData?.backgroundAnalysis?.atmosphere || 'dynamic',
      },
      character: {
        gender: 'mixed (multiple characters)',
        age_group: 'varies',
        hair: charactersWithImages.map(c => c.name).join(', '),
        eyes: 'varies per character',
        face: 'varies per character',
        outfit: 'varies per character',
        accessories: 'varies per character',
        body_proportions: 'varies',
        limb_proportions: 'varies per character',
        torso_shape: 'varies per character',
        hand_style: 'varies',
        feet_style: 'varies',
      },
      composition: {
        pose: 'scene-dependent',
        angle: 'varies',
        background: currentSession.illustrationData?.backgroundAnalysis?.environment_type || 'custom scene',
        depth_of_field: currentSession.illustrationData?.backgroundAnalysis?.depth_layers || 'standard',
      },
      negative_prompt: currentSession.illustrationData?.backgroundNegativePrompt || '',
    };

    setAnalysisResult(dummyAnalysis);
    setCurrentView('generator');
  }, [currentSession, setInfoDialog]);

  const handleGenerateImage = async () => {
    if (!analysisResult) {
      setInfoDialog({
        title: '분석 결과 없음',
        message: '분석 결과가 없습니다'
      });
      return;
    }

    // 세션 저장 (비동기, 화면 전환 차단하지 않음)
    if (!currentSession) {
      const newSession = createNewSession(analysisResult, uploadedImages);
      const updatedSessions = addSessionToList(sessions, newSession);
      setSessions(updatedSessions);
      setCurrentSession(newSession);
      persistSessions(updatedSessions).catch(err => logger.error('❌ 세션 저장 오류:', err));
    } else {
      const updatedSession = updateSession(currentSession, {
        analysis: analysisResult,
      });
      const updatedSessions = updateSessionInList(sessions, currentSession.id, updatedSession);
      setSessions(updatedSessions);
      setCurrentSession(updatedSession);
      persistSessions(updatedSessions).catch(err => logger.error('❌ 세션 저장 오류:', err));
    }

    // 즉시 화면 전환
    setCurrentView('generator');
  };

  const handleBackToAnalysis = () => {
    setCurrentView('analysis');
  };

  return (
    <ErrorBoundary>
      <div className="h-screen flex bg-gray-100 overflow-hidden relative">
      {/* 사이드바 - 이미지 생성 화면에서는 왼쪽으로 슬라이드 아웃 */}
      <div
        className={`absolute top-0 left-0 h-full z-10 transition-transform duration-500 ease-in-out ${
          currentView === 'generator' ? '-translate-x-full' : 'translate-x-0'
        }`}
      >
        <Sidebar
          sessions={sessions}
          currentSessionId={currentSession?.id}
          onSelectSession={handleSelectSessionWithFolderDeselect}
          onDeleteSession={handleDeleteSession}
          onExportSession={handleExportSession}
          onRenameSession={handleRenameSession}
          onNewImage={handleReset}
          onImportSession={handleImport}
          onSettingsClick={handleSettingsClick}
          onReorderSessions={handleReorderSessions}
          disabled={currentView === 'generator'}
          // 폴더 관련 props
          folders={folders}
          currentFolderId={currentFolderId}
          folderPath={folderPath}
          currentFolderSessions={currentFolderSessions}
          currentFolderSubfolders={currentFolderSubfolders}
          selectedFolderId={selectedFolderId}
          onSelectFolder={handleSelectFolder}
          onNavigateToFolder={handleNavigateToFolder}
          onNavigateBack={handleNavigateBack}
          onCreateFolder={async (name) => { await createFolder(name); }}
          onRenameFolder={renameFolder}
          onDeleteFolder={async (folderId, deleteContents) => {
            // 삭제 전 백업 저장 (Undo용)
            const folderToDelete = folders.find(f => f.id === folderId);
            if (folderToDelete) {
              setDeletedFolderBackup({
                folders: [...folders],
                sessions: [...sessions],
                sessionFolderMap: { ...sessionFolderMap },
                deletedFolderName: folderToDelete.name,
              });
            }

            await deleteFolder(folderId, deleteContents, sessions, handleDeleteSession);

            // Undo 토스트 표시
            if (folderToDelete) {
              setUndoToast(`"${folderToDelete.name}" 폴더가 삭제되었습니다`);
              // 10초 후 자동으로 토스트 닫기 및 백업 삭제
              setTimeout(() => {
                setUndoToast(null);
                setDeletedFolderBackup(null);
              }, 10000);
            }
          }}
          onMoveSessionToFolder={moveSessionToFolder}
          onMoveFolderToFolder={moveFolderToFolder}
          onReorderFolders={reorderFolders}
          onExportFolder={handleExportFolder}
        />
      </div>

      <main className={`flex flex-col overflow-hidden transition-all duration-500 ease-in-out ${
        currentView === 'generator' ? 'ml-0 w-full' : 'ml-72 flex-1'
      }`}>
        {selectedFolderId ? (
          // 폴더 선택 시 도움말 표시
          <div className="flex-1 flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100">
            <div className="max-w-md p-8 bg-white rounded-2xl shadow-lg border border-gray-200">
              <div className="text-center mb-6">
                <div className="w-16 h-16 mx-auto mb-4 bg-yellow-100 rounded-full flex items-center justify-center">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-yellow-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                  </svg>
                </div>
                <h2 className="text-xl font-bold text-gray-800 mb-2">📁 폴더 기능</h2>
                <p className="text-gray-600 text-sm">폴더를 사용하여 세션을 체계적으로 관리하세요</p>
              </div>
              <div className="space-y-4 text-sm">
                <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                  <span className="text-lg">⌨️</span>
                  <div>
                    <p className="font-semibold text-gray-800">Enter 키</p>
                    <p className="text-gray-600">선택한 폴더 이름 편집</p>
                  </div>
                </div>
                <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                  <span className="text-lg">🖱️</span>
                  <div>
                    <p className="font-semibold text-gray-800">더블 클릭</p>
                    <p className="text-gray-600">폴더 안으로 이동</p>
                  </div>
                </div>
                <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                  <span className="text-lg">📁</span>
                  <div>
                    <p className="font-semibold text-gray-800">폴더 중첩</p>
                    <p className="text-gray-600">폴더 안에 하위 폴더 생성 가능</p>
                  </div>
                </div>
                <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                  <span className="text-lg">✋</span>
                  <div>
                    <p className="font-semibold text-gray-800">드래그 & 드롭</p>
                    <p className="text-gray-600">세션을 폴더로 드래그하여 이동</p>
                  </div>
                </div>
              </div>
              <div className="mt-6 pt-4 border-t border-gray-200">
                <p className="text-xs text-gray-500 text-center">
                  💡 세션을 선택하면 이미지 분석 화면으로 돌아갑니다
                </p>
              </div>
            </div>
          </div>
        ) : currentSession?.type === 'BASIC' ? (
          <ChatPanel
            key={currentSession.id}
            session={currentSession}
            apiKey={apiKey}
            onSessionUpdate={handleSessionUpdate}
          />
        ) : currentSession?.type === 'CONCEPT' ? (
          <ConceptPanel
            key={currentSession.id}
            session={currentSession}
            apiKey={apiKey}
            onSessionUpdate={handleSessionUpdate}
            onSessionSaveOnly={handleSessionSaveOnly}
          />
        ) : currentSession?.type === 'ILLUSTRATION' ? (
          // ILLUSTRATION 세션 전용 UI
          currentView === 'analysis' ? (
            <div className="flex-1 overflow-auto bg-gradient-to-br from-gray-50 to-gray-100 p-6">
              <div className="max-w-2xl mx-auto">
                <div className="bg-white rounded-2xl shadow-lg border border-gray-200 overflow-hidden">
                  <div className="p-6 border-b border-gray-200 bg-gradient-to-r from-violet-500 to-purple-600">
                    <h2 className="text-xl font-bold text-white flex items-center gap-2">
                      🎨 일러스트 세션 설정
                    </h2>
                    <p className="text-sm text-white/80 mt-1">
                      캐릭터와 배경 참조 이미지를 등록하세요
                    </p>
                  </div>
                  <div className="p-6">
                    <IllustrationSetupPanel
                      data={currentSession.illustrationData || { characters: [], backgroundImages: [] }}
                      onDataChange={handleIllustrationDataChange}
                      disabled={false}
                    />
                  </div>
                  {/* 이미지 생성으로 이동 버튼 */}
                  <div className="p-6 border-t border-gray-200 bg-gray-50">
                    <button
                      onClick={handleIllustrationGenerate}
                      disabled={!(currentSession.illustrationData?.characters.some(c => c.images.length > 0))}
                      className={`w-full py-3 font-semibold rounded-lg transition-all ${
                        currentSession.illustrationData?.characters.some(c => c.images.length > 0)
                          ? 'bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 text-white shadow-lg'
                          : 'bg-gray-200 text-gray-500 cursor-not-allowed'
                      }`}
                    >
                      이미지 생성하기
                    </button>
                    {!(currentSession.illustrationData?.characters.some(c => c.images.length > 0)) && (
                      <p className="text-xs text-gray-500 text-center mt-2">
                        최소 1개 이상의 캐릭터에 이미지를 등록해야 합니다
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            analysisResult && (
              <ImageGeneratorPanel
                apiKey={apiKey}
                analysis={analysisResult}
                referenceImages={currentSession.illustrationData?.characters.flatMap(c => c.images) || []}
                sessionType="ILLUSTRATION"
                                generationHistory={currentSession?.generationHistory}
                onHistoryAdd={handleHistoryAdd}
                onHistoryUpdate={handleHistoryUpdate}
                onHistoryDelete={handleHistoryDelete}
                onBack={handleBackToAnalysis}
                autoSavePath={currentSession?.autoSavePath}
                onAutoSavePathChange={handleAutoSavePathChange}
                illustrationData={currentSession.illustrationData}
              />
            )
          )
        ) : uploadedImages.length > 0 ? (
          currentView === 'analysis' ? (
            <AnalysisPanel
              images={uploadedImages}
              isAnalyzing={isAnalyzing}
              analysisResult={analysisResult}
                            onAnalyze={handleAnalyze}
              onSaveSession={handleSaveSessionClick}
              onAddImage={handleImageSelect}
              onRemoveImage={handleRemoveImage}
              onGenerateImage={analysisResult ? handleGenerateImage : undefined}
              currentSession={currentSession}
              onStyleUpdate={(style) => {
                if (analysisResult) {
                  const updated = { ...analysisResult, style };
                  setAnalysisResult(updated);
                  saveSessionWithoutTranslation(updated);
                }
              }}
              onCharacterUpdate={(character) => {
                if (analysisResult) {
                  const updated = { ...analysisResult, character };
                  setAnalysisResult(updated);
                  saveSessionWithoutTranslation(updated);
                }
              }}
              onCompositionUpdate={(composition) => {
                if (analysisResult) {
                  const updated = { ...analysisResult, composition };
                  setAnalysisResult(updated);
                  saveSessionWithoutTranslation(updated);
                }
              }}
              onNegativePromptUpdate={(negativePrompt) => {
                if (analysisResult) {
                  const updated = { ...analysisResult, negative_prompt: negativePrompt };
                  setAnalysisResult(updated);
                  saveSessionWithoutTranslation(updated);
                }
              }}
              onUIAnalysisUpdate={(uiAnalysis) => {
                if (analysisResult) {
                  const updated = { ...analysisResult, ui_specific: uiAnalysis };
                  setAnalysisResult(updated);
                  saveSessionWithoutTranslation(updated);
                }
              }}
              onLogoAnalysisUpdate={(logoAnalysis) => {
                if (analysisResult) {
                  const updated = { ...analysisResult, logo_specific: logoAnalysis };
                  setAnalysisResult(updated);
                  saveSessionWithoutTranslation(updated);
                }
              }}
            />
          ) : (
            analysisResult && (
              <ImageGeneratorPanel
                apiKey={apiKey}
                analysis={analysisResult}
                referenceImages={uploadedImages}
                sessionType={currentSession?.type || 'STYLE'}
                                generationHistory={currentSession?.generationHistory}
                onHistoryAdd={handleHistoryAdd}
                onHistoryUpdate={handleHistoryUpdate}
                onHistoryDelete={handleHistoryDelete}
                onBack={handleBackToAnalysis}
                autoSavePath={currentSession?.autoSavePath}
                referenceDocuments={currentSession?.referenceDocuments}
                onDocumentAdd={handleDocumentAdd}
                onDocumentDelete={handleDocumentDelete}
                onAutoSavePathChange={handleAutoSavePathChange}
              />
            )
          )
        ) : !currentSession ? (
          <EmptyState onNewSession={handleReset} />
        ) : (
          <ImageUpload onImageSelect={handleImageSelect} />
        )}
      </main>

      <SettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        currentApiKey={apiKey}
        onSave={handleSaveApiKey}
      />

      <SaveSessionModal
        isOpen={showSaveSession}
        onClose={() => setShowSaveSession(false)}
        onSave={saveSession}
        currentSession={currentSession}
      />

      <NewSessionModal
        isOpen={showNewSession}
        onClose={() => setShowNewSession(false)}
        onCreate={handleNewSession}
      />

      <ProgressIndicator {...progress} />
      {saveProgress.stage !== 'idle' && <ProgressIndicator {...saveProgress} />}
      {importProgress.stage !== 'idle' && <ProgressIndicator {...importProgress} />}

      {/* 분석 강화 확인 다이얼로그 */}
      {refineConfirm && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              cancelRefine();
            }
          }}
        >
          <div
            className="bg-white border border-gray-200 rounded-lg shadow-xl max-w-sm w-full p-6 mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold mb-2 text-gray-800">분석 강화 확인</h3>
            <p className="text-gray-600 mb-6">
              기존 분석 내용이 변경될 수 있습니다.
              <br />
              그래도 진행하시겠습니까?
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={cancelRefine}
                className="px-4 py-2 rounded-lg bg-gray-200 hover:bg-gray-300 transition-colors font-medium text-gray-700"
              >
                취소
              </button>
              <button
                onClick={confirmRefine}
                className="px-4 py-2 rounded-lg bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 transition-colors font-medium text-white"
              >
                분석하기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 이미지 개수 제한 경고 다이얼로그 */}
      {showLimitWarning && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowLimitWarning(false);
            }
          }}
        >
          <div
            className="bg-white border border-gray-200 rounded-lg shadow-xl max-w-md w-full p-6 mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold mb-2 text-red-600">이미지 개수 제한</h3>
            <p className="text-gray-600 mb-4">
              참조 이미지는 최대 14개까지 등록할 수 있습니다.
            </p>
            <p className="text-gray-600 mb-6">
              기존 이미지를 제거한 후 새로운 이미지를 등록해 주세요.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowLimitWarning(false)}
                className="px-4 py-2 rounded-lg bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 transition-colors font-medium text-white"
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 손상된 세션 경고 다이얼로그 */}
      {damagedSessionsWarning && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setDamagedSessionsWarning(null);
            }
          }}
        >
          <div
            className="bg-white border border-gray-200 rounded-lg shadow-xl max-w-lg w-full p-6 mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold mb-4 text-yellow-600">⚠️ 세션 손상 경고</h3>
            <pre className="text-gray-700 mb-6 whitespace-pre-wrap text-sm">{damagedSessionsWarning}</pre>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setDamagedSessionsWarning(null)}
                className="px-4 py-2 rounded-lg bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 transition-colors font-medium text-white"
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 에러 다이얼로그 */}
      {errorDialog && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setErrorDialog(null);
            }
          }}
        >
          <div
            className="bg-white border border-gray-200 rounded-lg shadow-xl max-w-md w-full p-6 mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold mb-4 text-red-600">❌ {errorDialog.title}</h3>
            <p className="text-gray-700 mb-6 whitespace-pre-wrap">{errorDialog.message}</p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setErrorDialog(null)}
                className="px-4 py-2 rounded-lg bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 transition-colors font-medium text-white"
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 정보 다이얼로그 */}
      {infoDialog && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setInfoDialog(null);
            }
          }}
        >
          <div
            className="bg-white border border-gray-200 rounded-lg shadow-xl max-w-md w-full p-6 mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold mb-4 text-blue-600">ℹ️ {infoDialog.title}</h3>
            <p className="text-gray-700 mb-6 whitespace-pre-wrap">{infoDialog.message}</p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setInfoDialog(null)}
                className="px-4 py-2 rounded-lg bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 transition-colors font-medium text-white"
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 자동 업데이트 모달 */}
      <UpdateModal
        status={updateStatus}
        update={update}
        progress={updateProgress}
        error={updateError}
        onDownload={downloadAndInstall}
        onDismiss={dismissUpdate}
      />

      {/* 폴더 삭제 Undo 토스트 */}
      {undoToast && (
        <div className="fixed bottom-4 left-4 bg-gray-900 text-white rounded-xl shadow-2xl p-4 border border-gray-700 min-w-[320px] animate-slide-up z-50">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex-shrink-0 w-8 h-8 bg-yellow-500/20 rounded-full flex items-center justify-center">
                <svg className="w-4 h-4 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </div>
              <div>
                <p className="font-medium text-sm">{undoToast}</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  <kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-xs">Ctrl</kbd> + <kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-xs">Z</kbd> 로 되돌리기
                </p>
              </div>
            </div>
            <button
              onClick={() => {
                setUndoToast(null);
                setDeletedFolderBackup(null);
              }}
              className="p-1 hover:bg-gray-700 rounded transition-colors"
            >
              <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}
      </div>
    </ErrorBoundary>
  );
}

export default App;
