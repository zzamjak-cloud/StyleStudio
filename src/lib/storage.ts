import { Store } from '@tauri-apps/plugin-store';
import { save, open } from '@tauri-apps/plugin-dialog';
import { writeTextFile, readTextFile } from '@tauri-apps/plugin-fs';
import { Session } from '../types/session';
import { Folder, FolderData } from '../types/folder';
import { logger } from './logger';
import { saveImage, loadImages, saveImageWithKey, loadImage } from './imageStorage';

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

/** 현재 존재하는 세션 ID에 맞게 session_folder_map에서 고아 항목 제거 */
export async function pruneSessionFolderMapToSessions(sessionIds: string[]): Promise<void> {
  const store = await getStore();
  const idSet = new Set(sessionIds);
  const existingMap =
    (await store.get<Record<string, string | null>>('session_folder_map')) ?? {};
  const prunedMap = Object.fromEntries(
    Object.entries(existingMap).filter(([id]) => idSet.has(id))
  );
  if (Object.keys(prunedMap).length === Object.keys(existingMap).length) return;
  await store.set('session_folder_map', prunedMap);
  await store.save();
  logger.debug(
    '🧹 session_folder_map 정리:',
    Object.keys(existingMap).length,
    '→',
    Object.keys(prunedMap).length
  );
}

// Gemini API 키 저장
export async function saveGeminiApiKey(apiKey: string): Promise<void> {
  const store = await getStore();
  const cleanApiKey = apiKey.trim(); // 공백 제거
  await store.set('gemini_api_key', cleanApiKey);
  await store.save();
  logger.debug('✅ Gemini API 키 저장 완료');
  logger.debug('   - 키 길이:', cleanApiKey.length);
  logger.debug('   - 키 시작:', cleanApiKey.substring(0, 10) + '...');
}

// Gemini API 키 불러오기
export async function loadGeminiApiKey(): Promise<string | null> {
  try {
    const store = await getStore();
    const apiKey = await store.get<string>('gemini_api_key');
    logger.debug('📦 Gemini API 키 로드:', apiKey ? '존재함' : '없음');
    if (apiKey) {
      logger.debug('   - 키 길이:', apiKey.length);
      logger.debug('   - 키 시작:', apiKey.substring(0, 10) + '...');
    }
    return apiKey || null;
  } catch (error) {
    logger.error('Gemini API 키 로드 오류:', error);
    return null;
  }
}

// OpenAI API 키 저장
export async function saveOpenAIApiKey(apiKey: string): Promise<void> {
  const store = await getStore();
  const cleanApiKey = apiKey.trim();
  await store.set('openai_api_key', cleanApiKey);
  await store.save();
  logger.debug('✅ OpenAI API 키 저장 완료');
  logger.debug('   - 키 길이:', cleanApiKey.length);
  logger.debug('   - 키 시작:', cleanApiKey.substring(0, 10) + '...');
}

// OpenAI API 키 불러오기
export async function loadOpenAIApiKey(): Promise<string | null> {
  try {
    const store = await getStore();
    const apiKey = await store.get<string>('openai_api_key');
    logger.debug('📦 OpenAI API 키 로드:', apiKey ? '존재함' : '없음');
    if (apiKey) {
      logger.debug('   - 키 길이:', apiKey.length);
      logger.debug('   - 키 시작:', apiKey.substring(0, 10) + '...');
    }
    return apiKey || null;
  } catch (error) {
    logger.error('OpenAI API 키 로드 오류:', error);
    return null;
  }
}

// 하위 호환성 유지용 별칭
export async function saveApiKey(apiKey: string): Promise<void> {
  await saveGeminiApiKey(apiKey);
}

export async function loadApiKey(): Promise<string | null> {
  return loadGeminiApiKey();
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

/** 채팅 thought_signature 등 IndexedDB에 넣은 불투명 문자열 키 (images와 네임스페이스 분리) */
export const CHAT_SIGNATURE_KEY_MARKER = '-chatsig-';

function isChatSignatureStorageKey(value: string | undefined, expectedKey: string): boolean {
  return !!value && value === expectedKey;
}

/**
 * thought_signature 등 큰 불투명 문자열을 IndexedDB에 저장하고 키만 남긴다.
 * (data: URL이 아니어도 크기가 크면 저장 대상)
 */
async function persistOpaqueBlobField(
  rawValue: string | undefined,
  storageKey: string
): Promise<string | undefined> {
  if (rawValue === undefined || rawValue === '') return rawValue;
  if (rawValue === storageKey) return rawValue;
  if (isChatSignatureStorageKey(rawValue, storageKey)) return rawValue;
  await saveImageWithKey(storageKey, rawValue);
  return storageKey;
}

async function restoreOpaqueBlobField(
  rawValue: string | undefined
): Promise<string | undefined> {
  if (rawValue === undefined || rawValue === '') return rawValue;
  if (rawValue.includes(CHAT_SIGNATURE_KEY_MARKER)) {
    const restored = await loadImage(rawValue);
    return restored ?? rawValue;
  }
  return rawValue;
}

/**
 * 단일 base64 → IndexedDB 키 변환 (이미 키이면 그대로 반환)
 * 키 네임스페이스를 명시적으로 받아 generationHistory/concept/chat 등에서 충돌 방지.
 */
async function persistImageField(
  rawValue: string | undefined,
  key: string
): Promise<string | undefined> {
  if (!rawValue) return rawValue;
  if (!rawValue.startsWith('data:')) return rawValue; // 이미 키
  await saveImageWithKey(key, rawValue);
  return key;
}

/**
 * 단일 IndexedDB 키 → base64 복원 (이미 base64이거나 비어 있으면 그대로 반환)
 */
async function restoreImageField(
  rawValue: string | undefined
): Promise<string | undefined> {
  if (!rawValue) return rawValue;
  if (rawValue.startsWith('data:')) return rawValue; // 이미 base64
  const restored = await loadImage(rawValue);
  return restored ?? rawValue;
}

/**
 * 세션 객체의 부가 영역(generationHistory, chatData.messages.images,
 * conceptData.history, conceptData.referenceImage)에 들어 있는 base64 이미지를
 * IndexedDB로 옮기고, 객체에는 키만 남긴다. settings.json 직렬화 비용을 크게 줄인다.
 */
async function migrateSessionExtras(session: Session): Promise<Session> {
  const sessionId = session.id;

  // 1) generationHistory[].imageBase64
  let nextGenerationHistory = session.generationHistory;
  if (nextGenerationHistory && nextGenerationHistory.length > 0) {
    nextGenerationHistory = await Promise.all(
      nextGenerationHistory.map(async (entry) => {
        const next = await persistImageField(
          entry.imageBase64,
          `${sessionId}-gen-${entry.id}`
        );
        return next === entry.imageBase64 ? entry : { ...entry, imageBase64: next ?? '' };
      })
    );
  }

  // 2) chatData.messages[].images[] + imageSignatures[] (thought_signature 대용량 문자열)
  let nextChatData = session.chatData;
  if (nextChatData && nextChatData.messages.length > 0) {
    const newMessages = await Promise.all(
      nextChatData.messages.map(async (msg) => {
        let nextMsg = msg;

        if (msg.images && msg.images.length > 0) {
          const newImages = await Promise.all(
            msg.images.map(async (img, idx) => {
              const key = `${sessionId}-chat-${msg.id}-${idx}`;
              return (await persistImageField(img, key)) ?? img;
            })
          );
          const imagesChanged = newImages.some((v, i) => v !== msg.images![i]);
          if (imagesChanged) nextMsg = { ...nextMsg, images: newImages };
        }

        if (msg.imageSignatures && msg.imageSignatures.length > 0) {
          const newSigs = await Promise.all(
            msg.imageSignatures.map(async (sig, idx) => {
              const sigKey = `${sessionId}${CHAT_SIGNATURE_KEY_MARKER}${msg.id}-${idx}`;
              return (await persistOpaqueBlobField(sig, sigKey)) ?? sig;
            })
          );
          const sigsChanged = newSigs.some((v, i) => v !== msg.imageSignatures![i]);
          if (sigsChanged) nextMsg = { ...nextMsg, imageSignatures: newSigs };
        }

        return nextMsg !== msg ? nextMsg : msg;
      })
    );
    const messagesChanged = newMessages.some((m, i) => m !== nextChatData!.messages[i]);
    if (messagesChanged) {
      nextChatData = { ...nextChatData, messages: newMessages };
    }
  }

  // 3) conceptData.history[].imageBase64 + conceptData.referenceImage
  let nextConceptData = session.conceptData;
  if (nextConceptData) {
    let conceptChanged = false;
    let history = nextConceptData.history;
    let referenceImage = nextConceptData.referenceImage;

    if (history && history.length > 0) {
      const newHistory = await Promise.all(
        history.map(async (entry) => {
          const next = await persistImageField(
            entry.imageBase64,
            `${sessionId}-concept-${entry.id}`
          );
          return next === entry.imageBase64 ? entry : { ...entry, imageBase64: next ?? '' };
        })
      );
      if (newHistory.some((e, i) => e !== history[i])) {
        history = newHistory;
        conceptChanged = true;
      }
    }

    if (referenceImage) {
      const next = await persistImageField(referenceImage, `${sessionId}-conceptref`);
      if (next !== referenceImage) {
        referenceImage = next;
        conceptChanged = true;
      }
    }

    if (conceptChanged) {
      nextConceptData = { ...nextConceptData, history, referenceImage };
    }
  }

  // 4) illustrationData.characters[].images + illustrationData.backgroundImages
  let nextIllustrationData = session.illustrationData;
  if (nextIllustrationData) {
    let illChanged = false;

    const nextCharacters = await Promise.all(
      nextIllustrationData.characters.map(async (character) => {
        if (!character.images || character.images.length === 0) return character;

        const migratedImages = await Promise.all(
          character.images.map(async (img, idx) => {
            const key = `${sessionId}-illuchar-${character.id}-${idx}`;
            return (await persistImageField(img, key)) ?? img;
          })
        );

        const changed = migratedImages.some((v, i) => v !== character.images[i]);
        if (!changed) return character;

        illChanged = true;
        return {
          ...character,
          images: migratedImages,
        };
      })
    );

    const bgImages = nextIllustrationData.backgroundImages || [];
    const migratedBgImages = await Promise.all(
      bgImages.map(async (img, idx) => {
        const key = `${sessionId}-illubg-${idx}`;
        return (await persistImageField(img, key)) ?? img;
      })
    );
    const bgChanged = migratedBgImages.some((v, i) => v !== bgImages[i]);
    if (bgChanged) {
      illChanged = true;
    }

    if (illChanged) {
      nextIllustrationData = {
        ...nextIllustrationData,
        characters: nextCharacters,
        backgroundImages: migratedBgImages,
      };
    }
  }

  if (
    nextGenerationHistory === session.generationHistory &&
    nextChatData === session.chatData &&
    nextConceptData === session.conceptData &&
    nextIllustrationData === session.illustrationData
  ) {
    return session;
  }

  return {
    ...session,
    generationHistory: nextGenerationHistory,
    chatData: nextChatData,
    conceptData: nextConceptData,
    illustrationData: nextIllustrationData,
  };
}

/**
 * 세션 객체의 부가 영역에 저장된 IndexedDB 키를 base64로 복원한다.
 * 디스크에서 메모리로 끌어올릴 때 사용.
 */
async function restoreSessionExtras(session: Session): Promise<Session> {
  // generationHistory
  let nextGenerationHistory = session.generationHistory;
  if (nextGenerationHistory && nextGenerationHistory.length > 0) {
    nextGenerationHistory = await Promise.all(
      nextGenerationHistory.map(async (entry) => {
        const restored = await restoreImageField(entry.imageBase64);
        return restored === entry.imageBase64 ? entry : { ...entry, imageBase64: restored ?? '' };
      })
    );
  }

  // chatData (이미지 + thought_signature 블롭)
  let nextChatData = session.chatData;
  if (nextChatData && nextChatData.messages.length > 0) {
    const newMessages = await Promise.all(
      nextChatData.messages.map(async (msg) => {
        let nextMsg = msg;

        if (msg.images && msg.images.length > 0) {
          const newImages = await Promise.all(msg.images.map((img) => restoreImageField(img)));
          const finalImages = newImages.map((v, i) => v ?? msg.images![i]);
          const imgChanged = finalImages.some((v, i) => v !== msg.images![i]);
          if (imgChanged) nextMsg = { ...nextMsg, images: finalImages };
        }

        if (msg.imageSignatures && msg.imageSignatures.length > 0) {
          const newSigs = await Promise.all(
            msg.imageSignatures.map((sig) => restoreOpaqueBlobField(sig))
          );
          const finalSigs = newSigs.map((v, i) => v ?? msg.imageSignatures![i]);
          const sigChanged = finalSigs.some((v, i) => v !== msg.imageSignatures![i]);
          if (sigChanged) nextMsg = { ...nextMsg, imageSignatures: finalSigs };
        }

        return nextMsg !== msg ? nextMsg : msg;
      })
    );
    if (newMessages.some((m, i) => m !== nextChatData!.messages[i])) {
      nextChatData = { ...nextChatData, messages: newMessages };
    }
  }

  // conceptData
  let nextConceptData = session.conceptData;
  if (nextConceptData) {
    let conceptChanged = false;
    let history = nextConceptData.history;
    let referenceImage = nextConceptData.referenceImage;

    if (history && history.length > 0) {
      const newHistory = await Promise.all(
        history.map(async (entry) => {
          const restored = await restoreImageField(entry.imageBase64);
          return restored === entry.imageBase64 ? entry : { ...entry, imageBase64: restored ?? '' };
        })
      );
      if (newHistory.some((e, i) => e !== history[i])) {
        history = newHistory;
        conceptChanged = true;
      }
    }

    if (referenceImage) {
      const restored = await restoreImageField(referenceImage);
      if (restored !== referenceImage) {
        referenceImage = restored;
        conceptChanged = true;
      }
    }

    if (conceptChanged) {
      nextConceptData = { ...nextConceptData, history, referenceImage };
    }
  }

  // illustrationData (export 시에는 키를 base64로 복원)
  let nextIllustrationData = session.illustrationData;
  if (nextIllustrationData) {
    let illChanged = false;

    const nextCharacters = await Promise.all(
      nextIllustrationData.characters.map(async (character) => {
        if (!character.images || character.images.length === 0) return character;

        const restoredImages = await Promise.all(
          character.images.map((img) => restoreImageField(img))
        );
        const finalImages = restoredImages.map((v, i) => v ?? character.images[i]);
        const changed = finalImages.some((v, i) => v !== character.images[i]);
        if (!changed) return character;

        illChanged = true;
        return {
          ...character,
          images: finalImages,
        };
      })
    );

    const bgImages = nextIllustrationData.backgroundImages || [];
    const restoredBgImages = await Promise.all(
      bgImages.map((img) => restoreImageField(img))
    );
    const finalBgImages = restoredBgImages.map((v, i) => v ?? bgImages[i]);
    const bgChanged = finalBgImages.some((v, i) => v !== bgImages[i]);
    if (bgChanged) {
      illChanged = true;
    }

    if (illChanged) {
      nextIllustrationData = {
        ...nextIllustrationData,
        characters: nextCharacters,
        backgroundImages: finalBgImages,
      };
    }
  }

  if (
    nextGenerationHistory === session.generationHistory &&
    nextChatData === session.chatData &&
    nextConceptData === session.conceptData &&
    nextIllustrationData === session.illustrationData
  ) {
    return session;
  }

  return {
    ...session,
    generationHistory: nextGenerationHistory,
    chatData: nextChatData,
    conceptData: nextConceptData,
    illustrationData: nextIllustrationData,
  };
}

/**
 * 세션에 포함된 모든 이미지/블롭 키를 수집한다.
 * (레거시 IndexedDB -> 파일 저장소 승격 대상으로 사용)
 */
function collectSessionStorageKeys(session: Session): string[] {
  const keys = new Set<string>();
  const pushIfKey = (value: string | undefined) => {
    if (!value) return;
    if (value.startsWith('data:')) return;
    keys.add(value);
  };

  for (const ref of session.referenceImages || []) pushIfKey(ref);
  for (const key of session.imageKeys || []) pushIfKey(key);

  for (const entry of session.generationHistory || []) pushIfKey(entry.imageBase64);

  for (const msg of session.chatData?.messages || []) {
    for (const img of msg.images || []) pushIfKey(img);
    for (const sig of msg.imageSignatures || []) pushIfKey(sig);
  }

  for (const concept of session.conceptData?.history || []) pushIfKey(concept.imageBase64);
  pushIfKey(session.conceptData?.referenceImage);

  for (const character of session.illustrationData?.characters || []) {
    for (const img of character.images || []) pushIfKey(img);
  }
  for (const bg of session.illustrationData?.backgroundImages || []) pushIfKey(bg);

  return Array.from(keys);
}

/**
 * 세션 저장 (Base64 이미지를 IndexedDB로 마이그레이션)
 */
async function migrateSessionsForStorage(sessions: Session[]): Promise<Session[]> {
  return Promise.all(
    sessions.map(async (session) => {
      // 이미 imageKeys가 있거나, referenceImages가 모두 키 형식이면 마이그레이션 불필요
      const hasImageKeys = session.imageKeys && session.imageKeys.length > 0;
      const allAreKeys = session.referenceImages.every(isImageKey);

      let baseSession: Session;
      if (hasImageKeys || allAreKeys) {
        // imageKeys가 있는데 referenceImages가 비어 있으면,
        // 이전 로드 실패로 빈 배열이 저장되는 것을 방지하기 위해 키로 복원한다.
        if (hasImageKeys && session.referenceImages.length === 0) {
          baseSession = {
            ...session,
            referenceImages: session.imageKeys ?? [],
          };
        } else {
          baseSession = session;
        }
      } else {
        // Base64 이미지를 IndexedDB로 저장
        logger.debug(
          `  - 세션 "${session.name}": ${session.referenceImages.length}개 참조 이미지 마이그레이션 중...`
        );
        const imageKeys = await Promise.all(
          session.referenceImages.map((dataUrl, index) => saveImage(session.id, index, dataUrl))
        );
        baseSession = {
          ...session,
          imageKeys,
          referenceImages: imageKeys,
        };
      }

      // 부가 영역(generationHistory/chatData/conceptData/illustrationData)의 대용량 데이터도
      // IndexedDB로 옮겨 settings.json 본체 크기를 압축한다.
      return migrateSessionExtras(baseSession);
    })
  );
}

export async function saveSessions(sessions: Session[]): Promise<void> {
  try {
    const migratedSessions = await migrateSessionsForStorage(sessions);

    await pruneSessionFolderMapToSessions(migratedSessions.map((s) => s.id));

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
 * 기존 settings.json의 레거시 세션 데이터를 즉시 백필 마이그레이션한다.
 * 앱 시작 시 1회 실행하여, 아직 저장되지 않은 과거 세션의 대용량 문자열을 정리한다.
 */
export async function backfillStoredSessionsIfNeeded(): Promise<boolean> {
  try {
    const store = await getStore();
    const sessions = (await store.get<Session[]>('sessions')) ?? [];
    if (sessions.length === 0) return false;

    const migrated = await migrateSessionsForStorage(sessions);
    const before = JSON.stringify(sessions);
    const after = JSON.stringify(migrated);
    const changed = before !== after;

    if (!changed) return false;

    await pruneSessionFolderMapToSessions(migrated.map((s) => s.id));
    await store.set('sessions', migrated);
    await store.save();
    logger.info('🧹 레거시 세션 백필 마이그레이션 완료:', migrated.length, '개');
    return true;
  } catch (error) {
    logger.error('❌ 레거시 세션 백필 마이그레이션 실패:', error);
    return false;
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

    // 레거시 블롭 승격: 현재 환경에서 접근 가능한 IndexedDB가 있다면
    // 키를 읽는 과정에서 AppData 파일 저장소로 자동 승격시킨다.
    // (dev/prod 교차 사용을 위해 공유 저장소에 가능한 한 미리 채워둠)
    const promoteKeys = Array.from(
      new Set(sessions.flatMap((session) => collectSessionStorageKeys(session)))
    );
    if (promoteKeys.length > 0) {
      await Promise.all(promoteKeys.map((key) => loadImage(key)));
    }

    // 각 세션의 이미지를 IndexedDB에서 복원
    const referenceRestored = await Promise.all(
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
            // 복원 실패 시에도 키 배열을 유지해 이후 저장 시 데이터가 소거되지 않게 보호
            referenceImages:
              images.length > 0
                ? images
                : (session.referenceImages.length > 0 ? session.referenceImages : session.imageKeys),
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
            // 복원 실패 시 키 유지 (빈 배열로 덮어써지는 데이터 손실 방지)
            referenceImages: images.length > 0 ? images : session.referenceImages,
            imageKeys: session.referenceImages, // 키 정보 보존
          };
        }

        // 레거시 Base64 형식 (마이그레이션 필요)
        logger.debug(`  - 세션 "${session.name}": 레거시 Base64 형식 (마이그레이션 필요)`);
        return session;
      })
    );

    // 부가 영역(generationHistory/chatData/conceptData)은 lazy 디코딩 — 키 그대로 메모리에 남겨두고
    // 실제 보이는 시점에 LazyImage 컴포넌트가 IndexedDB에서 비동기로 base64로 변환한다.
    // 이로써 시작 시 모든 세션의 모든 이미지를 한 번에 디코딩하지 않아 앱 시작이 빨라진다.
    const restoredSessions = referenceRestored;

    logger.debug('✅ 세션 로드 완료:', restoredSessions.length, '개 (참조 이미지만 즉시 복원, 나머지는 lazy)');
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
      logger.debug(`  - IndexedDB에서 ${session.imageKeys.length}개 참조 이미지 복원 중...`);
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

    // 부가 영역(generationHistory/chatData/conceptData)도 base64로 복원해서 export
    // (런타임은 lazy 키 상태일 수 있으므로 명시적으로 복원)
    exportSession = await restoreSessionExtras(exportSession);

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
      const sessions = Array.isArray(firstData.sessions) ? (firstData.sessions as Session[]) : [];
      const legacyMap =
        firstData.sessionFolderMap && typeof firstData.sessionFolderMap === 'object'
          ? (firstData.sessionFolderMap as Record<string, string | null>)
          : {};
      const rootFolderId: string | null = firstData.folder?.id ?? null;

      // 구버전 폴더 파일 마이그레이션:
      // - sessionFolderMap이 없거나 비어 있으면 session.folderId(있다면)를 우선 사용
      // - 그래도 없으면 폴더 루트로 귀속시켜 "세션이 루트로 튀는" 현상 방지
      const normalizedSessionFolderMap: Record<string, string | null> = { ...legacyMap };
      for (const session of sessions) {
        if (normalizedSessionFolderMap[session.id] !== undefined) continue;
        normalizedSessionFolderMap[session.id] =
          typeof session.folderId === 'string' ? session.folderId : rootFolderId;
      }

      logger.debug('📁 폴더 파일 감지됨');
      return {
        type: 'folder',
        sessions,
        folderData: {
          ...(firstData as FolderExportData),
          sessions,
          sessionFolderMap: normalizedSessionFolderMap,
        },
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
    // 파일 저장 다이얼로그 열기 (파일명 규칙: folder_{폴더명}.json)
    const filePath = await save({
      defaultPath: `folder_${folder.name}.json`,
      filters: [
        {
          name: 'StyleStudio Folder',
          extensions: ['json'],
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

    // IndexedDB에서 참조 이미지 + 부가 영역(히스토리/채팅/컨셉) 모두 복원
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
      exportSession = await restoreSessionExtras(exportSession);
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
