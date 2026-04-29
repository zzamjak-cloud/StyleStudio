// 채팅 이미지 어노테이션(부분 편집) 데이터 모델.
// 사용자가 생성된 AI 이미지 위에 그린 펜/도형/텍스트 레이블을 직렬화하여
// OpenAI /v1/images/edits API와 결합하기 위한 구조.

export type AnnotationTool = 'pen' | 'rect' | 'circle' | 'arrow' | 'eraser' | 'text';

export interface AnnotationStroke {
  id: string;
  tool: AnnotationTool;
  points: number[]; // [x1, y1, x2, y2, ...]
  color: string;
  strokeWidth: number;
  isMaskingStroke: boolean; // true이면 마스크 레이어에도 동시 흰색 fill (편집 영역 지정)
}

export interface TextAnnotation {
  id: string;
  text: string;
  // 0~1로 정규화된 좌표 (이미지 비율과 무관하게 보존)
  x: number;
  y: number;
  color: string;
  fontSize: number;
}

/** 정규화된 영역 (0~1) */
export interface ColorRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface AnnotationResult {
  /** 사용자가 그린 어노테이션이 합성된 JPEG (디버그/이력 보관용) */
  compositePng: string;
  /** 편집 영역을 흰색, 보존 영역을 검정으로 표시한 마스크 PNG — OpenAI 정밀 편집 시에만 사용 */
  maskPng: string;
  /** 텍스트 어노테이션 메타데이터 (정규화 좌표) */
  textAnnotations: TextAnnotation[];
  /** 원본 메시지 ID 또는 IndexedDB 키 등 추적용 식별자 */
  originalImageRef: string;
  /** 깨끗한 원본 이미지 (편집 대상, 컬러 라인 없음) data URL */
  originalImage: string;
  /** 색상 마커별 지시문 (키: hex 색상 코드(소문자), 값: 사용자 입력 지시문) */
  colorInstructions: Record<string, string>;
  /** 캔버스에서 실제로 사용된 색상 hex 목록 (소문자) */
  usedColors: string[];
  /** 색상별 stroke의 정규화 bounding box (모델에 텍스트로 영역 지시할 때 사용) */
  colorRegions: Record<string, ColorRegion>;
  /** 사용자 자유 형식 공통 지시문 (모든 색상에 공통적으로 적용) */
  globalInstructions: string;
}

/** 색상 hex → 한국어 라벨 매핑 (모델에 자연어 지시문으로 풀어쓰기 위함) */
export const ANNOTATION_COLORS: Array<{ hex: string; label: string; emoji: string }> = [
  { hex: '#ff3b30', label: '빨간색', emoji: '🔴' },
  { hex: '#ffcc00', label: '노란색', emoji: '🟡' },
  { hex: '#0a84ff', label: '파란색', emoji: '🔵' },
  { hex: '#34c759', label: '초록색', emoji: '🟢' },
];

export function getColorLabel(hex: string): { label: string; emoji: string } {
  const lower = hex.toLowerCase();
  const found = ANNOTATION_COLORS.find((c) => c.hex === lower);
  return found ?? { label: hex, emoji: '🎨' };
}

/** 색상별 지시문을 모델용 자연어 prompt로 직렬화. colorRegions가 있으면 좌표 포함 */
export function serializeColorInstructions(
  colorInstructions: Record<string, string>,
  usedColors: string[],
  colorRegions?: Record<string, ColorRegion>
): string {
  const filledEntries: Array<{ hex: string; text: string }> = [];
  for (const hex of usedColors) {
    const text = (colorInstructions[hex.toLowerCase()] ?? '').trim();
    if (text) filledEntries.push({ hex: hex.toLowerCase(), text });
  }
  if (filledEntries.length === 0) return '';
  const lines: string[] = ['[부분 편집 지시 — 영역별 처리]'];
  for (const entry of filledEntries) {
    const meta = getColorLabel(entry.hex);
    const region = colorRegions?.[entry.hex];
    if (region) {
      const x1 = Math.round(region.x * 100);
      const y1 = Math.round(region.y * 100);
      const x2 = Math.round((region.x + region.w) * 100);
      const y2 = Math.round((region.y + region.h) * 100);
      lines.push(`- ${meta.emoji} 영역 (가로 ${x1}~${x2}%, 세로 ${y1}~${y2}%): ${entry.text}`);
    } else {
      lines.push(`- ${meta.emoji} ${meta.label} 영역: ${entry.text}`);
    }
  }
  lines.push('명시되지 않은 영역은 원본의 형태/색상/디테일을 가능한 한 그대로 유지하라.');
  return lines.join('\n');
}

export function serializeTextAnnotations(labels: TextAnnotation[]): string {
  if (labels.length === 0) return '';
  const lines = labels.map((label) => {
    const xPct = Math.round(label.x * 100);
    const yPct = Math.round(label.y * 100);
    return `- "${label.text}" 위치(가로 ${xPct}%, 세로 ${yPct}%)`;
  });
  return ['[사용자 어노테이션 텍스트 라벨]', ...lines].join('\n');
}

