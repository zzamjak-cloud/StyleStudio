import { Session, SessionType } from '../types/session';
import { ImageAnalysisResult } from '../types/analysis';
import { saveSessions } from '../lib/storage';
import { logger } from '../lib/logger';

/**
 * 세션 생성 헬퍼 함수
 */
export function createNewSession(
  analysis: ImageAnalysisResult,
  referenceImages: string[],
  sessionType: SessionType = 'STYLE'
): Session {
  return {
    id: Date.now().toString(),
    name: `세션 ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`,
    type: sessionType,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    referenceImages,
    analysis,
    imageCount: referenceImages.length,
  };
}

/**
 * 세션 업데이트 헬퍼 함수
 */
export function updateSession(
  session: Session,
  updates: Partial<Session>
): Session {
  return {
    ...session,
    ...updates,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * 세션 목록에서 세션 업데이트
 */
export function updateSessionInList(
  sessions: Session[],
  sessionId: string,
  updatedSession: Session
): Session[] {
  return sessions.map((s) => (s.id === sessionId ? updatedSession : s));
}

/**
 * 세션 목록에 세션 추가
 */
export function addSessionToList(sessions: Session[], newSession: Session): Session[] {
  return [...sessions, newSession];
}

/**
 * 세션 목록에서 세션 삭제
 */
export function removeSessionFromList(sessions: Session[], sessionId: string): Session[] {
  return sessions.filter((s) => s.id !== sessionId);
}

/**
 * 세션 저장 (debounce + 백그라운드 직렬화)
 *
 * 호출은 즉시 resolve되며, 실제 디스크 쓰기는 마지막 호출 후 SAVE_DEBOUNCE_MS 뒤에
 * 한 번만 실행된다. 짧은 시간에 다수의 세션 변경(히스토리 추가/문서 추가/순서 변경 등)이
 * 몰릴 때 거대한 settings.json 직렬화가 매번 발생하는 것을 막아 클릭 반응성을 보장한다.
 *
 * 즉시 저장이 필요한 시점(앱 종료, 페이지 언로드 등)에는 flushPendingSessions()를 호출.
 */
const SAVE_DEBOUNCE_MS = 500;
let pendingSessions: Session[] | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let saveChain: Promise<void> = Promise.resolve();

function schedulePersist(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
  }
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (!pendingSessions) return;
    const toSave = pendingSessions;
    pendingSessions = null;
    saveChain = saveChain
      .then(() => saveSessions(toSave))
      .catch((err) => {
        logger.error('❌ 지연 세션 저장 실패:', err);
      });
  }, SAVE_DEBOUNCE_MS);
}

export function persistSessions(sessions: Session[]): Promise<void> {
  pendingSessions = sessions;
  schedulePersist();
  return Promise.resolve();
}

/**
 * 대기 중인 세션 저장을 즉시 실행한다.
 * 앱 종료/페이지 언로드/명시적 동기화에서 사용.
 */
export async function flushPendingSessions(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (pendingSessions) {
    const toSave = pendingSessions;
    pendingSessions = null;
    saveChain = saveChain.then(() => saveSessions(toSave));
  }
  await saveChain;
}

