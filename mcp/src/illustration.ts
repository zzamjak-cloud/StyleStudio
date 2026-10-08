/**
 * 일러스트 세션 배치 (`ss_illustration_batch`) — 같은 캐릭터 세트(최대 5명)로 여러 장면을 만든다.
 *
 * 앱과 같은 규칙 (`ImageGeneratorPanel.handleGenerate` 의 ILLUSTRATION 분기):
 * - 장면 프롬프트만 번역하고, 카메라는 basePrompt 에 섞지 않고 cameraSettings 로 따로 전달(캐릭터 정확도 우선)
 * - 참조 이미지 순서: 캐릭터별 이미지(최대 3장) → 배경(최대 5장) → 구도 스케치(마지막)
 * - 구도 스케치에 캐릭터 라벨 좌표를 주면 앱과 같은 스케치 분석(`analyzeCompositionSketch`, 장면당 Flash 1회)으로
 *   배치 규칙을 프롬프트에 넣는다
 *
 * MCP 가 앱보다 나은 점 (앱 회귀 아님 — 앱은 그대로):
 * - 참조 상한(gpt 16 / gemini 14)을 넘으면 앱은 맨 뒤의 스케치가 먼저 잘린다. 여기서는 스케치를 지키고
 *   배경 → 캐릭터 추가 이미지 순으로 줄인다(캐릭터당 최소 1장 보장).
 * - 어느 참조 이미지가 어느 캐릭터인지 대응표를 프롬프트 끝에 붙인다(앱 프롬프트에는 대응 정보가 없다).
 */

import { z } from 'zod';

import { buildPromptForSession } from '../../src/lib/prompts/sessionPrompts';
import { analyzeCompositionSketch } from '../../src/lib/sketch/analyzeSketch';
import type { IllustrationCharacter, IllustrationSessionData, SketchLabel } from '../../src/types/illustration';
import type { PixelArtGridLayout } from '../../src/types/pixelart';

import { cameraText, PLAN_HARD_LIMIT, resolveDestDir, resolveModel, uniqueNamer } from './common';
import { getApiKey, sanitizeName } from './env';
import { readReferenceFile } from './imageio';
import { DEFAULT_OUTPUT, expectedFileCount, saveGeneratedImage, taskDir, type OutputOptions } from './output';
import { runPlan } from './runner';
import { gridEnum, guarded, modelOptionsSchema, runSchema, type RegisterTool } from './toolkit';
import type { WorkUnit } from './engine';

/** 앱 한도 (types/illustration.ts ILLUSTRATION_LIMITS) */
const MAX_CHARACTERS = 5;
const MAX_IMAGES_PER_CHARACTER = 3;
const MAX_BACKGROUNDS = 5;

interface RefPlan {
  references: string[];
  /** 대응표 — 프롬프트 끝에 붙인다 */
  map: string;
  dropped: number;
}

/**
 * 참조 이미지 예산 배분. 스케치(있으면)를 먼저 확보하고, 캐릭터당 1장 → 배경 → 캐릭터 추가 이미지 순으로 채운다.
 * 순서는 앱과 같게 [캐릭터들, 배경들, 스케치] 로 낸다.
 */
export function planIllustrationReferences(
  characters: { name: string; images: string[] }[],
  backgrounds: string[],
  sketch: string | undefined,
  maxRefs: number
): RefPlan {
  let budget = maxRefs - (sketch ? 1 : 0);
  const keep = characters.map(() => 0);
  // 1) 캐릭터당 1장
  characters.forEach((c, i) => {
    if (budget > 0 && c.images.length > 0) {
      keep[i] = 1;
      budget--;
    }
  });
  // 2) 배경
  const bgKeep = Math.min(backgrounds.length, Math.max(0, budget));
  budget -= bgKeep;
  // 3) 캐릭터 추가 이미지 (돌아가며 한 장씩)
  for (let round = 1; round < MAX_IMAGES_PER_CHARACTER && budget > 0; round++) {
    characters.forEach((c, i) => {
      if (budget > 0 && c.images.length > round) {
        keep[i]++;
        budget--;
      }
    });
  }

  const references: string[] = [];
  const lines: string[] = [];
  characters.forEach((c, i) => {
    if (keep[i] === 0) return;
    const start = references.length + 1;
    references.push(...c.images.slice(0, keep[i]));
    lines.push(`- Reference image${keep[i] > 1 ? `s ${start}-${references.length}` : ` ${start}`}: character "${c.name}"`);
  });
  if (bgKeep > 0) {
    const start = references.length + 1;
    references.push(...backgrounds.slice(0, bgKeep));
    lines.push(`- Reference image${bgKeep > 1 ? `s ${start}-${references.length}` : ` ${start}`}: background / environment reference`);
  }
  if (sketch) {
    references.push(sketch);
    lines.push(`- Reference image ${references.length} (last): composition sketch (layout guide only)`);
  }
  const total = characters.reduce((s, c) => s + c.images.length, 0) + backgrounds.length + (sketch ? 1 : 0);
  return {
    references,
    map: `\n\n🗂️ REFERENCE IMAGE MAP:\n${lines.join('\n')}`,
    dropped: total - references.length,
  };
}

export const registerIllustrationTool: RegisterTool = (server, { dataDir }) => {
  server.registerTool(
    'ss_illustration_batch',
    {
      description: [
        'StyleStudio 일러스트 세션으로 같은 캐릭터 세트(최대 5명, 캐릭터당 이미지 3장)를 여러 장면에 등장시킨다 (백그라운드 작업).',
        'scenes[] 마다 장면 프롬프트·카메라·그리드·구도 스케치를 따로 줄 수 있다.',
        '구도 스케치에 labels(캐릭터 이름 + 0~1 좌표)를 주면 앱과 같은 스케치 분석으로 좌우·원근 배치를 지킨다(장면당 분석 1회).',
      ].join(' '),
      inputSchema: {
        characters: z
          .array(z.object({ name: z.string(), images: z.array(z.string()).min(1).max(MAX_IMAGES_PER_CHARACTER) }))
          .min(1)
          .max(MAX_CHARACTERS),
        backgrounds: z.array(z.string()).max(MAX_BACKGROUNDS).optional().describe('배경 참조 이미지'),
        scenes: z
          .array(
            z.object({
              name: z.string().optional(),
              prompt: z.string().optional().describe('장면 설명 (비면 "Create an illustration with the characters")'),
              count: z.number().int().positive().max(100).optional(),
              grid: gridEnum.optional(),
              camera_angle: z.string().optional(),
              camera_lens: z.string().optional(),
              sketch: z
                .object({
                  path: z.string().describe('구도 스케치 이미지'),
                  labels: z
                    .array(z.object({ character: z.string(), x: z.number().min(0).max(1), y: z.number().min(0).max(1) }))
                    .optional()
                    .describe('캐릭터 이름과 스케치상 위치 (0~1). 주면 스케치 분석을 한다'),
                })
                .optional(),
              aspect_ratio: z.string().optional(),
            })
          )
          .min(1)
          .max(200),
        options: z.object({ ...modelOptionsSchema }).optional(),
        ...runSchema,
      },
    },
    (input) =>
      guarded(async () => {
        const opts = input.options ?? {};
        const checks = resolveModel(opts.model);
        const { model } = checks;
        const quality = checks.quality(opts.quality);
        const imageSize = checks.size(opts.image_size);

        // 캐릭터·배경 이미지는 한 번만 읽어 모든 장면이 공유한다
        const characters = input.characters.map((c, i) => ({
          id: `char-${i + 1}`,
          name: c.name,
          images: c.images.map(readReferenceFile),
        }));
        const backgrounds = (input.backgrounds ?? []).map(readReferenceFile);
        const illustrationCharacters: IllustrationCharacter[] = characters.map((c) => ({ id: c.id, name: c.name, images: c.images }));

        const nameOf = uniqueNamer();
        const perRequest = Math.max(1, model.supports.maxImagesPerRequest);
        const output: OutputOptions = { ...DEFAULT_OUTPUT };

        type Planned = {
          name: string;
          scene: (typeof input.scenes)[number];
          grid: PixelArtGridLayout;
          n: number;
          firstSeq: number;
          refs: RefPlan;
          sketchPng?: string;
          labels?: SketchLabel[];
          aspectRatio: string;
        };
        const planned: Planned[] = [];
        input.scenes.forEach((scene, index) => {
          const name = nameOf(sanitizeName(scene.name ?? scene.prompt?.slice(0, 40) ?? '', `scene-${index + 1}`));
          const sketchPng = scene.sketch ? readReferenceFile(scene.sketch.path) : undefined;
          const labels: SketchLabel[] | undefined = scene.sketch?.labels?.map((l, i) => ({
            id: `label-${i + 1}`,
            text: l.character,
            x: l.x,
            y: l.y,
            characterId: characters.find((c) => c.name === l.character)?.id,
          }));
          const refs = planIllustrationReferences(characters, backgrounds, sketchPng, model.supports.maxReferenceImages);
          const count = Math.max(1, scene.count ?? 1);
          for (let made = 0; made < count; made += perRequest) {
            if (planned.length >= PLAN_HARD_LIMIT) throw new Error(`요청이 ${PLAN_HARD_LIMIT}건을 넘는 배치는 계획하지 않습니다.`);
            planned.push({
              name,
              scene,
              grid: (scene.grid ?? '1x1') as PixelArtGridLayout,
              n: Math.min(perRequest, count - made),
              firstSeq: made + 1,
              refs,
              sketchPng,
              labels,
              aspectRatio: checks.aspect(scene.aspect_ratio ?? opts.aspect_ratio),
            });
          }
        });

        const destDir = resolveDestDir(dataDir, input.dest_dir, 'illustration', new Set(planned.map((p) => p.name)));
        // 같은 스케치 분석은 장면당 1회만 (count 로 요청이 나뉘어도 공유)
        const sketchAnalyses = new Map<string, ReturnType<typeof analyzeCompositionSketch>>();

        const units: WorkUnit[] = planned.map((p) => {
          const dir = taskDir(destDir, p.name);
          const call = { aspectRatio: p.aspectRatio, imageSize, quality, n: p.n, references: p.refs.references };
          return {
            label: p.name,
            grid: p.grid,
            images: p.n,
            expectedFiles: expectedFileCount(p.grid, p.n, undefined, output),
            call,
            texts: [p.scene.prompt],
            rawDir: dir,
            run: async (ctx) => {
              let analysis;
              if (p.sketchPng && p.labels && p.labels.length > 0) {
                let pending = sketchAnalyses.get(p.name);
                if (!pending) {
                  pending = analyzeCompositionSketch({
                    apiKey: getApiKey(dataDir),
                    sketchPng: p.sketchPng,
                    labels: p.labels,
                    characters: illustrationCharacters,
                  });
                  sketchAnalyses.set(p.name, pending);
                }
                analysis = await pending;
              }
              const illustrationData: IllustrationSessionData = {
                characters: illustrationCharacters,
                backgroundImages: backgrounds,
                conceptSketch: p.sketchPng ? { sketchPng: p.sketchPng, labels: p.labels ?? [], analysis } : undefined,
              };
              const prompt =
                buildPromptForSession({
                  basePrompt: ctx.tr(p.scene.prompt) || 'Create an illustration with the characters',
                  hasReferenceImages: true,
                  sessionType: 'ILLUSTRATION',
                  illustrationData,
                  pixelArtGrid: p.grid,
                  cameraSettings: cameraText(p.scene.camera_angle, p.scene.camera_lens),
                }) + p.refs.map;
              const images = await ctx.generate(prompt, call);
              const files: string[] = [];
              for (const [i, bytes] of images.entries()) {
                const sheetBase = `${p.name}_${String(p.firstSeq + i).padStart(2, '0')}`;
                files.push(
                  ...(await ctx.saveSafely(
                    bytes,
                    () => saveGeneratedImage(bytes, { dir, sheetBase, grid: p.grid, options: output }),
                    dir,
                    sheetBase
                  ))
                );
              }
              return files;
            },
          };
        });

        // 장면마다 스케치 유무로 잘리는 수가 다르다 — 가장 많이 잘린 장면 기준으로 알린다
        const dropped = Math.max(0, ...planned.map((p) => p.refs.dropped));
        return runPlan(dataDir, {
          kind: 'ILLUSTRATION',
          model,
          units,
          destDir,
          concurrency: input.concurrency,
          translate: opts.translate,
          meta: {
            session_type: 'ILLUSTRATION',
            characters: characters.map((c) => `${c.name}(${c.images.length})`),
            backgrounds: backgrounds.length,
            reference_budget: model.supports.maxReferenceImages,
            references_dropped_for_budget: dropped,
          },
          breakdown: planned.map((p) => ({
            scene: p.name,
            grid: p.grid,
            n: p.n,
            references: p.refs.references.length,
            sketch: !!p.sketchPng,
            sketch_analysis: !!(p.labels && p.labels.length > 0),
          })),
          max_requests: input.max_requests,
          max_images: input.max_images,
          max_cost_usd: input.max_cost_usd,
          dry_run: input.dry_run,
          wait_seconds: input.wait_seconds,
        });
      })
  );
};
