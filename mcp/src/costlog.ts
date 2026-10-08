/**
 * 실측 비용 기록 — OpenRouter 이미지 단가는 토큰 단위라 요청 전에는 정확히 알 수 없다.
 * 응답의 `usage.cost` 를 (모델·품질/해상도·비율) 단위로 모아 평균을 내고, dry run 견적에 쓴다.
 * 파일은 MCP 상태 폴더(`stateDir()/cost-history.json`)에만 둔다 — 앱 데이터와 무관하다.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stateDir } from './env';

interface CostEntry {
  /** 누적 이미지 수 */
  images: number;
  /** 누적 비용 (USD) */
  usd: number;
}

type CostHistory = Record<string, CostEntry>;

const FILE = () => join(stateDir(), 'cost-history.json');

/** 참조 이미지 수 구간 — 입력 이미지 토큰이 비용에 크게 들어가므로 구간별로 따로 평균낸다 */
function refBucket(refs: number): string {
  if (refs <= 0) return 'ref0';
  if (refs <= 4) return 'ref1-4';
  return 'ref5+';
}

export function costKey(model: string, tier: string | undefined, aspectRatio: string, refs = 0): string {
  return `${model}|${tier ?? '-'}|${aspectRatio}|${refBucket(refs)}`;
}

function load(): CostHistory {
  try {
    return existsSync(FILE()) ? (JSON.parse(readFileSync(FILE(), 'utf-8')) as CostHistory) : {};
  } catch {
    return {};
  }
}

/**
 * 응답 usage 에서 실제 USD 비용을 꺼낸다 (필드가 없으면 undefined).
 *
 * BYOK(사용자 자체 제공사 키) 계정은 OpenRouter 수수료만 `cost` 에 담겨 0 이 되고, 실제 제공사
 * 비용은 `cost_details.upstream_inference_cost` 에 온다 (2026-10-08 실측: gpt-image-2 low 1장
 * cost=0, upstream=0.006175). 둘을 더해 사용자가 실제로 내는 금액으로 본다.
 */
export function extractCost(usage: Record<string, unknown> | undefined): number | undefined {
  if (!usage) return undefined;
  const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
  const fee = num(usage.cost);
  const details = usage.cost_details as Record<string, unknown> | undefined;
  const upstream = usage.is_byok === true ? num(details?.upstream_inference_cost) : undefined;
  if (fee === undefined && upstream === undefined) return undefined;
  return (fee ?? 0) + (upstream ?? 0);
}

export function recordCost(key: string, images: number, usd: number): void {
  if (images <= 0 || !(usd >= 0)) return;
  try {
    const history = load();
    const entry = history[key] ?? { images: 0, usd: 0 };
    entry.images += images;
    entry.usd += usd;
    history[key] = entry;
    mkdirSync(stateDir(), { recursive: true });
    writeFileSync(FILE(), JSON.stringify(history, null, 2));
  } catch {
    // 기록 실패는 생성에 영향 없음
  }
}

/** 이미지 1장 평균 비용 (기록이 없으면 undefined) */
export function averageCostPerImage(key: string): number | undefined {
  const entry = load()[key];
  return entry && entry.images > 0 ? entry.usd / entry.images : undefined;
}

export function allAverages(): Record<string, { per_image_usd: number; samples: number }> {
  const out: Record<string, { per_image_usd: number; samples: number }> = {};
  for (const [key, entry] of Object.entries(load())) {
    if (entry.images > 0) out[key] = { per_image_usd: entry.usd / entry.images, samples: entry.images };
  }
  return out;
}
