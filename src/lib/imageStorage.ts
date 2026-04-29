import { openDB, IDBPDatabase } from 'idb';
import {
  BaseDirectory,
  exists,
  mkdir,
  readDir,
  readTextFile,
  remove,
  writeTextFile,
} from '@tauri-apps/plugin-fs';
import { logger } from './logger';

const DB_NAME = 'StyleStudioImages';
const STORE_NAME = 'images';
const DB_VERSION = 1;
const IMAGE_FS_DIR = 'images';
const IMAGE_FS_EXT = '.txt';

function getImageFileName(key: string): string {
  return `${key}${IMAGE_FS_EXT}`;
}

function normalizeImageKey(rawKey: string): string {
  let key = rawKey.trim();
  if (key.startsWith(`${IMAGE_FS_DIR}/`)) {
    key = key.slice(`${IMAGE_FS_DIR}/`.length);
  }
  if (key.endsWith(IMAGE_FS_EXT)) {
    key = key.slice(0, -IMAGE_FS_EXT.length);
  }
  return key;
}

async function ensureImageDir(): Promise<void> {
  if (!(await exists(IMAGE_FS_DIR, { baseDir: BaseDirectory.AppData }))) {
    await mkdir(IMAGE_FS_DIR, { baseDir: BaseDirectory.AppData, recursive: true });
  }
}

/**
 * IndexedDB 데이터베이스 초기화 및 반환
 */
async function getImageDB(): Promise<IDBPDatabase> {
  try {
    return await openDB(DB_NAME, DB_VERSION, {
      upgrade(db: IDBPDatabase) {
        // images 스토어가 없으면 생성
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
          logger.debug('✅ IndexedDB images 스토어 생성 완료');
        }
      },
    });
  } catch (error) {
    logger.error('❌ IndexedDB 초기화 실패:', error);
    throw error;
  }
}

/**
 * 이미지를 IndexedDB에 저장하고 키를 반환
 * @param sessionId 세션 ID
 * @param imageIndex 이미지 인덱스 (0부터 시작)
 * @param dataUrl Base64 data URL
 * @returns IndexedDB 키
 */
export async function saveImage(
  sessionId: string,
  imageIndex: number,
  dataUrl: string
): Promise<string> {
  try {
    const key = `${sessionId}-${imageIndex}`;
    await saveImageWithKey(key, dataUrl);
    logger.debug(`✅ 이미지 저장 완료: ${key} (${Math.round(dataUrl.length / 1024)} KB)`);

    return key;
  } catch (error) {
    logger.error('❌ 이미지 저장 실패:', error);
    throw error;
  }
}

/**
 * 임의의 키로 이미지를 저장 (히스토리/채팅 등 namespace 제어가 필요한 경우 사용)
 */
export async function saveImageWithKey(key: string, dataUrl: string): Promise<void> {
  try {
    await ensureImageDir();
    await writeTextFile(`${IMAGE_FS_DIR}/${getImageFileName(key)}`, dataUrl, {
      baseDir: BaseDirectory.AppData,
    });
  } catch (error) {
    // 권한/경로 이슈 시 레거시 IndexedDB로 폴백
    try {
      const db = await getImageDB();
      await db.put(STORE_NAME, dataUrl, key);
      logger.warn(`⚠️ 파일 저장 실패로 IndexedDB 폴백 저장: ${key}`);
      return;
    } catch (fallbackError) {
      logger.error('❌ 이미지 키 저장 실패:', error, fallbackError);
      throw fallbackError;
    }
  }
}

/**
 * IndexedDB에서 이미지를 로드
 * @param key IndexedDB 키
 * @returns Base64 data URL (없으면 null)
 */
export async function loadImage(key: string): Promise<string | null> {
  try {
    const normalizedKey = normalizeImageKey(key);
    const fsCandidates = Array.from(
      new Set([
        `${IMAGE_FS_DIR}/${getImageFileName(normalizedKey)}`,
        key.startsWith(`${IMAGE_FS_DIR}/`) ? key : '',
        key.endsWith(IMAGE_FS_EXT) && !key.startsWith(`${IMAGE_FS_DIR}/`) ? `${IMAGE_FS_DIR}/${key}` : '',
      ].filter(Boolean))
    );

    for (const fsPath of fsCandidates) {
      if (await exists(fsPath, { baseDir: BaseDirectory.AppData })) {
        const dataUrl = await readTextFile(fsPath, { baseDir: BaseDirectory.AppData });
        logger.debug(`✅ 이미지 로드 완료: ${key} -> ${fsPath}`);
        return dataUrl;
      }
    }

    // 하위 호환: 예전 IndexedDB에만 있는 데이터를 읽고 파일 저장소로 승격
    const db = await getImageDB();
    const legacyDataUrl =
      (await db.get(STORE_NAME, key)) ??
      (normalizedKey !== key ? await db.get(STORE_NAME, normalizedKey) : undefined);
    if (legacyDataUrl && typeof legacyDataUrl === 'string') {
      await saveImageWithKey(normalizedKey, legacyDataUrl);
      logger.debug(`♻️ IndexedDB → 파일 저장소 승격 완료: ${key} -> ${normalizedKey}`);
      return legacyDataUrl;
    }

    logger.warn(`⚠️ 이미지를 찾을 수 없음: ${key}`);
    return null;
  } catch (error) {
    // 파일 저장소 접근 실패 시 레거시 IndexedDB 조회 폴백
    try {
      const db = await getImageDB();
      const legacyDataUrl = await db.get(STORE_NAME, key);
      if (legacyDataUrl && typeof legacyDataUrl === 'string') {
        logger.warn(`⚠️ 파일 저장소 로드 실패로 IndexedDB 폴백 로드: ${key}`);
        return legacyDataUrl;
      }
    } catch {
      // no-op
    }
    logger.error('❌ 이미지 로드 실패:', error);
    return null;
  }
}

/**
 * 여러 이미지를 한 번에 로드
 * @param keys IndexedDB 키 배열
 * @returns Base64 data URL 배열
 */
export async function loadImages(keys: string[]): Promise<string[]> {
  try {
    const results = await Promise.all(
      keys.map(key => loadImage(key))
    );

    // null 값 필터링
    return results.filter((url): url is string => url !== null);
  } catch (error) {
    logger.error('❌ 여러 이미지 로드 실패:', error);
    return [];
  }
}

/**
 * 세션의 모든 이미지를 삭제
 * @param sessionId 세션 ID
 */
export async function deleteSessionImages(sessionId: string): Promise<void> {
  try {
    if (!(await exists(IMAGE_FS_DIR, { baseDir: BaseDirectory.AppData }))) return;
    const entries = await readDir(IMAGE_FS_DIR, { baseDir: BaseDirectory.AppData });
    const targetNames = entries
      .filter((entry) => entry.isFile && entry.name?.startsWith(`${sessionId}-`))
      .map((entry) => entry.name!);
    await Promise.all(
      targetNames.map((name) =>
        remove(`${IMAGE_FS_DIR}/${name}`, { baseDir: BaseDirectory.AppData })
      )
    );
    logger.debug(`✅ 세션 이미지 삭제 완료: ${sessionId} (${targetNames.length}개)`);
  } catch (error) {
    logger.error('❌ 세션 이미지 삭제 실패:', error);
    throw error;
  }
}

/**
 * 특정 이미지를 삭제
 * @param key IndexedDB 키
 */
export async function deleteImage(key: string): Promise<void> {
  try {
    const normalizedKey = normalizeImageKey(key);
    const fsPath = `${IMAGE_FS_DIR}/${getImageFileName(normalizedKey)}`;
    if (await exists(fsPath, { baseDir: BaseDirectory.AppData })) {
      await remove(fsPath, { baseDir: BaseDirectory.AppData });
    }
    logger.debug(`✅ 이미지 삭제 완료: ${key}`);
  } catch (error) {
    logger.error('❌ 이미지 삭제 실패:', error);
    throw error;
  }
}

/**
 * IndexedDB 전체 용량 확인 (개발용)
 */
export async function getStorageSize(): Promise<number> {
  try {
    if (!(await exists(IMAGE_FS_DIR, { baseDir: BaseDirectory.AppData }))) {
      return 0;
    }
    const entries = await readDir(IMAGE_FS_DIR, { baseDir: BaseDirectory.AppData });
    let totalSize = 0;
    for (const entry of entries) {
      if (!entry.isFile || !entry.name) continue;
      const content = await readTextFile(`${IMAGE_FS_DIR}/${entry.name}`, {
        baseDir: BaseDirectory.AppData,
      });
      totalSize += content.length;
    }

    const sizeInMB = totalSize / (1024 * 1024);
    logger.debug(`💾 이미지 파일 저장소 사용량: ${sizeInMB.toFixed(2)} MB`);

    return sizeInMB;
  } catch (error) {
    logger.error('❌ 저장소 크기 확인 실패:', error);
    return 0;
  }
}

/**
 * 모든 이미지 삭제 (개발용 - 주의!)
 */
export async function clearAllImages(): Promise<void> {
  try {
    if (await exists(IMAGE_FS_DIR, { baseDir: BaseDirectory.AppData })) {
      await remove(IMAGE_FS_DIR, { baseDir: BaseDirectory.AppData, recursive: true });
    }
    await ensureImageDir();
    logger.debug('✅ 모든 이미지 삭제 완료 (파일 저장소)');
  } catch (error) {
    logger.error('❌ 이미지 전체 삭제 실패:', error);
    throw error;
  }
}
