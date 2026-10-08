/**
 * 세션 도구 공통 — 모델·옵션 검증, 스타일 소스 해석, 출력 폴더, 안전 상한.
 * 생성기·컨셉·일러스트·편집 체인·타일맵 도구가 같은 규칙을 쓰도록 한 곳에 둔다.
 */

import { existsSync, readFileSync } from 'node:fs';
import { basename, isAbsolute, join, resolve } from 'node:path';

import type { ImageAnalysisResult } from '../../src/types/analysis';
import { getCameraAnglePrompt } from '../../src/types/cameraAngle';
import { getCameraLensPrompt } from '../../src/types/cameraLens';
import {
  DEFAULT_IMAGE_MODEL,
  IMAGE_MODELS,
  normalizeImageQuality,
  type ImageModelDefinition,
  type ImageQualityOption,
  type ImageSizeOption,
} from '../../src/hooks/api/imageModels';

import { assertWritable, defaultOutputRoot, getSessionStyle } from './env';
import { readReferenceFile } from './imageio';

/** 계획 단계 절대 상한 (max_requests 와 별개 — 서버 보호용) */
export const PLAN_HARD_LIMIT = 1000;

// ───────────────────────── 모델 ─────────────────────────

export interface ModelChecks {
  model: ImageModelDefinition;
  aspect: (value: string | undefined, fallback?: string) => string;
  size: (value: string | undefined) => ImageSizeOption | undefined;
  quality: (value: string | undefined) => ImageQualityOption | undefined;
}

export function resolveModel(modelId: string | undefined, allowed?: (m: ImageModelDefinition) => boolean): ModelChecks {
  const id = modelId ?? DEFAULT_IMAGE_MODEL;
  const model = IMAGE_MODELS.find((m) => m.id === id && m.availability === 'available');
  if (!model) throw new Error(`알 수 없는 모델입니다: ${id}. ss_models 로 목록을 확인하세요.`);
  if (allowed && !allowed(model)) throw new Error(`이 도구에서는 ${model.id} 모델을 쓸 수 없습니다.`);
  const supports = model.supports;
  return {
    model,
    aspect: (value, fallback = '1:1') => {
      const ratio = value ?? fallback;
      if (!(supports.aspectRatios as string[]).includes(ratio)) {
        throw new Error(`${model.id} 는 비율 ${ratio} 를 지원하지 않습니다. 가능: ${supports.aspectRatios.join(', ')}`);
      }
      return ratio;
    },
    size: (value) => {
      if (model.provider !== 'gemini') return undefined;
      const size = (value ?? '1K').toUpperCase() as ImageSizeOption;
      if (!supports.imageSizes.includes(size)) {
        throw new Error(`${model.id} 는 크기 ${size} 를 지원하지 않습니다. 가능: ${supports.imageSizes.join(', ')}`);
      }
      return size;
    },
    quality: (value) =>
      model.provider === 'openai' ? normalizeImageQuality(model.id, (value ?? 'medium') as ImageQualityOption) : undefined,
  };
}

export function cameraText(angle?: string, lens?: string): string | undefined {
  return [angle ? getCameraAnglePrompt(angle) : '', lens ? getCameraLensPrompt(lens) : ''].filter(Boolean).join(', ') || undefined;
}

// ───────────────────────── 스타일 소스 ─────────────────────────

export interface StyleSourceInput {
  session_id?: string;
  profile_path?: string;
  reference_images?: string[];
  analysis?: ImageAnalysisResult;
  style_text?: string;
  use_references?: boolean;
}

export interface ResolvedStyle {
  analysis?: ImageAnalysisResult;
  referenceImages: string[];
  styleText?: string;
  source: string;
}

function loadProfile(path: string) {
  if (!existsSync(path)) throw new Error(`스타일 프로필을 찾을 수 없습니다: ${path}`);
  const json = JSON.parse(readFileSync(path, 'utf-8')) as {
    analysis?: ImageAnalysisResult;
    reference_paths?: string[];
    style_text?: string;
    source_session_id?: string;
  };
  return {
    analysis: json.analysis,
    referencePaths: json.reference_paths ?? [],
    styleText: json.style_text,
    sourceSessionId: json.source_session_id,
  };
}

/** 스타일 소스(세션·프로필·참조 파일·분석 JSON·텍스트)를 분석 결과 + 참조 이미지로 해석한다 */
export function resolveStyle(dataDir: string, input: StyleSourceInput | undefined, maxRefs: number): ResolvedStyle {
  const sources: string[] = [];
  let analysis: ImageAnalysisResult | undefined;
  let references: string[] = [];
  let styleText = input?.style_text?.trim() || undefined;

  if (input?.session_id) {
    const session = getSessionStyle(dataDir, input.session_id);
    analysis = session.analysis;
    references = session.referenceImages;
    sources.push(
      `세션 "${session.name}"(${session.type}) — 분석 ${analysis ? '있음' : '없음'}, 참조 ${references.length}장${
        session.missingReferences ? ` (읽지 못함 ${session.missingReferences})` : ''
      }`
    );
  }
  if (input?.profile_path) {
    const profile = loadProfile(input.profile_path);
    analysis = profile.analysis ?? analysis;
    styleText = styleText ?? profile.styleText;
    // 세션에서 분석한 프로필은 참조 이미지를 그 세션에서 다시 읽는다
    if (profile.sourceSessionId && profile.sourceSessionId !== input.session_id) {
      references = [...references, ...getSessionStyle(dataDir, profile.sourceSessionId).referenceImages];
    }
    references = [...references, ...profile.referencePaths.map(readReferenceFile)];
    sources.push(`프로필 ${basename(input.profile_path)}`);
  }
  if (input?.reference_images && input.reference_images.length > 0) {
    references = [...references, ...input.reference_images.map(readReferenceFile)];
    sources.push(`참조 파일 ${input.reference_images.length}장`);
  }
  if (input?.analysis) {
    analysis = input.analysis;
    sources.push('분석 JSON 직접 지정');
  }
  if (input?.use_references === false) references = [];
  if (references.length > maxRefs) references = references.slice(0, maxRefs);
  if (styleText) sources.push('스타일 설명');

  return { analysis, referenceImages: references, styleText, source: sources.join(', ') || '없음 (프롬프트만)' };
}

// ───────────────────────── 출력 ─────────────────────────

function stamp(): string {
  const d = new Date();
  const pad = (v: number) => String(v).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/** 출력 폴더 결정 + 앱 데이터 보호 검사 (실제로 쓰는 하위 폴더 이름까지) */
export function resolveDestDir(dataDir: string, destDir: string | undefined, kind: string, subdirs: Iterable<string>): string {
  if (destDir && !isAbsolute(destDir)) throw new Error(`dest_dir 는 절대 경로여야 합니다: ${destDir}`);
  const dir = destDir ? resolve(destDir) : join(defaultOutputRoot(), `${kind}_${stamp()}`);
  assertWritable(dir, dataDir);
  for (const name of subdirs) assertWritable(join(dir, name), dataDir);
  return dir;
}

/** 작업 이름 중복 방지 (같은 이름이면 _2, _3) */
export function uniqueNamer() {
  const used = new Map<string, number>();
  return (base: string) => {
    const dup = used.get(base) ?? 0;
    used.set(base, dup + 1);
    return dup === 0 ? base : `${base}_${dup + 1}`;
  };
}

// ───────────────────────── 안전 상한 ─────────────────────────

export interface LimitInput {
  max_requests?: number;
  max_images?: number;
  max_cost_usd?: number;
}

/** 요청 수·이미지 수·견적 금액 상한을 넘는 항목 목록 (비면 통과) */
export function limitViolations(
  plan: { requests: number; images: number; estimatedCostUsd?: number },
  input: LimitInput
): string[] {
  const out: string[] = [];
  const maxRequests = input.max_requests ?? 30;
  const maxImages = input.max_images ?? 60;
  if (plan.requests > maxRequests) out.push(`요청 수 ${plan.requests} > max_requests ${maxRequests}`);
  if (plan.images > maxImages) out.push(`생성 이미지 수 ${plan.images} > max_images ${maxImages}`);
  if (input.max_cost_usd !== undefined && plan.estimatedCostUsd !== undefined && plan.estimatedCostUsd > input.max_cost_usd) {
    out.push(`견적 $${plan.estimatedCostUsd} > max_cost_usd $${input.max_cost_usd}`);
  }
  return out;
}
