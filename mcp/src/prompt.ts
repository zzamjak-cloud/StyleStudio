/**
 * 생성기 계열 세션의 프롬프트 조립 (MCP)
 *
 * 원칙: **앱의 세션 템플릿(`buildPromptForSession`)을 한 번만 씌운다.**
 * - 참조 이미지가 있으면 앱과 똑같이 세션 템플릿을 적용한다 — 템플릿 문구는 앱과 같은 소스다.
 * - 참조 이미지가 없으면 앱은 원문만 보내 그리드·배경 지시가 빠진다. 배치에서는 그리드 패킹이
 *   핵심이므로, 이 경우에만 MCP 전용 래퍼(`noReferencePrompt`)로 세션 성격·그리드 지시를 붙인다.
 * - 항목 목록(items)은 셀 번호 목록으로 basePrompt 에 들어가 템플릿의 "VARIATIONS" 자리에 놓인다.
 */

import type { SessionType } from '../../src/types/session';
import type { ImageAnalysisResult } from '../../src/types/analysis';
import type { ReferenceDocument } from '../../src/types/referenceDocument';
import { getPixelArtGridInfo, type PixelArtGridLayout } from '../../src/types/pixelart';
import {
  applyTransparentBackground,
  buildPromptForSession,
  parseResolutionEstimate,
  PIXELART_MODERN_STYLE_RULES,
  TRANSPARENT_BACKGROUND_CAPABLE_SESSIONS,
} from '../../src/lib/prompts/sessionPrompts';
import { buildUnifiedPrompt } from '../../src/lib/promptBuilder';

/** 1단계에서 지원하는 세션 타입 (생성기 계열 + 원문 그대로인 BASIC) */
export const GENERATOR_SESSION_TYPES = [
  'STYLE',
  'CHARACTER',
  'BACKGROUND',
  'ICON',
  'UI',
  'LOGO',
  'PIXELART_CHARACTER',
  'PIXELART_BACKGROUND',
  'PIXELART_ICON',
  'BASIC',
] as const satisfies readonly SessionType[];

export type GeneratorSessionType = (typeof GENERATOR_SESSION_TYPES)[number];

export const GRID_LAYOUTS: PixelArtGridLayout[] = ['1x1', '2x2', '3x3', '4x4', '6x6', '8x8'];

export function isPixelSession(type: SessionType): boolean {
  return type === 'PIXELART_CHARACTER' || type === 'PIXELART_BACKGROUND' || type === 'PIXELART_ICON';
}

/** 앱이 순백 배경을 강제하는 세션 = 투명 배경 대상 세션 */
export function usesWhiteBackground(type: SessionType): boolean {
  return TRANSPARENT_BACKGROUND_CAPABLE_SESSIONS.includes(type);
}

export function gridCells(grid: PixelArtGridLayout): number {
  const info = getPixelArtGridInfo(grid);
  return info.rows * info.cols;
}

/** 항목 수를 담을 수 있는 가장 작은 그리드 (상한 maxGrid) */
export function smallestGridFor(count: number, maxGrid: PixelArtGridLayout): PixelArtGridLayout {
  const cap = gridCells(maxGrid);
  for (const layout of GRID_LAYOUTS) {
    const cells = gridCells(layout);
    if (cells > cap) break;
    if (cells >= count) return layout;
  }
  return maxGrid;
}

/**
 * 항목 목록을 그리드 단위 묶음으로 나눈다. 묶음마다 담을 수 있는 가장 작은 그리드를 고른다
 * (예: 40개, 상한 4x4 → 16·16·8 → 4x4·4x4·3x3). 호출 1회 비용은 그리드 크기와 무관하므로
 * 마지막 묶음도 빈 셀이 최소가 되는 그리드를 쓴다.
 */
export function packItems(items: string[], maxGrid: PixelArtGridLayout): { grid: PixelArtGridLayout; items: string[] }[] {
  const cap = gridCells(maxGrid);
  const chunks: { grid: PixelArtGridLayout; items: string[] }[] = [];
  for (let i = 0; i < items.length; i += cap) {
    const chunk = items.slice(i, i + cap);
    chunks.push({ grid: smallestGridFor(chunk.length, maxGrid), items: chunk });
  }
  return chunks;
}

/** 셀 번호 목록 — 읽는 순서(좌→우, 위→아래). 비는 셀은 명시적으로 비우게 한다. */
export function cellListBlock(items: string[], grid: PixelArtGridLayout): string {
  const info = getPixelArtGridInfo(grid);
  const lines = items.map((item, index) => {
    const row = Math.floor(index / info.cols) + 1;
    const col = (index % info.cols) + 1;
    return `Cell ${index + 1} (row ${row}, col ${col}): ${item}`;
  });
  const total = info.rows * info.cols;
  if (items.length < total) {
    lines.push(
      `Cells ${items.length + 1}-${total}: leave completely empty (plain background only, nothing drawn).`
    );
  }
  return [
    `Each cell contains exactly ONE subject, centered, fully inside its own cell with clear margin (no overlap into neighbouring cells).`,
    `Cell order is left-to-right, top-to-bottom:`,
    ...lines,
  ].join('\n');
}

export interface ComposeParams {
  sessionType: GeneratorSessionType;
  /** 영어 프롬프트 (번역 후). items 가 있으면 공통 설명으로 쓰인다 */
  prompt?: string;
  /** 영어 항목 목록 (번역 후) — 있으면 셀 목록으로 들어간다 */
  items?: string[];
  grid: PixelArtGridLayout;
  analysis?: ImageAnalysisResult;
  hasReferenceImages: boolean;
  /** 카메라 앵글/렌즈 문자열 (영어) */
  camera?: string;
  /** 참조 없이 쓸 스타일 설명 (영어) — 분석 결과가 없을 때 */
  styleText?: string;
  referenceDocuments?: ReferenceDocument[];
  transparentBackground: boolean;
  negativePrompt?: string;
}

export function composePrompt(p: ComposeParams): string {
  const content = p.items && p.items.length > 0
    ? [p.prompt, cellListBlock(p.items, p.grid)].filter(Boolean).join('\n\n')
    : p.prompt ?? '';
  const positive = p.analysis ? buildUnifiedPrompt(p.analysis).positivePrompt : '';
  const style = [p.styleText, p.hasReferenceImages ? '' : positive].filter(Boolean).join(', ');

  let body: string;
  if (p.sessionType === 'BASIC') {
    // 채팅 세션은 원문 그대로 (앱과 동일)
    body = [content, p.camera, style].filter(Boolean).join(', ');
  } else if (p.hasReferenceImages) {
    // 앱 생성 패널과 같은 조립: [프롬프트, 카메라] → 세션 템플릿 1회
    const basePrompt = [content, p.camera, p.styleText].filter(Boolean).join(', ');
    body = buildPromptForSession({
      basePrompt,
      hasReferenceImages: true,
      sessionType: p.sessionType,
      pixelArtGrid: p.grid,
      analysis: p.analysis,
      referenceDocuments: p.referenceDocuments,
      transparentBackground: p.transparentBackground,
    });
  } else {
    body = noReferencePrompt({ ...p, content, style });
  }

  // analysis 는 외부 JSON 이 그대로 들어올 수 있다 — 문자열만 받는다
  const negatives = [p.analysis?.negative_prompt, p.negativePrompt].filter(
    (v): v is string => typeof v === 'string' && v.trim().length > 0
  );
  if (negatives.length > 0) {
    body += `\n\nAvoid: ${negatives.join(', ')}`;
  }
  return body;
}

const SESSION_NOUN: Record<Exclude<GeneratorSessionType, 'BASIC'>, [string, string]> = {
  STYLE: ['image', 'images'],
  CHARACTER: ['character pose', 'character poses'],
  BACKGROUND: ['background scene', 'background scenes'],
  ICON: ['game icon', 'game icons'],
  UI: ['UI screen', 'UI screens'],
  LOGO: ['game logo', 'logo variations'],
  PIXELART_CHARACTER: ['pixel art character', 'pixel art frames'],
  PIXELART_BACKGROUND: ['pixel art background', 'pixel art backgrounds'],
  PIXELART_ICON: ['pixel art icon', 'pixel art icons'],
};

/** 참조 이미지 없이 생성할 때의 세션 래퍼 (MCP 전용 — 앱은 이 경우 원문만 보낸다) */
function noReferencePrompt(p: ComposeParams & { content: string; style: string }): string {
  const type = p.sessionType as Exclude<GeneratorSessionType, 'BASIC'>;
  const [one, many] = SESSION_NOUN[type];
  const info = getPixelArtGridInfo(p.grid);
  const isGrid = p.grid !== '1x1';
  const frames = info.rows * info.cols;
  const pixel = isPixelSession(type);
  const resolution = pixel
    ? p.analysis?.pixelart_specific?.resolution_estimate
      ? parseResolutionEstimate(p.analysis.pixelart_specific.resolution_estimate)
      : info.recommendedPixelSize
    : 0;

  const sections: string[] = [];
  sections.push(
    isGrid
      ? `🎯 ${many.toUpperCase()} SET (${frames} cells in ${info.rows}x${info.cols} grid)`
      : `Create a ${one}.`
  );
  if (p.style) sections.push(`🎨 STYLE (apply consistently${isGrid ? ' to every cell' : ''}): ${p.style}`);
  if (pixel) {
    sections.push(
      `🎮 PIXEL ART REQUIREMENTS:\n✓ Resolution: ${resolution}x${resolution}px${isGrid ? ' per cell' : ''}\n✓ Crisp pixel edges (no anti-aliasing)\n✓ Limited, consistent color palette`
    );
    sections.push(PIXELART_MODERN_STYLE_RULES);
  }
  if (type === 'ICON' || type === 'PIXELART_ICON') sections.push('Centered composition, readable silhouette at small size.');
  if (type === 'LOGO') sections.push('⚠️ AI TEXT LIMITATION: The AI may not spell text perfectly. Focus on design aesthetics.');
  if (type === 'UI' && p.referenceDocuments && p.referenceDocuments.length > 0) {
    sections.push(
      '📄 REFERENCE DOCUMENTS:\n' +
        p.referenceDocuments.map((d, i) => `[Document ${i + 1}] ${d.fileName}:\n${d.content}`).join('\n\n')
    );
  }
  if (usesWhiteBackground(type)) {
    sections.push(
      `🖼️ BACKGROUND: Pure white background (#FFFFFF)${isGrid ? ' for all cells' : ''}. No gradients, no patterns, no other colors.`
    );
  }
  if (isGrid) {
    sections.push(
      '⛔ CRITICAL - NO GRID LINES: Do NOT draw any lines, borders, dividers, or separators between cells. The grid layout is purely conceptual - there should be NO visible grid structure in the final image.'
    );
  }
  if (p.camera) sections.push(`📷 CAMERA: ${p.camera}`);
  sections.push(isGrid ? `✨ CONTENT (${frames} cells):\n${p.content || `Various ${many}`}` : `Subject: ${p.content}`);
  if (isGrid) sections.push(`Generate ${frames} ${many} in one consistent style, arranged in a ${info.rows}x${info.cols} grid.`);

  const body = sections.join('\n\n');
  return p.transparentBackground ? applyTransparentBackground(body) : body;
}
