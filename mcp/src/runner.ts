/**
 * 도구 공통 실행 흐름: 계획 요약 → (dry run 이면 여기서 끝) → 안전 상한 → 작업 시작 → 대기.
 * 모든 세션 도구가 같은 응답 형식·같은 안전장치를 갖도록 한 곳에 둔다.
 */

import type { ImageModelDefinition } from '../../src/hooks/api/imageModels';

import { limitViolations, type LimitInput } from './common';
import { jobSummary, startJob, summarizePlan, waitForJob, type WorkUnit } from './engine';

export interface PlanToRun extends LimitInput {
  kind: string;
  model: ImageModelDefinition;
  units: WorkUnit[];
  destDir: string;
  concurrency?: number;
  translate?: boolean;
  /** 매니페스트·dry run 응답에 함께 보일 정보 */
  meta: Record<string, unknown>;
  /** dry run 에 보일 단위별 구성 */
  breakdown: unknown[];
  dry_run?: boolean;
  wait_seconds?: number;
}

export async function runPlan(dataDir: string, plan: PlanToRun) {
  if (plan.units.length === 0) throw new Error('만들 작업이 없습니다.');
  const summary = summarizePlan(plan.model, plan.units);
  const violations = limitViolations(
    { requests: summary.requests, images: summary.images, estimatedCostUsd: summary.estimatedCostUsd },
    plan
  );
  const head = {
    kind: plan.kind,
    model: plan.model.id,
    ...plan.meta,
    requests: summary.requests,
    images_requested: summary.images,
    expected_files: summary.expectedFiles,
    estimated_cost_usd: summary.estimatedCostUsd ?? null,
    cost_basis: summary.costBasis,
    dest_dir: plan.destDir,
  };

  if (plan.dry_run) {
    return {
      dry_run: true,
      ...head,
      breakdown: plan.breakdown,
      note:
        violations.length > 0
          ? `이대로는 실행되지 않는다 (${violations.join(', ')}). 의도한 규모면 상한을 올리고, 아니면 그리드로 더 묶어라.`
          : '실행하려면 dry_run 을 빼고 다시 호출한다.',
    };
  }
  if (violations.length > 0) {
    throw new Error(`안전 상한을 넘어 실행하지 않았습니다: ${violations.join(', ')}. 의도한 규모면 해당 상한을 올려 다시 호출하세요.`);
  }

  const job = startJob(dataDir, {
    kind: plan.kind,
    model: plan.model,
    units: plan.units,
    destDir: plan.destDir,
    concurrency: Math.min(8, Math.max(1, Math.floor(plan.concurrency ?? 4))),
    translate: plan.translate !== false,
    meta: plan.meta,
  });
  await waitForJob(job, (plan.wait_seconds ?? 40) * 1000);
  return {
    ...jobSummary(job),
    plan: { requests: summary.requests, images_requested: summary.images, expected_files: summary.expectedFiles },
  };
}
