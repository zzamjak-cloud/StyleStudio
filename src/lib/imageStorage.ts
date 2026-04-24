import { openDB, IDBPDatabase } from 'idb';
import { logger } from './logger';

const DB_NAME = 'StyleStudioImages';
const STORE_NAME = 'images';
const DB_VERSION = 1;

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
    const db = await getImageDB();
    const key = `${sessionId}-${imageIndex}`;

    await db.put(STORE_NAME, dataUrl, key);
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
    const db = await getImageDB();
    await db.put(STORE_NAME, dataUrl, key);
  } catch (error) {
    logger.error('❌ 이미지 키 저장 실패:', error);
    throw error;
  }
}

/**
 * IndexedDB에서 이미지를 로드
 * @param key IndexedDB 키
 * @returns Base64 data URL (없으면 null)
 */
export async function loadImage(key: string): Promise<string | null> {
  try {
    const db = await getImageDB();
    const dataUrl = await db.get(STORE_NAME, key);

    if (dataUrl) {
      logger.debug(`✅ 이미지 로드 완료: ${key}`);
      return dataUrl as string;
    } else {
      logger.warn(`⚠️ 이미지를 찾을 수 없음: ${key}`);
      return null;
    }
  } catch (error) {
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
    const db = await getImageDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    // sessionId로 시작하는 모든 키 찾기
    const allKeys = await store.getAllKeys();
    const sessionKeys = allKeys.filter((key: IDBValidKey) =>
      typeof key === 'string' && key.startsWith(`${sessionId}-`)
    );

    // 모든 세션 이미지 삭제
    await Promise.all(
      sessionKeys.map((key: IDBValidKey) => store.delete(key))
    );

    await tx.done;
    logger.debug(`✅ 세션 이미지 삭제 완료: ${sessionId} (${sessionKeys.length}개)`);
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
    const db = await getImageDB();
    await db.delete(STORE_NAME, key);
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
    const db = await getImageDB();
    const allValues = await db.getAll(STORE_NAME);

    const totalSize = allValues.reduce((sum: number, dataUrl: any) => {
      return sum + (typeof dataUrl === 'string' ? dataUrl.length : 0);
    }, 0);

    const sizeInMB = totalSize / (1024 * 1024);
    logger.debug(`💾 IndexedDB 사용량: ${sizeInMB.toFixed(2)} MB`);

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
    const db = await getImageDB();
    await db.clear(STORE_NAME);
    logger.debug('✅ 모든 이미지 삭제 완료');
  } catch (error) {
    logger.error('❌ 이미지 전체 삭제 실패:', error);
    throw error;
  }
}
