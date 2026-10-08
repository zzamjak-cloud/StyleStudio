/**
 * 타일맵 세션 배치 (`ss_tilemap_batch`) — 변형 세트·룰타일 세트를 대량으로 만든다.
 *
 * 세트 하나 = 머티리얼 시트 생성 API 1회 + **앱 합성기 그대로**(`buildVariationTileSet`·`buildRuleTileSet`·
 * `composeFinalSheet`) + 앱 내보내기와 같은 구성의 파일. 합성기는 canvas 2D 를 쓰므로 MCP 전용
 * 순수 JS shim(`canvas-shim.ts`) 위에서 돌린다 — 알고리즘을 복제하지 않는다.
 *
 * 앱 흐름(ImageGeneratorPanel.handleGenerate 의 TILEMAP 분기 → useImageGenerator → processNewSheet →
 * exportTilemapForUnity)과 맞춘 것:
 * - 프롬프트는 `buildPromptForSession` 을 **한 번만** 씌운다. 지형 한글은 번역본을 넣는다.
 * - 생성 결과는 흰 배경 JPEG(q0.92)로 바꾼 뒤 합성기에 넣는다(`convertBase64ToJpeg`, `match_app_jpeg`).
 * - 모델은 덕테이프 계열(`getTilemapImageModels`)만, 비율 1:1, 룰타일은 8x8 고정.
 * → wiki/infra/mcp.md, wiki/tilemap/overview.md
 */

import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

import type { ImageAnalysisResult } from '../../src/types/analysis';
import { getPixelArtGridInfo } from '../../src/types/pixelart';
import {
  DEFAULT_TILEMAP_EDGE_STYLE,
  DEFAULT_TILEMAP_OUTLINE,
  DEFAULT_TILEMAP_OUTLINE2,
  TILEMAP_OUTLINE_THICKNESS_RANGE,
  TILEMAP_RULETILE_GRID,
  type TilemapEdgeStyle,
  type TilemapGridLayout,
  type TilemapMode,
  type TilemapOutline,
  type TilemapOutlineSide,
} from '../../src/types/tilemap';
import { getTilemapImageModels, TILEMAP_FIXED_IMAGE_MODEL } from '../../src/hooks/api/imageModels';
import { convertBase64ToJpeg } from '../../src/hooks/api/useImageGenerator';
import { buildPromptForSession } from '../../src/lib/prompts/sessionPrompts';
import { buildUnifiedPrompt } from '../../src/lib/promptBuilder';
import { TILEMAP_EDGE_STYLES } from '../../src/lib/tilemap/edgeStyles';
import { NEIGHBOR } from '../../src/lib/tilemap/edgeProfile';
import { baseTileFilename, describeSlot, type SlotSpec } from '../../src/lib/tilemap/autotileSignature';
import { buildRuleTileSet, COMPOSER_VERSION } from '../../src/lib/tilemap/ruleTileComposer';
import { buildVariationTileSet, VARIATION_COMPOSER_VERSION } from '../../src/lib/tilemap/variationComposer';
import { buildImportGuide, composeFinalSheet } from '../../src/lib/tilemap/tilemapExporter';

import { installCanvasShim } from './canvas-shim';
import { PLAN_HARD_LIMIT, resolveDestDir, resolveModel, resolveStyle, uniqueNamer, type StyleSourceInput } from './common';
import { assertWritable, sanitizeName, writeUnique } from './env';
import { dataUrlToBytes, extensionFor, sniffMime } from './imageio';
import { runPlan, type PlanToRun } from './runner';
import { guarded, runSchema, styleSchema, type RegisterTool } from './toolkit';
import type { WorkUnit } from './engine';

/** 유니티 권장 PPU — 앱 내보내기(`tilemapExporter.UNITY_PIXELS_PER_UNIT`)와 같은 값 */
const UNITY_PIXELS_PER_UNIT = 128;

// ───────────────────────── 입력 ─────────────────────────

export interface OutlineInput {
  enabled?: boolean;
  thickness_px?: number;
  color?: string;
  opacity?: number;
}

export interface TilemapTaskInput {
  name?: string;
  mode: TilemapMode;
  /** variation: 재질 (빈 값이면 앱과 같은 기본 'stylized grass ground') */
  terrain?: string;
  /** ruletile: 베이스 지형 (빈 값 = 투명) */
  base_terrain?: string;
  /** ruletile: 오버레이 지형 (빈 값 = 투명) */
  overlay_terrain?: string;
  /** 추가 스타일 지시 (앱의 추가 프롬프트 — variation 은 재질 설명 뒤에, ruletile 은 스타일 방향으로 들어간다) */
  prompt?: string;
  grid?: TilemapGridLayout;
  edge_style?: TilemapEdgeStyle;
  outline?: OutlineInput;
  outline2?: OutlineInput;
  outline_side?: TilemapOutlineSide;
  count?: number;
}

export interface TilemapBatchInput {
  style?: StyleSourceInput;
  tasks: TilemapTaskInput[];
  options?: {
    model?: string;
    quality?: string;
    translate?: boolean;
    match_app_jpeg?: boolean;
    negative_prompt?: string;
  };
  dest_dir?: string;
  concurrency?: number;
  max_requests?: number;
  max_images?: number;
  max_cost_usd?: number;
  dry_run?: boolean;
  wait_seconds?: number;
}

/** 세트 하나의 확정 설정 (합성·내보내기 입력) */
export interface SetSpec {
  mode: TilemapMode;
  grid: TilemapGridLayout;
  /** 입력 원문 (tileset.json 기록용) */
  terrain?: string;
  baseTerrain?: string;
  overlayTerrain?: string;
  edgeStyle: TilemapEdgeStyle;
  outline?: TilemapOutline;
  outline2?: TilemapOutline;
  outlineSide: TilemapOutlineSide;
  transparentBase: boolean;
  transparentOverlay: boolean;
  /** 생성 결과를 앱처럼 흰 배경 JPEG(q0.92)로 바꾼 뒤 합성할지 */
  matchAppJpeg: boolean;
}

function resolveOutline(input: OutlineInput | undefined, defaults: TilemapOutline, label: string): TilemapOutline | undefined {
  if (!input) return undefined;
  const thickness = input.thickness_px ?? defaults.thicknessPx;
  const { min, max } = TILEMAP_OUTLINE_THICKNESS_RANGE;
  if (thickness < min || thickness > max) throw new Error(`${label}.thickness_px 는 ${min}~${max} 이어야 합니다 (셀 128px 기준).`);
  const color = input.color ?? defaults.color;
  if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error(`${label}.color 는 #RRGGBB 형식이어야 합니다: ${color}`);
  // 객체를 넘겼으면 켠 것으로 본다 (끄려면 enabled:false)
  return { enabled: input.enabled ?? true, thicknessPx: thickness, color, opacity: input.opacity ?? defaults.opacity };
}

// ───────────────────────── 계획 ─────────────────────────

/** 세트 1개가 만드는 파일 수: 원본 시트 + 합성 시트 + 슬롯 타일 + (룰타일) 베이스 타일 + 가이드 + tileset.json */
export function expectedSetFiles(spec: Pick<SetSpec, 'mode' | 'grid' | 'transparentBase'>): number {
  const { totalFrames } = getPixelArtGridInfo(spec.grid);
  const baseTiles = spec.mode === 'ruletile' && !spec.transparentBase ? 8 : 0;
  return 4 + totalFrames + baseTiles;
}

export async function planTilemapBatch(dataDir: string, input: TilemapBatchInput): Promise<PlanToRun> {
  if (!input.tasks || input.tasks.length === 0) throw new Error('tasks 가 비어 있습니다.');
  const opts = input.options ?? {};
  const allowed = new Set(getTilemapImageModels().map((m) => m.id));
  const checks = resolveModel(opts.model ?? TILEMAP_FIXED_IMAGE_MODEL, (m) => allowed.has(m.id));
  const { model } = checks;
  const quality = checks.quality(opts.quality);
  const aspectRatio = checks.aspect('1:1');
  const style = resolveStyle(dataDir, input.style, model.supports.maxReferenceImages);
  const analysis = style.analysis as ImageAnalysisResult | undefined;
  const hasReferenceImages = style.referenceImages.length > 0;
  const matchAppJpeg = opts.match_app_jpeg !== false;

  type Planned = { name: string; spec: SetSpec; prompt?: string; taskIndex: number; set: number; gridForced: boolean };
  const planned: Planned[] = [];
  const nameOf = uniqueNamer();

  input.tasks.forEach((task, taskIndex) => {
    const where = `tasks[${taskIndex}]`;
    const isRuletile = task.mode === 'ruletile';
    if (task.mode !== 'variation' && !isRuletile) throw new Error(`${where}.mode 는 variation 또는 ruletile 이어야 합니다.`);
    if (task.grid && task.grid !== '4x4' && task.grid !== '8x8') throw new Error(`${where}.grid 는 4x4 또는 8x8 이어야 합니다.`);

    const baseTerrain = task.base_terrain?.trim() ?? '';
    const overlayTerrain = task.overlay_terrain?.trim() ?? '';
    if (isRuletile) {
      if (task.terrain?.trim()) throw new Error(`${where}: 룰타일은 terrain 대신 base_terrain / overlay_terrain 을 쓴다.`);
      // 앱과 같은 규칙: 비운 지형은 투명, 둘 다 비면 아웃라인 말고 남는 게 없어 막는다
      if (!baseTerrain && !overlayTerrain) throw new Error(`${where}: base_terrain 과 overlay_terrain 중 최소 하나는 필요합니다 (비운 쪽은 투명).`);
    } else {
      const ruleOnly = (['base_terrain', 'overlay_terrain', 'edge_style', 'outline', 'outline2', 'outline_side'] as const).filter(
        (k) => task[k] !== undefined
      );
      if (ruleOnly.length > 0) throw new Error(`${where}: ${ruleOnly.join(', ')} 는 ruletile 전용입니다.`);
    }

    const grid: TilemapGridLayout = isRuletile ? TILEMAP_RULETILE_GRID : (task.grid ?? '4x4');
    const spec: SetSpec = {
      mode: task.mode,
      grid,
      terrain: isRuletile ? undefined : task.terrain?.trim() || undefined,
      baseTerrain: isRuletile ? baseTerrain : undefined,
      overlayTerrain: isRuletile ? overlayTerrain : undefined,
      edgeStyle: task.edge_style ?? DEFAULT_TILEMAP_EDGE_STYLE,
      outline: isRuletile ? resolveOutline(task.outline, DEFAULT_TILEMAP_OUTLINE, `${where}.outline`) : undefined,
      outline2: isRuletile ? resolveOutline(task.outline2, DEFAULT_TILEMAP_OUTLINE2, `${where}.outline2`) : undefined,
      outlineSide: task.outline_side ?? 'outer',
      transparentBase: isRuletile && !baseTerrain,
      transparentOverlay: isRuletile && !overlayTerrain,
      matchAppJpeg,
    };
    const count = Math.max(1, Math.floor(task.count ?? 1));
    const label =
      task.name ?? (isRuletile ? [baseTerrain || '투명', overlayTerrain || '투명'].join('_') : spec.terrain ?? 'variation');
    const taskName = sanitizeName(label, `tileset-${taskIndex + 1}`);
    for (let set = 1; set <= count; set++) {
      // 계획 단계에서 바로 끊는다 — 오타 하나(count: 1e9)로 계획 배열이 폭주하지 않게
      if (planned.length >= PLAN_HARD_LIMIT) {
        throw new Error(`세트가 ${PLAN_HARD_LIMIT}개를 넘는 배치는 계획하지 않습니다. tasks 를 나눠 여러 번 실행하세요.`);
      }
      planned.push({
        name: nameOf(count > 1 ? `${taskName}_${String(set).padStart(2, '0')}` : taskName),
        spec,
        prompt: task.prompt?.trim() || undefined,
        taskIndex,
        set,
        gridForced: isRuletile && !!task.grid && task.grid !== TILEMAP_RULETILE_GRID,
      });
    }
  });

  const destDir = resolveDestDir(dataDir, input.dest_dir, 'tilemap', new Set(planned.map((p) => p.name)));
  const positive = analysis ? buildUnifiedPrompt(analysis).positivePrompt : '';
  // analysis 는 외부 JSON 이 그대로 들어올 수 있다 — 문자열만 받는다
  const negativeOf = (tr: (t: string | undefined) => string | undefined) =>
    [analysis?.negative_prompt, tr(opts.negative_prompt)]
      .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
      .join(', ');

  const units: WorkUnit[] = planned.map((p) => {
    const spec = p.spec;
    const dir = join(destDir, p.name);
    const buildPrompt = (tr: (t: string | undefined) => string | undefined): string => {
      // 앱 생성 패널과 같은 조립: [추가 프롬프트(변형은 재질), (참조 없으면) 분석 프롬프트] → 템플릿 1회
      const additional = [spec.mode === 'variation' ? tr(spec.terrain) : undefined, tr(p.prompt), tr(style.styleText)]
        .filter(Boolean)
        .join(', ');
      const basePrompt = [additional, hasReferenceImages ? '' : positive].filter(Boolean).join(', ') || positive;
      let prompt = buildPromptForSession({
        basePrompt,
        hasReferenceImages,
        sessionType: 'TILEMAP',
        pixelArtGrid: spec.grid,
        analysis,
        tilemapMode: spec.mode,
        ...(spec.mode === 'ruletile'
          ? { tilemapBaseTerrain: tr(spec.baseTerrain) ?? '', tilemapOverlayTerrain: tr(spec.overlayTerrain) ?? '' }
          : {}),
      });
      // useImageGenerator 와 같은 위치·형식 (Image API 에 별도 필드가 없다)
      const negative = negativeOf(tr);
      if (negative) prompt += `\n\nAvoid: ${negative}`;
      return prompt;
    };

    return {
      label: p.name,
      grid: spec.grid,
      images: 1,
      expectedFiles: expectedSetFiles(spec),
      call: { aspectRatio, quality, n: 1, references: style.referenceImages },
      texts: [spec.terrain, spec.baseTerrain, spec.overlayTerrain, p.prompt, style.styleText, opts.negative_prompt],
      rawDir: dir,
      run: async (ctx) => {
        const prompt = buildPrompt(ctx.tr);
        const [bytes] = await ctx.generate(prompt, { aspectRatio, quality, n: 1, references: style.referenceImages });
        if (!bytes) throw new Error('API 응답에 이미지가 없습니다.');
        // 합성 실패 시에도 과금된 시트는 원본으로 남긴다 (엔진 경고에 이유가 기록된다)
        return ctx.saveSafely(bytes, () => writeTileset(bytes, spec, dir, { prompt, model: model.id, quality, dataDir }), dir, 'source_sheet');
      },
    };
  });

  return {
    kind: 'TILEMAP',
    model,
    units,
    destDir,
    concurrency: input.concurrency,
    translate: opts.translate,
    meta: {
      session_type: 'TILEMAP',
      style_source: style.source,
      reference_images: style.referenceImages.length,
      match_app_jpeg: matchAppJpeg,
    },
    breakdown: planned.map((p) => ({
      set: p.name,
      task_index: p.taskIndex,
      mode: p.spec.mode,
      grid: p.spec.grid,
      ...(p.gridForced ? { note: '룰타일은 8x8 고정이라 grid 를 무시했다' } : {}),
      terrain: p.spec.mode === 'variation' ? p.spec.terrain ?? '(기본: stylized grass ground)' : undefined,
      base_terrain: p.spec.mode === 'ruletile' ? p.spec.baseTerrain || '(투명)' : undefined,
      overlay_terrain: p.spec.mode === 'ruletile' ? p.spec.overlayTerrain || '(투명)' : undefined,
      edge_style: p.spec.mode === 'ruletile' ? p.spec.edgeStyle : undefined,
      outline: p.spec.outline,
      outline2: p.spec.outline2,
      quality,
      expected_files: expectedSetFiles(p.spec),
    })),
    max_requests: input.max_requests,
    max_images: input.max_images,
    max_cost_usd: input.max_cost_usd,
    dry_run: input.dry_run,
    wait_seconds: input.wait_seconds,
  };
}

// ───────────────────────── 합성 · 내보내기 ─────────────────────────

/** 유니티 Rule Tile 3x3 규칙 값 (This=같은 Rule Tile / Not=다름·빈칸 / Any=무관) */
export type RuleCell = 'This' | 'Not' | 'Any';

/**
 * signature → 유니티 3x3 규칙. 앱 가이드의 `buildRuleGrid` 와 같은 규칙이다(테스트로 대조):
 * 대각은 인접 두 변이 모두 오버레이일 때만 의미가 있고, 그 외는 Any 여야 매칭이 된다.
 */
export function ruleNeighbors(signature: number): Record<keyof typeof NEIGHBOR, RuleCell> {
  const has = (b: number) => (signature & b) !== 0;
  const cell = (b: number, meaningful: boolean): RuleCell => (!meaningful ? 'Any' : has(b) ? 'This' : 'Not');
  return {
    N: cell(NEIGHBOR.N, true),
    NE: cell(NEIGHBOR.NE, has(NEIGHBOR.N) && has(NEIGHBOR.E)),
    E: cell(NEIGHBOR.E, true),
    SE: cell(NEIGHBOR.SE, has(NEIGHBOR.S) && has(NEIGHBOR.E)),
    S: cell(NEIGHBOR.S, true),
    SW: cell(NEIGHBOR.SW, has(NEIGHBOR.S) && has(NEIGHBOR.W)),
    W: cell(NEIGHBOR.W, true),
    NW: cell(NEIGHBOR.NW, has(NEIGHBOR.N) && has(NEIGHBOR.W)),
  };
}

/** 합성 결과 (테스트·파일 쓰기 공용) */
export interface ComposedTileset {
  tiles: string[];
  baseTiles: string[];
  slots?: SlotSpec[];
  /** variation: 서로 다른 변형 수 (1 이면 스와치가 타일보다 작아 변형을 못 만든 것) */
  distinctCount?: number;
  poolSize?: number;
}

/** 시트 바이트 → 앱 합성기 결과 (`processNewSheet` 와 같은 분기) */
export async function composeTileset(sheetBytes: Uint8Array, spec: SetSpec): Promise<ComposedTileset> {
  installCanvasShim();
  const mime = sniffMime(sheetBytes);
  const base64 = Buffer.from(sheetBytes).toString('base64');
  // 앱은 생성 결과를 흰 배경 JPEG(q0.92)로 바꾼 뒤 합성기에 넣는다 — 같은 함수를 shim 위에서 그대로 쓴다
  const sheetDataUrl = spec.matchAppJpeg
    ? `data:image/jpeg;base64,${await convertBase64ToJpeg(base64, mime)}`
    : `data:${mime};base64,${base64}`;

  if (spec.mode === 'ruletile') {
    const set = await buildRuleTileSet(sheetDataUrl, spec.grid, {
      edgeStyle: spec.edgeStyle,
      outline: spec.outline,
      outline2: spec.outline2,
      outlineSide: spec.outlineSide,
      transparentBase: spec.transparentBase,
      transparentOverlay: spec.transparentOverlay,
    });
    return { tiles: set.tiles, baseTiles: set.baseTiles, slots: set.slots };
  }
  const set = await buildVariationTileSet(sheetDataUrl, spec.grid);
  // 내보내기는 배정된 슬롯만 (여유분은 앱 화면의 슬롯 교체용)
  return { tiles: set.tiles.slice(0, set.slotCount), baseTiles: [], distinctCount: set.distinctCount, poolSize: set.tiles.length };
}

/** 이미 무언가 있는 폴더면 `_2`… 로 새 폴더를 잡는다 — tileset.json 의 파일 참조가 어긋나지 않게 */
function freshDir(dir: string): string {
  for (let i = 1; i < 10_000; i++) {
    const candidate = i === 1 ? dir : `${dir}_${i}`;
    if (!existsSync(candidate) || readdirSync(candidate).length === 0) {
      mkdirSync(candidate, { recursive: true });
      return candidate;
    }
  }
  throw new Error(`출력 폴더를 정할 수 없습니다: ${dir}`);
}

/**
 * 시트 1장 → 앱 `exportTilemapForUnity` 와 같은 구성의 파일 + `tileset.json` + 원본 시트.
 * 모든 파일은 writeUnique(덮어쓰기 금지)로 쓴다. 쓴 파일의 절대 경로 목록을 돌려준다.
 */
export async function writeTileset(
  sheetBytes: Uint8Array,
  spec: SetSpec,
  dir: string,
  meta: { prompt?: string; model?: string; quality?: string; dataDir?: string } = {}
): Promise<string[]> {
  const composed = await composeTileset(sheetBytes, spec);
  const { rows, cols, cellSize, totalFrames } = getPixelArtGridInfo(spec.grid);
  if (composed.tiles.length !== totalFrames) {
    throw new Error(`타일 수가 그리드와 맞지 않습니다 (${composed.tiles.length}/${totalFrames})`);
  }

  // 합성까지 끝난 뒤에 폴더를 잡는다 — 실패하면 빈 폴더 대신 엔진이 원본만 남긴다
  const outDir = freshDir(dir);
  // 상위 폴더는 resolveDestDir 가 검사했지만, `_2` 로 바뀐 폴더도 한 번 더 확인한다
  if (meta.dataDir !== undefined) for (const target of [outDir, join(outDir, 'tiles')]) assertWritable(target, meta.dataDir);
  const tilesDir = join(outDir, 'tiles');
  const files: string[] = [];
  const rel = (path: string) => path.slice(outDir.length + 1).replace(/\\/g, '/');

  const sourcePath = writeUnique(outDir, 'source_sheet', extensionFor(sniffMime(sheetBytes)), sheetBytes);
  files.push(sourcePath);
  // 교체 반영 최종 시트 — 앱 결과 뷰 "시트 보기" 와 같은 함수
  const sheetPath = writeUnique(outDir, 'tilesheet', 'png', dataUrlToBytes(await composeFinalSheet(composed.tiles, spec.grid)));
  files.push(sheetPath);

  const slotFiles = composed.tiles.map((tile, i) =>
    writeUnique(tilesDir, `tile_${String(i).padStart(2, '0')}`, 'png', dataUrlToBytes(tile))
  );
  files.push(...slotFiles);
  // 룰타일 전용: 순수 베이스 지형 타일 변형들 (투명 베이스면 0장)
  const baseFiles = composed.baseTiles.map((tile, i) =>
    writeUnique(tilesDir, baseTileFilename(i).replace(/\.png$/, ''), 'png', dataUrlToBytes(tile))
  );
  files.push(...baseFiles);

  const guide = buildImportGuide(spec.grid, spec.mode, spec.mode === 'ruletile' && composed.baseTiles.length === 0, false);
  files.push(writeUnique(outDir, 'IMPORT_GUIDE', 'txt', guide));

  const slots = slotFiles.map((path, index) => {
    const slot = composed.slots?.[index];
    const entry: Record<string, unknown> = { index, row: Math.floor(index / cols), col: index % cols, file: rel(path) };
    if (slot) {
      const n = ruleNeighbors(slot.signature);
      Object.assign(entry, {
        signature: slot.signature,
        variant: slot.variant,
        role: describeSlot(slot),
        rule: n,
        // 유니티 Rule Tile 편집기의 3x3 배치 그대로 (가운데 = 타일 자신)
        rule_grid: [
          [n.NW, n.N, n.NE],
          [n.W, 'Self', n.E],
          [n.SW, n.S, n.SE],
        ],
      });
    }
    return entry;
  });

  const isRuletile = spec.mode === 'ruletile';
  // 사방이 오버레이인 "채움" 타일 = Rule Tile 의 Default Sprite 후보
  const fill = composed.slots?.findIndex((s) => s.signature === 255 && s.variant === 0);
  const tileset = {
    format: 'stylestudio-tileset',
    format_version: 1,
    mode: spec.mode,
    composer_version: isRuletile ? COMPOSER_VERSION : VARIATION_COMPOSER_VERSION,
    grid: spec.grid,
    rows,
    cols,
    cell_size: cellSize,
    pixels_per_unit: UNITY_PIXELS_PER_UNIT,
    units_per_tile: cellSize / UNITY_PIXELS_PER_UNIT,
    sheet: rel(sheetPath),
    source_sheet: rel(sourcePath),
    match_app_jpeg: spec.matchAppJpeg,
    ...(isRuletile
      ? {
          base_terrain: spec.baseTerrain || null,
          overlay_terrain: spec.overlayTerrain || null,
          transparent_base: spec.transparentBase,
          transparent_overlay: spec.transparentOverlay,
          edge_style: spec.edgeStyle,
          outline: spec.outline ?? null,
          outline2: spec.outline2 ?? null,
          outline_side: spec.outlineSide,
          rule_legend: 'This=같은 Rule Tile(오버레이) / Not=다름·빈칸(베이스) / Any=무관(화살표 없음)',
          default_sprite: fill !== undefined && fill >= 0 ? slots[fill].file : null,
          base_tiles: baseFiles.map(rel),
        }
      : {
          terrain: spec.terrain ?? null,
          // 모든 타일이 변 픽셀을 공유하고 각자 wrap 연속이라 Random Tile 로 묶어 아무렇게나 칠해도 된다
          random_tile: true,
          distinct_variants: composed.distinctCount,
        }),
    model: meta.model,
    quality: meta.quality,
    prompt: meta.prompt,
    slots,
  };
  files.push(writeUnique(outDir, 'tileset', 'json', JSON.stringify(tileset, null, 2)));
  return files;
}

// ───────────────────────── 도구 등록 ─────────────────────────

const edgeStyleIds = TILEMAP_EDGE_STYLES.map((s) => s.id) as [TilemapEdgeStyle, ...TilemapEdgeStyle[]];

const outlineSchema = z
  .object({
    enabled: z.boolean().optional().describe('기본 true (객체를 넘기면 켠다)'),
    thickness_px: z.number().min(1).max(12).optional().describe('한쪽 방향 폭, 셀 128px 기준 (4x4 는 2배로 환산)'),
    color: z.string().optional().describe('#RRGGBB'),
    opacity: z.number().min(0).max(1).optional().describe('덮는 양 (그림자처럼 깔 때 < 1)'),
  })
  .optional();

export const registerTilemapTool: RegisterTool = (server, ctx) => {
  server.registerTool(
    'ss_tilemap_batch',
    {
      description: [
        'StyleStudio 타일맵 세션으로 유니티용 타일 세트를 대량 생성해 파일로 저장한다 (백그라운드 작업).',
        '세트 하나 = 머티리얼 시트 생성 1회 + 앱 합성기로 타일 합성 (AI 그림을 자르지 않아 임의 배치에서도 이음새가 없다).',
        'mode=variation: 재질 1종의 상호 교체 가능한 변형 타일 (grid 4x4=256px×16 / 8x8=128px×64).',
        'mode=ruletile: 베이스/오버레이 지형 전환 Rule Tile (8x8 고정 = blob 47종 + 변형 17 + 베이스 타일 8장). 지형을 비우면 그쪽은 투명.',
        '세트 폴더마다 tilesheet.png, tiles/tile_NN.png, (룰타일) tiles/tile_base*.png, IMPORT_GUIDE.txt, tileset.json(슬롯별 파일·signature·유니티 3x3 규칙), source_sheet 를 쓴다.',
        '화풍은 style 로 — ss_analyze session_type=TILEMAP 프로필의 tilemap_specific 이 프롬프트 스타일 스펙으로 들어간다.',
        '모델은 덕테이프 계열(openai/gpt-image-*)만, 기본 openai/gpt-image-2 · 품질 medium. dry_run=true 면 API 호출 없이 계획·견적만.',
      ].join(' '),
      inputSchema: {
        style: styleSchema,
        tasks: z
          .array(
            z.object({
              name: z.string().optional().describe('세트 폴더 이름'),
              mode: z.enum(['variation', 'ruletile']),
              terrain: z.string().optional().describe('variation: 재질 (예: 잔디, mossy cobblestone). 한글은 자동 번역'),
              base_terrain: z.string().optional().describe('ruletile: 베이스 지형 (빈 값 = 투명)'),
              overlay_terrain: z.string().optional().describe('ruletile: 오버레이 지형 (빈 값 = 투명)'),
              prompt: z.string().optional().describe('추가 스타일 지시 (레이아웃은 바꾸지 않는다)'),
              grid: z.enum(['4x4', '8x8']).optional().describe('variation 전용 (기본 4x4). ruletile 은 8x8 고정'),
              edge_style: z
                .enum(edgeStyleIds)
                .optional()
                .describe(`ruletile 경계선 모양: ${TILEMAP_EDGE_STYLES.map((s) => `${s.id}(${s.label})`).join(', ')}`),
              outline: outlineSchema.describe('ruletile 1단계 아웃라인 띠'),
              outline2: outlineSchema.describe('ruletile 2단계 띠 (1단계에 이어 붙는다)'),
              outline_side: z.enum(['outer', 'inner']).optional().describe('띠가 뻗는 방향 (기본 outer = 오버레이 바깥)'),
              count: z.number().int().positive().max(100).optional().describe('같은 설정으로 만들 세트 수 (세트마다 API 1회)'),
            })
          )
          .min(1)
          .max(200),
        options: z
          .object({
            model: z
              .string()
              .optional()
              .describe(`타일맵 호환 모델만: ${getTilemapImageModels().map((m) => m.id).join(', ')} (기본 ${TILEMAP_FIXED_IMAGE_MODEL})`),
            quality: z.string().optional().describe('low|medium|high (2.5 계열은 xhigh|max). 기본 medium'),
            translate: z.boolean().optional().describe('한글 자동 번역 (기본 true)'),
            match_app_jpeg: z
              .boolean()
              .optional()
              .describe('앱처럼 생성 결과를 흰 배경 JPEG(q0.92)로 바꾼 뒤 합성 (기본 true — 앱 결과와 맞춘다)'),
            negative_prompt: z.string().optional(),
          })
          .optional(),
        ...runSchema,
      },
    },
    (input) => guarded(async () => runPlan(ctx.dataDir, await planTilemapBatch(ctx.dataDir, input as unknown as TilemapBatchInput)))
  );
};
