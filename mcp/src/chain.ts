/**
 * 편집 체인 (`ss_edit_chain`) — 채팅 세션의 "이어지는 편집"을 배치로 돌린다.
 *
 * 앱과 같은 규칙 (`useChatImageGeneration` → 공유 `lib/prompts/chatPrompt.ts`):
 * - 매 단계 프롬프트 = [이전 단계 대화 맥락(최근 6턴)] + [그리드·픽셀 모드 prefix] + [문서 요약] + 단계 지시
 * - 참조 이미지 = [직전 단계 결과(첫 단계는 start_image)] + 단계별 추가 이미지 — 직전 결과를 기준으로 고친다
 * - 채팅은 번역하지 않는다 (앱과 동일, `translate: true` 로 켤 수 있다)
 *
 * 체인 하나는 순차(단계가 직전 결과에 의존), 체인끼리는 병렬로 돈다.
 * 앱은 직전 결과를 JPEG(픽셀 모드는 정규화 확대본)로 저장해 다음 참조로 쓰지만, 여기서는 모델이 준
 * 원본 바이트를 그대로 다음 참조로 쓴다(재압축 손실 없음).
 */

import { z } from 'zod';

import type { ChatMessage } from '../../src/types/chat';
import type { PixelArtGridLayout } from '../../src/types/pixelart';
import { buildChatConversationContext, buildChatSettingsPrefix, composeChatPrompt } from '../../src/lib/prompts/chatPrompt';

import { PLAN_HARD_LIMIT, resolveDestDir, resolveModel, uniqueNamer } from './common';
import { sanitizeName } from './env';
import { readReferenceFile, toDataUrl } from './imageio';
import { loadDocuments } from './documents';
import { DEFAULT_OUTPUT, expectedFileCount, saveGeneratedImage, taskDir, type OutputOptions } from './output';
import { runPlan } from './runner';
import { documentsSchema, gridEnum, guarded, modelOptionsSchema, pixelateSchema, runSchema, type RegisterTool } from './toolkit';
import type { WorkUnit } from './engine';

/** 체인 하나의 최대 단계 수 */
const MAX_STEPS = 30;

export const registerChainTool: RegisterTool = (server, { dataDir }) => {
  server.registerTool(
    'ss_edit_chain',
    {
      description: [
        'StyleStudio 채팅 세션의 "이어서 편집하기"를 배치로 실행한다 (백그라운드 작업).',
        'chains[] 마다 시작 이미지(선택)와 단계별 지시(steps)를 주면, 매 단계가 직전 결과를 참조로 받아 고친다.',
        '체인끼리는 병렬, 체인 안은 순차. 단계마다 결과 파일을 남긴다 (예: 의상 바꾸기 → 포즈 바꾸기 → 배경 추가).',
        'options.pixel_art_mode 면 앱 채팅의 픽셀아트 모드처럼 픽셀 규칙을 넣고 결과를 픽셀 정규화한다.',
        'documents 는 앱처럼 요약해서(문서당 1회) 모든 단계에 넣는다.',
      ].join(' '),
      inputSchema: {
        chains: z
          .array(
            z.object({
              name: z.string().optional(),
              start_image: z.string().optional().describe('편집을 시작할 이미지 (없으면 첫 단계가 새로 생성)'),
              steps: z
                .array(
                  z.object({
                    prompt: z.string().describe('이 단계의 지시'),
                    images: z.array(z.string()).max(8).optional().describe('이 단계에 함께 첨부할 이미지'),
                  })
                )
                .min(1)
                .max(MAX_STEPS),
            })
          )
          .min(1)
          .max(100),
        documents: documentsSchema,
        options: z
          .object({
            ...modelOptionsSchema,
            grid: gridEnum.optional().describe('그리드 레이아웃 힌트 (prefix 로 전달)'),
            pixel_art_mode: z.boolean().optional(),
            pixelate: pixelateSchema,
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
        const aspectRatio = checks.aspect(opts.aspect_ratio);
        const imageSize = checks.size(opts.image_size);
        const quality = checks.quality(opts.quality);
        const grid = (opts.grid ?? '1x1') as PixelArtGridLayout;
        const pixelArtMode = !!opts.pixel_art_mode;
        const output: OutputOptions = {
          ...DEFAULT_OUTPUT,
          split_grid: false, // 체인 결과는 다음 단계의 편집 대상 — 시트 그대로 둔다
          pixelate: {
            enabled: pixelArtMode && opts.pixelate?.enabled !== false,
            size: opts.pixelate?.size ?? 'auto',
            palette_size: opts.pixelate?.palette_size ?? 'auto',
          },
        };
        const translate = opts.translate === true;
        const totalSteps = input.chains.reduce((s, c) => s + c.steps.length, 0);
        if (totalSteps > PLAN_HARD_LIMIT) throw new Error(`단계가 ${PLAN_HARD_LIMIT}개를 넘는 배치는 계획하지 않습니다.`);

        const nameOf = uniqueNamer();
        const chains = input.chains.map((c, i) => ({
          name: nameOf(sanitizeName(c.name ?? c.steps[0].prompt.slice(0, 30), `chain-${i + 1}`)),
          start: c.start_image ? readReferenceFile(c.start_image) : undefined,
          steps: c.steps.map((s) => ({ prompt: s.prompt, images: (s.images ?? []).map(readReferenceFile) })),
        }));
        const destDir = resolveDestDir(dataDir, input.dest_dir, 'chain', chains.map((c) => c.name));
        // 문서는 dry run 에서 요약 비용이 들지 않도록 실행할 때 한 번만 읽는다 (체인끼리 공유)
        let documentsPromise: ReturnType<typeof loadDocuments> | undefined;
        const documents = () => (documentsPromise ??= loadDocuments(dataDir, input.documents, { forPrompt: 'summary' }));
        const settingsPrefix = buildChatSettingsPrefix({ pixelArtGrid: grid, pixelArtMode });
        const maxRefs = model.supports.maxReferenceImages;

        const units: WorkUnit[] = chains.map((chain) => {
          const dir = taskDir(destDir, chain.name);
          return {
            label: chain.name,
            grid,
            images: chain.steps.length,
            requests: chain.steps.length,
            expectedFiles: chain.steps.length * expectedFileCount(grid, 1, undefined, output),
            // 견적용 대표값 — 실제 참조는 단계마다 정해진다
            call: { aspectRatio, imageSize, quality, n: 1, references: chain.start ? [chain.start] : [] },
            texts: translate ? chain.steps.map((s) => s.prompt) : [],
            rawDir: dir,
            run: async (ctx) => {
              const docs = await documents();
              const history: ChatMessage[] = [];
              let previous = chain.start;
              const files: string[] = [];
              for (const [index, step] of chain.steps.entries()) {
                const userMessage = (translate ? ctx.tr(step.prompt) : step.prompt) ?? step.prompt;
                const prompt = composeChatPrompt({
                  conversationContext: buildChatConversationContext(undefined, history),
                  settingsPrefix,
                  userMessage,
                  documents: docs,
                });
                // 직전 결과 + 단계 첨부 (중복 제거, 모델 상한)
                const references = Array.from(new Set([...(previous ? [previous] : []), ...step.images])).slice(0, maxRefs);
                const [bytes] = await ctx.generate(prompt, { aspectRatio, imageSize, quality, n: 1, references });
                const base = `${chain.name}_step${String(index + 1).padStart(2, '0')}`;
                files.push(
                  ...(await ctx.saveSafely(bytes, () => saveGeneratedImage(bytes, { dir, sheetBase: base, grid, options: output }), dir, base))
                );
                previous = toDataUrl(bytes);
                const now = new Date().toISOString();
                history.push(
                  { id: `u${index}`, role: 'user', content: step.prompt, images: step.images, timestamp: now },
                  { id: `a${index}`, role: 'assistant', content: '', images: [previous], timestamp: now, isGeneratedImage: true }
                );
              }
              return files;
            },
          };
        });

        return runPlan(dataDir, {
          kind: 'EDIT_CHAIN',
          model,
          units,
          destDir,
          concurrency: input.concurrency,
          translate,
          meta: { session_type: 'BASIC', chains: chains.length, steps: totalSteps, pixel_art_mode: pixelArtMode },
          breakdown: chains.map((c) => ({ chain: c.name, steps: c.steps.length, start_image: !!c.start })),
          max_requests: input.max_requests,
          max_images: input.max_images,
          max_cost_usd: input.max_cost_usd,
          dry_run: input.dry_run,
          wait_seconds: input.wait_seconds,
        });
      })
  );
};
