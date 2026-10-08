/**
 * 도구 등록 공통 — 응답 형식, 오류 처리, 여러 도구가 함께 쓰는 입력 스키마.
 * 세션 도구 모듈은 `register…Tool(server, ctx)` 를 내보내고 index.ts 가 호출한다.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export interface ToolContext {
  dataDir: string;
}

export type RegisterTool = (server: McpServer, ctx: ToolContext) => void;

/** 도구 응답: 사람이 읽기 쉬운 JSON 텍스트 */
export function ok(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

export function fail(error: unknown) {
  return { isError: true, content: [{ type: 'text' as const, text: (error as Error)?.message ?? String(error) }] };
}

export async function guarded<T>(fn: () => Promise<T> | T) {
  try {
    return ok(await fn());
  } catch (error) {
    return fail(error);
  }
}

// ───────────────────────── 공용 스키마 ─────────────────────────

export const gridEnum = z.enum(['1x1', '2x2', '3x3', '4x4', '6x6', '8x8']);

export const styleSchema = z
  .object({
    session_id: z.string().optional().describe('기존 StyleStudio 세션 id (분석 결과·참조 이미지 사용)'),
    profile_path: z.string().optional().describe('ss_analyze 로 만든 스타일 프로필 JSON'),
    reference_images: z.array(z.string()).optional().describe('참조 이미지 파일 경로'),
    analysis: z.record(z.string(), z.unknown()).optional().describe('ImageAnalysisResult JSON 직접 지정'),
    style_text: z.string().optional().describe('참조 이미지 없이 쓸 화풍 설명'),
    use_references: z.boolean().optional().describe('false 면 참조 이미지를 보내지 않는다 (분석만 사용)'),
  })
  .optional();

export const documentsSchema = z
  .array(
    z.object({
      name: z.string().optional(),
      content: z.string().optional().describe('본문 직접 지정'),
      path: z.string().optional().describe('pdf·xlsx·xls·csv·md·txt·json 파일'),
      url: z.string().optional().describe('웹페이지 또는 구글 스프레드시트 URL'),
    })
  )
  .max(20)
  .optional();

export const pixelateSchema = z
  .object({
    enabled: z.boolean().optional(),
    size: z.union([z.literal('auto'), z.literal(32), z.literal(64), z.literal(128)]).optional(),
    palette_size: z.union([z.literal('auto'), z.literal(8), z.literal(16), z.literal(32), z.literal(48)]).optional(),
  })
  .optional();

/** 실행 제어 — 모든 생성 도구 공통 (출력 폴더·동시성·안전 상한·dry run·대기) */
export const runSchema = {
  dest_dir: z.string().optional().describe('출력 폴더 (절대 경로, 기본 ~/Downloads/AI_Gen/MCP/<종류>_<시각>)'),
  concurrency: z.number().int().min(1).max(8).optional().describe('동시 실행 수 (기본 4)'),
  max_requests: z.number().int().positive().optional().describe('요청 수 안전 상한 (기본 30)'),
  max_images: z.number().int().positive().optional().describe('생성 이미지 수 안전 상한 (기본 60)'),
  max_cost_usd: z.number().positive().optional().describe('견적이 이 금액을 넘으면 실행하지 않는다 (실측 기록이 있을 때만 판정)'),
  dry_run: z.boolean().optional().describe('true 면 API 를 호출하지 않고 요청 수·견적만 돌려준다'),
  wait_seconds: z.number().min(0).max(600).optional().describe('응답 전 기다릴 시간 (기본 40초 — Codex 기본 타임아웃 60초 이내)'),
};

export const modelOptionsSchema = {
  model: z.string().optional().describe('기본 openai/gpt-image-2 (ss_models 참고)'),
  quality: z.string().optional().describe('gpt 계열: low|medium|high (2.5 계열은 xhigh|max). 기본 medium'),
  image_size: z.string().optional().describe('gemini 계열: 1K|2K|4K. 기본 1K'),
  aspect_ratio: z.string().optional(),
  translate: z.boolean().optional().describe('한글 자동 번역 (기본 true)'),
};
