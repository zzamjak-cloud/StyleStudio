import { useState, useCallback, useEffect, useRef, memo } from 'react';
import { Session } from '../../types/session';
import { ConceptSessionData, ConceptGenerationEntry } from '../../types/concept';
import { ConceptLeftPanel } from './ConceptLeftPanel';
import { ConceptRightPanel } from './ConceptRightPanel';
import { ConceptHistory } from './ConceptHistory';
import { useConceptGeneration } from '../../hooks/useConceptGeneration';
import { exists, mkdir, writeFile } from '@tauri-apps/plugin-fs';
import { downloadDir, join } from '@tauri-apps/api/path';
import { logger } from '../../lib/logger';

interface ConceptPanelProps {
  session: Session;
  apiKey: string;
  onSessionUpdate: (session: Session) => void;
  onSessionSaveOnly?: (session: Session) => void;
}

/** 컨셉 세션 메인 패널 */
export const ConceptPanel = memo(({ session, apiKey, onSessionUpdate, onSessionSaveOnly }: ConceptPanelProps) => {
  // 컨셉 데이터 초기화
  const [conceptData, setConceptData] = useState<ConceptSessionData>(() => {
    return session.conceptData || {
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
  });

  // 히스토리 패널 높이 상태
  const [historyHeight, setHistoryHeight] = useState(200);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [restoredPrompt, setRestoredPrompt] = useState('');
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
  const [selectedGeneratedImage, setSelectedGeneratedImage] = useState<string | null>(null);
  const [isRestoringHistory, setIsRestoringHistory] = useState(false);
  const gamePlayStyleDraftRef = useRef(conceptData.gamePlayStyle || '');

  // 생성 훅
  const { isGenerating, generateConcept } = useConceptGeneration(apiKey);

  const autoSaveConceptImage = useCallback(async (imageDataUrl: string) => {
    const downloadPath = await downloadDir();
    const savePath = await join(downloadPath, 'AI_Gen');

    try {
      const folderExists = await exists(savePath);
      if (!folderExists) {
        await mkdir(savePath, { recursive: true });
      }
    } catch {
      await mkdir(savePath, { recursive: true });
    }

    const timestamp = Date.now();
    const fullPath = await join(savePath, `concept-${timestamp}.jpg`);

    const base64Data = imageDataUrl.includes(',') ? imageDataUrl.split(',')[1] : imageDataUrl;
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    await writeFile(fullPath, bytes);
    return fullPath;
  }, []);

  // 세션 저장용 ref (이미지 생성, 히스토리 삭제, 언마운트 시에만 저장)
  const sessionRef = useRef(session);
  const onSessionUpdateRef = useRef(onSessionUpdate);
  const onSessionSaveOnlyRef = useRef(onSessionSaveOnly);
  const conceptDataRef = useRef(conceptData);
  useEffect(() => { sessionRef.current = session; }, [session]);
  useEffect(() => { onSessionUpdateRef.current = onSessionUpdate; }, [onSessionUpdate]);
  useEffect(() => { onSessionSaveOnlyRef.current = onSessionSaveOnly; }, [onSessionSaveOnly]);
  useEffect(() => { conceptDataRef.current = conceptData; }, [conceptData]);

  // 명시적 세션 저장 함수 (ref 기반으로 안정적인 참조)
  const saveToSession = useCallback((dataToSave: ConceptSessionData) => {
    onSessionUpdateRef.current({
      ...sessionRef.current,
      conceptData: dataToSave,
      updatedAt: new Date().toISOString(),
    });
  }, []);

  // 언마운트 시 경량 저장 (startTransition/setCurrentSession을 거치지 않아 딜레이 없음)
  useEffect(() => {
    return () => {
      const saveFn = onSessionSaveOnlyRef.current || onSessionUpdateRef.current;
      saveFn({
        ...sessionRef.current,
        conceptData: conceptDataRef.current,
        updatedAt: new Date().toISOString(),
      });
    };
  }, []);

  useEffect(() => {
    gamePlayStyleDraftRef.current = conceptData.gamePlayStyle || '';
  }, [conceptData.gamePlayStyle]);

  // 참조 이미지 변경
  const handleReferenceImageChange = useCallback((imageBase64: string | undefined) => {
    setConceptData(prev => ({
      ...prev,
      referenceImage: imageBase64,
    }));
  }, []);

  // 게임 정보 변경
  const handleGameInfoChange = useCallback((gameInfo: {
    gameGenres: string[];
    gamePlayStyle?: string;
    referenceGames?: string[];
    artStyles: string[];
  }) => {
    gamePlayStyleDraftRef.current = gameInfo.gamePlayStyle || '';
    setConceptData(prev => ({
      ...prev,
      ...gameInfo,
    }));
  }, []);

  const handleGamePlayStyleDraftChange = useCallback((value: string) => {
    gamePlayStyleDraftRef.current = value;
  }, []);

  // 생성 설정 변경
  const handleSettingsChange = useCallback((settings: ConceptSessionData['generationSettings']) => {
    setConceptData(prev => ({
      ...prev,
      generationSettings: settings,
    }));
  }, []);

  // 이미지 생성
  const handleGenerate = useCallback(async (prompt: string) => {
    if (isGenerating || !apiKey) return;

    try {
      setGenerationError(null);
      const gamePlayStyle = gamePlayStyleDraftRef.current;
      const result = await generateConcept({
        prompt,
        referenceImage: conceptData.referenceImage,
        gameGenres: conceptData.gameGenres,
        gamePlayStyle,
        referenceGames: conceptData.referenceGames,
        artStyles: conceptData.artStyles,
        settings: conceptData.generationSettings,
      });

      // 히스토리에 추가 및 세션 저장
      const newEntry = {
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        prompt: result.prompt,
        imageBase64: result.imageBase64,
        settings: conceptData.generationSettings,
        gameInfo: {
          genres: conceptData.gameGenres,
          playStyle: gamePlayStyle,
          referenceGames: conceptData.referenceGames,
          artStyles: conceptData.artStyles,
        },
      };

      const updatedData: ConceptSessionData = {
        ...conceptData,
        gamePlayStyle,
        history: [...conceptData.history, newEntry],
      };
      setConceptData(updatedData);
      saveToSession(updatedData);

      setSelectedHistoryId(newEntry.id);
      setSelectedGeneratedImage(newEntry.imageBase64);
      setRestoredPrompt(newEntry.prompt || '');

      // 생성 완료 시 AI_Gen 폴더에 자동 저장
      try {
        const savedPath = await autoSaveConceptImage(result.imageBase64);
        logger.debug('✅ 컨셉 이미지 자동 저장 완료:', savedPath);
      } catch (saveError) {
        logger.error('❌ 컨셉 이미지 자동 저장 실패:', saveError);
      }
    } catch (error) {
      console.error('컨셉 이미지 생성 실패:', error);
      const message = error instanceof Error ? error.message : '컨셉 이미지 생성 중 알 수 없는 오류가 발생했습니다.';
      setGenerationError(message);
    }
  }, [isGenerating, apiKey, conceptData, generateConcept, autoSaveConceptImage]);

  // 히스토리 아이템 삭제 및 세션 저장
  const handleHistoryDelete = useCallback((id: string) => {
    const updatedData: ConceptSessionData = {
      ...conceptDataRef.current,
      history: conceptDataRef.current.history.filter(item => item.id !== id),
    };
    setConceptData(updatedData);
    saveToSession(updatedData);
    if (selectedHistoryId === id) {
      setSelectedHistoryId(null);
      setSelectedGeneratedImage(null);
    }
  }, [selectedHistoryId, saveToSession]);

  // 히스토리 선택 시 설정/정보 복원
  const handleHistorySelect = useCallback((entry: ConceptGenerationEntry) => {
    setIsRestoringHistory(true);

    // 먼저 로딩 상태를 화면에 반영한 뒤 복원 로직 실행
    requestAnimationFrame(() => {
      const model = entry.settings.model === 'nanobanana-2' ? 'nanobanana-2' : 'nanobanana-pro';
      const ratio = ['1:1', '16:9', '9:16', '4:3', '3:4'].includes(entry.settings.ratio)
        ? (entry.settings.ratio as ConceptSessionData['generationSettings']['ratio'])
        : '1:1';
      const size = ['1k', '2k', '3k'].includes(entry.settings.size)
        ? (entry.settings.size as ConceptSessionData['generationSettings']['size'])
        : '1k';
      const grid = ['1x1', '2x2', '3x3', '4x4'].includes(entry.settings.grid)
        ? (entry.settings.grid as ConceptSessionData['generationSettings']['grid'])
        : '1x1';

      const restoredPlayStyle = entry.gameInfo?.playStyle || '';
      gamePlayStyleDraftRef.current = restoredPlayStyle;

      setConceptData(prev => ({
        ...prev,
        gameGenres: entry.gameInfo?.genres || prev.gameGenres,
        gamePlayStyle: restoredPlayStyle,
        referenceGames: entry.gameInfo?.referenceGames || prev.referenceGames,
        artStyles: entry.gameInfo?.artStyles || prev.artStyles,
        generationSettings: {
          model,
          ratio,
          size,
          grid,
        },
      }));

      setRestoredPrompt(entry.prompt || '');
      setSelectedHistoryId(entry.id);
      setSelectedGeneratedImage(entry.imageBase64);

      // 상태 반영 직후 로딩 UI 해제
      setTimeout(() => setIsRestoringHistory(false), 120);
    });
  }, []);

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* 상단 영역 - 좌우 분할 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 좌측 패널 - 입력 */}
        <ConceptLeftPanel
          referenceImage={conceptData.referenceImage}
          generatedImage={selectedGeneratedImage || conceptData.history[conceptData.history.length - 1]?.imageBase64}
          gameGenres={conceptData.gameGenres}
          gamePlayStyle={conceptData.gamePlayStyle}
          referenceGames={conceptData.referenceGames}
          artStyles={conceptData.artStyles}
          onReferenceImageChange={handleReferenceImageChange}
          onGamePlayStyleDraftChange={handleGamePlayStyleDraftChange}
          onGameInfoChange={handleGameInfoChange}
        />

        {/* 우측 패널 - 생성 */}
        <ConceptRightPanel
          settings={conceptData.generationSettings}
          onSettingsChange={handleSettingsChange}
          onGenerate={handleGenerate}
          isGenerating={isGenerating}
          disabled={!apiKey}
          errorMessage={generationError}
          promptValue={restoredPrompt}
        />
      </div>

      {/* 하단 히스토리 */}
      <ConceptHistory
        history={conceptData.history}
        height={historyHeight}
        onHeightChange={setHistoryHeight}
        onDelete={handleHistoryDelete}
        onSelect={handleHistorySelect}
        selectedEntryId={selectedHistoryId}
        isLoading={isRestoringHistory}
      />
    </div>
  );
});

ConceptPanel.displayName = 'ConceptPanel';