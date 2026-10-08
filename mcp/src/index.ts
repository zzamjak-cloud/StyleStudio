/**
 * StyleStudio MCP 서버 (`ss-mcp`) — AI 에이전트용 대량 배치 생성
 *
 * Claude Code·Codex 같은 로컬 에이전트가 StyleStudio 의 세션별 생성 기능(생성기 세션·컨셉·일러스트·
 * 편집 체인·타일맵, 참조 분석·문서)을 앱 없이 대량으로 쓰게 한다.
 * - 앱이 꺼져 있어도 동작한다. OpenRouter 키는 앱 설정(settings.json)에서 읽는다.
 * - 결과는 파일로만 남긴다. 앱 데이터에는 쓰지 않는다.
 * - 프롬프트·분석·모델 정의·합성기는 앱 소스(`src/`)를 그대로 번들해 앱과 어긋나지 않는다.
 * - stdout 은 MCP 프로토콜 전용이다. 진단은 stderr 로만 낸다 (stdio-guard 가 첫 import).
 *
 * → wiki/infra/mcp.md
 */

import './stdio-guard';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readFileSync } from 'node:fs';
import { basename, dirname, extname, resolve } from 'node:path';
import { z } from 'zod';

import appPackage from '../../package.json';
import { getTilemapImageModels, IMAGE_MODELS, type ImageModelDefinition } from '../../src/hooks/api/imageModels';
import { TILEMAP_EDGE_STYLES } from '../../src/lib/tilemap/edgeStyles';
import { CAMERA_ANGLES } from '../../src/types/cameraAngle';
import { CAMERA_LENSES } from '../../src/types/cameraLens';
import { ANALYSIS_MODELS } from '../../src/types/constants';
import { GAME_GENRE_PRESETS, ART_STYLE_PRESETS } from '../../src/types/concept';
import { OPENROUTER_BASE_URL, openrouterHeaders } from '../../src/lib/api/openrouter';
import { pixelateRgba } from '../../src/lib/pixelart/pixelate';

import {
  apiKeySource,
  assertWritable,
  defaultOutputRoot,
  getApiKey,
  hasApiKey,
  listSessions,
  resolveDataDir,
  sanitizeName,
  stateDir,
  writeUnique,
} from './env';
import { planGeneratorBatch, type BatchInput } from './batch';
import { getJob, jobSummary, listJobs, waitForJob } from './engine';
import { runPlan } from './runner';
import { splitCells } from './output';
import { analyzeToProfile, ANALYZABLE_SESSION_TYPES } from './analyze';
import { allAverages } from './costlog';
import { decodeImage, encodePng, upscaleNearest } from './imageio';
import { GENERATOR_SESSION_TYPES, GRID_LAYOUTS, isPixelSession, usesWhiteBackground } from './prompt';
import {
  documentsSchema,
  gridEnum,
  guarded,
  modelOptionsSchema,
  pixelateSchema,
  runSchema,
  styleSchema,
  type ToolContext,
} from './toolkit';
import { registerConceptTool } from './concept';
import { registerIllustrationTool } from './illustration';
import { registerChainTool } from './chain';
import { registerTilemapTool } from './tilemap';

// 앱 버전과 같다 — 앱이 다운로드한 실행 파일·번들 스크립트가 현재 앱과 맞는지 --version 으로 검증한다
const VERSION: string = appPackage.version;
const dataDir = resolveDataDir();
const ctx: ToolContext = { dataDir };

function describeModel(model: ImageModelDefinition) {
  return {
    id: model.id,
    label: model.label,
    provider: model.provider,
    aspect_ratios: model.supports.aspectRatios,
    image_sizes: model.provider === 'gemini' ? model.supports.imageSizes : ['1K (고정)'],
    qualities: model.provider === 'openai' ? model.supports.qualities : [],
    max_reference_images: model.supports.maxReferenceImages,
    max_images_per_request: model.supports.maxImagesPerRequest,
    transparent_background: model.supports.transparentBackground,
  };
}

const server = new McpServer(
  { name: 'stylestudio', version: VERSION },
  {
    instructions: [
      'StyleStudio(AI 게임 아트 앱)의 세션별 이미지 생성 기능을 대량 배치로 쓰는 서버다. 앱이 꺼져 있어도 앱 설정의 OpenRouter 키로 동작하며 결과는 파일로만 저장한다.',
      '세션별 도구: ss_generate_batch(스타일·캐릭터·배경·아이콘·UI·로고·픽셀아트) · ss_concept_batch(게임 컨셉 아트) · ss_illustration_batch(다중 캐릭터 일러스트) · ss_edit_chain(대화형 이어서 편집) · ss_tilemap_batch(타일맵 변형 세트·룰타일 → 유니티용 타일).',
      '권장 흐름: ss_models(모델·옵션 확인) → [필요 시] ss_analyze(참조 이미지 → 스타일 프로필, 1회) → 각 도구를 dry_run=true 로 호출해 요청 수·견적 확인 → 실행 → ss_job_status 로 진행 확인.',
      '비용 절감: 같은 종류 여러 개(아이콘·포즈 목록)는 ss_generate_batch 의 tasks[].items 에 나열하라 — 그리드 셀에 나눠 담아 호출 1회로 여러 개를 얻고 셀별 파일로 자른다. 같은 프롬프트의 여러 장은 count 를 쓰면 gpt 계열은 요청 1회에 최대 10장. 품질은 low < medium < high 순으로 비싸다.',
      '기존 StyleStudio 세션의 화풍을 쓰려면 ss_list_sessions 로 id 를 찾아 style.session_id 로 넘긴다.',
      '실행은 백그라운드 작업이다. 응답이 running 이면 ss_job_status(job_id) 로 다시 조회한다.',
    ].join('\n'),
  }
);

// ───────────────────────── 조회 ─────────────────────────

server.registerTool(
  'ss_info',
  {
    description: '서버 상태: 앱 데이터 경로, OpenRouter 키 설정 여부·출처와 크레딧, 기본 출력 폴더, 진행 중 작업.',
    inputSchema: {},
  },
  () =>
    guarded(async () => {
      let credit: unknown = null;
      if (hasApiKey(dataDir)) {
        try {
          const res = await fetch(`${OPENROUTER_BASE_URL}/key`, {
            headers: openrouterHeaders(getApiKey(dataDir)),
            signal: AbortSignal.timeout(15_000),
          });
          const body = (await res.json()) as { data?: Record<string, unknown> };
          const d = body.data ?? {};
          credit = { usage_usd: d.usage ?? null, limit_usd: d.limit ?? null, limit_remaining_usd: d.limit_remaining ?? null };
        } catch {
          credit = '조회 실패';
        }
      }
      return {
        version: VERSION,
        data_dir: dataDir,
        api_key_configured: hasApiKey(dataDir),
        // env 면 OPENROUTER_API_KEY 환경변수 계정으로 과금된다 (앱에 저장된 키가 아님)
        api_key_source: apiKeySource(),
        credit,
        default_output_dir: defaultOutputRoot(),
        state_dir: stateDir(),
        jobs: listJobs().map((j) => ({ job_id: j.id, kind: j.kind, status: j.status, progress: `${j.completed + j.failed}/${j.total}` })),
      };
    })
);

server.registerTool(
  'ss_models',
  {
    description:
      '이미지 모델별 지원 옵션(비율·크기·품질·참조 상한·요청당 장수·투명 배경), 세션 타입별 기능, 카메라 프리셋 id, 컨셉 프리셋, 실측 평균 비용.',
    inputSchema: {},
  },
  () =>
    guarded(() => ({
      image_models: IMAGE_MODELS.filter((m) => m.availability === 'available').map(describeModel),
      default_model: 'openai/gpt-image-2',
      analysis_models: ANALYSIS_MODELS.map((m) => ({ id: m.id, label: m.label, description: m.description })),
      generator_session_types: GENERATOR_SESSION_TYPES.map((t) => ({
        type: t,
        white_background: usesWhiteBackground(t),
        transparent_background_capable: usesWhiteBackground(t),
        pixel_normalization: isPixelSession(t),
        uses_reference_documents: t === 'UI',
      })),
      grids: GRID_LAYOUTS,
      camera_angles: CAMERA_ANGLES.filter((a) => a.id !== 'none').map((a) => a.id),
      camera_lenses: CAMERA_LENSES.filter((l) => l.id !== 'none').map((l) => l.id),
      concept_presets: { genres: GAME_GENRE_PRESETS, art_styles: ART_STYLE_PRESETS },
      // 타일맵은 앱과 같은 고정값을 쓴다 — 1:1, 덕테이프 계열만, 룰타일은 8x8
      tilemap: {
        models: getTilemapImageModels().map((m) => m.id),
        aspect_ratio: '1:1',
        modes: { variation: { grids: ['4x4', '8x8'] }, ruletile: { grids: ['8x8'] } },
        edge_styles: TILEMAP_EDGE_STYLES.map((e) => ({ id: e.id, label: e.label })),
        analysis: "ss_analyze session_type='TILEMAP' 프로필의 tilemap_specific 이 화풍 지시로 들어간다",
      },
      pixelate: { size: ['auto', 32, 64, 128], palette_size: ['auto', 8, 16, 32, 48] },
      measured_costs: allAverages(),
    }))
);

server.registerTool(
  'ss_list_sessions',
  {
    description:
      'StyleStudio 세션 목록(최근 수정순). 화풍을 재사용할 세션을 고를 때 쓴다 — has_analysis 와 reference_count 를 확인하고 각 도구의 style.session_id 로 넘긴다.',
    inputSchema: {
      query: z.string().optional().describe('세션 이름에 포함될 문자열'),
      session_type: z.string().optional().describe('세션 타입 필터 (예: ICON, CHARACTER)'),
      limit: z.number().int().positive().optional().describe('최대 결과 수 (기본 50)'),
    },
  },
  ({ query, session_type, limit }) =>
    guarded(() => {
      const q = query?.toLowerCase();
      const sessions = listSessions(dataDir)
        .filter((s) => !q || s.name.toLowerCase().includes(q))
        .filter((s) => !session_type || s.type === session_type.toUpperCase());
      return { total: sessions.length, sessions: sessions.slice(0, limit ?? 50) };
    })
);

// ───────────────────────── 분석 ─────────────────────────

server.registerTool(
  'ss_analyze',
  {
    description:
      '참조 이미지를 앱의 세션 타입별 분석 프롬프트로 분석해 스타일 프로필 JSON 으로 저장한다(분석 호출 1회). 이후 각 도구의 style.profile_path 로 재사용하면 배치마다 분석 비용이 들지 않는다. 타일맵은 session_type=TILEMAP 으로 분석한다.',
    inputSchema: {
      session_type: z.enum(ANALYZABLE_SESSION_TYPES).describe('분석 프롬프트를 고를 세션 타입'),
      image_paths: z.array(z.string()).optional().describe('참조 이미지 파일 경로 (png/jpg/webp, 최대 14장)'),
      session_id: z.string().optional().describe('기존 세션의 참조 이미지를 분석할 때'),
      analysis_model: z.string().optional().describe('분석 모델 (기본 google/gemini-3.8-flash)'),
      name: z.string().optional().describe('프로필 이름'),
      save_path: z.string().optional().describe('저장 경로 (.json 절대 경로, 기본 ~/Downloads/AI_Gen/MCP/styles/<name>.json)'),
      refine_profile_path: z.string().optional().describe('기존 프로필을 다듬는 분석 강화 모드'),
    },
  },
  (input) => guarded(() => analyzeToProfile(dataDir, input))
);

// ───────────────────────── 생성기 세션 ─────────────────────────

server.registerTool(
  'ss_generate_batch',
  {
    description: [
      'StyleStudio 생성기 세션 기능으로 이미지를 대량 생성해 파일로 저장한다 (백그라운드 작업).',
      '세션 타입: STYLE·CHARACTER·BACKGROUND·ICON·UI·LOGO·PIXELART_CHARACTER·PIXELART_BACKGROUND·PIXELART_ICON (BASIC=프롬프트 원문 그대로).',
      'tasks[].items: 항목 목록을 그리드 셀에 나눠 담는다(기본 상한 4x4=16개/호출) → 셀마다 "항목명.png" 로 잘라 저장.',
      'tasks[].count: 같은 프롬프트로 여러 장 (gpt 계열은 요청당 최대 10장). tasks[].grid: 한 장 안의 변형 그리드.',
      'style: session_id / profile_path / reference_images / style_text. UI 세션은 options.reference_documents 로 기획 문서(pdf·xlsx·웹)를 넣는다.',
      'dry_run=true 면 API 를 호출하지 않고 요청 수·이미지 수·견적만 돌려준다.',
    ].join(' '),
    inputSchema: {
      session_type: z.enum(GENERATOR_SESSION_TYPES),
      style: styleSchema,
      tasks: z
        .array(
          z.object({
            name: z.string().optional().describe('출력 하위 폴더·파일 이름'),
            prompt: z.string().optional().describe('생성 내용 (items 가 있으면 공통 설명)'),
            items: z.array(z.string()).max(1000).optional().describe('셀 하나에 하나씩 그릴 항목 목록 (최대 1000)'),
            count: z.number().int().positive().max(1000).optional().describe('이 프롬프트로 만들 이미지 수 (items 와 함께 쓰지 않음)'),
            grid: gridEnum.optional().describe('items: 묶음 상한 / prompt: 한 장 안의 변형 그리드'),
            aspect_ratio: z.string().optional(),
            quality: z.string().optional(),
            image_size: z.string().optional(),
            negative_prompt: z.string().optional(),
          })
        )
        .min(1)
        .max(200),
      options: z
        .object({
          ...modelOptionsSchema,
          max_grid: gridEnum.optional().describe('items 묶음 그리드 상한 (기본 4x4)'),
          transparent_background: z.boolean().optional().describe('알파 PNG (gpt-image-2.5 계열 + 흰 배경 세션만)'),
          camera_angle: z.string().optional(),
          camera_lens: z.string().optional(),
          negative_prompt: z.string().optional(),
          reference_documents: documentsSchema.describe('UI 세션 기획 문서'),
          pixelate: pixelateSchema.describe('픽셀 세션 정규화 (기본 켜짐, auto)'),
          pixel_output: z.enum(['logical', 'upscaled', 'both']).optional().describe('픽셀 결과 저장 형태 (기본 both)'),
          split_grid: z.boolean().optional().describe('그리드를 셀 파일로 자를지 (기본 true)'),
          keep_sheet: z.boolean().optional().describe('자르기 전 시트도 저장 (기본 true)'),
          output_format: z.enum(['png', 'jpg']).optional().describe('기본 png'),
        })
        .optional(),
      ...runSchema,
    },
  },
  (input) => guarded(async () => runPlan(dataDir, await planGeneratorBatch(dataDir, input as unknown as BatchInput)))
);

// ───────────────────────── 세션별 도구 ─────────────────────────

registerConceptTool(server, ctx);
registerIllustrationTool(server, ctx);
registerChainTool(server, ctx);
registerTilemapTool(server, ctx);

// ───────────────────────── 작업 ─────────────────────────

server.registerTool(
  'ss_job_status',
  {
    description: '배치 작업 진행·결과 조회. wait_seconds 동안 완료를 기다렸다가 응답한다.',
    inputSchema: {
      job_id: z.string(),
      wait_seconds: z.number().min(0).max(600).optional().describe('기본 30초'),
    },
  },
  ({ job_id, wait_seconds }) =>
    guarded(async () => {
      const job = getJob(job_id);
      if (!job) {
        throw new Error(
          `작업을 찾을 수 없습니다: ${job_id}. 서버가 재시작되면 작업 목록이 사라집니다 — 결과는 출력 폴더의 manifest 를 확인하세요.`
        );
      }
      if (job.status === 'running') await waitForJob(job, (wait_seconds ?? 30) * 1000);
      return jobSummary(job);
    })
);

server.registerTool(
  'ss_cancel_job',
  {
    description: '배치 작업 취소. 이미 보낸 요청은 끝까지 받고, 대기 중인 요청은 보내지 않는다.',
    inputSchema: { job_id: z.string() },
  },
  ({ job_id }) =>
    guarded(() => {
      const job = getJob(job_id);
      if (!job) throw new Error(`작업을 찾을 수 없습니다: ${job_id}`);
      job.cancelRequested = true;
      return jobSummary(job);
    })
);

// ───────────────────────── 후처리 ─────────────────────────

/** 후처리 출력 폴더 — 앱 데이터 폴더 안이면 거부 (원본 옆이 기본이라 세션 이미지 경로를 넣는 경우를 막는다) */
function outputDir(source: string, destDir: string | undefined): string {
  const dir = destDir ? resolve(destDir) : dirname(resolve(source));
  assertWritable(dir, dataDir);
  return dir;
}

server.registerTool(
  'ss_split_grid',
  {
    description: '이미 받은 그리드 이미지를 셀 PNG 로 균등 분할한다 (API 호출 없음). 원본은 그대로 둔다.',
    inputSchema: {
      paths: z.array(z.string()).min(1),
      grid: gridEnum,
      names: z.array(z.string()).optional().describe('셀 순서(좌→우, 위→아래)대로 붙일 파일 이름'),
      dest_dir: z.string().optional(),
    },
  },
  ({ paths, grid, names, dest_dir }) =>
    guarded(() => {
      const out: { input: string; files?: string[]; error?: string }[] = [];
      for (const path of paths) {
        try {
          const dir = outputDir(path, dest_dir);
          const stem = basename(path, extname(path));
          const cells = splitCells(decodeImage(readFileSync(path)), grid);
          const files = cells.map((cell, i) =>
            writeUnique(
              dir,
              names?.[i] ? sanitizeName(names[i], `${stem}_cell${i + 1}`) : `${stem}_cell${String(i + 1).padStart(2, '0')}`,
              'png',
              encodePng(cell)
            )
          );
          out.push({ input: path, files });
        } catch (error) {
          out.push({ input: path, error: (error as Error).message });
        }
      }
      return { results: out };
    })
);

server.registerTool(
  'ss_pixelate',
  {
    description:
      '이미지 파일에 앱과 같은 픽셀 정규화(격자 정렬·팔레트 양자화)를 적용한다 (API 호출 없음). 논리 해상도 PNG 와 정수배 확대본을 새 파일로 만든다.',
    inputSchema: {
      paths: z.array(z.string()).min(1),
      size: z.union([z.literal('auto'), z.literal(32), z.literal(64), z.literal(128)]).optional(),
      palette_size: z.union([z.literal('auto'), z.literal(8), z.literal(16), z.literal(32), z.literal(48)]).optional(),
      grid: gridEnum.optional().describe('스프라이트 시트면 그리드를 주면 격자를 셀 경계에 맞춘다'),
      dest_dir: z.string().optional(),
    },
  },
  ({ paths, size, palette_size, grid, dest_dir }) =>
    guarded(() => {
      const out: { input: string; logical?: string; upscaled?: string; size?: string; colors?: number; error?: string }[] = [];
      for (const path of paths) {
        try {
          const { logical, palette } = pixelateRgba(decodeImage(readFileSync(path)), {
            size: size ?? 'auto',
            paletteSize: palette_size ?? 'auto',
            grid,
          });
          const dir = outputDir(path, dest_dir);
          const stem = basename(path, extname(path));
          const logicalPath = writeUnique(dir, `${stem}_px`, 'png', encodePng(logical));
          const scale = Math.max(1, Math.floor(512 / Math.max(logical.width, logical.height)));
          const upPath = writeUnique(dir, `${stem}_px@${scale}x`, 'png', encodePng(upscaleNearest(logical, scale)));
          out.push({ input: path, logical: logicalPath, upscaled: upPath, size: `${logical.width}x${logical.height}`, colors: palette.length });
        } catch (error) {
          out.push({ input: path, error: (error as Error).message });
        }
      }
      return { results: out };
    })
);

/**
 * 클라이언트가 연결을 끊으면(stdin 종료) 종료한다. 그대로 두면 프로세스가 남아 실행 파일을 잠근다.
 * 진행 중인 작업은 결과 파일이 남도록 마저 끝내되, 최대 10분까지만 기다린다.
 */
function exitWhenClientGone() {
  let exiting = false;
  const shutdown = async () => {
    if (exiting) return;
    exiting = true;
    const running = listJobs().filter((j) => j.status === 'running');
    if (running.length > 0) {
      console.error(`[ss-mcp] 클라이언트 종료 — 진행 중 작업 ${running.length}개를 마친 뒤 종료합니다`);
      await Promise.race([Promise.all(running.map((j) => j.done)), new Promise((r) => setTimeout(r, 10 * 60_000))]);
    }
    process.exit(0);
  };
  process.stdin.on('end', shutdown);
  process.stdin.on('close', shutdown);
}

async function main() {
  // 앱이 런타임·다운로드 검증에 쓴다 — 프로토콜을 시작하지 않고 버전만 찍고 끝낸다
  if (process.argv.includes('--version')) {
    process.stdout.write(`${VERSION}\n`);
    process.exit(0);
  }
  await server.connect(new StdioServerTransport());
  exitWhenClientGone();
  // stdout 은 프로토콜 전용 — 진단은 stderr
  console.error(`[ss-mcp ${VERSION}] data_dir=${dataDir} api_key=${hasApiKey(dataDir) ? 'ok' : 'missing'}`);
}

main().catch((error) => {
  console.error('[ss-mcp] 시작 실패:', error);
  process.exit(1);
});
