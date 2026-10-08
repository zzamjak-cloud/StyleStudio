/**
 * 컨셉 세션 배치 (`ss_concept_batch`) — 게임 컨셉 아트를 장르·플레이 방식·레퍼런스 게임·아트 스타일
 * 조합으로 대량 생성한다.
 *
 * 앱과 같은 규칙 (`useConceptGeneration` → 공유 `lib/prompts/conceptPrompt.ts`):
 * - 프롬프트가 비면 장르·플레이 방식·레퍼런스 게임·아트 스타일로 자동 구성, 그리드면 "N개의 다양한 베리에이션"
 * - 참조 이미지(1장)가 있을 때만 CONCEPT 세션 템플릿을 한 번 씌운다
 * - 크기 1k/2k/3k → 1K/2K/4K (Gemini 계열만 의미 있음), 기본 비율 9:16
 * - 앱은 컨셉 프롬프트를 번역하지 않는다 — 기본은 그대로 보내고 `translate: true` 일 때만 번역한다
 *
 * 배치 레버: `matrix` 로 장르 × 아트 스타일 조합을 한 번에 펼친다.
 */

import { z } from 'zod';

import { buildPromptForSession } from '../../src/lib/prompts/sessionPrompts';
import { buildConceptBasePrompt, CONCEPT_SIZE_MAP } from '../../src/lib/prompts/conceptPrompt';
import type { PixelArtGridLayout } from '../../src/types/pixelart';

import { PLAN_HARD_LIMIT, resolveDestDir, resolveModel, uniqueNamer } from './common';
import { sanitizeName } from './env';
import { readReferenceFile } from './imageio';
import { DEFAULT_OUTPUT, expectedFileCount, saveGeneratedImage, taskDir, type OutputOptions } from './output';
import { runPlan } from './runner';
import { guarded, modelOptionsSchema, runSchema, type RegisterTool } from './toolkit';
import type { WorkUnit } from './engine';

const conceptGrid = z.enum(['1x1', '2x2', '3x3', '4x4']);
const conceptSize = z.enum(['1k', '2k', '3k']);

const conceptFields = {
  prompt: z.string().optional().describe('직접 쓴 프롬프트 (있으면 자동 구성 대신 사용)'),
  genres: z.array(z.string()).optional().describe('게임 장르 (예: 퍼즐, 하이퍼 캐주얼 — ss_models 의 concept_presets)'),
  play_style: z.string().optional().describe('게임 플레이 방식'),
  reference_games: z.array(z.string()).optional().describe('레퍼런스 게임'),
  art_styles: z.array(z.string()).optional().describe('아트 스타일 (예: 카툰 렌더, 로우 폴리)'),
  reference_image: z.string().optional().describe('참조 이미지 파일 (1장 — 있으면 컨셉 템플릿 적용)'),
  grid: conceptGrid.optional().describe('한 장 안의 베리에이션 그리드 (기본 1x1)'),
  count: z.number().int().positive().max(200).optional().describe('같은 설정으로 만들 장수 (gpt 계열은 요청당 최대 10장)'),
};

export const registerConceptTool: RegisterTool = (server, { dataDir }) => {
  server.registerTool(
    'ss_concept_batch',
    {
      description: [
        'StyleStudio 컨셉 세션으로 게임 컨셉 아트를 대량 생성한다 (백그라운드 작업).',
        'concepts[] 로 개별 지정하거나, matrix 로 장르 × 아트 스타일 조합을 한 번에 펼친다.',
        '공통값은 defaults 에 둔다. 기본 비율 9:16, 크기 1k (2k·3k 는 Gemini 계열만).',
        '그리드(2x2~4x4)면 한 장에 여러 안이 나오고 split_grid(기본 true)로 셀 파일도 만든다.',
      ].join(' '),
      inputSchema: {
        concepts: z.array(z.object({ name: z.string().optional(), ...conceptFields })).max(200).optional(),
        matrix: z
          .object({
            genres: z.array(z.string()).min(1).max(30),
            art_styles: z.array(z.string()).min(1).max(30),
          })
          .optional()
          .describe('장르 × 아트 스타일 조합을 모두 만든다 (defaults 의 나머지 값과 합쳐짐 — defaults.prompt 는 자동 구성 뒤 추가 지시로 붙는다)'),
        defaults: z.object({ ...conceptFields }).optional(),
        options: z
          .object({
            ...modelOptionsSchema,
            size: conceptSize.optional().describe('1k | 2k | 3k (Gemini 계열만 의미, 3k→4K)'),
            split_grid: z.boolean().optional(),
            keep_sheet: z.boolean().optional(),
            output_format: z.enum(['png', 'jpg']).optional(),
          })
          .optional(),
        ...runSchema,
      },
    },
    (input) =>
      guarded(async () => {
        const opts = input.options ?? {};
        const checks = resolveModel(opts.model);
        const { model } = checks;
        const defaults = input.defaults ?? {};

        // 개별 지정 + 매트릭스 조합 → 컨셉 목록
        // extra: matrix 행에서 defaults.prompt 를 자동 구성 뒤에 붙이는 추가 지시
        type Concept = z.infer<z.ZodObject<typeof conceptFields>> & { name?: string; extra?: string };
        const list: Concept[] = (input.concepts ?? []).map((c) => ({ ...defaults, ...c }));
        if (input.matrix) {
          for (const genre of input.matrix.genres) {
            for (const style of input.matrix.art_styles) {
              // defaults.prompt 를 prompt 로 두면 앱 규칙상 자동 구성이 생략돼 조합이 사라진다 — 추가 지시로 돌린다
              list.push({ ...defaults, prompt: undefined, extra: defaults.prompt, genres: [genre], art_styles: [style], name: `${genre}_${style}` });
            }
          }
        }
        if (list.length === 0) list.push({ ...defaults });

        const output: OutputOptions = {
          ...DEFAULT_OUTPUT,
          split_grid: opts.split_grid !== false,
          keep_sheet: opts.keep_sheet !== false,
          output_format: opts.output_format ?? 'png',
        };
        const nameOf = uniqueNamer();
        const perRequest = Math.max(1, model.supports.maxImagesPerRequest);

        type Planned = { name: string; base: string; ref?: string; grid: PixelArtGridLayout; n: number; firstSeq: number };
        const planned: Planned[] = [];
        for (const c of list) {
          const grid = (c.grid ?? '1x1') as PixelArtGridLayout;
          const auto = buildConceptBasePrompt({
            prompt: c.prompt,
            gameGenres: c.genres ?? [],
            gamePlayStyle: c.play_style,
            referenceGames: c.reference_games,
            artStyles: c.art_styles ?? [],
            grid: grid as '1x1' | '2x2' | '3x3' | '4x4',
          });
          const base = c.extra?.trim() ? `${auto}, ${c.extra.trim()}` : auto;
          const name = nameOf(sanitizeName(c.name ?? base.slice(0, 40), 'concept'));
          const ref = c.reference_image ? readReferenceFile(c.reference_image) : undefined;
          const count = Math.max(1, c.count ?? 1);
          for (let made = 0; made < count; made += perRequest) {
            if (planned.length >= PLAN_HARD_LIMIT) throw new Error(`요청이 ${PLAN_HARD_LIMIT}건을 넘는 배치는 계획하지 않습니다.`);
            planned.push({ name, base, ref, grid, n: Math.min(perRequest, count - made), firstSeq: made + 1 });
          }
        }

        const aspectRatio = checks.aspect(opts.aspect_ratio, '9:16');
        const imageSize = checks.size(CONCEPT_SIZE_MAP[(opts.size ?? '1k') as '1k' | '2k' | '3k']);
        const quality = checks.quality(opts.quality);
        const destDir = resolveDestDir(dataDir, input.dest_dir, 'concept', new Set(planned.map((p) => p.name)));
        const translate = opts.translate === true;

        const units: WorkUnit[] = planned.map((p) => {
          const dir = taskDir(destDir, p.name);
          return {
            label: p.name,
            grid: p.grid,
            images: p.n,
            expectedFiles: expectedFileCount(p.grid, p.n, undefined, output),
            call: { aspectRatio, imageSize, quality, n: p.n, references: p.ref ? [p.ref] : [] },
            texts: translate ? [p.base] : [],
            rawDir: dir,
            // 앱과 같이 참조 이미지가 있을 때만 CONCEPT 템플릿 1회
            buildPrompt: (tr) =>
              buildPromptForSession({
                basePrompt: (translate ? tr(p.base) : p.base) ?? p.base,
                hasReferenceImages: !!p.ref,
                sessionType: 'CONCEPT',
              }),
            save: (bytes, i) =>
              saveGeneratedImage(bytes, {
                dir,
                sheetBase: `${p.name}_${String(p.firstSeq + i).padStart(2, '0')}`,
                grid: p.grid,
                options: output,
              }),
          };
        });

        return runPlan(dataDir, {
          kind: 'CONCEPT',
          model,
          units,
          destDir,
          concurrency: input.concurrency,
          translate,
          meta: { session_type: 'CONCEPT', concepts: list.length },
          breakdown: planned.map((p) => ({ concept: p.name, prompt: p.base, grid: p.grid, n: p.n, reference_image: !!p.ref })),
          max_requests: input.max_requests,
          max_images: input.max_images,
          max_cost_usd: input.max_cost_usd,
          dry_run: input.dry_run,
          wait_seconds: input.wait_seconds,
        });
      })
  );
};
