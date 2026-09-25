/**
 * 고아 이미지 정리 판정 self-check (dev 전용).
 *
 * 실행: `npm run dev` 후 http://localhost:1420/dev/image-orphan-check.html
 * 실제 파일은 건드리지 않는다 — 순수 함수(planOrphanImageDeletion·shouldMoveAfterRecheck·planTrashPurge)만 검증.
 */

import {
  ImageFileEntry,
  MIN_ORPHAN_AGE_MS,
  TRASH_RETENTION_MS,
  collectReferencedImageKeys,
  planOrphanImageDeletion,
  planTrashPurge,
  shouldMoveAfterRecheck,
  toTrashFileName,
} from './imageOrphanCleanup';
import { collectSessionStorageKeys } from './storage';
import { Session } from '../types/session';

export interface CheckResult {
  name: string;
  passed: boolean;
  /** 사람이 읽는 근거 */
  detail: string;
}

const NOW = Date.UTC(2026, 8, 24);
const OLD = NOW - MIN_ORPHAN_AGE_MS * 2;

function file(key: string, mtimeMs: number | null = OLD): ImageFileEntry {
  return { name: `${key}.txt`, size: 1024, mtimeMs };
}

/** 픽스처 세션 — 모든 이미지 영역에 키를 하나씩 채운다 */
function session(id: string, extra: Record<string, unknown> = {}): Session {
  return {
    id,
    name: `세션 ${id}`,
    referenceImages: [`${id}-0`],
    imageKeys: [`${id}-0`],
    generationHistory: [{ id: 'g1', imageBase64: `${id}-gen-g1` }],
    chatData: { messages: [{ id: 'm1', images: [`${id}-chat-m1-0`], imageSignatures: [`${id}-chatsig-m1-0`] }] },
    conceptData: { history: [{ id: 'c1', imageBase64: `${id}-concept-c1` }], referenceImage: `${id}-conceptref` },
    illustrationData: { characters: [{ id: 'ch1', images: [`${id}-illuchar-ch1-0`] }], backgroundImages: [`${id}-illubg-0`] },
    ...extra,
  } as unknown as Session;
}

function deleted(plan: ReturnType<typeof planOrphanImageDeletion>): string[] {
  return plan.toDelete.map((f) => f.name.replace(/\.txt$/, '')).sort();
}

function check(name: string, passed: boolean, detail: string): CheckResult {
  return { name, passed, detail };
}

export function runAllImageOrphanChecks(): CheckResult[] {
  const results: CheckResult[] = [];
  const LIVE = '1767056403966';
  const GONE = '1700000000000';
  const liveSession = session(LIVE, {
    tilemapData: {
      sheets: [
        { id: 'sheet-a', imageKey: 'tilemap-sheet-sheet-a' },
        { id: 'sheet-b', imageKey: `${LIVE}-tilemap-sheet-sheet-b` },
      ],
    },
  });

  // 1) 참조 집합 ⊇ collectSessionStorageKeys (깊은 순회가 알려진 필드를 누락하지 않음)
  {
    const known = collectSessionStorageKeys(liveSession);
    const ref = collectReferencedImageKeys([[liveSession]]);
    const missing = known.filter((k) => !ref.has(k));
    results.push(
      check('참조 집합 ⊇ collectSessionStorageKeys', missing.length === 0 && known.length >= 10,
        `known=${known.length} missing=${JSON.stringify(missing)}`)
    );
  }

  // 2) 존재 세션 키 보존
  {
    const keys = [
      `${LIVE}-0`, `${LIVE}-gen-g1`, `${LIVE}-chat-m1-0`, `${LIVE}-chatsig-m1-0`, `${LIVE}-concept-c1`,
      `${LIVE}-conceptref`, `${LIVE}-illuchar-ch1-0`, `${LIVE}-illubg-0`, `${LIVE}-tilemap-sheet-sheet-b`,
      `${LIVE}-gen-unreferenced`,
    ];
    const plan = planOrphanImageDeletion({ files: keys.map((k) => file(k)), sessionLists: [[liveSession]], nowMs: NOW });
    results.push(check('존재 세션 키 보존', plan.toDelete.length === 0 && !plan.skippedReason,
      `삭제=${JSON.stringify(deleted(plan))}`));
  }

  // 3) 삭제된 세션 키 삭제 (모든 알려진 형식)
  {
    const goneKeys = [
      `${GONE}-0`, `${GONE}-gen-x`, `${GONE}-chat-m-0`, `${GONE}-chatsig-m-0`, `${GONE}-concept-x`,
      `${GONE}-conceptref`, `${GONE}-illuchar-c-0`, `${GONE}-illubg-1`, `${GONE}-tilemap-sheet-s`,
    ];
    const plan = planOrphanImageDeletion({
      files: [file(`${LIVE}-0`), ...goneKeys.map((k) => file(k))],
      sessionLists: [[liveSession]],
      nowMs: NOW,
    });
    const got = deleted(plan);
    results.push(check('삭제된 세션 키 삭제', JSON.stringify(got) === JSON.stringify([...goneKeys].sort()),
      `삭제=${got.length}/${goneKeys.length}`));
  }

  // 4) 비접두 타일맵 키: 참조됨 → 보존, 미참조 → 삭제
  {
    const plan = planOrphanImageDeletion({
      files: [file('tilemap-sheet-sheet-a'), file('tilemap-sheet-sheet-orphan')],
      sessionLists: [[liveSession]],
      nowMs: NOW,
    });
    const got = deleted(plan);
    results.push(check('비접두 타일맵 키 (참조 보존 / 미참조 삭제)',
      JSON.stringify(got) === JSON.stringify(['tilemap-sheet-sheet-orphan']), `삭제=${JSON.stringify(got)}`));
  }

  // 5) 알 수 없는 형식 보존
  {
    const unknown = [
      'random-file', 'notes', 'abc-def-ghi', 'foo-1', 'abc-gen-x', `${GONE}-unknownkind-1`, 'uuid-1234-5678-gen-x',
      `${GONE}-0.png`, '.DS_Store', `${GONE}-anim-future-1`, `${GONE}-anim-cell-walk-s-0-1`, `${GONE}-anim-turn-top-r1`,
      `${GONE}-anim-cell-m1-down-up-0-r1`, `${GONE}-anim-guide-walk-top-r1`,
    ];
    const plan = planOrphanImageDeletion({
      files: [file(`${LIVE}-0`), ...unknown.map((k) => (k.includes('.') ? { name: k, size: 1, mtimeMs: OLD } : file(k)))],
      sessionLists: [[liveSession]],
      nowMs: NOW,
    });
    results.push(check('알 수 없는 형식 보존', plan.toDelete.length === 0, `삭제=${JSON.stringify(deleted(plan))}`));
  }

  // 6) 빈 세션 목록 → 아무것도 지우지 않음
  {
    const plan = planOrphanImageDeletion({
      files: [file(`${GONE}-0`), file('tilemap-sheet-x')],
      sessionLists: [[], []],
      nowMs: NOW,
    });
    results.push(check('빈 세션 목록이면 아무것도 지우지 않음', plan.toDelete.length === 0 && !!plan.skippedReason,
      `skipped=${plan.skippedReason}`));
  }

  // 7) 저장본·로드본(복수 세션 목록): 어느 한 목록에만 있는 세션·참조도 보존
  //    dev·prod 동시 실행 보호는 이 합집합이 아니라 24h mtime 조건 + dev dry-run이 담당한다
  {
    const OTHER = '1780000000000';
    const otherSession = session(OTHER, { tilemapData: { sheets: [{ id: 'p', imageKey: 'tilemap-sheet-p' }] } });
    const plan = planOrphanImageDeletion({
      files: [file(`${LIVE}-0`), file(`${OTHER}-gen-g1`), file('tilemap-sheet-p'), file(`${GONE}-0`)],
      sessionLists: [[liveSession], [otherSession]],
      nowMs: NOW,
    });
    const got = deleted(plan);
    results.push(check('저장본·로드본 합집합 보존', JSON.stringify(got) === JSON.stringify([`${GONE}-0`]),
      `삭제=${JSON.stringify(got)}`));
  }

  // 8) 최근 파일·수정 시각 불명 보존
  {
    const plan = planOrphanImageDeletion({
      files: [file(`${LIVE}-0`), file('tilemap-sheet-new', NOW - 60_000), file(`${GONE}-0`, null)],
      sessionLists: [[liveSession]],
      nowMs: NOW,
    });
    results.push(check('최근/시각 불명 파일 보존', plan.toDelete.length === 0, `삭제=${JSON.stringify(deleted(plan))}`));
  }

  // 9) 참조 파일이 디스크에 하나도 없으면 판별 이상으로 보고 전부 보류
  {
    const plan = planOrphanImageDeletion({
      files: [file(`${GONE}-0`), file('tilemap-sheet-x')],
      sessionLists: [[liveSession]],
      nowMs: NOW,
    });
    results.push(check('참조 파일 0개면 전부 보류', plan.toDelete.length === 0 && !!plan.skippedReason,
      `skipped=${plan.skippedReason}`));
  }

  // 10) 키 형식 흔들림(`images/` 접두·`.txt` 접미) 참조도 보존 + 알려진 필드 밖 문자열도 보존
  {
    const s = session(LIVE, {
      imageKeys: ['images/tilemap-sheet-legacy.txt'],
      futureData: { nested: [{ blob: 'tilemap-sheet-future' }] },
    });
    const plan = planOrphanImageDeletion({
      files: [file(`${LIVE}-0`), file('tilemap-sheet-legacy'), file('tilemap-sheet-future')],
      sessionLists: [[s]],
      nowMs: NOW,
    });
    results.push(check('정규화 키·미지 필드 참조 보존', plan.toDelete.length === 0, `삭제=${JSON.stringify(deleted(plan))}`));
  }

  // 11) 휴지통 이동: 이동 시각이 파일명에 들어가고 원래 이름이 보존된다
  {
    const name = toTrashFileName(`${GONE}-0.txt`, NOW);
    const purgeNow = planTrashPurge([name], NOW + TRASH_RETENTION_MS);
    results.push(check('휴지통 파일명 = trashed-이동시각-원래이름', name === `trashed-${NOW}-${GONE}-0.txt` && purgeNow.length === 1,
      `name=${name}`));
  }

  // 12) 이동 직전 mtime 재확인: 계획 후 변경·최근·불명이면 건너뜀, 동일·오래됨이면 이동
  {
    const planned = file(`${GONE}-0`);
    const cases: [string, boolean, boolean][] = [
      ['동일·오래됨', shouldMoveAfterRecheck(planned, OLD, NOW), true],
      ['계획 후 재기록', shouldMoveAfterRecheck(planned, OLD + 1000, NOW), false],
      ['최근 파일', shouldMoveAfterRecheck(file(`${GONE}-1`, NOW - 60_000), NOW - 60_000, NOW), false],
      ['현재 mtime 불명', shouldMoveAfterRecheck(planned, null, NOW), false],
      ['계획 mtime 불명', shouldMoveAfterRecheck(file(`${GONE}-2`, null), OLD, NOW), false],
    ];
    const bad = cases.filter(([, got, want]) => got !== want).map(([label]) => label);
    results.push(check('이동 직전 mtime 재확인', bad.length === 0, `불일치=${JSON.stringify(bad)}`));
  }

  // 13) 휴지통 퍼지: 14일 경과분만 삭제, 미경과·형식 불명·미래 시각은 보존
  {
    const expired = toTrashFileName(`${GONE}-0.txt`, NOW - TRASH_RETENTION_MS);
    const fresh = toTrashFileName(`${GONE}-1.txt`, NOW - TRASH_RETENTION_MS + 60_000);
    const future = toTrashFileName(`${GONE}-2.txt`, NOW + 60_000);
    const got = planTrashPurge([expired, fresh, future, `${GONE}-3.txt`, '.DS_Store', 'abc-x.txt'], NOW);
    results.push(check('휴지통 14일 경과분만 퍼지', JSON.stringify(got) === JSON.stringify([expired]),
      `퍼지=${JSON.stringify(got)}`));
  }

  return results;
}
