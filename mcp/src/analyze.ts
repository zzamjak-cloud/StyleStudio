/**
 * 참조 이미지 분석 → 스타일 프로필
 *
 * 앱의 분석기(`useGeminiAnalyzer.analyzeImages`)를 그대로 호출한다 — 세션 타입별 분석 프롬프트
 * (LOGO/UI/BACKGROUND/PIXELART/…)와 응답 검증이 앱과 같다.
 * 결과는 재사용 가능한 프로필 JSON 으로 저장해, 배치마다 분석 비용을 다시 내지 않게 한다.
 */

import { readFileSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path';

import type { SessionType } from '../../src/types/session';
import type { ImageAnalysisResult } from '../../src/types/analysis';
import { useGeminiAnalyzer } from '../../src/hooks/api/useGeminiAnalyzer';
import { buildUnifiedPrompt } from '../../src/lib/promptBuilder';
import { ANALYSIS_MODELS } from '../../src/types/constants';

import { assertWritable, defaultOutputRoot, getApiKey, getSessionStyle, sanitizeName, writeUnique } from './env';
import { readReferenceFile } from './imageio';

export const ANALYZABLE_SESSION_TYPES = [
  'STYLE',
  'CHARACTER',
  'BACKGROUND',
  'ICON',
  'UI',
  'LOGO',
  'PIXELART_CHARACTER',
  'PIXELART_BACKGROUND',
  'PIXELART_ICON',
  'TILEMAP',
] as const;

export interface AnalyzeInput {
  session_type: string;
  image_paths?: string[];
  session_id?: string;
  analysis_model?: string;
  name?: string;
  save_path?: string;
  /** 이전 프로필 경로 — 주면 분석 강화(REFINEMENT) 모드로 기존 분석을 다듬는다 */
  refine_profile_path?: string;
}

export interface StyleProfile {
  version: 1;
  name: string;
  session_type: string;
  created_at: string;
  analysis_model: string;
  analysis: ImageAnalysisResult;
  /** 생성 시 참조 이미지로 다시 읽을 원본 경로 (세션에서 온 경우 비어 있음) */
  reference_paths: string[];
  /** 세션에서 분석한 경우 그 세션 id — 생성 때 session_id 로 참조 이미지를 쓸 수 있다 */
  source_session_id?: string;
}

export async function analyzeToProfile(dataDir: string, input: AnalyzeInput) {
  if (!(ANALYZABLE_SESSION_TYPES as readonly string[]).includes(input.session_type)) {
    throw new Error(`분석할 수 없는 session_type 입니다: ${input.session_type}. 가능: ${ANALYZABLE_SESSION_TYPES.join(', ')}`);
  }
  const model = input.analysis_model ?? ANALYSIS_MODELS[0].id;

  let images: string[] = [];
  let referencePaths: string[] = [];
  if (input.session_id) {
    images = getSessionStyle(dataDir, input.session_id).referenceImages;
  }
  if (input.image_paths && input.image_paths.length > 0) {
    referencePaths = input.image_paths.map((p) => resolve(p));
    images = [...images, ...referencePaths.map(readReferenceFile)];
  }
  if (images.length === 0) throw new Error('분석할 이미지가 없습니다. image_paths 또는 session_id 를 주세요.');
  // 앱 업로드 상한과 같다
  images = images.slice(0, 14);

  let previousAnalysis: ImageAnalysisResult | undefined;
  if (input.refine_profile_path) {
    previousAnalysis = (JSON.parse(readFileSync(input.refine_profile_path, 'utf-8')) as StyleProfile).analysis;
  }

  const apiKey = getApiKey(dataDir);
  const analysis = await new Promise<ImageAnalysisResult>((resolvePromise, reject) => {
    void useGeminiAnalyzer().analyzeImages(
      apiKey,
      images,
      { onProgress: () => undefined, onComplete: resolvePromise, onError: reject },
      input.session_type as SessionType,
      { model, previousAnalysis }
    );
  });

  const name = sanitizeName(input.name ?? `${input.session_type.toLowerCase()}-style`, 'style');
  const profile: StyleProfile = {
    version: 1,
    name,
    session_type: input.session_type,
    created_at: new Date().toISOString(),
    analysis_model: model,
    analysis,
    reference_paths: referencePaths,
    source_session_id: input.session_id,
  };

  // 저장: 앱 데이터 폴더 거부, .json 만, 기존 파일은 덮어쓰지 않고 _2… (명시 경로도 동일)
  const target = input.save_path ? input.save_path : join(defaultOutputRoot(), 'styles', `${name}.json`);
  if (!isAbsolute(target)) throw new Error(`save_path 는 절대 경로여야 합니다: ${target}`);
  if (extname(target).toLowerCase() !== '.json') throw new Error(`save_path 는 .json 파일이어야 합니다: ${target}`);
  assertWritable(target, dataDir);
  const savePath = writeUnique(dirname(target), basename(target, extname(target)), 'json', JSON.stringify(profile, null, 2));

  const unified = buildUnifiedPrompt(analysis);
  return {
    profile_path: savePath,
    session_type: input.session_type,
    analyzed_images: images.length,
    unified_prompt: unified.positivePrompt,
    negative_prompt: unified.negativePrompt,
    pixelart_resolution: analysis.pixelart_specific?.resolution_estimate ?? null,
    analysis,
  };
}
