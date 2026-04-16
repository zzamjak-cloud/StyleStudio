import { Store } from '@tauri-apps/plugin-store';
import { save, open } from '@tauri-apps/plugin-dialog';
import { writeTextFile, readTextFile } from '@tauri-apps/plugin-fs';
import { Session } from '../types/session';
import { Folder, FolderData } from '../types/folder';
import { logger } from './logger';
import { saveImage, loadImages } from './imageStorage';

// 창 상태 타입
export interface WindowState {
  x: number;
  y: number;
  width: number;
  height: number;
  maximized: boolean;
}

// Store 인스턴스를 가져오는 헬퍼 함수
async function getStore(): Promise<Store> {
  return await Store.load('settings.json');
}

// API 키 저장
export async function saveApiKey(apiKey: string): Promise<void> {
  const store = await getStore();
  const cleanApiKey = apiKey.trim(); // 공백 제거
  await store.set('gemini_api_key', cleanApiKey);
  await store.save();
  logger.debug('✅ API 키 저장 완료');
  logger.debug('   - 키 길이:', cleanApiKey.length);
  logger.debug('   - 키 시작:', cleanApiKey.substring(0, 10) + '...');
}

// API 키 불러오기
export async function loadApiKey(): Promise<string | null> {
  try {
    const store = await getStore();
    const apiKey = await store.get<string>('gemini_api_key');
    logger.debug('📦 API 키 로드:', apiKey ? '존재함' : '없음');
    if (apiKey) {
      logger.debug('   - 키 길이:', apiKey.length);
      logger.debug('   - 키 시작:', apiKey.substring(0, 10) + '...');
    }
    return apiKey || null;
  } catch (error) {
    logger.error('API 키 로드 오류:', error);
    return null;
  }
}

// 설정 초기화
export async function clearSettings(): Promise<void> {
  const store = await getStore();
  await store.clear();
  await store.save();
  logger.debug('🗑️ 설정 초기화 완료');
}

/**
 * Base64 이미지가 IndexedDB 키인지 확인
 * (키 형식: "sessionId-index")
 */
function isImageKey(str: string): boolean {
  return !str.startsWith('data:');
}

/**
 * 세션 저장 (Base64 이미지를 IndexedDB로 마이그레이션)
 */
export async function saveSessions(sessions: Session[]): Promise<void> {
  try {
    // 각 세션의 이미지를 IndexedDB로 마이그레이션
    const migratedSessions = await Promise.all(
      sessions.map(async (session) => {
        // 이미 imageKeys가 있거나, referenceImages가 모두 키 형식이면 마이그레이션 불필요
        const hasImageKeys = session.imageKeys && session.imageKeys.length > 0;
        const allAreKeys = session.referenceImages.every(isImageKey);

        if (hasImageKeys || allAreKeys) {
          logger.debug(`  - 세션 "${session.name}": 이미 마이그레이션됨`);
          return session;
        }

        // Base64 이미지를 IndexedDB로 저장
        logger.debug(`  - 세션 "${session.name}": ${session.referenceImages.length}개 이미지 마이그레이션 중...`);
        const imageKeys = await Promise.all(
          session.referenceImages.map((dataUrl, index) =>
            saveImage(session.id, index, dataUrl)
          )
        );

        // 마이그레이션된 세션 반환
        return {
          ...session,
          imageKeys, // 새로운 imageKeys 추가
          referenceImages: imageKeys, // referenceImages도 키로 업데이트
        };
      })
    );

    // Store에 저장
    const store = await getStore();
    await store.set('sessions', migratedSessions);
    await store.save();
    logger.debug('✅ 세션 저장 완료:', migratedSessions.length, '개 (IndexedDB 마이그레이션 포함)');
  } catch (error) {
    logger.error('❌ 세션 저장 실패:', error);
    throw error;
  }
}

/**
 * 세션 불러오기 (IndexedDB에서 이미지 복원)
 */
export async function loadSessions(): Promise<Session[]> {
  try {
    const store = await getStore();
    const sessions = await store.get<Session[]>('sessions');

    if (!sessions || sessions.length === 0) {
      logger.debug('📦 세션 로드: 0개');
      return [];
    }

    // 각 세션의 이미지를 IndexedDB에서 복원
    const restoredSessions = await Promise.all(
      sessions.map(async (session) => {
        // imageKeys가 있으면 IndexedDB에서 로드
        if (session.imageKeys && session.imageKeys.length > 0) {
          logger.debug(`  - 세션 "${session.name}": IndexedDB에서 ${session.imageKeys.length}개 이미지 로드 중...`);
          const images = await loadImages(session.imageKeys);

          if (images.length === 0 && session.imageKeys.length > 0) {
            logger.error(`  ❌ 세션 "${session.name}": IndexedDB에서 이미지를 찾을 수 없습니다!`);
            logger.error(`     ImageKeys: ${JSON.stringify(session.imageKeys)}`);
            logger.error(`     해결 방법: 원본 PC에서 세션을 다시 export하거나, 참조 이미지를 다시 업로드하세요`);
          } else {
            logger.debug(`  ✅ 세션 "${session.name}": ${images.length}개 이미지 복원 완료`);
          }

          return {
            ...session,
            referenceImages: images, // 복원된 이미지 (빈 배열일 수 있음)
          };
        }

        // imageKeys가 없으면 referenceImages가 Base64인지 키인지 확인
        const allAreKeys = session.referenceImages.every(isImageKey);
        if (allAreKeys) {
          logger.debug(`  - 세션 "${session.name}": IndexedDB에서 ${session.referenceImages.length}개 이미지 로드 중...`);
          const images = await loadImages(session.referenceImages);

          if (images.length === 0 && session.referenceImages.length > 0) {
            logger.error(`  ❌ 세션 "${session.name}": IndexedDB에서 이미지를 찾을 수 없습니다!`);
            logger.error(`     ImageKeys: ${JSON.stringify(session.referenceImages)}`);
            logger.error(`     해결 방법: 원본 PC에서 세션을 다시 export하거나, 참조 이미지를 다시 업로드하세요`);
          } else {
            logger.debug(`  ✅ 세션 "${session.name}": ${images.length}개 이미지 복원 완료`);
          }

          return {
            ...session,
            referenceImages: images, // 복원된 이미지 (빈 배열일 수 있음)
            imageKeys: session.referenceImages, // 키 정보 보존
          };
        }

        // 레거시 Base64 형식 (마이그레이션 필요)
        logger.debug(`  - 세션 "${session.name}": 레거시 Base64 형식 (마이그레이션 필요)`);
        return session;
      })
    );

    logger.debug('✅ 세션 로드 완료:', restoredSessions.length, '개 (IndexedDB 복원 포함)');
    return restoredSessions;
  } catch (error) {
    logger.error('❌ 세션 로드 오류:', error);
    return [];
  }
}

// 세션을 파일로 저장 (Export)
export async function exportSessionToFile(session: Session): Promise<void> {
  try {
    // 파일 저장 다이얼로그 열기
    const filePath = await save({
      defaultPath: `${session.name}.stylestudio.json`,
      filters: [
        {
          name: 'StyleStudio Session',
          extensions: ['stylestudio.json', 'json'],
        },
      ],
    });

    if (!filePath) {
      logger.debug('❌ 파일 저장 취소됨');
      return;
    }

    logger.debug('💾 세션을 파일로 저장 중:', filePath);

    // IndexedDB 키를 실제 Base64 이미지로 복원
    let exportSession = session;
    if (session.imageKeys && session.imageKeys.length > 0) {
      logger.debug(`  - IndexedDB에서 ${session.imageKeys.length}개 이미지 복원 중...`);
      const images = await loadImages(session.imageKeys);

      if (images.length > 0) {
        exportSession = {
          ...session,
          referenceImages: images, // 실제 Base64 데이터로 교체
          // imageKeys는 유지 (호환성)
        };
        logger.debug(`  - ${images.length}개 이미지 복원 완료`);
      } else {
        logger.warn('  - ⚠️ IndexedDB에서 이미지를 찾을 수 없습니다. 키만 export됩니다.');
      }
    }

    // 세션을 JSON 문자열로 변환
    const jsonContent = JSON.stringify(exportSession, null, 2);

    // 파일에 쓰기
    await writeTextFile(filePath, jsonContent);

    logger.debug('✅ 세션 파일 저장 완료:', filePath);
  } catch (error) {
    logger.error('❌ 세션 파일 저장 오류:', error);
    throw error;
  }
}

// Import 결과 타입 (세션 또는 폴더)
export interface ImportResult {
  type: 'session' | 'folder';
  sessions: Session[];
  folderData?: FolderExportData;
}

// 파일에서 세션 또는 폴더 불러오기 (Import) - 다중 파일 지원
export async function importSessionFromFile(): Promise<Session[]> {
  const result = await importFromFile();
  return result.sessions;
}

// 통합 import 함수 (세션/폴더 모두 지원)
export async function importFromFile(): Promise<ImportResult> {
  try {
    // 파일 열기 다이얼로그 (다중 선택 가능, 세션/폴더 파일 모두 허용)
    const selected = await open({
      multiple: true,
      filters: [
        {
          name: 'StyleStudio Files',
          extensions: ['stylestudio.json', 'stylestudio-folder.json', 'json'],
        },
      ],
    });

    if (!selected) {
      logger.debug('❌ 파일 선택 취소됨');
      return { type: 'session', sessions: [] };
    }

    // 선택된 파일 경로 배열로 변환
    const filePaths = Array.isArray(selected) ? selected : [selected];
    logger.debug(`📂 ${filePaths.length}개 파일 불러오기 시작`);

    // 파일 타입 감지 (첫 번째 파일 기준)
    const firstFilePath = filePaths[0];
    const firstContent = await readTextFile(firstFilePath);
    const firstData = JSON.parse(firstContent);

    // 폴더 파일인지 확인 (exportVersion 필드로 판단)
    if (firstData.exportVersion && firstData.folder && firstData.subfolders) {
      logger.debug('📁 폴더 파일 감지됨');
      return {
        type: 'folder',
        sessions: firstData.sessions || [],
        folderData: firstData as FolderExportData,
      };
    }

    // 세션 파일 처리
    const sessions: Session[] = [];
    for (const filePath of filePaths) {
      try {
        logger.debug('   - 파일 읽는 중:', filePath);

        // 파일 읽기
        const fileContent = await readTextFile(filePath);

        // JSON 파싱
        const data = JSON.parse(fileContent);

        // 폴더 파일이면 건너뛰기
        if (data.exportVersion && data.folder) {
          logger.debug('   ⚠️ 폴더 파일은 단독으로 불러와주세요:', filePath);
          continue;
        }

        const session: Session = data;

        logger.debug(`   ✅ 세션 "${session.name}" 불러오기 완료`);
        logger.debug(`      - 세션 ID: ${session.id}`);
        logger.debug(`      - 이미지 개수: ${session.imageCount}`);

        sessions.push(session);
      } catch (error) {
        logger.error(`   ❌ 파일 읽기 실패 (${filePath}):`, error);
        // 한 파일 실패해도 계속 진행
      }
    }

    logger.debug(`✅ 총 ${sessions.length}개 세션 불러오기 완료`);
    return { type: 'session', sessions };
  } catch (error) {
    logger.error('❌ 파일 불러오기 오류:', error);
    throw error;
  }
}

// ============================================
// 폴더 내보내기/불러오기 (폴더 + 내부 세션/하위폴더 전체)
// ============================================

// 폴더 내보내기용 데이터 타입
export interface FolderExportData {
  exportVersion: '1.0';
  exportedAt: string;
  folder: Folder;
  subfolders: Folder[];
  sessions: Session[];
  // 폴더 계층 구조 복원을 위한 정보
  folderHierarchy: Record<string, string | null>; // folderId -> parentId
  sessionFolderMap: Record<string, string | null>; // sessionId -> folderId
}

/**
 * 폴더를 파일로 내보내기 (하위 폴더 및 세션 모두 포함)
 */
export async function exportFolderToFile(
  folder: Folder,
  allFolders: Folder[],
  allSessions: Session[],
  sessionFolderMap: Record<string, string | null>
): Promise<void> {
  try {
    // 파일 저장 다이얼로그 열기
    const filePath = await save({
      defaultPath: `${folder.name}.stylestudio-folder.json`,
      filters: [
        {
          name: 'StyleStudio Folder',
          extensions: ['stylestudio-folder.json', 'json'],
        },
      ],
    });

    if (!filePath) {
      logger.debug('❌ 폴더 저장 취소됨');
      return;
    }

    logger.debug('💾 폴더를 파일로 저장 중:', filePath);

    // 재귀적으로 하위 폴더 수집
    const collectSubfolders = (parentId: string): Folder[] => {
      const children = allFolders.filter(f => f.parentId === parentId);
      const result: Folder[] = [];
      for (const child of children) {
        result.push(child);
        result.push(...collectSubfolders(child.id));
      }
      return result;
    };

    const subfolders = collectSubfolders(folder.id);
    const allRelatedFolderIds = [folder.id, ...subfolders.map(f => f.id)];

    // 폴더에 속한 세션 수집
    const sessionsInFolder = allSessions.filter(s => {
      const folderId = sessionFolderMap[s.id];
      return folderId && allRelatedFolderIds.includes(folderId);
    });

    // IndexedDB에서 이미지 복원
    const sessionsWithImages: Session[] = [];
    for (const session of sessionsInFolder) {
      let exportSession = session;
      if (session.imageKeys && session.imageKeys.length > 0) {
        const images = await loadImages(session.imageKeys);
        if (images.length > 0) {
          exportSession = {
            ...session,
            referenceImages: images,
          };
        }
      }
      sessionsWithImages.push(exportSession);
    }

    // 폴더 계층 구조 정보 생성
    const folderHierarchy: Record<string, string | null> = {};
    folderHierarchy[folder.id] = null; // 루트 폴더는 parentId를 null로
    for (const subfolder of subfolders) {
      // 상위 폴더가 folder.id면 null로, 아니면 상대 경로 유지
      if (subfolder.parentId === folder.id) {
        folderHierarchy[subfolder.id] = folder.id;
      } else {
        folderHierarchy[subfolder.id] = subfolder.parentId;
      }
    }

    // 세션-폴더 매핑 (내보내기할 세션만)
    const exportSessionFolderMap: Record<string, string | null> = {};
    for (const session of sessionsWithImages) {
      exportSessionFolderMap[session.id] = sessionFolderMap[session.id] || null;
    }

    // 내보내기 데이터 구성
    const exportData: FolderExportData = {
      exportVersion: '1.0',
      exportedAt: new Date().toISOString(),
      folder: folder,
      subfolders: subfolders,
      sessions: sessionsWithImages,
      folderHierarchy: folderHierarchy,
      sessionFolderMap: exportSessionFolderMap,
    };

    // JSON 파일 저장
    const jsonContent = JSON.stringify(exportData, null, 2);
    await writeTextFile(filePath, jsonContent);

    logger.debug('✅ 폴더 내보내기 완료:', filePath);
    logger.debug(`   - 폴더: ${folder.name}`);
    logger.debug(`   - 하위 폴더: ${subfolders.length}개`);
    logger.debug(`   - 세션: ${sessionsWithImages.length}개`);
  } catch (error) {
    logger.error('❌ 폴더 내보내기 오류:', error);
    throw error;
  }
}

/**
 * 파일에서 폴더 불러오기 (하위 폴더 및 세션 모두 포함)
 * 반환: { folder, subfolders, sessions, sessionFolderMap }
 */
export async function importFolderFromFile(): Promise<FolderExportData | null> {
  try {
    // 파일 열기 다이얼로그
    const selected = await open({
      multiple: false,
      filters: [
        {
          name: 'StyleStudio Folder',
          extensions: ['stylestudio-folder.json', 'json'],
        },
      ],
    });

    if (!selected) {
      logger.debug('❌ 폴더 불러오기 취소됨');
      return null;
    }

    const filePath = Array.isArray(selected) ? selected[0] : selected;
    logger.debug('📂 폴더 파일 불러오기:', filePath);

    // 파일 읽기
    const fileContent = await readTextFile(filePath);
    const data: FolderExportData = JSON.parse(fileContent);

    // 버전 확인
    if (data.exportVersion !== '1.0') {
      logger.warn('⚠️ 알 수 없는 폴더 내보내기 버전:', data.exportVersion);
    }

    logger.debug('✅ 폴더 불러오기 완료:');
    logger.debug(`   - 폴더: ${data.folder.name}`);
    logger.debug(`   - 하위 폴더: ${data.subfolders.length}개`);
    logger.debug(`   - 세션: ${data.sessions.length}개`);

    return data;
  } catch (error) {
    logger.error('❌ 폴더 불러오기 오류:', error);
    throw error;
  }
}

// 창 상태 저장
export async function saveWindowState(windowState: WindowState): Promise<void> {
  const store = await getStore();
  await store.set('window_state', windowState);
  await store.save();
}

// 저장된 창 상태 가져오기
export async function getWindowState(): Promise<WindowState | null> {
  const store = await getStore();
  return await store.get<WindowState>('window_state') || null;
}

// ============================================
// 폴더 관련 함수들
// ============================================

/**
 * 폴더 목록 저장
 */
export async function saveFolders(folders: Folder[]): Promise<void> {
  try {
    const store = await getStore();
    await store.set('folders', folders);
    await store.save();
    logger.debug('✅ 폴더 저장 완료:', folders.length, '개');
  } catch (error) {
    logger.error('❌ 폴더 저장 실패:', error);
    throw error;
  }
}

/**
 * 폴더 목록 불러오기
 */
export async function loadFolders(): Promise<Folder[]> {
  try {
    const store = await getStore();
    const folders = await store.get<Folder[]>('folders');
    logger.debug('📦 폴더 로드:', folders?.length || 0, '개');
    return folders || [];
  } catch (error) {
    logger.error('❌ 폴더 로드 오류:', error);
    return [];
  }
}

/**
 * 세션-폴더 매핑 저장
 */
export async function saveSessionFolderMap(sessionFolderMap: Record<string, string | null>): Promise<void> {
  try {
    const store = await getStore();
    await store.set('session_folder_map', sessionFolderMap);
    await store.save();
    logger.debug('✅ 세션-폴더 매핑 저장 완료');
  } catch (error) {
    logger.error('❌ 세션-폴더 매핑 저장 실패:', error);
    throw error;
  }
}

/**
 * 세션-폴더 매핑 불러오기
 */
export async function loadSessionFolderMap(): Promise<Record<string, string | null>> {
  try {
    const store = await getStore();
    const map = await store.get<Record<string, string | null>>('session_folder_map');
    logger.debug('📦 세션-폴더 매핑 로드:', Object.keys(map || {}).length, '개');
    return map || {};
  } catch (error) {
    logger.error('❌ 세션-폴더 매핑 로드 오류:', error);
    return {};
  }
}

/**
 * 폴더 데이터 전체 저장 (폴더 + 매핑)
 */
export async function saveFolderData(data: FolderData): Promise<void> {
  await saveFolders(data.folders);
  await saveSessionFolderMap(data.sessionFolderMap);
}

/**
 * 폴더 데이터 전체 불러오기
 */
export async function loadFolderData(): Promise<FolderData> {
  const folders = await loadFolders();
  const sessionFolderMap = await loadSessionFolderMap();
  return { folders, sessionFolderMap };
}

// ============================================
// 세션 저장 폴더 관련 함수들
// ============================================

/**
 * 기본 세션 저장 폴더 경로 저장
 */
export async function saveDefaultSessionSavePath(path: string | null): Promise<void> {
  try {
    const store = await getStore();
    await store.set('default_session_save_path', path);
    await store.save();
    logger.debug('✅ 기본 세션 저장 폴더 저장 완료:', path);
  } catch (error) {
    logger.error('❌ 기본 세션 저장 폴더 저장 실패:', error);
    throw error;
  }
}

/**
 * 기본 세션 저장 폴더 경로 불러오기
 */
export async function loadDefaultSessionSavePath(): Promise<string | null> {
  try {
    const store = await getStore();
    const path = await store.get<string>('default_session_save_path');
    logger.debug('📦 기본 세션 저장 폴더 로드:', path || '없음');
    return path || null;
  } catch (error) {
    logger.error('❌ 기본 세션 저장 폴더 로드 오류:', error);
    return null;
  }
}
