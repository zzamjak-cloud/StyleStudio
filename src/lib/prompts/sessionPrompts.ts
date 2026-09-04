import { SessionType } from '../../types/session';
import { ReferenceDocument } from '../../types/referenceDocument';
import { PixelArtGridLayout, getPixelArtGridInfo } from '../../types/pixelart';
import { ImageAnalysisResult } from '../../types/analysis';
import { IllustrationSessionData } from '../../types/illustration';
import { TilemapMode } from '../../types/tilemap';
import { buildThinkingPrefix, ThinkingSessionType } from './thinkingPrefix';
import { formatCompositionForPrompt } from '../sketch/analyzeSketch';

const THINKING_TYPE_BY_SESSION: Partial<Record<SessionType, ThinkingSessionType>> = {
  BASIC: 'chat',
  CHARACTER: 'character',
  BACKGROUND: 'background',
  ICON: 'icon',
  STYLE: 'style',
  UI: 'ui',
  LOGO: 'logo',
  PIXELART_CHARACTER: 'pixelart',
  PIXELART_BACKGROUND: 'pixelart',
  PIXELART_ICON: 'pixelart',
  ILLUSTRATION: 'illustration',
  CONCEPT: 'concept',
};

/**
 * 해상도 문자열에서 숫자 추출
 */
function parseResolutionEstimate(resolutionStr?: string): number {
  if (!resolutionStr) return 128;
  const match = resolutionStr.match(/(\d+)x(\d+)/);
  if (!match) return 128;
  const width = parseInt(match[1], 10);
  const height = parseInt(match[2], 10);
  const maxDimension = Math.max(width, height);
  return Math.max(16, Math.min(512, maxDimension));
}

/**
 * 세션 타입에 따른 프롬프트 생성 파라미터
 */
export interface PromptGenerationParams {
  basePrompt: string;
  hasReferenceImages: boolean;
  sessionType?: SessionType;
  pixelArtGrid?: PixelArtGridLayout;
  analysis?: ImageAnalysisResult;
  referenceDocuments?: ReferenceDocument[];
  illustrationData?: IllustrationSessionData; // ILLUSTRATION 세션 전용
  cameraSettings?: string; // 카메라 앵글/렌즈 설정 (별도 처리용)
  thinkingMode?: boolean; // 추론 기반 생성 prefix 적용 여부
  tilemapMode?: TilemapMode; // TILEMAP: 변형/룰타일 모드
  tilemapBaseTerrain?: string; // TILEMAP 룰타일: 베이스 지형 (영어 번역본)
  tilemapOverlayTerrain?: string; // TILEMAP 룰타일: 오버레이 지형 (영어 번역본)
}

/**
 * 세션 타입별 프롬프트 생성 함수 맵
 */
type PromptGeneratorFunction = (params: PromptGenerationParams) => string;

const promptGenerators: Record<SessionType, PromptGeneratorFunction> = {
  BASIC: (params) => params.basePrompt, // BASIC 채팅 세션은 프롬프트를 그대로 사용
  CHARACTER: generateCharacterPrompt,
  BACKGROUND: generateBackgroundPrompt,
  ICON: generateIconPrompt,
  STYLE: generateStylePrompt,
  UI: generateUIPrompt,
  LOGO: generateLogoPrompt,
  PIXELART_CHARACTER: generatePixelArtCharacterPrompt,
  PIXELART_BACKGROUND: generatePixelArtBackgroundPrompt,
  PIXELART_ICON: generatePixelArtIconPrompt,
  ILLUSTRATION: generateIllustrationPrompt,
  CONCEPT: generateConceptPrompt,
  TILEMAP: generateTilemapPrompt,
};

/**
 * 메인 프롬프트 빌더 함수
 */
export function buildPromptForSession(params: PromptGenerationParams): string {
  let body: string;
  if (params.sessionType === 'TILEMAP') {
    // 타일맵은 참조 유무와 무관하게 타일링 규칙 프롬프트를 항상 적용
    body = generateTilemapPrompt(params);
  } else if (!params.hasReferenceImages || !params.sessionType) {
    body = params.basePrompt;
  } else {
    const generator = promptGenerators[params.sessionType];
    body = generator ? generator(params) : params.basePrompt;
  }

  if (params.thinkingMode) {
    const thinkingType = (params.sessionType && THINKING_TYPE_BY_SESSION[params.sessionType]) ?? 'generic';
    return `${buildThinkingPrefix(thinkingType)}\n\n${body}`;
  }
  return body;
}

/**
 * 분석 결과에서 캐릭터 외형 상세 정보를 프롬프트 섹션으로 변환
 */
function buildCharacterDetailSection(analysis?: ImageAnalysisResult): string {
  if (!analysis?.character) return '';

  const c = analysis.character;
  const details: string[] = [];

  if (c.body_proportions) details.push(`Body proportions: ${c.body_proportions}`);
  if (c.limb_proportions) details.push(`Limb proportions: ${c.limb_proportions}`);
  if (c.torso_shape) details.push(`Torso shape: ${c.torso_shape}`);
  if (c.hand_style) details.push(`Hand style: ${c.hand_style}`);
  if (c.feet_style) details.push(`Feet style: ${c.feet_style}`);
  if (c.eyes) details.push(`Eyes: ${c.eyes}`);
  if (c.face) details.push(`Face: ${c.face}`);
  if (c.hair) details.push(`Hair: ${c.hair}`);
  if (c.outfit) details.push(`Outfit: ${c.outfit}`);
  if (c.accessories) details.push(`Accessories: ${c.accessories}`);
  if (c.gender) details.push(`Gender: ${c.gender}`);
  if (c.age_group) details.push(`Age group: ${c.age_group}`);

  if (details.length === 0) return '';

  return `\n\n📋 CHARACTER ANATOMY SPEC (from analysis - MUST match exactly):\n${details.map(d => `- ${d}`).join('\n')}`;
}

/**
 * CHARACTER 세션 프롬프트 생성
 */
function generateCharacterPrompt(params: PromptGenerationParams): string {
  const { basePrompt, pixelArtGrid, analysis } = params;

  // 분석 결과에서 캐릭터 상세 정보 추출
  const characterDetails = buildCharacterDetailSection(analysis);

  // Grid 지원 추가
  if (pixelArtGrid && pixelArtGrid !== '1x1') {
    const gridInfo = getPixelArtGridInfo(pixelArtGrid);
    const gridLayout = `${gridInfo.rows}x${gridInfo.cols}`;
    const frameCount = gridInfo.rows * gridInfo.cols;
    return `⚠️ CRITICAL: CHARACTER ACCURACY IS THE #1 PRIORITY ⚠️

🎯 POSE VARIATIONS GRID (${frameCount} cells in ${gridLayout} layout)

🔴 MANDATORY - CHARACTER REPRODUCTION (HIGHEST PRIORITY):
You MUST draw the EXACT same character from the reference images.
Copy the character IDENTICALLY - not similar, not inspired by, but IDENTICAL.
${characterDetails}

🎨 STYLE CONSISTENCY REQUIREMENTS:
✓ Use EXACTLY the same character design from the reference images
✓ Match: face shape, eye style & spacing, hair style/color, outfit, body proportions
✓ Keep all distinctive features (accessories, patterns, colors) identical
✓ Same art style and rendering technique across all poses
✓ Maintain EXACT same body proportions, limb lengths, and hand/foot style

🚫 DO NOT CHANGE:
- Eye size, shape, spacing, or color
- Body height ratio or limb proportions
- Hand/foot rendering style (keep same level of detail/simplification)
- Torso shape or body build
- Any distinctive anatomical features

🖼️ BACKGROUND: Pure white background (#FFFFFF) for all cells. No gradients, no patterns, no other colors.

⛔ CRITICAL - NO GRID LINES: Do NOT draw any lines, borders, dividers, or separators between cells. Each cell must seamlessly blend with adjacent white backgrounds. The grid layout is purely conceptual for arranging poses - there should be NO visible grid structure in the final image.

🤸 POSE VARIATIONS (${frameCount} different poses):
${basePrompt || 'Various action poses and expressions'}

CRITICAL: Each cell shows the SAME character in a different pose/angle.
Do NOT change the character's appearance, colors, or outfit between cells.
If someone compared the character side by side with the reference, they should look IDENTICAL.

Generate the ${gridLayout} grid of character pose variations now.`;
  }

  // 단일 포즈 (1x1)
  return `⚠️ CRITICAL: CHARACTER ACCURACY IS THE #1 PRIORITY ⚠️

🔴 MANDATORY - CHARACTER REPRODUCTION (HIGHEST PRIORITY):
You MUST draw the EXACT same character from the reference images.
Copy the character IDENTICALLY - not similar, not inspired by, but IDENTICAL.
${characterDetails}

✅ WHAT TO COPY FROM REFERENCE IMAGES:
- The EXACT face (same shape, same features, same proportions)
- The EXACT eyes (same color, same style, same size, same spacing between eyes)
- The EXACT hair (same style, same color, same length, same details)
- The EXACT body (same proportions, same build, same limb lengths)
- The EXACT hands/feet (same level of detail or simplification)
- The EXACT clothing (same outfit, same colors, same patterns)
- The EXACT art style (same line work, same coloring technique)

🚫 DO NOT CHANGE:
- Eye size, shape, spacing, or color
- Body height ratio or limb proportions
- Hand/foot rendering style
- Torso shape or body build
- Any distinctive anatomical features

BACKGROUND: Pure white background (#FFFFFF). No gradients, no patterns, no other colors.

New pose: ${basePrompt}

⚠️ FINAL REMINDER: The character must be VISUALLY IDENTICAL to the reference. Only the pose/expression should change. If compared side by side, the character should look like the same character drawn by the same artist.`;
}

/**
 * BACKGROUND 세션 프롬프트 생성
 */
function generateBackgroundPrompt(params: PromptGenerationParams): string {
  const { basePrompt, pixelArtGrid } = params;

  if (pixelArtGrid && pixelArtGrid !== '1x1') {
    const gridInfo = getPixelArtGridInfo(pixelArtGrid);
    const gridLayout = `${gridInfo.rows}x${gridInfo.cols}`;
    const frameCount = gridInfo.rows * gridInfo.cols;
    return `🎯 BACKGROUND VARIATIONS GRID (${frameCount} cells in ${gridLayout} layout)

🎨 STYLE CONSISTENCY:
✓ Match the art style from reference images
✓ Keep the same color palette and rendering technique
✓ Maintain consistent atmosphere and mood
✓ Use similar composition principles

⛔ CRITICAL - NO GRID LINES: Do NOT draw any lines, borders, dividers, or separators between cells. The grid layout is purely conceptual - there should be NO visible grid structure in the final image.

🌄 SCENE VARIATIONS (${frameCount} different environments):
${basePrompt || 'Various background environments'}

Generate ${frameCount} background variations in a ${gridLayout} grid.`;
  }

  return `Create a background matching the art style of the reference images.

Scene: ${basePrompt}

Match the color palette, rendering technique, and atmosphere.`;
}

/**
 * ICON 세션 프롬프트 생성
 */
function generateIconPrompt(params: PromptGenerationParams): string {
  const { basePrompt, pixelArtGrid } = params;

  if (pixelArtGrid && pixelArtGrid !== '1x1') {
    const gridInfo = getPixelArtGridInfo(pixelArtGrid);
    const gridLayout = `${gridInfo.rows}x${gridInfo.cols}`;
    const frameCount = gridInfo.rows * gridInfo.cols;
    return `🎯 ICON SET (${frameCount} icons in ${gridLayout} grid)

🎨 STYLE CONSISTENCY:
✓ Match icon style from reference images
✓ Keep same rendering technique
✓ Consistent color palette
✓ Similar complexity level
✓ Centered composition

🖼️ BACKGROUND: Pure white background (#FFFFFF) for all cells. No gradients, no patterns, no other colors.

⛔ CRITICAL - NO GRID LINES: Do NOT draw any lines, borders, dividers, or separators between cells. Each cell must seamlessly blend with adjacent white backgrounds. The grid layout is purely conceptual - there should be NO visible grid structure in the final image.

🎲 ICON VARIATIONS (${frameCount} different icons):
${basePrompt || 'Various game icons'}

Generate ${frameCount} icons in consistent style.`;
  }

  return `Create an icon matching the style from reference images.

BACKGROUND: Pure white background (#FFFFFF). No gradients, no patterns, no other colors.

Icon: ${basePrompt}

Match the rendering technique, color palette, and composition.`;
}

/**
 * STYLE 세션 프롬프트 생성
 */
function generateStylePrompt(params: PromptGenerationParams): string {
  const { basePrompt, pixelArtGrid } = params;

  if (pixelArtGrid && pixelArtGrid !== '1x1') {
    const gridInfo = getPixelArtGridInfo(pixelArtGrid);
    const gridLayout = `${gridInfo.rows}x${gridInfo.cols}`;
    const frameCount = gridInfo.rows * gridInfo.cols;
    return `🎯 STYLE VARIATIONS GRID (${frameCount} cells in ${gridLayout} layout)

🎨 STYLE CONSISTENCY:
✓ Match art style from reference images
✓ Keep rendering technique consistent
✓ Use similar color palette
✓ Maintain consistent quality level

⛔ CRITICAL - NO GRID LINES: Do NOT draw any lines, borders, dividers, or separators between cells. The grid layout is purely conceptual - there should be NO visible grid structure in the final image.

✨ CONTENT VARIATIONS (${frameCount} different images):
${basePrompt || 'Various artistic compositions'}

Generate ${frameCount} images in consistent style.`;
  }

  return `Create an image matching the art style from reference images.

Content: ${basePrompt}

Match the rendering technique, color palette, and overall aesthetic.`;
}

/**
 * UI 세션 프롬프트 생성
 */
function generateUIPrompt(params: PromptGenerationParams): string {
  const { basePrompt, pixelArtGrid, referenceDocuments } = params;

  let documentContext = '';
  if (referenceDocuments && referenceDocuments.length > 0) {
    documentContext = '\n\n📄 REFERENCE DOCUMENTS:\n';
    referenceDocuments.forEach((doc, idx) => {
      documentContext += `\n[Document ${idx + 1}] ${doc.fileName}:\n${doc.content}\n`;
    });
  }

  if (pixelArtGrid && pixelArtGrid !== '1x1') {
    const gridInfo = getPixelArtGridInfo(pixelArtGrid);
    const gridLayout = `${gridInfo.rows}x${gridInfo.cols}`;
    const frameCount = gridInfo.rows * gridInfo.cols;
    return `🎯 UI SCREEN SET (${frameCount} screens in ${gridLayout} grid)

🎨 UI STYLE CONSISTENCY:
✓ Match UI style from reference images
✓ Consistent design system (buttons, colors, fonts)
✓ Similar layout principles
✓ Cohesive visual hierarchy

⛔ CRITICAL - NO GRID LINES: Do NOT draw any lines, borders, dividers, or separators between cells. The grid layout is purely conceptual - there should be NO visible grid structure in the final image.${documentContext}

📱 SCREEN VARIATIONS (${frameCount} different UI screens):
${basePrompt || 'Various UI screens'}

Generate ${frameCount} UI screens in consistent style.`;
  }

  return `Create a UI screen matching the design style from reference images.${documentContext}

Screen: ${basePrompt}

Match the design system, layout principles, and visual hierarchy.`;
}

/**
 * LOGO 세션 프롬프트 생성
 */
function generateLogoPrompt(params: PromptGenerationParams): string {
  const { basePrompt, pixelArtGrid } = params;

  if (pixelArtGrid && pixelArtGrid !== '1x1') {
    const gridInfo = getPixelArtGridInfo(pixelArtGrid);
    const gridLayout = `${gridInfo.rows}x${gridInfo.cols}`;
    const frameCount = gridInfo.rows * gridInfo.cols;
    return `🎯 LOGO VARIATIONS GRID (${frameCount} logos in ${gridLayout} layout)

🎨 STYLE CONSISTENCY:
✓ Match logo style from reference images
✓ Keep typography approach similar
✓ Consistent treatment (3D, outline, effects)
✓ Similar material/texture style
✓ Coherent color vibrancy

🖼️ BACKGROUND: Pure white background (#FFFFFF) for all cells. No gradients, no patterns, no other colors.

⛔ CRITICAL - NO GRID LINES: Do NOT draw any lines, borders, dividers, or separators between cells. Each cell must seamlessly blend with adjacent white backgrounds. The grid layout is purely conceptual - there should be NO visible grid structure in the final image.

🔤 LOGO VARIATIONS (${frameCount} different versions):
${basePrompt || 'Logo title variations'}

⚠️ AI TEXT LIMITATION: The AI may not spell text perfectly. Focus on design aesthetics.

Generate ${frameCount} logo variations in consistent style.`;
  }

  return `Create a logo matching the style from reference images.

BACKGROUND: Pure white background (#FFFFFF). No gradients, no patterns, no other colors.

Logo: ${basePrompt}

⚠️ AI TEXT LIMITATION: The AI may not spell text perfectly. Focus on design aesthetics.

Match the typography style, treatment, and visual effects.`;
}

/**
 * PIXELART_CHARACTER 세션 프롬프트 생성
 */
function generatePixelArtCharacterPrompt(params: PromptGenerationParams): string {
  const { basePrompt, pixelArtGrid, analysis } = params;

  const resolution = parseResolutionEstimate(analysis?.pixelart_specific?.resolution_estimate);

  if (pixelArtGrid && pixelArtGrid !== '1x1') {
    const gridInfo = getPixelArtGridInfo(pixelArtGrid);
    const gridLayout = `${gridInfo.rows}x${gridInfo.cols}`;
    const frameCount = gridInfo.rows * gridInfo.cols;
    return `🎯 PIXEL ART SPRITE SHEET (${frameCount} frames in ${gridLayout} grid)

🎮 PIXEL ART REQUIREMENTS:
✓ Resolution: ${resolution}x${resolution}px per cell
✓ Match pixel art style from reference
✓ Consistent character design across all frames
✓ Same color palette (limited colors)
✓ Crisp pixel edges (no anti-aliasing)

🖼️ BACKGROUND: Pure white background (#FFFFFF) for all cells. No gradients, no patterns, no checkered pattern, no transparency.

⛔ CRITICAL - NO GRID LINES: Do NOT draw any lines, borders, dividers, or separators between cells. Each cell must seamlessly blend with adjacent white backgrounds. The grid layout is purely conceptual - there should be NO visible grid structure in the final image.

🤸 ANIMATION SEQUENCE (${frameCount} frames):
${basePrompt || 'Character animation frames'}

Generate ${frameCount} pixel art frames in ${gridLayout} grid.`;
  }

  return `Create a pixel art character matching the style from reference images.

Animation: ${basePrompt}

Resolution: ${resolution}x${resolution}px
Match the pixel art style, color palette, and character design.

BACKGROUND: Pure white background (#FFFFFF) only. No gradients, no patterns, no checkered pattern, no transparency.`;
}

/**
 * PIXELART_BACKGROUND 세션 프롬프트 생성
 */
function generatePixelArtBackgroundPrompt(params: PromptGenerationParams): string {
  const { basePrompt, pixelArtGrid, analysis } = params;

  const resolution = parseResolutionEstimate(analysis?.pixelart_specific?.resolution_estimate);

  if (pixelArtGrid && pixelArtGrid !== '1x1') {
    const gridInfo = getPixelArtGridInfo(pixelArtGrid);
    const gridLayout = `${gridInfo.rows}x${gridInfo.cols}`;
    const frameCount = gridInfo.rows * gridInfo.cols;
    return `🎯 PIXEL ART BACKGROUND SET (${frameCount} scenes in ${gridLayout} grid)

🎮 PIXEL ART REQUIREMENTS:
✓ Resolution: ${resolution}x${resolution}px per cell
✓ Match pixel art style from reference
✓ Consistent art style across scenes
✓ Same color palette approach
✓ Crisp pixel edges (no anti-aliasing)

⛔ CRITICAL - NO GRID LINES: Do NOT draw any lines, borders, dividers, or separators between cells. The grid layout is purely conceptual - there should be NO visible grid structure in the final image.

🌄 SCENE VARIATIONS (${frameCount} backgrounds):
${basePrompt || 'Background scene variations'}

Generate ${frameCount} pixel art backgrounds in ${gridLayout} grid.`;
  }

  return `Create a pixel art background matching the style from reference images.

Scene: ${basePrompt}

Resolution: ${resolution}x${resolution}px
Match the pixel art style and color palette.`;
}

/**
 * PIXELART_ICON 세션 프롬프트 생성
 */
function generatePixelArtIconPrompt(params: PromptGenerationParams): string {
  const { basePrompt, pixelArtGrid, analysis } = params;

  const resolution = parseResolutionEstimate(analysis?.pixelart_specific?.resolution_estimate);

  if (pixelArtGrid && pixelArtGrid !== '1x1') {
    const gridInfo = getPixelArtGridInfo(pixelArtGrid);
    const gridLayout = `${gridInfo.rows}x${gridInfo.cols}`;
    const frameCount = gridInfo.rows * gridInfo.cols;
    return `🎯 PIXEL ART ICON SET (${frameCount} icons in ${gridLayout} grid)

🎮 PIXEL ART REQUIREMENTS:
✓ Resolution: ${resolution}x${resolution}px per cell
✓ Match pixel art style from reference
✓ Consistent icon style
✓ Same color palette
✓ Crisp pixel edges (no anti-aliasing)
✓ Centered composition

🖼️ BACKGROUND: Pure white background (#FFFFFF) for all cells. No gradients, no patterns, no checkered pattern, no transparency.

⛔ CRITICAL - NO GRID LINES: Do NOT draw any lines, borders, dividers, or separators between cells. Each cell must seamlessly blend with adjacent white backgrounds. The grid layout is purely conceptual - there should be NO visible grid structure in the final image.

🎲 ICON VARIATIONS (${frameCount} items):
${basePrompt || 'Game item icons'}

Generate ${frameCount} pixel art icons in ${gridLayout} grid.`;
  }

  return `Create a pixel art icon matching the style from reference images.

Icon: ${basePrompt}

Resolution: ${resolution}x${resolution}px
Match the pixel art style and color palette.

BACKGROUND: Pure white background (#FFFFFF) only. No gradients, no patterns, no checkered pattern, no transparency.`;
}

/**
 * ILLUSTRATION 세션 프롬프트 생성
 * - 참조 이미지의 캐릭터를 직접 복사하는 방식
 * - 그리드 레이아웃 지원
 * - 카메라 설정은 캐릭터 복제보다 낮은 우선순위로 처리
 */
function generateIllustrationPrompt(params: PromptGenerationParams): string {
  const { basePrompt, illustrationData, pixelArtGrid, cameraSettings } = params;

  if (!illustrationData) {
    return basePrompt;
  }

  // 캐릭터가 있는지 확인 (분석 여부 상관없이 이미지가 있으면 사용)
  const charactersWithImages = illustrationData.characters.filter(c => c.images && c.images.length > 0);

  if (charactersWithImages.length === 0) {
    return basePrompt;
  }

  // 캐릭터 이름 목록
  const characterNames = charactersWithImages.map(c => `"${c.name}"`).join(', ');
  const characterCount = charactersWithImages.length;

  // 카메라 설정 섹션 (있을 경우에만)
  const cameraSection = cameraSettings
    ? `\n📷 CAMERA (apply AFTER ensuring character accuracy):\n${cameraSettings}\n⚠️ Camera settings must NOT alter character appearance - only affect composition/framing.`
    : '';

  // 구도 스케치 섹션 (분석 결과 + reference image 가이드 명시)
  const hasSketchImage = !!illustrationData.conceptSketch?.sketchPng;
  const sketchPreamble = hasSketchImage
    ? '\n📎 The LAST reference image is a USER COMPOSITION SKETCH (rough drawing with character name labels). DO NOT copy its art style or pen lines. Use it ONLY as a layout guide — match where each named character is placed (left/right, foreground/background) and the overall framing. The final illustration must be rendered in the art style of the CHARACTER reference images, not the sketch.'
    : '';
  const compositionSection = illustrationData.conceptSketch?.analysis
    ? `${sketchPreamble}\n${formatCompositionForPrompt(illustrationData.conceptSketch.analysis)}\n⚠️ Composition rules: respect the placements EXACTLY (do not swap left/right). Character appearance still comes from the character reference images — do not let the rough sketch alter their identity.`
    : sketchPreamble;

  // 그리드 레이아웃 처리
  if (pixelArtGrid && pixelArtGrid !== '1x1') {
    const gridInfo = getPixelArtGridInfo(pixelArtGrid);
    const gridLayout = `${gridInfo.rows}x${gridInfo.cols}`;
    const frameCount = gridInfo.rows * gridInfo.cols;

    return `⚠️⚠️⚠️ CRITICAL INSTRUCTION - READ CAREFULLY ⚠️⚠️⚠️

YOU MUST DIRECTLY COPY THE CHARACTERS FROM THE REFERENCE IMAGES ABOVE.
THIS IS THE #1 PRIORITY - CHARACTER ACCURACY COMES BEFORE EVERYTHING ELSE.

🔴 MANDATORY - CHARACTER REPRODUCTION (HIGHEST PRIORITY):
The reference images show ${characterCount} character(s): ${characterNames}
You MUST draw these EXACT characters - not similar ones, not inspired by, but IDENTICAL copies.

✅ WHAT TO COPY FROM REFERENCE IMAGES:
- The EXACT face (same shape, same features, same proportions)
- The EXACT eyes (same color, same style, same size)
- The EXACT hair (same style, same color, same length, same details)
- The EXACT body (same proportions, same build)
- The EXACT clothing (same outfit, same colors, same patterns)
- The EXACT art style (same line work, same coloring technique)

🚫 WHAT YOU MUST NOT DO:
- DO NOT redesign the characters
- DO NOT change hair color or style
- DO NOT change eye color or shape
- DO NOT change clothing or accessories
- DO NOT change body proportions
- DO NOT change the art style
- DO NOT add or remove any features

📐 GRID LAYOUT: ${gridLayout} (${frameCount} cells)
⛔ NO GRID LINES - cells blend seamlessly with no borders or dividers.

🎬 SCENE: ${basePrompt || 'Various poses with the characters'}
${cameraSection}${compositionSection}

Each of the ${frameCount} cells shows the SAME characters (copied pixel-perfect from reference) in different poses/scenes.

⚠️ FINAL REMINDER: The characters in your output must be VISUALLY IDENTICAL to the reference images. Character accuracy is MORE IMPORTANT than camera angles or any other instruction. If someone compared them side by side, they should look like the same character drawn by the same artist.`;
  }

  // 단일 이미지
  return `⚠️⚠️⚠️ CRITICAL INSTRUCTION - READ CAREFULLY ⚠️⚠️⚠️

YOU MUST DIRECTLY COPY THE CHARACTERS FROM THE REFERENCE IMAGES ABOVE.
THIS IS THE #1 PRIORITY - CHARACTER ACCURACY COMES BEFORE EVERYTHING ELSE.

🔴 MANDATORY - CHARACTER REPRODUCTION (HIGHEST PRIORITY):
The reference images show ${characterCount} character(s): ${characterNames}
You MUST draw these EXACT characters - not similar ones, not inspired by, but IDENTICAL copies.

✅ WHAT TO COPY FROM REFERENCE IMAGES:
- The EXACT face (same shape, same features, same proportions)
- The EXACT eyes (same color, same style, same size)
- The EXACT hair (same style, same color, same length, same details)
- The EXACT body (same proportions, same build)
- The EXACT clothing (same outfit, same colors, same patterns)
- The EXACT art style (same line work, same coloring technique)

🚫 WHAT YOU MUST NOT DO:
- DO NOT redesign the characters
- DO NOT change hair color or style
- DO NOT change eye color or shape
- DO NOT change clothing or accessories
- DO NOT change body proportions
- DO NOT change the art style
- DO NOT add or remove any features

🎬 SCENE: ${basePrompt}
${cameraSection}${compositionSection}

⚠️ FINAL REMINDER: The characters in your output must be VISUALLY IDENTICAL to the reference images. Character accuracy is MORE IMPORTANT than camera angles or any other instruction. If someone compared them side by side, they should look like the same character drawn by the same artist.`;
}

/**
 * CONCEPT 세션 프롬프트 생성
 */
function generateConceptPrompt(params: PromptGenerationParams): string {
  const { basePrompt, pixelArtGrid } = params;

  if (pixelArtGrid && pixelArtGrid !== '1x1') {
    const gridInfo = getPixelArtGridInfo(pixelArtGrid);
    const gridLayout = `${gridInfo.rows}x${gridInfo.cols}`;
    const frameCount = gridInfo.rows * gridInfo.cols;
    return `🎯 GAME CONCEPT ART GRID (${frameCount} variations in ${gridLayout} layout)

🎨 CONCEPT ART STYLE:
✓ Professional game concept art quality
✓ Cohesive visual style across all variations
✓ Consistent art direction and rendering technique
✓ Atmospheric and evocative mood
✓ High-quality presentation

⛔ CRITICAL - NO GRID LINES: Do NOT draw any lines, borders, dividers, or separators between cells. The grid layout is purely conceptual - there should be NO visible grid structure in the final image.

🎮 CONCEPT VARIATIONS (${frameCount} different concepts):
${basePrompt || 'Game concept art variations'}

Generate ${frameCount} concept art pieces in ${gridLayout} grid.
Each piece should explore different aspects or moods while maintaining style consistency.`;
  }

  return `Create professional game concept art.

${basePrompt}

Focus on atmosphere, mood, and visual storytelling.
Use high-quality rendering with attention to lighting and composition.`;
}

/**
 * TILEMAP 세션 프롬프트 생성 (모드 분기)
 * - 변형(variation) 모드: 손맵 변형 타일 세트 (모든 타일이 상호 seamless)
 * - 룰타일(ruletile) 모드: 지형 전환 타일셋
 */
function generateTilemapPrompt(params: PromptGenerationParams): string {
  if (params.tilemapMode === 'ruletile') {
    return generateTilemapRuleTilePrompt(params);
  }
  return generateTilemapVariationPrompt(params);
}

/**
 * TILEMAP 변형 모드 프롬프트 — **재질 스와치** 요청.
 *
 * v1은 "N장이 그리드로 배치된 타일 시트"를 그리게 한 뒤 잘라 썼는데, 그 방식으로는
 * 임의 배치에서 이음새가 이어질 수 없었다: 잘라낸 타일은 **원래 붙어 있던 이웃**과만
 * 이어지고, 모든 타일의 변 픽셀을 일치시키는 건 프롬프트로 요청할 수 있는 종류의
 * 계약이 아니기 때문이다(v1의 "외곽 15%를 조용하게"는 완화 요청일 뿐이었다).
 *
 * v2는 룰타일과 같이 AI에게 **재질과 화풍만** 받는다. 타일 변형과 변 픽셀 공유는
 * 코드가 만든다(`variationComposer.buildVariationTileSet`). 그래서 이 프롬프트에는
 * 그리드·셀·디테일 배치 같은 기하 요구가 전혀 없고, 모델 편차에 둔감하다.
 *
 * 스와치는 **디테일 없는 균질한 필드**여야 한다 — `makeSeamless`가 크로스페이드라
 * 꽃·돌 같은 개별 디테일이 두 위치에 반투명하게 겹쳐 보인다(seamlessTexture 주석).
 */
function generateTilemapVariationPrompt(params: PromptGenerationParams): string {
  const { basePrompt, analysis } = params;

  const terrain = basePrompt?.trim() || 'stylized grass ground';

  // 참조 분석(손맵 스타일 스펙)이 있으면 스펙 섹션 삽입
  const t = analysis?.tilemap_specific;
  const specLines: string[] = [];
  if (t?.material_type) specLines.push(`- Material: ${t.material_type}`);
  if (t?.brush_style) specLines.push(`- Brushwork: ${t.brush_style}`);
  if (t?.color_palette) specLines.push(`- Color palette: ${t.color_palette}`);
  if (t?.texture_density) specLines.push(`- Texture density: ${t.texture_density}`);
  if (t?.perspective) specLines.push(`- Perspective: ${t.perspective}`);
  if (t?.edge_softness) specLines.push(`- Edge softness: ${t.edge_softness}`);
  if (t?.lighting_direction) specLines.push(`- Lighting: ${t.lighting_direction}`);
  const styleSpec = specLines.length > 0
    ? `\n🎨 HAND-PAINTED STYLE SPEC (from reference analysis - MUST match):\n${specLines.join('\n')}\n`
    : '';

  return `🎯 HAND-PAINTED TERRAIN MATERIAL SWATCH (1024x1024, ONE material filling the whole canvas)

This is NOT a finished picture, NOT a landscape and NOT a tile sheet. It is a **material reference swatch**: one flat field of terrain material filling the entire canvas. Software will cut the actual game tiles from this material and generate the tile variations itself, so keep it completely uniform.

📐 LAYOUT: the ENTIRE canvas, edge to edge, is a flat even field of ${terrain}. Nothing else. No cells, no panels, no halves, no second material.
${styleSpec}
🧱 RULES:
1. HAND-PAINTED ONLY: visible painterly brushwork, stylized game-art shading - NOT photorealistic, NOT a photo texture, NOT 3D rendered.
2. FLAT, EVEN FIELD: statistically uniform all over - same hue, brightness and detail density from corner to corner. NO large shapes, NO paths, NO patches, NO objects, NO flowers, NO rocks, NO scattered focal details, NO vignette, NO lighting gradient across the canvas. Think of a fabric swatch, not a landscape.
3. CRISP TEXTURE: keep the brushwork sharp and well defined at full resolution - no blur, no soft haze, no washed-out low-contrast mush.
4. NO GRID LINES, NO FRAMES, NO BORDERS: do not draw any dividers, outlines, cell separators, captions or panel borders.
5. CONSISTENT LIGHTING: one light direction and color temperature across the whole canvas; all shadows fall the same way.

⛔ AVOID: photorealistic, 3D render, photo texture, grid lines, cell dividers, panel borders, text, labels, objects, characters, vignette, dramatic lighting, large composed scenery, blurry, soft focus, second material.

Paint the ${terrain} material swatch now.`;
}

/**
 * TILEMAP 룰타일 프롬프트 — **머티리얼 시트** 요청.
 *
 * v2는 큰 그림(패치/도넛)을 그리게 한 뒤 그리드로 잘라 역할을 붙였는데, 이 방식은
 * 두 가지 이유로 룰타일이 될 수 없었다:
 *  1) 잘라낸 타일은 "원래 붙어 있던 이웃"과만 이어진다 (엣지 계약이 없음)
 *  2) 모델이 지시한 % 기하를 정확히 맞추지 못해 역할 라벨이 그림과 어긋난다
 *
 * v3는 AI에게 **재질과 화풍만** 받는다. 타일의 지형 경계는 코드가
 * `edgeProfile.ts`의 계약에 따라 직접 그린다(`ruleTileComposer.ts`).
 * 그래서 이 프롬프트에는 정밀한 기하 요구가 없고, 모델 편차에 둔감하다.
 *
 * 요청 레이아웃(합성기가 실측 비율로 해석):
 *   - 좌 절반: 순수 베이스 지형 필드
 *   - 우 절반: 순수 오버레이 지형 필드
 *
 * **지형 하나를 비우면 그 지형은 투명**이므로 재질이 필요 없다. 그때는 캔버스 전체를
 * 남은 지형 하나의 스와치로 요청한다 — 쓰지 않을 반쪽을 그리게 하면 스와치 면적이
 * 절반으로 줄고, 모델이 "두 개를 그려야 한다"는 지시 때문에 굳이 대비되는 두 재질을
 * 만들어 내려다 요청한 재질까지 흔들린다.
 */
function generateTilemapRuleTilePrompt(params: PromptGenerationParams): string {
  const { analysis, basePrompt } = params;
  const baseInput = (params.tilemapBaseTerrain ?? '').trim();
  const overlayInput = (params.tilemapOverlayTerrain ?? '').trim();
  // 둘 다 비는 경우는 UI에서 막지만, 프롬프트 단독으로도 안전하게 폴백한다
  const bothEmpty = !baseInput && !overlayInput;
  const base = baseInput || (bothEmpty ? 'grass' : '');
  const overlay = overlayInput || (bothEmpty ? 'dirt path' : '');
  /** 한쪽만 투명이면 캔버스 전체가 남은 지형 하나의 스와치다 */
  const soloTerrain = base && overlay ? '' : base || overlay;

  // 참조 분석 스펙 섹션 (변형 모드와 동일 로직 재사용)
  const t = analysis?.tilemap_specific;
  const specLines: string[] = [];
  if (t?.brush_style) specLines.push(`- Brushwork: ${t.brush_style}`);
  if (t?.color_palette) specLines.push(`- Color palette: ${t.color_palette}`);
  if (t?.perspective) specLines.push(`- Perspective: ${t.perspective}`);
  if (t?.edge_softness) specLines.push(`- Edge softness: ${t.edge_softness}`);
  if (t?.lighting_direction) specLines.push(`- Lighting: ${t.lighting_direction}`);
  const styleSpec = specLines.length > 0
    ? `\n🎨 HAND-PAINTED STYLE SPEC (from reference analysis - MUST match):\n${specLines.join('\n')}\n`
    : '';

  const styleDirection = basePrompt && basePrompt.trim()
    ? `\n🎨 ADDITIONAL STYLE DIRECTION (applies to both terrains, must NOT change the layout): ${basePrompt.trim()}\n`
    : '';

  if (soloTerrain) {
    // 한쪽 지형이 투명 → 캔버스 전체가 남은 지형 하나의 스와치
    return `🎯 HAND-PAINTED TERRAIN MATERIAL SWATCH (1024x1024, ONE material filling the whole canvas)

This is NOT a finished picture, NOT a landscape and NOT a tile sheet. It is a **material reference swatch**: one flat field of terrain material filling the entire canvas. Software will cut the actual game tiles from this material, so keep it completely uniform.

📐 LAYOUT: the ENTIRE canvas, edge to edge, is a flat even field of ${soloTerrain}. Nothing else. No panels, no halves, no second material.
${styleSpec}
🧱 RULES:
1. HAND-PAINTED ONLY: visible painterly brushwork, stylized game-art shading - NOT photorealistic, NOT a photo texture, NOT 3D rendered.
2. FLAT, EVEN FIELD: statistically uniform all over - same hue, brightness and detail density from corner to corner. NO large shapes, NO paths, NO patches, NO objects, NO flowers, NO rocks, NO scattered focal details, NO vignette, NO lighting gradient across the canvas. Think of a fabric swatch, not a landscape.
3. CRISP TEXTURE: keep the brushwork sharp and well defined at full resolution - no blur, no soft haze, no washed-out low-contrast mush.
4. NO GRID LINES, NO FRAMES, NO BORDERS: do not draw any dividers, outlines, captions or panel borders.
5. CONSISTENT LIGHTING: one light direction and color temperature across the whole canvas.

⛔ AVOID: photorealistic, 3D render, photo texture, grid lines, panel borders, text, labels, objects, characters, vignette, dramatic lighting, large composed scenery, blurry, soft focus, second material, split panels.
${styleDirection}
Paint the ${soloTerrain} material swatch now.`;
  }

  return `🎯 HAND-PAINTED TERRAIN MATERIAL SHEET (1024x1024, two swatches)

This is NOT a finished picture, NOT a landscape and NOT a tile sheet. It is a **material reference sheet**: two flat swatches of terrain material, side by side. Software will cut the actual game tiles from these materials, so follow the layout exactly.

📐 LAYOUT (split the canvas straight down the middle, no border drawn between the halves):
- LEFT HALF: a flat, even field of ${base}. Nothing else.
- RIGHT HALF: a flat, even field of ${overlay}. Nothing else.
${styleSpec}
🧱 RULES:
1. HAND-PAINTED ONLY: visible painterly brushwork, stylized game-art shading - NOT photorealistic, NOT a photo texture, NOT 3D rendered. The same style applies to both halves.
2. FLAT, EVEN FIELDS: each half must be statistically uniform all over - same hue, brightness and detail density from corner to corner. NO large shapes, NO paths, NO patches, NO objects, NO flowers, NO rocks, NO scattered focal details, NO vignette, NO lighting gradient across the panel. Think of a fabric swatch, not a landscape.
3. CRISP TEXTURE: keep the brushwork sharp and well defined at full resolution - no blur, no soft haze, no washed-out low-contrast mush. The two materials must read as clearly different surfaces.
4. NO GRID LINES, NO FRAMES, NO BLEND: do not draw any dividers, outlines, captions or panel borders. Do NOT paint a transition, gradient or blend where the two halves meet - they simply butt against each other.
5. CONSISTENT LIGHTING: one light direction and color temperature across the whole canvas.

⛔ AVOID: photorealistic, 3D render, photo texture, grid lines, panel borders, text, labels, objects, characters, vignette, dramatic lighting, large composed scenery, blurry, soft focus, gradient between the halves.
${styleDirection}
Paint the ${base} / ${overlay} material sheet now.`;
}
