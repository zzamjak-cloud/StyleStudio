// 사용자가 그린 구도 스케치 + 캐릭터 라벨을 Gemini Vision으로 분석하여
// 일러스트 생성 프롬프트에 합성할 수 있는 구조화된 결과를 반환

import { CompositionAnalysis, SketchLabel, IllustrationCharacter, CharacterPlacement } from '../../types/illustration';
import { logger } from '../logger';

const MODEL = 'gemini-2.5-flash';

interface AnalyzeParams {
  apiKey: string;
  sketchPng: string;        // data URL or base64
  labels: SketchLabel[];
  characters: IllustrationCharacter[];
}

const FALLBACK_ANALYSIS: CompositionAnalysis = {
  layout: 'centered composition',
  perspective: 'eye-level, three-quarter view',
  cameraDistance: 'medium',
  placements: [],
  backgroundElements: [],
  moodHint: 'neutral',
};

export async function analyzeCompositionSketch(params: AnalyzeParams): Promise<CompositionAnalysis> {
  const { apiKey, sketchPng, labels, characters } = params;
  if (!apiKey) {
    logger.warn('analyzeCompositionSketch: API Key 없음, fallback 반환');
    return FALLBACK_ANALYSIS;
  }

  const base64 = sketchPng.includes(',') ? sketchPng.split(',')[1] : sketchPng;
  const labelDescription = labels
    .map((l) => `- "${l.text}" (가로 ${Math.round(l.x * 100)}%, 세로 ${Math.round(l.y * 100)}%)${l.characterId ? ` [characterId: ${l.characterId}]` : ''}`)
    .join('\n');
  const characterRoster = characters
    .map((c) => `- ${c.name} (id: ${c.id})${c.analysis?.species_type ? `, ${c.analysis.species_type}` : ''}`)
    .join('\n');

  const prompt = [
    'You are analyzing a rough composition sketch for an illustration.',
    '',
    'Registered characters:',
    characterRoster || '(none)',
    '',
    'User-placed labels on the sketch (normalized coords 0~1):',
    labelDescription || '(no labels)',
    '',
    'Return ONLY a JSON object (no markdown, no commentary) with this exact shape:',
    '{',
    '  "layout": "string description of overall composition (e.g., \\"rule of thirds, two characters in foreground\\")",',
    '  "perspective": "string (e.g., \\"low angle, three-quarter view\\")",',
    '  "cameraDistance": "close-up" | "medium" | "wide" | "extreme-wide",',
    '  "placements": [{ "characterId": "id-from-roster-or-empty", "name": "string", "position": {"x":0~1,"y":0~1,"width":0~1,"height":0~1}, "pose": "string (e.g., standing, running, sitting)", "facingDirection": "left"|"right"|"front"|"back" }],',
    '  "backgroundElements": ["array of strings inferred from the sketch shapes"],',
    '  "moodHint": "string (e.g., serene, dramatic, playful)"',
    '}',
    '',
    'Be concise. Infer placements from labels and visible shapes. If labels reference registered characters by name, copy their characterId.',
  ].join('\n');

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                { text: prompt },
                { inline_data: { mime_type: 'image/png', data: base64 } },
              ],
            },
          ],
          generationConfig: { responseModalities: ['TEXT'], temperature: 0.3 },
        }),
      }
    );

    if (!response.ok) {
      const text = await response.text();
      logger.error('analyzeCompositionSketch HTTP 오류:', response.status, text);
      return FALLBACK_ANALYSIS;
    }

    const data = await response.json();
    const candidate = (data as any)?.candidates?.[0];
    const textPart = candidate?.content?.parts?.find((p: any) => typeof p.text === 'string');
    if (!textPart?.text) {
      logger.warn('analyzeCompositionSketch: 응답 텍스트 없음, fallback');
      return FALLBACK_ANALYSIS;
    }

    const cleaned = String(textPart.text)
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    const parsed = JSON.parse(cleaned);
    const placements: CharacterPlacement[] = Array.isArray(parsed.placements)
      ? parsed.placements.map((p: any) => ({
          characterId: typeof p.characterId === 'string' ? p.characterId : '',
          name: typeof p.name === 'string' ? p.name : '',
          position: {
            x: clamp01(p.position?.x),
            y: clamp01(p.position?.y),
            width: clamp01(p.position?.width),
            height: clamp01(p.position?.height),
          },
          pose: typeof p.pose === 'string' ? p.pose : undefined,
          facingDirection: ['left', 'right', 'front', 'back'].includes(p.facingDirection) ? p.facingDirection : undefined,
        }))
      : [];

    return {
      layout: typeof parsed.layout === 'string' ? parsed.layout : FALLBACK_ANALYSIS.layout,
      perspective: typeof parsed.perspective === 'string' ? parsed.perspective : FALLBACK_ANALYSIS.perspective,
      cameraDistance: ['close-up', 'medium', 'wide', 'extreme-wide'].includes(parsed.cameraDistance)
        ? parsed.cameraDistance
        : FALLBACK_ANALYSIS.cameraDistance,
      placements,
      backgroundElements: Array.isArray(parsed.backgroundElements)
        ? parsed.backgroundElements.filter((s: unknown) => typeof s === 'string')
        : [],
      moodHint: typeof parsed.moodHint === 'string' ? parsed.moodHint : FALLBACK_ANALYSIS.moodHint,
    };
  } catch (error) {
    logger.error('analyzeCompositionSketch 실패:', error);
    return FALLBACK_ANALYSIS;
  }
}

function clamp01(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

// 정규화 좌표를 자연어 위치 표현으로 변환 (모델이 % 좌표보다 자연어를 더 정확히 따름)
function describeHorizontal(xCenter: number): string {
  if (xCenter < 0.33) return 'LEFT side';
  if (xCenter < 0.66) return 'CENTER';
  return 'RIGHT side';
}
function describeVertical(yCenter: number): string {
  if (yCenter < 0.33) return 'top';
  if (yCenter < 0.66) return 'middle';
  return 'bottom';
}
function describeDepth(yCenter: number, hSize: number): string {
  // 카메라가 정면 가정 — 화면 하단/큰 사이즈는 foreground, 상단/작은 사이즈는 background
  const score = yCenter + hSize * 0.5;
  if (score < 0.5) return 'background (further from camera)';
  if (score < 0.85) return 'midground';
  return 'foreground (closer to camera)';
}

/** 분석 결과를 일러스트 프롬프트에 합칠 자연어 섹션으로 변환 */
export function formatCompositionForPrompt(analysis: CompositionAnalysis): string {
  if (!analysis) return '';
  const lines: string[] = ['📐 COMPOSITION (derived from user sketch — MUST be respected):'];
  lines.push(`- Layout: ${analysis.layout}`);
  lines.push(`- Perspective: ${analysis.perspective}`);
  lines.push(`- Camera distance: ${analysis.cameraDistance}`);
  if (analysis.moodHint) lines.push(`- Mood: ${analysis.moodHint}`);
  if (analysis.placements.length > 0) {
    lines.push('- Character placements (positions are CRITICAL — do NOT swap or mirror):');
    for (const p of analysis.placements) {
      const xCenter = p.position.x + p.position.width / 2;
      const yCenter = p.position.y + p.position.height / 2;
      const xPct = Math.round(xCenter * 100);
      const yPct = Math.round(yCenter * 100);
      const horiz = describeHorizontal(xCenter);
      const vert = describeVertical(yCenter);
      const depth = describeDepth(yCenter, p.position.height);
      const meta = [p.pose, p.facingDirection ? `facing ${p.facingDirection}` : null].filter(Boolean).join(', ');
      lines.push(`  • ${p.name || '(unnamed)'}: ${horiz}, ${vert} area, ${depth} (center at ~${xPct}%/${yPct}% of frame)${meta ? ` — ${meta}` : ''}`);
    }
  }
  if (analysis.backgroundElements.length > 0) {
    lines.push(`- Background elements: ${analysis.backgroundElements.join(', ')}`);
  }
  return lines.join('\n');
}
