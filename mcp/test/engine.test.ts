/**
 * 실행 엔진 테스트 — 이미지 API 를 부르지 않는 직접 실행 단위(run)로 상태 전이를 확인한다.
 * 가짜 키를 둔 임시 앱 데이터 폴더를 쓴다 (실제 API 호출 없음 — 취소된 generate 는 fetch 전에 멈춘다).
 */
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CancelledError, startJob, type WorkUnit } from '../src/engine';
import { resolveModel } from '../src/common';
import { writeUnique } from '../src/env';

const dataDir = mkdtempSync(join(tmpdir(), 'ss-eng-data-'));
writeFileSync(join(dataDir, 'settings.json'), JSON.stringify({ openrouter_api_key: 'sk-test-not-real' }));
const { model } = resolveModel(undefined);

function unit(label: string, run: WorkUnit['run']): WorkUnit {
  return {
    label,
    grid: '1x1',
    images: 2,
    requests: 2,
    expectedFiles: 2,
    call: { aspectRatio: '1:1', n: 1, references: [] },
    texts: [],
    rawDir: mkdtempSync(join(tmpdir(), 'ss-eng-out-')),
    run,
  };
}

const start = (units: WorkUnit[]) =>
  startJob(dataDir, {
    kind: 'TEST',
    model,
    units,
    destDir: mkdtempSync(join(tmpdir(), 'ss-eng-dest-')),
    concurrency: 2,
    translate: false,
    meta: {},
  });

describe('실행 엔진', () => {
  test('단위가 중간에 실패해도 앞에서 저장한 파일은 결과·매니페스트에 남는다', async () => {
    const job = start([
      unit('chain', async (ctx) => {
        const dir = mkdtempSync(join(tmpdir(), 'ss-eng-step-'));
        await ctx.saveSafely(new Uint8Array([1]), () => [writeUnique(dir, 'step01', 'png', new Uint8Array([1]))], dir, 'step01');
        throw new Error('3단계에서 실패');
      }),
    ]);
    await job.done;
    expect(job.status).toBe('failed');
    expect(job.files.length).toBe(1);
    expect(job.requests[0].files.length).toBe(1);
    expect(job.requests[0].error).toContain('앞 단계 파일 1개 보존');
    expect(existsSync(job.manifestPath)).toBe(true);
  });

  test('취소되면 다음 generate 는 API 를 부르기 전에 멈추고 단위는 skipped', async () => {
    let calledAfterCancel = false;
    const job = start([
      unit('chain', async (ctx) => {
        await Promise.resolve(); // startJob 이 반환돼 job 이 대입된 뒤에 진행
        job.cancelRequested = true; // 1단계가 끝난 뒤 취소가 들어온 상황
        try {
          await ctx.generate('2단계', { aspectRatio: '1:1', n: 1, references: [] });
          calledAfterCancel = true;
        } catch (error) {
          expect(error).toBeInstanceOf(CancelledError);
          throw error;
        }
      }),
    ]);
    await job.done;
    expect(calledAfterCancel).toBe(false);
    expect(job.requests[0].status).toBe('skipped');
    expect(job.status).toBe('cancelled');
  });

  test('이미지 API 가 아닌 오류의 "(401)" 은 작업 중단 사유가 되지 않는다', async () => {
    const job = start([
      unit('doc', async () => {
        throw new Error('문서 다운로드 실패 (401): https://example.com/private');
      }),
      unit('next', async () => undefined),
    ]);
    await job.done;
    expect(job.abortReason).toBeUndefined();
    expect(job.requests[0].error).toContain('문서 다운로드 실패 (401)');
    expect(job.requests[1].status).toBe('done');
  });
});
