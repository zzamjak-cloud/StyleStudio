import { SessionType } from '../../types/session';
import { ReferenceDocument } from '../../types/referenceDocument';
import { PixelArtGridLayout, getPixelArtGridInfo } from '../../types/pixelart';
import { ImageAnalysisResult } from '../../types/analysis';
import { IllustrationSessionData } from '../../types/illustration';

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
};

/**
 * 메인 프롬프트 빌더 함수
 */
export function buildPromptForSession(params: PromptGenerationParams): string {
  if (!params.hasReferenceImages || !params.sessionType) {
    return params.basePrompt;
  }

  const generator = promptGenerators[params.sessionType];
  if (!generator) {
    return params.basePrompt;
  }

  return generator(params);
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
${cameraSection}

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
${cameraSection}

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
