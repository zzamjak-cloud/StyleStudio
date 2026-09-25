/**
 * 앱 내부 이미지 저장소(AppData/images)의 고아 파일 정리.
 *
 * 세션을 지워도 이미지 파일은 남는다(즉시 삭제는 폴더 삭제 Ctrl+Z가 세션 객체만 복원하므로 금지).
 * 대신 앱 시작 시, 시작 시점 세션 스냅샷이 참조하지 않는 파일만 보수적으로 `images/.trash/`로 옮기고,
 * 휴지통에서 14일이 지난 파일만 영구 삭제한다(오판정 복구 여지).
 * 사용자에게 보이는 자동 저장 파일(~/Downloads/AI_Gen)은 대상이 아니다.
 *
 * 판정(planOrphanImageDeletion·shouldMoveAfterRecheck·planTrashPurge)은 순수 함수 — dev/image-orphan-check.html 셀프체크가 검증한다.
 * 애매하면 지우지 않는다: 알 수 없는 형식·최근 파일·존재 세션 접두어 파일은 항상 보존.
 */

import { Store } from '@tauri-apps/plugin-store';
import { BaseDirectory, exists, mkdir, readDir, remove, rename, stat } from '@tauri-apps/plugin-fs';
import { Session } from '../types/session';
import { collectSessionStorageKeys } from './storage';
import { IMAGE_FS_DIR, IMAGE_FS_EXT } from './imageStorage';
import { logger } from './logger';

/** 이보다 최근에 수정된 파일은 지우지 않는다 — 파일은 썼지만 세션 저장(디바운스)이 아직인 경우 보호 */
export const MIN_ORPHAN_AGE_MS = 24 * 60 * 60 * 1000;

/** 휴지통(.trash)에 옮긴 뒤 이 기간이 지나야 영구 삭제한다 */
export const TRASH_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

/** 고아 파일을 옮겨 두는 휴지통 디렉토리 (images 하위 — readDir의 isFile 필터로 목록 대상에서 빠진다) */
export const IMAGE_TRASH_DIR = `${IMAGE_FS_DIR}/.trash`;

/**
 * 휴지통 파일명 `trashed-{이동시각 ms 13자리}-{원래 파일명}` — rename은 mtime을 유지하므로 이동 시각을 이름에 남긴다.
 * 접두어가 없으면 원래 키의 세션 ID(13자리 시각)가 이동 시각으로 오인된다.
 */
const TRASH_FILE_NAME = /^trashed-(\d{13})-(.+)$/;

/** 앱 시작 직후 UI를 막지 않도록 정리를 미루는 시간 */
const CLEANUP_DELAY_MS = 20_000;

/**
 * 세션 접두어 키의 알려진 접미 형식(`{sessionId}-{suffix}`).
 * 세션 ID는 `Date.now()` 13자리 숫자(+선택적 base36 꼬리)라 하이픈이 없다 — 이 형식이 아닌
 * 접두어(UUID 등)의 파일은 해석 불가로 분류되어 보존된다(안전한 쪽).
 */
const SESSION_PREFIXED_KEY = new RegExp(
  '^(\\d{13}[0-9a-z]*)-(\\d+|gen-.+|chat-.+|chatsig-.+|concept-.+|conceptref|illuchar-.+|illubg-\\d+|tilemap-sheet-.+)$'
);

/** 세션 접두어가 없는 키 — 참조로만 소속을 알 수 있다 */
const UNPREFIXED_TILEMAP_KEY = /^tilemap-sheet-.+$/;

export interface ImageFileEntry {
  /** 디렉토리 내 파일명 (`{key}.txt`) */
  name: string;
  size: number | null;
  /** 수정 시각. 알 수 없으면 null → 보존 */
  mtimeMs: number | null;
}

export type OrphanReason =
  | 'referenced'
  | 'live-session'
  | 'unknown-format'
  | 'too-recent'
  | 'unreferenced-tilemap-sheet'
  | 'deleted-session';

export interface OrphanDecision {
  entry: ImageFileEntry;
  key: string | null;
  remove: boolean;
  reason: OrphanReason;
}

export interface OrphanPlan {
  /** 정리를 통째로 건너뛴 이유 (있으면 toDelete는 비어 있다) */
  skippedReason: string | null;
  toDelete: ImageFileEntry[];
  decisions: OrphanDecision[];
}

/** imageStorage.normalizeImageKey 와 같은 규칙 — `images/` 접두·`.txt` 접미 흔들림 흡수 */
function normalizeKey(raw: string): string {
  let key = raw.trim();
  if (key.startsWith(`${IMAGE_FS_DIR}/`)) key = key.slice(IMAGE_FS_DIR.length + 1);
  if (key.endsWith(IMAGE_FS_EXT)) key = key.slice(0, -IMAGE_FS_EXT.length);
  return key;
}

function isSessionLike(value: unknown): value is Session {
  return !!value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string';
}

/** 세션 목록들에 있는 모든 세션 ID */
export function collectSessionIds(sessionLists: readonly unknown[][]): Set<string> {
  const ids = new Set<string>();
  for (const list of sessionLists) {
    for (const session of list) {
      if (isSessionLike(session) && session.id) ids.add(session.id);
    }
  }
  return ids;
}

/**
 * 참조 집합: collectSessionStorageKeys(알려진 필드) ∪ 세션 객체 안의 모든 문자열(깊은 순회).
 * 깊은 순회는 collectSessionStorageKeys가 모르는 필드(새 세션 타입·새 이미지 영역)까지 보호하기 위한 안전망.
 */
export function collectReferencedImageKeys(sessionLists: readonly unknown[][]): Set<string> {
  const keys = new Set<string>();
  const add = (value: string) => {
    if (value.startsWith('data:')) return;
    const key = normalizeKey(value);
    if (key) keys.add(key);
  };

  const walk = (value: unknown, seen: Set<object>) => {
    if (typeof value === 'string') {
      add(value);
      return;
    }
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    for (const child of Array.isArray(value) ? value : Object.values(value)) walk(child, seen);
  };

  for (const list of sessionLists) {
    for (const session of list) {
      if (isSessionLike(session)) {
        try {
          for (const key of collectSessionStorageKeys(session)) add(key);
        } catch {
          // 손상된 세션 형식 — 깊은 순회가 대신 보호한다
        }
      }
      walk(session, new Set());
    }
  }
  return keys;
}

/**
 * 삭제 대상 판정 (순수 함수).
 * 삭제 조건(AND): 참조 집합에 없음 · 존재 세션 접두어 아님 · 충분히 오래됨 ·
 * (비접두 타일맵 키이거나, 알려진 형식의 접두어 키인데 그 세션이 없음).
 */
export function planOrphanImageDeletion(input: {
  files: readonly ImageFileEntry[];
  sessionLists: readonly unknown[][];
  nowMs: number;
  minAgeMs?: number;
}): OrphanPlan {
  const { files, sessionLists, nowMs, minAgeMs = MIN_ORPHAN_AGE_MS } = input;
  const sessionIds = collectSessionIds(sessionLists);
  if (sessionIds.size === 0) {
    return { skippedReason: '세션 목록이 비어 있음', toDelete: [], decisions: [] };
  }
  const referenced = collectReferencedImageKeys(sessionLists);
  const liveIds = Array.from(sessionIds);

  const decisions: OrphanDecision[] = files.map((entry) => {
    const keep = (reason: OrphanReason, key: string | null = null): OrphanDecision => ({
      entry,
      key,
      remove: false,
      reason,
    });
    if (!entry.name.endsWith(IMAGE_FS_EXT)) return keep('unknown-format');
    const key = entry.name.slice(0, -IMAGE_FS_EXT.length);
    if (!key) return keep('unknown-format');
    if (referenced.has(key)) return keep('referenced', key);
    if (liveIds.some((id) => key === id || key.startsWith(`${id}-`))) return keep('live-session', key);

    let reason: OrphanReason | null = null;
    if (UNPREFIXED_TILEMAP_KEY.test(key)) reason = 'unreferenced-tilemap-sheet';
    else if (SESSION_PREFIXED_KEY.test(key)) reason = 'deleted-session';
    if (!reason) return keep('unknown-format', key);

    if (entry.mtimeMs === null || nowMs - entry.mtimeMs < minAgeMs) return keep('too-recent', key);
    return { entry, key, remove: true, reason };
  });

  // 참조되는 파일이 디스크에 하나도 없는데 삭제 후보만 있다면 판별 자체가 어긋난 것 — 전부 보류
  const anyKeptByReference = decisions.some(
    (d) => d.reason === 'referenced' || d.reason === 'live-session'
  );
  if (!anyKeptByReference && decisions.some((d) => d.remove)) {
    return {
      skippedReason: '참조 파일이 하나도 발견되지 않음 (판별 이상 의심)',
      toDelete: [],
      decisions,
    };
  }

  return {
    skippedReason: null,
    toDelete: decisions.filter((d) => d.remove).map((d) => d.entry),
    decisions,
  };
}

/** 휴지통 파일명 생성 */
export function toTrashFileName(name: string, movedAtMs: number): string {
  return `trashed-${String(Math.floor(movedAtMs)).padStart(13, '0')}-${name}`;
}

/**
 * 이동 직전 재확인 (순수 함수, TOCTOU 방지).
 * 계획 시점 이후 파일이 다시 쓰였거나(mtime 변경) 최근 파일이면 옮기지 않는다.
 */
export function shouldMoveAfterRecheck(
  planned: ImageFileEntry,
  currentMtimeMs: number | null,
  nowMs: number,
  minAgeMs: number = MIN_ORPHAN_AGE_MS
): boolean {
  if (planned.mtimeMs === null || currentMtimeMs === null) return false;
  if (currentMtimeMs !== planned.mtimeMs) return false;
  return nowMs - currentMtimeMs >= minAgeMs;
}

/**
 * 휴지통 영구 삭제 대상 판정 (순수 함수).
 * 파일명의 이동 시각 기준으로 보관 기간이 지난 것만 — 형식이 다르거나 미래 시각이면 보존.
 */
export function planTrashPurge(
  names: readonly string[],
  nowMs: number,
  retentionMs: number = TRASH_RETENTION_MS
): string[] {
  return names.filter((name) => {
    const match = TRASH_FILE_NAME.exec(name);
    if (!match) return false;
    const movedAtMs = Number(match[1]);
    return movedAtMs <= nowMs && nowMs - movedAtMs >= retentionMs;
  });
}

async function listImageFiles(): Promise<ImageFileEntry[]> {
  if (!(await exists(IMAGE_FS_DIR, { baseDir: BaseDirectory.AppData }))) return [];
  const entries = await readDir(IMAGE_FS_DIR, { baseDir: BaseDirectory.AppData });
  const files: ImageFileEntry[] = [];
  for (const entry of entries) {
    if (!entry.isFile || !entry.name) continue;
    try {
      const info = await stat(`${IMAGE_FS_DIR}/${entry.name}`, { baseDir: BaseDirectory.AppData });
      files.push({ name: entry.name, size: info.size, mtimeMs: info.mtime ? info.mtime.getTime() : null });
    } catch {
      // 수정 시각을 모르면 보존
      files.push({ name: entry.name, size: null, mtimeMs: null });
    }
  }
  return files;
}

/** 휴지통에서 보관 기간이 지난 파일만 영구 삭제 */
async function purgeExpiredTrash(): Promise<void> {
  if (!(await exists(IMAGE_TRASH_DIR, { baseDir: BaseDirectory.AppData }))) return;
  const entries = await readDir(IMAGE_TRASH_DIR, { baseDir: BaseDirectory.AppData });
  const names = entries.filter((e) => e.isFile && e.name).map((e) => e.name);
  let purged = 0;
  for (const name of planTrashPurge(names, Date.now())) {
    try {
      await remove(`${IMAGE_TRASH_DIR}/${name}`, { baseDir: BaseDirectory.AppData });
      purged += 1;
    } catch (error) {
      logger.debug('🧹 휴지통 영구 삭제 실패(무시):', name, error);
    }
  }
  if (purged > 0) logger.info(`🧹 휴지통 정리: ${TRASH_RETENTION_MS / 86_400_000}일 경과 ${purged}개 영구 삭제`);
}

/**
 * 앱 시작 직후 호출. 지금 시점의 세션 스냅샷(저장본 + 로드본)을 잡아 두고, 지연 후 백그라운드에서 정리한다.
 * 스냅샷을 먼저 잡는 이유: 지연 중 사용자가 폴더를 지우면 그 세션들은 Ctrl+Z 백업(메모리)에만 남는데,
 * 지연 후 목록을 다시 읽으면 그 이미지까지 지우게 된다.
 * dev 빌드는 dry-run(판정만 로그) — dev·prod가 같은 AppData를 공유해 동시 실행 시 서로의 메모리 상태를 모른다.
 * (VITE_ORPHAN_CLEANUP_LIVE=1 이면 dev에서도 실제로 옮긴다)
 */
export function scheduleOrphanImageCleanup(loadedSessions: readonly Session[]): void {
  if (loadedSessions.length === 0) {
    logger.debug('🧹 고아 이미지 정리 건너뜀: 로드된 세션 없음');
    return;
  }

  void (async () => {
    try {
      const store = await Store.load('settings.json');
      const stored = await store.get<unknown>('sessions');
      if (!Array.isArray(stored) || stored.length === 0) {
        logger.debug('🧹 고아 이미지 정리 건너뜀: 저장된 세션 없음');
        return;
      }
      // 저장본과 로드본의 세션 구성이 다르면(저장 진행 중·로드 이상) 판정하지 않는다
      const storedIds = collectSessionIds([stored]);
      const loadedIds = collectSessionIds([loadedSessions as unknown[]]);
      if (storedIds.size !== loadedIds.size || [...loadedIds].some((id) => !storedIds.has(id))) {
        logger.debug('🧹 고아 이미지 정리 건너뜀: 저장본·로드본 세션 불일치');
        return;
      }
      const sessionLists: unknown[][] = [stored, loadedSessions as unknown[]];

      await new Promise((resolve) => setTimeout(resolve, CLEANUP_DELAY_MS));

      const files = await listImageFiles();
      const plan = planOrphanImageDeletion({ files, sessionLists, nowMs: Date.now() });
      if (plan.skippedReason) {
        logger.debug(`🧹 고아 이미지 정리 건너뜀: ${plan.skippedReason}`);
        return;
      }
      const plannedBytes = plan.toDelete.reduce((sum, f) => sum + (f.size ?? 0), 0);
      // VITE_ORPHAN_CLEANUP_LIVE=1 이면 dev에서도 실제 이동·퍼지 — prod 첫 실행 전 검증용
      const live = !import.meta.env.DEV || import.meta.env.VITE_ORPHAN_CLEANUP_LIVE === '1';
      if (!live) {
        logger.debug(
          `🧹 [dry-run] 고아 이미지 ${plan.toDelete.length}/${files.length}개 휴지통 이동 대상 ` +
            `(${(plannedBytes / 1024 / 1024).toFixed(2)} MB) — dev 빌드는 옮기지 않음`,
          plan.toDelete.map((f) => f.name)
        );
        return;
      }

      await purgeExpiredTrash();

      if (plan.toDelete.length === 0) return;
      await mkdir(IMAGE_TRASH_DIR, { baseDir: BaseDirectory.AppData, recursive: true });
      let moved = 0;
      let movedBytes = 0;
      for (const file of plan.toDelete) {
        const path = `${IMAGE_FS_DIR}/${file.name}`;
        try {
          const info = await stat(path, { baseDir: BaseDirectory.AppData });
          const nowMs = Date.now();
          if (!shouldMoveAfterRecheck(file, info.mtime ? info.mtime.getTime() : null, nowMs)) {
            logger.debug('🧹 고아 이미지 이동 건너뜀(계획 후 변경·최근 파일):', file.name);
            continue;
          }
          await rename(path, `${IMAGE_TRASH_DIR}/${toTrashFileName(file.name, nowMs)}`, {
            oldPathBaseDir: BaseDirectory.AppData,
            newPathBaseDir: BaseDirectory.AppData,
          });
          moved += 1;
          movedBytes += info.size ?? file.size ?? 0;
        } catch (error) {
          logger.debug('🧹 고아 이미지 이동 실패(무시):', file.name, error);
        }
      }
      logger.info(
        `🧹 고아 이미지 정리: ${moved}/${plan.toDelete.length}개 휴지통 이동 ` +
          `(${(movedBytes / 1024 / 1024).toFixed(2)} MB, ${TRASH_RETENTION_MS / 86_400_000}일 후 영구 삭제)`
      );
    } catch (error) {
      logger.debug('🧹 고아 이미지 정리 실패(무시):', error);
    }
  })();
}
