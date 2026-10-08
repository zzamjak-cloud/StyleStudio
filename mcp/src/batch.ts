/**
 * 생성기 계열 세션 배치 계획 (STYLE·CHARACTER·BACKGROUND·ICON·UI·LOGO·PIXELART 3종·BASIC)
 *
 * tasks 를 작업 단위로 바꾼다. 실행·재시도·비용·저장은 엔진(engine.ts)이 한다.
 *
 * 비용 레버
 * - items: 항목을 그리드 셀에 나눠 담아 호출 1회로 여러 개를 얻고, 셀 단위 파일로 자른다.
 * - count → n: 같은 프롬프트로 여러 장이 필요하면 gpt 계열은 한 요청에 최대 10장을 받는다.
 */

import type { ImageAnalysisResult } from '../../src/types/analysis';
import type { PixelArtGridLayout } from '../../src/types/pixelart';
import type { PaletteSizeOption, PixelateSizeOption } from '../../src/lib/pixelart/pixelate';

import {
  cameraText,
  PLAN_HARD_LIMIT,
  resolveDestDir,
  resolveModel,
  resolveStyle,
  uniqueNamer,
  type StyleSourceInput,
} from './common';
import { sanitizeName } from './env';
import { loadDocuments, type DocumentInput } from './documents';
import { expectedFileCount, saveGeneratedImage, taskDir, type OutputOptions } from './output';
import {
  composePrompt,
  GENERATOR_SESSION_TYPES,
  GRID_LAYOUTS,
  isPixelSession,
  packItems,
  usesWhiteBackground,
  type GeneratorSessionType,
} from './prompt';
import type { WorkUnit } from './engine';
import type { PlanToRun } from './runner';

export type { StyleSourceInput };

export interface TaskInput {
  name?: string;
  prompt?: string;
  items?: string[];
  count?: number;
  grid?: PixelArtGridLayout;
  aspect_ratio?: string;
  quality?: string;
  image_size?: string;
  negative_prompt?: string;
}

export interface BatchOptionsInput {
  model?: string;
  quality?: string;
  image_size?: string;
  aspect_ratio?: string;
  max_grid?: PixelArtGridLayout;
  transparent_background?: boolean;
  camera_angle?: string;
  camera_lens?: string;
  negative_prompt?: string;
  reference_documents?: DocumentInput[];
  pixelate?: { enabled?: boolean; size?: PixelateSizeOption; palette_size?: PaletteSizeOption };
  pixel_output?: 'logical' | 'upscaled' | 'both';
  split_grid?: boolean;
  keep_sheet?: boolean;
  output_format?: 'png' | 'jpg';
  translate?: boolean;
}

export interface BatchInput {
  session_type: string;
  style?: StyleSourceInput;
  tasks: TaskInput[];
  options?: BatchOptionsInput;
  dest_dir?: string;
  concurrency?: number;
  max_requests?: number;
  max_images?: number;
  max_cost_usd?: number;
  dry_run?: boolean;
  wait_seconds?: number;
}

/** 생성기 세션 배치 → 실행 계획 */
export async function planGeneratorBatch(dataDir: string, input: BatchInput): Promise<PlanToRun> {
  if (!(GENERATOR_SESSION_TYPES as readonly string[]).includes(input.session_type)) {
    throw new Error(`지원하지 않는 session_type 입니다: ${input.session_type}. 가능한 값: ${GENERATOR_SESSION_TYPES.join(', ')}`);
  }
  const sessionType = input.session_type as GeneratorSessionType;
  if (!input.tasks || input.tasks.length === 0) throw new Error('tasks 가 비어 있습니다.');

  const opts = input.options ?? {};
  const checks = resolveModel(opts.model);
  const { model } = checks;

  const transparent = !!opts.transparent_background;
  if (transparent && !model.supports.transparentBackground) {
    throw new Error(`${model.label}(${model.id}) 는 투명 배경을 지원하지 않습니다. openai/gpt-image-2.5-flare 또는 -sunburst 를 쓰세요.`);
  }
  if (transparent && !usesWhiteBackground(sessionType)) {
    throw new Error('투명 배경은 CHARACTER/ICON/LOGO/PIXELART_CHARACTER/PIXELART_ICON 세션에서만 쓸 수 있습니다.');
  }
  const maxGrid = opts.max_grid ?? '4x4';
  if (!GRID_LAYOUTS.includes(maxGrid)) throw new Error(`max_grid 는 ${GRID_LAYOUTS.join(', ')} 중 하나여야 합니다.`);

  const style = resolveStyle(dataDir, input.style, model.supports.maxReferenceImages);
  const documents = await loadDocuments(dataDir, opts.reference_documents, { forPrompt: 'content' });
  const camera = cameraText(opts.camera_angle, opts.camera_lens);
  const output: OutputOptions = {
    split_grid: opts.split_grid !== false,
    keep_sheet: opts.keep_sheet !== false,
    output_format: opts.output_format ?? 'png',
    pixel_output: opts.pixel_output ?? 'both',
    pixelate: {
      enabled: isPixelSession(sessionType) && opts.pixelate?.enabled !== false,
      size: opts.pixelate?.size ?? 'auto',
      palette_size: opts.pixelate?.palette_size ?? 'auto',
    },
    transparent,
  };

  // ── 작업 단위 계획
  type Planned = {
    taskName: string;
    prompt?: string;
    items?: string[];
    grid: PixelArtGridLayout;
    n: number;
    firstSeq: number;
    aspectRatio: string;
    quality?: string;
    imageSize?: string;
    negativePrompt?: string;
  };
  const planned: Planned[] = [];
  const push = (p: Planned) => {
    // 계획 단계에서 바로 끊는다 — 오타 하나(count: 1e9)로 계획 배열이 폭주해 서버가 죽지 않게
    if (planned.length >= PLAN_HARD_LIMIT) {
      throw new Error(`요청이 ${PLAN_HARD_LIMIT}건을 넘는 배치는 계획하지 않습니다. tasks 를 나눠 여러 번 실행하세요.`);
    }
    planned.push(p);
  };
  const nameOf = uniqueNamer();

  input.tasks.forEach((task, taskIndex) => {
    const items = (task.items ?? []).map((i) => i.trim()).filter(Boolean);
    if (task.items && task.items.length > 0 && items.length === 0) {
      throw new Error(`tasks[${taskIndex}].items 가 모두 빈 문자열입니다.`);
    }
    if (items.length > 0 && task.count !== undefined) {
      throw new Error(`tasks[${taskIndex}] 에 items 와 count 를 함께 쓸 수 없습니다 (items 는 항목마다 1개씩 만든다).`);
    }
    if (!task.prompt?.trim() && items.length === 0) {
      throw new Error(`tasks[${taskIndex}] 에 prompt 또는 items 가 필요합니다.`);
    }
    if (task.grid && !GRID_LAYOUTS.includes(task.grid)) {
      throw new Error(`tasks[${taskIndex}].grid 는 ${GRID_LAYOUTS.join(', ')} 중 하나여야 합니다.`);
    }
    const taskName = nameOf(sanitizeName(task.name ?? task.prompt?.slice(0, 40) ?? items[0] ?? '', `task-${taskIndex + 1}`));
    const common = {
      taskName,
      prompt: task.prompt,
      aspectRatio: checks.aspect(task.aspect_ratio ?? opts.aspect_ratio),
      quality: checks.quality(task.quality ?? opts.quality),
      imageSize: checks.size(task.image_size ?? opts.image_size),
      negativePrompt: [opts.negative_prompt, task.negative_prompt].filter(Boolean).join(', ') || undefined,
    };
    if (items.length > 0) {
      // 셀 하나당 한 항목. grid 를 지정하면 그 크기를 상한으로 묶는다 (1x1 이면 항목마다 1장)
      for (const chunk of packItems(items, task.grid ?? maxGrid)) {
        push({ ...common, items: chunk.items, grid: chunk.grid, n: 1, firstSeq: 1 });
      }
    } else {
      const count = Math.max(1, Math.floor(task.count ?? 1));
      const perRequest = Math.max(1, model.supports.maxImagesPerRequest);
      for (let made = 0; made < count; made += perRequest) {
        push({ ...common, grid: task.grid ?? '1x1', n: Math.min(perRequest, count - made), firstSeq: made + 1 });
      }
    }
  });

  const destDir = resolveDestDir(dataDir, input.dest_dir, sessionType.toLowerCase(), new Set(planned.map((p) => p.taskName)));

  const units: WorkUnit[] = planned.map((p, index) => {
    const dir = taskDir(destDir, p.taskName);
    return {
      label: p.taskName,
      grid: p.grid,
      items: p.items,
      images: p.n,
      expectedFiles: expectedFileCount(p.grid, p.n, p.items && output.split_grid ? p.items.length : undefined, output),
      call: {
        aspectRatio: p.aspectRatio,
        imageSize: p.imageSize,
        quality: p.quality,
        background: transparent ? 'transparent' : undefined,
        n: p.n,
        references: style.referenceImages,
      },
      texts: [p.prompt, p.negativePrompt, style.styleText, ...(p.items ?? [])],
      rawDir: dir,
      buildPrompt: (tr) =>
        composePrompt({
          sessionType,
          prompt: tr(p.prompt),
          items: p.items?.map((i) => tr(i)!),
          grid: p.grid,
          analysis: style.analysis as ImageAnalysisResult | undefined,
          hasReferenceImages: style.referenceImages.length > 0,
          camera,
          styleText: tr(style.styleText),
          referenceDocuments: documents,
          transparentBackground: transparent,
          negativePrompt: tr(p.negativePrompt),
        }),
      save: (bytes, imageIndex) =>
        saveGeneratedImage(bytes, {
          dir,
          sheetBase: p.items
            ? `${p.taskName}_sheet${String(index + 1).padStart(2, '0')}`
            : `${p.taskName}_${String(p.firstSeq + imageIndex).padStart(2, '0')}`,
          grid: p.grid,
          items: p.items,
          options: output,
        }),
    };
  });

  return {
    kind: sessionType,
    model,
    units,
    destDir,
    concurrency: input.concurrency,
    translate: opts.translate,
    meta: {
      session_type: sessionType,
      style_source: style.source,
      reference_images: style.referenceImages.length,
      transparent_background: transparent,
    },
    breakdown: planned.map((p) => ({
      task: p.taskName,
      grid: p.grid,
      n: p.n,
      items: p.items,
      quality: p.quality ?? p.imageSize,
      aspect_ratio: p.aspectRatio,
    })),
    max_requests: input.max_requests,
    max_images: input.max_images,
    max_cost_usd: input.max_cost_usd,
    dry_run: input.dry_run,
    wait_seconds: input.wait_seconds,
  };
}

// 이전 이름 호환 — 테스트·외부 참조용
export { PLAN_HARD_LIMIT };
export { splitCells } from './output';
