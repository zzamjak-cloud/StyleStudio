import { useState, useCallback } from 'react';
import { Folder, FolderPath } from '../types/folder';
import { Session } from '../types/session';
import { loadFolderData, saveFolderData } from '../lib/storage';
import { logger } from '../lib/logger';

// 슬라이드 방향 타입 (하위 호환성 유지)
export type SlideDirection = 'left' | 'right' | null;

interface UseFolderManagementReturn {
  // 폴더 상태
  folders: Folder[];
  currentFolderId: string | null;
  folderPath: FolderPath[];
  sessionFolderMap: Record<string, string | null>;

  // 애니메이션 상태
  slideDirection: SlideDirection;
  isAnimating: boolean;

  // 초기화
  initializeFolders: () => Promise<void>;

  // 폴더 조회
  getCurrentFolderSessions: (sessions: Session[]) => Session[];
  getCurrentFolderSubfolders: () => Folder[];
  getSessionsInFolder: (folderId: string | null, sessions: Session[]) => Session[];

  // 폴더 CRUD
  createFolder: (name: string, parentId?: string | null) => Promise<Folder>;
  renameFolder: (folderId: string, newName: string) => Promise<void>;
  deleteFolder: (folderId: string, deleteContents: boolean, sessions: Session[], onDeleteSession: (sessionId: string) => Promise<void>) => Promise<void>;

  // 폴더 네비게이션
  navigateToFolder: (folderId: string | null) => void;
  navigateBack: () => void;

  // 세션/폴더 이동
  moveSessionToFolder: (sessionId: string, folderId: string | null) => Promise<void>;
  moveFolderToFolder: (movingFolderId: string, targetFolderId: string | null) => Promise<void>;

  // 폴더 순서 변경
  reorderFolders: (reorderedFolders: Folder[]) => Promise<void>;

  // 새 세션 생성 시 현재 폴더 ID 반환
  getCurrentFolderIdForNewSession: () => string | null;

  // 폴더 import (외부에서 불러온 폴더 데이터 추가)
  importFolderData: (
    importedFolder: Folder,
    importedSubfolders: Folder[],
    importedSessionFolderMap: Record<string, string | null>,
    targetFolderId: string | null
  ) => Promise<{ newFolderIdMap: Record<string, string> }>;

  // 폴더 데이터 복원 (Undo용)
  restoreFolderData: (
    backupFolders: Folder[],
    backupSessionFolderMap: Record<string, string | null>
  ) => Promise<void>;
}

/**
 * 폴더 관리 Hook
 */
export function useFolderManagement(): UseFolderManagementReturn {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [sessionFolderMap, setSessionFolderMap] = useState<Record<string, string | null>>({});

  // 하위 호환성을 위해 유지 (항상 비활성화 상태)
  const slideDirection: SlideDirection = null;
  const isAnimating = false;

  // 폴더 데이터 초기화
  const initializeFolders = async () => {
    try {
      const data = await loadFolderData();
      setFolders(data.folders);
      setSessionFolderMap(data.sessionFolderMap);
      logger.debug('✅ 폴더 데이터 초기화 완료:', data.folders.length, '개 폴더');
    } catch (error) {
      logger.error('❌ 폴더 데이터 초기화 오류:', error);
    }
  };

  // 현재 폴더까지의 경로 계산
  const folderPath: FolderPath[] = (() => {
    const path: FolderPath[] = [];
    let fId = currentFolderId;

    while (fId) {
      const folder = folders.find(f => f.id === fId);
      if (folder) {
        path.unshift({ id: folder.id, name: folder.name });
        fId = folder.parentId;
      } else {
        break;
      }
    }

    return path;
  })();

  // 현재 폴더의 하위 폴더 가져오기
  const getCurrentFolderSubfolders = useCallback((): Folder[] => {
    return folders
      .filter(f => f.parentId === currentFolderId)
      .sort((a, b) => a.order - b.order);
  }, [folders, currentFolderId]);

  // 특정 폴더의 세션 가져오기
  const getSessionsInFolder = useCallback((folderId: string | null, sessions: Session[]): Session[] => {
    return sessions.filter(session => {
      const mappedFolderId = sessionFolderMap[session.id];
      // 매핑이 없거나 null이면 루트
      if (mappedFolderId === undefined || mappedFolderId === null) {
        return folderId === null;
      }
      return mappedFolderId === folderId;
    });
  }, [sessionFolderMap]);

  // 현재 폴더의 세션 가져오기
  const getCurrentFolderSessions = useCallback((sessions: Session[]): Session[] => {
    return getSessionsInFolder(currentFolderId, sessions);
  }, [currentFolderId, getSessionsInFolder]);

  // 폴더 생성
  const createFolder = async (name: string, parentId: string | null = currentFolderId): Promise<Folder> => {
    const newFolder: Folder = {
      id: Date.now().toString() + Math.random().toString(36).substring(2, 9),
      name,
      parentId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      order: folders.filter(f => f.parentId === parentId).length,
    };

    const updatedFolders = [...folders, newFolder];
    setFolders(updatedFolders);

    try {
      await saveFolderData({ folders: updatedFolders, sessionFolderMap });
      logger.info('✅ 폴더 생성 완료:', name);
    } catch (error) {
      logger.error('❌ 폴더 생성 오류:', error);
      throw error;
    }

    return newFolder;
  };

  // 폴더 이름 변경
  const renameFolder = async (folderId: string, newName: string): Promise<void> => {
    const updatedFolders = folders.map(f =>
      f.id === folderId
        ? { ...f, name: newName, updatedAt: new Date().toISOString() }
        : f
    );
    setFolders(updatedFolders);

    try {
      await saveFolderData({ folders: updatedFolders, sessionFolderMap });
      logger.info('✅ 폴더 이름 변경 완료:', newName);
    } catch (error) {
      logger.error('❌ 폴더 이름 변경 오류:', error);
      throw error;
    }
  };

  // 폴더 삭제
  const deleteFolder = async (
    folderId: string,
    deleteContents: boolean,
    sessions: Session[],
    onDeleteSession: (sessionId: string) => Promise<void>
  ): Promise<void> => {
    const folderToDelete = folders.find(f => f.id === folderId);
    if (!folderToDelete) return;

    let updatedFolders = [...folders];
    let updatedMap = { ...sessionFolderMap };

    // 하위 폴더 ID들 수집 (재귀적)
    const getChildFolderIds = (parentId: string): string[] => {
      const childIds: string[] = [];
      const children = folders.filter(f => f.parentId === parentId);
      for (const child of children) {
        childIds.push(child.id);
        childIds.push(...getChildFolderIds(child.id));
      }
      return childIds;
    };

    const childFolderIds = getChildFolderIds(folderId);
    const allFolderIds = [folderId, ...childFolderIds];

    if (deleteContents) {
      // 하위 항목 모두 삭제
      // 1. 해당 폴더들의 세션 삭제
      const sessionsToDelete = sessions.filter(s =>
        allFolderIds.includes(sessionFolderMap[s.id] as string)
      );
      for (const session of sessionsToDelete) {
        await onDeleteSession(session.id);
        delete updatedMap[session.id];
      }

      // 2. 폴더 삭제
      updatedFolders = updatedFolders.filter(f => !allFolderIds.includes(f.id));
    } else {
      // 하위 항목을 상위 폴더로 이동
      const parentId = folderToDelete.parentId;

      // 1. 직속 하위 폴더를 상위로 이동
      updatedFolders = updatedFolders.map(f =>
        f.parentId === folderId
          ? { ...f, parentId, updatedAt: new Date().toISOString() }
          : f
      );

      // 2. 직속 세션을 상위로 이동
      for (const sessionId of Object.keys(updatedMap)) {
        if (updatedMap[sessionId] === folderId) {
          updatedMap[sessionId] = parentId;
        }
      }

      // 3. 폴더 자체만 삭제
      updatedFolders = updatedFolders.filter(f => f.id !== folderId);
    }

    setFolders(updatedFolders);
    setSessionFolderMap(updatedMap);

    // 현재 폴더가 삭제되면 상위로 이동
    if (allFolderIds.includes(currentFolderId as string)) {
      setCurrentFolderId(folderToDelete.parentId);
    }

    try {
      await saveFolderData({ folders: updatedFolders, sessionFolderMap: updatedMap });
      logger.info('✅ 폴더 삭제 완료:', folderToDelete.name);
    } catch (error) {
      logger.error('❌ 폴더 삭제 오류:', error);
      throw error;
    }
  };

  // 폴더 네비게이션 - 진입 (즉시 전환)
  const navigateToFolder = (folderId: string | null) => {
    setCurrentFolderId(folderId);
  };

  // 폴더 네비게이션 - 뒤로가기 (즉시 전환)
  const navigateBack = () => {
    if (currentFolderId === null) return;

    const currentFolder = folders.find(f => f.id === currentFolderId);
    const parentId = currentFolder?.parentId ?? null;
    setCurrentFolderId(parentId);
  };

  // 세션을 폴더로 이동
  const moveSessionToFolder = async (sessionId: string, folderId: string | null): Promise<void> => {
    const updatedMap = { ...sessionFolderMap, [sessionId]: folderId };
    setSessionFolderMap(updatedMap);

    try {
      await saveFolderData({ folders, sessionFolderMap: updatedMap });
      logger.debug('✅ 세션 이동 완료:', sessionId, '->', folderId);
    } catch (error) {
      logger.error('❌ 세션 이동 오류:', error);
      throw error;
    }
  };

  // 폴더를 다른 폴더로 이동
  const moveFolderToFolder = async (movingFolderId: string, targetFolderId: string | null): Promise<void> => {
    // 자기 자신이나 자식 폴더로는 이동 불가
    if (movingFolderId === targetFolderId) return;

    // 타겟이 이동할 폴더의 하위인지 확인
    let checkId: string | null = targetFolderId;
    while (checkId) {
      if (checkId === movingFolderId) {
        logger.warn('❌ 자식 폴더로 이동할 수 없습니다');
        return;
      }
      const parent = folders.find(f => f.id === checkId);
      checkId = parent?.parentId ?? null;
    }

    const updatedFolders = folders.map(f =>
      f.id === movingFolderId
        ? { ...f, parentId: targetFolderId, updatedAt: new Date().toISOString() }
        : f
    );
    setFolders(updatedFolders);

    try {
      await saveFolderData({ folders: updatedFolders, sessionFolderMap });
      logger.debug('✅ 폴더 이동 완료:', movingFolderId, '->', targetFolderId);
    } catch (error) {
      logger.error('❌ 폴더 이동 오류:', error);
      throw error;
    }
  };

  // 폴더 순서 변경
  const reorderFolders = async (reorderedFolders: Folder[]): Promise<void> => {
    // 순서 값 재할당
    const updatedFolders = folders.map(f => {
      const reordered = reorderedFolders.find(rf => rf.id === f.id);
      if (reordered) {
        const newOrder = reorderedFolders.indexOf(reordered);
        return { ...f, order: newOrder, updatedAt: new Date().toISOString() };
      }
      return f;
    });

    setFolders(updatedFolders);

    try {
      await saveFolderData({ folders: updatedFolders, sessionFolderMap });
      logger.debug('✅ 폴더 순서 변경 완료');
    } catch (error) {
      logger.error('❌ 폴더 순서 변경 오류:', error);
      throw error;
    }
  };

  // 새 세션 생성 시 현재 폴더 ID 반환
  const getCurrentFolderIdForNewSession = (): string | null => {
    return currentFolderId;
  };

  // 폴더 import (외부에서 불러온 폴더 데이터 추가)
  // 반환: 기존 폴더 ID -> 새 폴더 ID 매핑
  const importFolderData = async (
    importedFolder: Folder,
    importedSubfolders: Folder[],
    importedSessionFolderMap: Record<string, string | null>,
    targetFolderId: string | null
  ): Promise<{ newFolderIdMap: Record<string, string> }> => {
    // 새 ID 생성을 위한 매핑 (기존 ID -> 새 ID)
    const newFolderIdMap: Record<string, string> = {};

    // 1. 루트 폴더 ID 생성
    const newRootFolderId = Date.now().toString() + Math.random().toString(36).substring(2, 9);
    newFolderIdMap[importedFolder.id] = newRootFolderId;

    // 2. 하위 폴더 ID 생성
    for (const subfolder of importedSubfolders) {
      const newId = Date.now().toString() + Math.random().toString(36).substring(2, 9) + Math.random().toString(36).substring(2, 5);
      newFolderIdMap[subfolder.id] = newId;
    }

    // 3. 새 폴더 객체 생성
    const newRootFolder: Folder = {
      ...importedFolder,
      id: newRootFolderId,
      parentId: targetFolderId, // 타겟 폴더 아래에 배치
      order: folders.filter(f => f.parentId === targetFolderId).length,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const newSubfolders: Folder[] = importedSubfolders.map(subfolder => ({
      ...subfolder,
      id: newFolderIdMap[subfolder.id],
      parentId: subfolder.parentId ? newFolderIdMap[subfolder.parentId] : newRootFolderId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));

    // 4. 세션-폴더 매핑 업데이트
    const newSessionFolderMap: Record<string, string | null> = {};
    for (const [sessionId, oldFolderId] of Object.entries(importedSessionFolderMap)) {
      if (oldFolderId && newFolderIdMap[oldFolderId]) {
        newSessionFolderMap[sessionId] = newFolderIdMap[oldFolderId];
      }
    }

    // 5. 상태 업데이트
    const updatedFolders = [...folders, newRootFolder, ...newSubfolders];
    const updatedSessionFolderMap = { ...sessionFolderMap, ...newSessionFolderMap };

    setFolders(updatedFolders);
    setSessionFolderMap(updatedSessionFolderMap);

    // 6. 저장
    try {
      await saveFolderData({ folders: updatedFolders, sessionFolderMap: updatedSessionFolderMap });
      logger.info('✅ 폴더 import 완료:', importedFolder.name);
      logger.debug(`   - 루트 폴더: ${newRootFolderId}`);
      logger.debug(`   - 하위 폴더: ${newSubfolders.length}개`);
    } catch (error) {
      logger.error('❌ 폴더 import 오류:', error);
      throw error;
    }

    return { newFolderIdMap };
  };

  // 폴더 데이터 복원 (Undo용)
  const restoreFolderData = async (
    backupFolders: Folder[],
    backupSessionFolderMap: Record<string, string | null>
  ): Promise<void> => {
    setFolders(backupFolders);
    setSessionFolderMap(backupSessionFolderMap);

    try {
      await saveFolderData({ folders: backupFolders, sessionFolderMap: backupSessionFolderMap });
      logger.info('✅ 폴더 데이터 복원 완료');
    } catch (error) {
      logger.error('❌ 폴더 데이터 복원 오류:', error);
      throw error;
    }
  };

  return {
    folders,
    currentFolderId,
    folderPath,
    sessionFolderMap,
    slideDirection,
    isAnimating,
    initializeFolders,
    getCurrentFolderSessions,
    getCurrentFolderSubfolders,
    getSessionsInFolder,
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
  };
}
