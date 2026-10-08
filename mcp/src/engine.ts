/**
 * 작업 실행 엔진 — 모든 세션 도구가 공유한다.
 *
 * 도구는 "작업 단위(WorkUnit)" 목록만 만든다. 엔진이 번역(배치당 1회) → 동시 실행 풀 →
 * 재시도·타임아웃 → 비용 기록 → 후처리 저장 → 매니페스트를 처리한다.
 *
 * - 기본 단위: 이미지 API 1회 호출 후 `save` 로 저장 (생성기·컨셉·일러스트·타일맵 시트)
 * - 직접 실행 단위(`run`): 단위 안에서 여러 번 순차 호출 (편집 체인 — 직전 결과를 다음 참조로)
 *
 * 장시간 작업은 MCP 클라이언트 타임아웃(Codex 기본 60초)에 걸리므로 백그라운드로 돌리고
 * `ss_job_status` 로 조회하게 한다. → wiki/infra/mcp.md
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import type { PixelArtGridLayout } from '../../src/types/pixelart';
import type { ImageModelDefinition } from '../../src/hooks/api/imageModels';
import { generateImagesViaOpenRouter } from '../../src/lib/api/openrouter';
import { formatImageApiError } from '../../src/hooks/api/useImageGenerator';
import { useGeminiTranslator } from '../../src/hooks/api/useGeminiTranslator';

import { getApiKey } from './env';
import { saveRaw } from './output';
import { averageCostPerImage, costKey, extractCost, recordCost } from './costlog';

export type Translate = (text: string | undefined) => string | undefined;

/** 이미지 API 호출 파라미터 (모델 단위로 검증된 값) */
export interface ImageCall {
  aspectRatio: string;
  imageSize?: string;
  quality?: string;
  background?: 'transparent';
  n: number;
  references: string[];
}

export interface UnitContext {
  tr: Translate;
  record: RequestRecord;
  /** 이미지 API 호출 — 재시도·타임아웃·비용 기록 포함. 원본 바이트 배열을 돌려준다 */
  generate: (prompt: string, call: ImageCall) => Promise<Uint8Array[]>;
  /** 저장 실패 시에도 과금 결과를 남기는 저장 래퍼 (비동기 저장 — 타일맵 합성 등 — 도 받는다) */
  saveSafely: (bytes: Uint8Array, save: () => string[] | Promise<string[]>, rawDir: string, rawBase: string) => Promise<string[]>;
}

export interface WorkUnit {
  label: string;
  grid: PixelArtGridLayout;
  items?: string[];
  call: ImageCall;
  /** 이 단위가 만들 이미지 수 (견적·상한용) */
  images: number;
  /** 이 단위가 보내는 이미지 API 요청 수 (기본 1 — 편집 체인은 단계 수) */
  requests?: number;
  /** 이 단위가 만들 파일 수 (dry run 표시용) */
  expectedFiles: number;
  /** 번역 대상 원문 (한글이 있는 것만 번역된다) */
  texts: (string | undefined)[];
  /** 기본 실행: 프롬프트 */
  buildPrompt?: (tr: Translate) => string;
  /** 기본 실행: 응답 이미지 1장 저장 → 파일들 (imageIndex 는 0 부터) */
  save?: (bytes: Uint8Array, imageIndex: number, tr: Translate) => string[];
  /** 직접 실행 (편집 체인 등) — 있으면 buildPrompt/save 대신 쓴다. 파일은 ctx.saveSafely 가 결과에 반영한다 */
  run?: (ctx: UnitContext) => Promise<unknown>;
  /** 원본 저장 폴더 (후처리 실패 시) */
  rawDir: string;
}

export interface RequestRecord {
  index: number;
  task: string;
  grid: PixelArtGridLayout;
  n: number;
  items?: string[];
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
  attempts: number;
  /** 실제 전송한 프롬프트 (체인이면 단계별) */
  prompt?: string | string[];
  cost_usd?: number;
  usage?: Record<string, unknown>[];
  generation_ids?: string[];
  duration_ms?: number;
  files: string[];
  error?: string;
}

export interface Job {
  id: string;
  kind: string;
  status: 'running' | 'done' | 'failed' | 'cancelled';
  destDir: string;
  manifestPath: string;
  startedAt: string;
  finishedAt?: string;
  total: number;
  completed: number;
  failed: number;
  costUsd: number;
  costKnown: boolean;
  files: string[];
  errors: string[];
  requests: RequestRecord[];
  abortReason?: string;
  cancelRequested: boolean;
  done: Promise<void>;
}

const jobs = new Map<string, Job>();

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

export function listJobs(): Job[] {
  return [...jobs.values()];
}

// ───────────────────────── 계획 요약 ─────────────────────────

export interface PlanSummary {
  requests: number;
  images: number;
  expectedFiles: number;
  estimatedCostUsd?: number;
  costBasis: string;
}

/** 단위 목록 → 요청 수·이미지 수·파일 수·견적 (실측 평균 기반) */
export function summarizePlan(model: ImageModelDefinition, units: WorkUnit[]): PlanSummary {
  let estimate = 0;
  let known = 0;
  let images = 0;
  let requests = 0;
  for (const u of units) {
    images += u.images;
    requests += u.requests ?? 1;
    const avg = averageCostPerImage(costKey(model.id, u.call.quality ?? u.call.imageSize, u.call.aspectRatio, u.call.references.length));
    if (avg !== undefined) {
      estimate += avg * u.images;
      known += u.images;
    }
  }
  return {
    requests,
    images,
    expectedFiles: units.reduce((s, u) => s + u.expectedFiles, 0),
    estimatedCostUsd: known > 0 ? Number(estimate.toFixed(4)) : undefined,
    costBasis:
      known === images
        ? '이전 실행의 실측 평균 기준'
        : known > 0
          ? `일부(${known}/${images}장)만 실측 기록이 있어 나머지는 제외한 값`
          : '실측 기록 없음 — 한 번 실행하면 다음부터 견적이 나온다',
  };
}

// ───────────────────────── 실행 ─────────────────────────

const KOREAN = /[ㄱ-ㅎㅏ-ㅣ가-힣]/;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 작업 전체의 한글 문자열 번역 (한 줄짜리는 1회로 묶고, 여러 줄은 단건 — 일괄 파서가 첫 줄만 남기므로) */
async function translateAll(apiKey: string, texts: Iterable<string | undefined>): Promise<Map<string, string>> {
  const unique = new Set<string>();
  for (const t of texts) if (t && KOREAN.test(t)) unique.add(t);
  const map = new Map<string, string>();
  if (unique.size === 0) return map;
  const translator = useGeminiTranslator();
  const singleLine = [...unique].filter((t) => !t.includes('\n'));
  const multiLine = [...unique].filter((t) => t.includes('\n'));
  if (singleLine.length > 0) {
    const translated = await translator.translateBatchToEnglish(apiKey, singleLine);
    singleLine.forEach((original, i) => map.set(original, translated[i] || original));
  }
  for (const original of multiLine) {
    map.set(original, (await translator.translateToEnglish(apiKey, original)) || original);
  }
  return map;
}

/** 요청 1건의 최대 대기 — 연결이 멈추면 worker 가 영구히 묶이지 않도록 */
const REQUEST_TIMEOUT_MS = 5 * 60_000;

/**
 * 이미지 API 가 HTTP 오류로 응답한 경우만 이 타입이다. 상태 코드 판정(재시도·401/402 중단·사용자 문구)은
 * 이 타입에만 한다 — 문서 다운로드 등 다른 오류 메시지의 "(401)" 을 API 키 오류로 오인하지 않게.
 */
export class ImageApiError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

/** 취소·중단으로 보내지 않은 호출 */
export class CancelledError extends Error {
  constructor() {
    super('취소되어 이 요청은 보내지 않았습니다');
  }
}

/** 공유 클라이언트가 던지는 `API 오류 (ddd): …` 를 ImageApiError 로, 그 외는 그대로 */
function classifyApiError(error: unknown): unknown {
  const message = (error as Error)?.message ?? '';
  const match = message.match(/^API 오류 \((\d{3})\)/);
  return match ? new ImageApiError(Number(match[1]), message) : error;
}

/** 연결 단계 실패(응답을 받기 전) — 이때만 재시도해도 이중 과금이 없다 */
function isConnectionError(error: unknown): boolean {
  const e = error as { name?: string; message?: string; cause?: { code?: string } };
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') return false; // 서버는 계속 생성·과금 중일 수 있다
  return e?.name === 'TypeError' || /fetch failed|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket/i.test(`${e?.message} ${e?.cause?.code ?? ''}`);
}

/**
 * 재시도: 429·408·5xx(이미지 API)와 연결 단계 네트워크 오류만 지수 대기 후 재시도한다.
 * 그 외 4xx, 타임아웃, "응답은 왔는데 이미지가 없음"은 재시도하지 않는다(이미 과금됐을 수 있다).
 * 매 시도 직전에 취소·중단을 확인한다 — 첫 호출도 예외가 아니다.
 */
async function callWithRetry<T>(fn: () => Promise<T>, shouldStop: () => boolean): Promise<T> {
  const MAX_ATTEMPTS = 4;
  for (let attempt = 1; ; attempt++) {
    if (shouldStop()) throw new CancelledError();
    try {
      return await fn();
    } catch (raw) {
      const error = classifyApiError(raw);
      const status = error instanceof ImageApiError ? error.status : 0;
      const retryable = status ? status === 429 || status === 408 || status >= 500 : isConnectionError(error);
      if (!retryable || attempt >= MAX_ATTEMPTS) throw error;
      await sleep((status === 429 ? 8000 : 5000) * attempt);
    }
  }
}

function writeManifest(job: Job, meta: Record<string, unknown>): void {
  try {
    mkdirSync(job.destDir, { recursive: true });
    writeFileSync(
      job.manifestPath,
      JSON.stringify(
        {
          job_id: job.id,
          kind: job.kind,
          status: job.status,
          ...meta,
          started_at: job.startedAt,
          finished_at: job.finishedAt,
          cost_usd: job.costKnown ? Number(job.costUsd.toFixed(4)) : null,
          requests: job.requests,
        },
        null,
        2
      )
    );
  } catch {
    // 매니페스트 실패는 결과 파일에 영향 없음
  }
}

export interface StartOptions {
  kind: string;
  model: ImageModelDefinition;
  units: WorkUnit[];
  destDir: string;
  concurrency: number;
  translate: boolean;
  /** 매니페스트에 함께 남길 정보 */
  meta: Record<string, unknown>;
}

export function startJob(dataDir: string, opts: StartOptions): Job {
  const apiKey = getApiKey(dataDir);
  const id = randomUUID().slice(0, 8);
  const records: RequestRecord[] = opts.units.map((u, index) => ({
    index,
    task: u.label,
    grid: u.grid,
    n: u.images,
    items: u.items,
    status: 'pending',
    attempts: 0,
    files: [],
  }));
  const job: Job = {
    id,
    kind: opts.kind,
    status: 'running',
    destDir: opts.destDir,
    manifestPath: join(opts.destDir, `manifest-${id}.json`),
    startedAt: new Date().toISOString(),
    total: opts.units.length,
    completed: 0,
    failed: 0,
    costUsd: 0,
    costKnown: false,
    files: [],
    errors: [],
    requests: records,
    cancelRequested: false,
    done: Promise.resolve(),
  };
  jobs.set(id, job);
  const meta = { model: opts.model.id, ...opts.meta };
  const shouldStop = () => job.cancelRequested || !!job.abortReason;

  job.done = (async () => {
    // 번역 실패는 원문으로 진행한다 (작업 전체가 pending 인 채 실패로 끝나지 않게)
    let translations = new Map<string, string>();
    if (opts.translate) {
      try {
        translations = await translateAll(apiKey, opts.units.flatMap((u) => u.texts));
      } catch (error) {
        job.errors.push(`번역 실패 — 원문으로 진행: ${(error as Error).message}`);
      }
    }
    const tr: Translate = (t) => (t ? translations.get(t) ?? t : t);

    const runUnit = async (unit: WorkUnit, record: RequestRecord) => {
      const generate = async (prompt: string, call: ImageCall): Promise<Uint8Array[]> => {
        record.prompt = record.prompt === undefined ? prompt : [...[record.prompt].flat(), prompt];
        const result = await callWithRetry(() => {
          record.attempts++;
          return generateImagesViaOpenRouter(apiKey, {
            model: opts.model.id,
            prompt,
            aspectRatio: call.aspectRatio,
            resolution: call.imageSize,
            quality: call.quality,
            background: call.background,
            inputReferences: call.references.length > 0 ? call.references : undefined,
            n: call.n,
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          });
        }, shouldStop);
        // 과금은 이미 일어났다 — 저장보다 먼저 기록해야 저장이 실패해도 비용이 빠지지 않는다
        if (result.usage) (record.usage ??= []).push(result.usage);
        if (result.id) (record.generation_ids ??= []).push(result.id);
        const cost = extractCost(result.usage);
        if (cost !== undefined) {
          record.cost_usd = (record.cost_usd ?? 0) + cost;
          job.costUsd += cost;
          job.costKnown = true;
          recordCost(
            costKey(opts.model.id, call.quality ?? call.imageSize, call.aspectRatio, call.references.length),
            result.images.length,
            cost
          );
        }
        return result.images.map((image) => Buffer.from(image.base64, 'base64'));
      };
      const warnings: string[] = [];
      // 저장 즉시 결과에 반영한다 — 체인 중간 단계가 실패해도 앞 단계(이미 과금된) 파일이 결과·매니페스트에 남도록
      const saveSafely = async (
        bytes: Uint8Array,
        save: () => string[] | Promise<string[]>,
        rawDir: string,
        rawBase: string
      ): Promise<string[]> => {
        let files: string[];
        try {
          files = await save();
        } catch (error) {
          warnings.push(`후처리 실패로 원본만 저장: ${(error as Error).message}`);
          files = [saveRaw(rawDir, rawBase, bytes)];
        }
        record.files.push(...files);
        job.files.push(...files);
        return files;
      };

      try {
        if (unit.run) {
          await unit.run({ tr, record, generate, saveSafely });
        } else {
          const images = await generate(unit.buildPrompt!(tr), unit.call);
          for (const [i, bytes] of images.entries()) {
            await saveSafely(bytes, () => unit.save!(bytes, i, tr), unit.rawDir, `${unit.label}_${record.index + 1}_${i + 1}`);
          }
        }
      } finally {
        if (warnings.length > 0) {
          const note = warnings.join(' / ');
          record.error = record.error ? `${record.error} / ${note}` : note;
          job.errors.push(`[${unit.label} #${record.index + 1}] ${note}`);
        }
      }
    };

    let cursor = 0;
    const worker = async () => {
      while (cursor < opts.units.length) {
        const index = cursor++;
        const unit = opts.units[index];
        const record = records[index];
        if (shouldStop()) {
          record.status = 'skipped';
          continue;
        }
        record.status = 'running';
        const started = Date.now();
        try {
          await runUnit(unit, record);
          record.status = 'done';
          job.completed++;
        } catch (error) {
          if (error instanceof CancelledError) {
            // 단위 중간(체인 단계 사이)에서 멈췄다 — 그때까지 저장된 파일은 record.files 에 남아 있다
            record.status = 'skipped';
            record.error = record.files.length > 0 ? `취소로 중단 (앞 단계 파일 ${record.files.length}개 보존)` : error.message;
            continue;
          }
          const status = error instanceof ImageApiError ? error.status : 0;
          const message = (error as Error).message;
          const friendly = status ? formatImageApiError(status, message.replace(/^.*?\):\s*/, '')) : message;
          record.status = 'failed';
          record.error = record.files.length > 0 ? `${friendly} (앞 단계 파일 ${record.files.length}개 보존)` : friendly;
          job.failed++;
          job.errors.push(`[${unit.label} #${index + 1}] ${friendly}`);
          // 키·크레딧 문제(이미지 API 응답일 때만)는 나머지 요청도 똑같이 실패하므로 즉시 중단한다
          if (status === 401 || status === 402) job.abortReason = friendly;
        } finally {
          record.duration_ms = Date.now() - started;
          writeManifest(job, meta);
        }
      }
    };

    try {
      await Promise.all(Array.from({ length: Math.min(opts.concurrency, opts.units.length) }, worker));
      // 실제로 건너뛴 요청이 있을 때만 취소로 본다 (모두 보낸 뒤 늦게 온 취소는 무시)
      const skipped = records.some((r) => r.status === 'skipped');
      job.status = job.abortReason ? 'failed' : job.cancelRequested && skipped ? 'cancelled' : job.completed === 0 ? 'failed' : 'done';
    } catch (error) {
      job.status = 'failed';
      job.errors.push((error as Error).message);
    } finally {
      job.finishedAt = new Date().toISOString();
      writeManifest(job, meta);
    }
  })();

  return job;
}

/** 작업 요약 (도구 응답용) — 프롬프트 전문은 매니페스트에만 둔다 */
export function jobSummary(job: Job, maxFiles = 200) {
  return {
    job_id: job.id,
    kind: job.kind,
    status: job.status,
    progress: `${job.completed + job.failed}/${job.total} 작업 단위 (성공 ${job.completed}, 실패 ${job.failed})`,
    dest_dir: job.destDir,
    manifest: job.manifestPath,
    cost_usd: job.costKnown ? Number(job.costUsd.toFixed(4)) : null,
    file_count: job.files.length,
    files: job.files.slice(0, maxFiles),
    files_truncated: job.files.length > maxFiles,
    errors: job.errors,
    abort_reason: job.abortReason ?? null,
    started_at: job.startedAt,
    finished_at: job.finishedAt ?? null,
  };
}

/** 작업이 끝나거나 waitMs 가 지날 때까지 기다린다 */
export async function waitForJob(job: Job, waitMs: number): Promise<void> {
  if (waitMs <= 0) return;
  await Promise.race([job.done, sleep(waitMs)]);
}
