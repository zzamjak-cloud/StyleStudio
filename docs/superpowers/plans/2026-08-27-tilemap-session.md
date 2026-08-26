# 타일맵 세션 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 유니티 Tilemap에 바로 쓰는 손맵 스타일 바닥타일 변형 세트를 생성하는 신규 세션 타입 `TILEMAP`을 추가한다.

**Architecture:** 기존 분석·생성 파이프라인(AnalysisPanel → ImageGeneratorPanel)을 그대로 재사용하고, 타일맵 고유 기능(시트 분할·seam 검증·교체 재생성·배치 미리보기·유니티 내보내기)은 생성 후처리 레이어(`useTilemapProcessing` 훅 + `TilemapResultView`)로 추가한다. 시트(1024 PNG)만 imageStorage에 저장하고 타일은 런타임 canvas 분할로 파생한다.

**Tech Stack:** React 19 + TypeScript + Tauri v2 (plugin-fs), plain `<canvas>` (Konva 미사용), Gemini/OpenAI 이미지 생성 (기존 훅 재사용)

**Spec:** `docs/superpowers/specs/2026-08-27-tilemap-session-design.md`

## Global Constraints

- 코드 주석·커밋 메시지·UI 문구: **한국어**. 식별자: 영어. (CLAUDE.md 언어 규칙)
- 테스트 인프라 없음 — 각 태스크의 검증은 `npx tsc --noEmit`, 최종 검증은 `npm run build` + 수동 E2E (Task 10).
- TILEMAP 세션 고정값: 비율 `1:1`, 해상도 `1K`, 그리드 `4x4 | 8x8` (기본 `4x4`).
- `TILEMAP_SEAM_WARNING_THRESHOLD = 70` (seam 점수 0~100, 미만이면 경고).
- 타일 개별 저장 금지 — 시트 imageStorage 키 + `slotAssignments` 매핑만 영속화.
- imageStorage 시트 키 형식: `tilemap-sheet-{sheetId}`.
- `SessionType`에 `'TILEMAP'` 추가 시 컴파일이 강제하는 전수 맵은 정확히 2곳: `SESSION_CONFIG`(sessionConfig.ts:43), `promptGenerators`(sessionPrompts.ts:57). 이 둘은 Task 1에서 함께 갱신해야 빌드가 통과한다.
- 위키 갱신은 선택이 아니라 필수 (프로젝트 규칙, Task 10).

---

### Task 1: 타입 정의 + SESSION_CONFIG + 타일맵 프롬프트

**Files:**
- Create: `src/types/tilemap.ts`
- Modify: `src/types/session.ts:7` (SessionType), `src/types/session.ts:26` 부근 (Session 필드)
- Modify: `src/types/analysis.ts:82` 부근 (TilemapSpecificAnalysis)
- Modify: `src/lib/config/sessionConfig.ts:307` 부근 (SESSION_CONFIG.TILEMAP)
- Modify: `src/lib/prompts/sessionPrompts.ts:57` (promptGenerators), `:75` (buildPromptForSession), 파일 말미 (generateTilemapPrompt)

**Interfaces:**
- Consumes: `PixelArtGridLayout`/`getPixelArtGridInfo` (`src/types/pixelart.ts`)
- Produces (이후 태스크 전부가 사용):
  - `TilemapGridLayout = '4x4' | '8x8'`
  - `TILEMAP_GRID_LAYOUTS: TilemapGridLayout[]`, `TILEMAP_SEAM_WARNING_THRESHOLD: number`
  - `interface TilemapSheet { id: string; imageKey: string; createdAt: string }`
  - `interface TileSlotAssignment { slotIndex: number; sheetId: string; cellIndex: number; seamScore?: number; locked?: boolean }`
  - `interface TilemapSessionData { grid: TilemapGridLayout; sheets: TilemapSheet[]; slotAssignments: TileSlotAssignment[] }`
  - `interface TilemapSpecificAnalysis` (7필드, 아래 코드 참조), `ImageAnalysisResult.tilemap_specific?`
  - `Session.tilemapData?: TilemapSessionData`, `SessionType`에 `'TILEMAP'`

- [ ] **Step 1: `src/types/tilemap.ts` 신규 작성**

```typescript
import { PixelArtGridLayout } from './pixelart';

/**
 * 타일맵 그리드 레이아웃 (PixelArtGridLayout의 부분집합)
 * 타일맵 세션은 4x4(16타일·셀 256px)와 8x8(64타일·셀 128px)만 지원한다.
 */
export type TilemapGridLayout = Extract<PixelArtGridLayout, '4x4' | '8x8'>;

/** 타일맵에서 지원하는 그리드 목록 (UI 노출용) */
export const TILEMAP_GRID_LAYOUTS: TilemapGridLayout[] = ['4x4', '8x8'];

/** seam 점수(0~100)가 이 값 미만이면 이음새 경고 뱃지를 표시한다 */
export const TILEMAP_SEAM_WARNING_THRESHOLD = 70;

/** 생성된 타일 시트 1장. 원본 1024 이미지는 imageStorage 키로만 보관한다(직접 base64 저장 금지) */
export interface TilemapSheet {
  id: string;
  imageKey: string; // imageStorage 키: `tilemap-sheet-{id}`
  createdAt: string; // ISO 8601
}

/**
 * 슬롯 → (시트, 셀) 매핑.
 * 타일은 시트의 결정적 분할 결과이므로 개별 저장하지 않고 이 매핑으로만 관리한다.
 */
export interface TileSlotAssignment {
  slotIndex: number; // 0 ~ (타일 수 - 1), 행우선
  sheetId: string; // TilemapSheet.id
  cellIndex: number; // 해당 시트 내 셀 번호 (행우선)
  seamScore?: number; // 0~100 이음새 점수
  locked?: boolean; // true면 교체 재생성에서 보호
}

/** TILEMAP 세션 전용 데이터 (Session.tilemapData) */
export interface TilemapSessionData {
  grid: TilemapGridLayout;
  sheets: TilemapSheet[];
  slotAssignments: TileSlotAssignment[];
}

/** PixelArtGridLayout 값이 타일맵 지원 그리드인지 판별 */
export function isTilemapGridLayout(grid: PixelArtGridLayout): grid is TilemapGridLayout {
  return grid === '4x4' || grid === '8x8';
}
```

- [ ] **Step 2: `src/types/analysis.ts`에 TilemapSpecificAnalysis 추가**

`LogoSpecificAnalysis`(라인 71) 뒤에 추가하고, `ImageAnalysisResult`(라인 74)에 필드 추가:

```typescript
// 타일맵(손맵 바닥타일) 특화 분석 결과 (TILEMAP 타입일 때만 사용)
export interface TilemapSpecificAnalysis {
  brush_style: string;         // 붓터치 스타일 (예: "visible soft brushwork", "layered opaque strokes")
  color_palette: string;       // 주요 색·명도 범위 (예: "warm greens with ochre accents, mid-value")
  texture_density: string;     // 디테일 밀도 (예: "sparse details, mostly flat base", "dense organic noise")
  material_type: string;       // 재질 (예: "grass", "stone floor", "dirt path", "wooden planks", "sand")
  perspective: string;         // 시점 (예: "top-down", "3/4 view")
  edge_softness: string;       // 경계 붓터치 부드러움 (예: "soft blended edges", "crisp painterly edges")
  lighting_direction: string;  // 광원 방향·색온도 (예: "top-left warm sunlight", "neutral ambient")
}
```

`ImageAnalysisResult`에:

```typescript
  tilemap_specific?: TilemapSpecificAnalysis; // TILEMAP 타입일 때만 존재
```

- [ ] **Step 3: `src/types/session.ts` 갱신**

라인 7의 유니온 끝에 `| 'TILEMAP'` 추가:

```typescript
export type SessionType = 'BASIC' | 'STYLE' | 'CHARACTER' | 'BACKGROUND' | 'ICON' | 'PIXELART_CHARACTER' | 'PIXELART_BACKGROUND' | 'PIXELART_ICON' | 'UI' | 'LOGO' | 'ILLUSTRATION' | 'CONCEPT' | 'TILEMAP';
```

import 추가(파일 상단) + `Session` 인터페이스의 `conceptData` 필드(라인 26) 아래에:

```typescript
import { TilemapSessionData } from './tilemap';
```

```typescript
  tilemapData?: TilemapSessionData; // TILEMAP 세션 전용 데이터
```

- [ ] **Step 4: `SESSION_CONFIG.TILEMAP` 추가 (sessionConfig.ts)**

`CONCEPT` 항목(라인 286~306) 뒤, 객체 닫힘 전에 추가. `grids`는 `Record<PixelArtGridLayout, string>`이라 6키 전부 필요 — 미지원 그리드는 안내 문구로 채운다(UI에서 노출 안 함, Task 4):

```typescript
  TILEMAP: {
    label: '타일맵',
    icon: '🧱',
    description: '유니티 Tilemap용 손맵 스타일 바닥타일 세트를 생성합니다',
    colors: {
      selected: 'bg-lime-600 text-white border-lime-700 shadow-lg',
      unselected: 'bg-white text-gray-700 border-lime-200 hover:border-lime-400',
      background: 'bg-gradient-to-r from-lime-50 to-emerald-50',
      border: 'border-lime-200',
    },
    grids: {
      '1x1': '타일맵에서는 지원하지 않는 그리드입니다',
      '2x2': '타일맵에서는 지원하지 않는 그리드입니다',
      '3x3': '타일맵에서는 지원하지 않는 그리드입니다',
      '4x4': '🧱 16개 타일 변형 세트를 생성합니다 (타일당 256px)',
      '6x6': '타일맵에서는 지원하지 않는 그리드입니다',
      '8x8': '🧱 64개 타일 변형 세트를 생성합니다 (타일당 128px)',
    },
    promptPlaceholder: '바닥 재질을 설명하세요 (예: 잔디, 흙길, 돌바닥 / grass, dirt path, stone floor)',
    gridLabel: '🧱 타일맵 그리드',
  },
```

- [ ] **Step 5: `generateTilemapPrompt` 작성 + 등록 (sessionPrompts.ts)**

`promptGenerators` 맵(라인 57)에 항목 추가:

```typescript
  TILEMAP: generateTilemapPrompt,
```

`buildPromptForSession`(라인 75)의 body 결정 분기를 TILEMAP 우선으로 수정 — **참조 이미지가 없어도 타일링 규칙이 반드시 적용**되어야 하기 때문:

```typescript
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
```

파일 말미(다른 generator들 뒤)에 전체 구현 추가:

```typescript
/**
 * TILEMAP 세션 프롬프트 생성
 * - 손맵(hand-painted) 변형 타일 세트: 모든 타일이 상호 seamless (임의 배치 호환)
 * - 타일링 규칙 6조: 균질 베이스 · 조용한 경계 존 · 중앙 디테일 랜덤성 ·
 *   NO GRID LINES · 일관 조명 · 손맵 채색 강제
 */
function generateTilemapPrompt(params: PromptGenerationParams): string {
  const { basePrompt, pixelArtGrid, analysis } = params;

  // 타일맵은 4x4/8x8만 지원 — 그 외 값이 들어오면 4x4로 강제
  const grid = pixelArtGrid === '8x8' ? '8x8' : '4x4';
  const gridInfo = getPixelArtGridInfo(grid);
  const tileCount = gridInfo.totalFrames;
  const gridLayout = `${gridInfo.rows}x${gridInfo.cols}`;

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

  return `🎯 HAND-PAINTED TILEMAP VARIATION SET (${tileCount} ground tiles in ${gridLayout} grid, single 1024x1024 image)

Create ${tileCount} mutually interchangeable ground tile variations of ONE terrain type, arranged in a ${gridLayout} grid. These tiles will be cut apart and placed in ANY random arrangement in a game engine (Unity Tilemap), so EVERY tile edge must blend seamlessly with EVERY other tile edge.
${styleSpec}
🧱 TILING RULES (CRITICAL - all 6 must hold):
1. UNIFORM BASE: the entire canvas is ONE continuous, statistically uniform hand-painted texture of the same material - consistent hue, brightness, and brushstroke density everywhere.
2. QUIET EDGE ZONES: the outer ~15% of every cell must stay low-contrast base texture only - no distinctive details, no strong shapes near any cell edge.
3. CENTERED DETAIL VARIETY: distinctive details (flowers, pebbles, cracks, leaves) go ONLY near each cell's center, and every cell gets DIFFERENT details for natural variety.
4. NO GRID LINES: do NOT draw any lines, borders, dividers, or separators between cells. The grid layout is purely conceptual - there must be NO visible grid structure in the final image.
5. CONSISTENT LIGHTING: one light direction and color temperature across the whole canvas; all shadows fall the same way.
6. HAND-PAINTED ONLY: visible painterly brushwork, stylized game-art shading - NOT photorealistic, NOT a photo texture, NOT 3D rendered.

⛔ AVOID: photorealistic, 3D render, photo texture, grid lines, seams, visible borders, vignette, tiling artifacts.

🌿 TERRAIN: ${basePrompt || 'stylized grass ground'}

Generate the ${tileCount}-tile hand-painted variation set in the ${gridLayout} grid now.`;
}
```

- [ ] **Step 6: 타입체크**

Run: `npx tsc --noEmit`
Expected: 에러 0. (SESSION_CONFIG·promptGenerators 둘 다 갱신했으므로 통과해야 함. 다른 곳에서 `Record<SessionType,...>` 에러가 나면 해당 파일도 이 태스크에서 함께 갱신)

- [ ] **Step 7: 커밋**

```bash
git add src/types/tilemap.ts src/types/session.ts src/types/analysis.ts src/lib/config/sessionConfig.ts src/lib/prompts/sessionPrompts.ts
git commit -m "feat: TILEMAP 세션 타입·설정·타일링 프롬프트 추가"
```

---

### Task 2: 분석 파이프라인 (분석 프롬프트 + 분기 + 분석 카드)

**Files:**
- Modify: `src/lib/gemini/analysisPrompt.ts:426` 부근 (PIXELART_BACKGROUND_ANALYZER_PROMPT 뒤)
- Modify: `src/hooks/api/useGeminiAnalyzer.ts:99` 부근 (프롬프트 분기)
- Create: `src/components/analysis/TilemapCard.tsx`
- Modify: `src/components/analysis/AnalysisPanel.tsx:74` 부근 (타입 체크), `:306` 부근 (카드 렌더), props 인터페이스
- Modify: `src/App.tsx:1468` 부근 (AnalysisPanel에 onTilemapAnalysisUpdate 전달)

**Interfaces:**
- Consumes: `TilemapSpecificAnalysis` (Task 1)
- Produces: `TILEMAP_ANALYZER_PROMPT: string` (analysisPrompt.ts export), `TilemapCard` 컴포넌트, `AnalysisPanel`의 `onTilemapAnalysisUpdate?: (t: TilemapSpecificAnalysis) => void` prop

- [ ] **Step 1: `TILEMAP_ANALYZER_PROMPT` 추가 (analysisPrompt.ts)**

`PIXELART_BACKGROUND_ANALYZER_PROMPT`(라인 330~426) 뒤에 추가. 구조는 그것을 본뜨되 손맵 타일 특화:

```typescript
export const TILEMAP_ANALYZER_PROMPT = `
너는 전문 게임 환경 아티스트이자 손맵(hand-painted) 텍스처 분석 전문가야.

사용자가 제공한 손맵 스타일 바닥타일/지형 이미지를 정밀 분석하여 다음 JSON 포맷으로 출력해:

{
  "style": {
    "art_style": "손맵 아트 스타일 (예: hand-painted stylized game art, painterly casual mobile style)",
    "technique": "채색 기법 (예: layered opaque brushwork, soft blended strokes, flat painterly shading)",
    "color_palette": "색상 팔레트 (예: warm greens with ochre accents, muted earth tones)",
    "lighting": "조명 (예: soft ambient top light, warm sunlight from top-left)",
    "mood": "분위기"
  },
  "character": {
    "gender": "N/A - tilemap only",
    "age_group": "N/A - tilemap only",
    "hair": "N/A - tilemap only",
    "eyes": "N/A - tilemap only",
    "face": "N/A - tilemap only",
    "outfit": "N/A - tilemap only",
    "accessories": "N/A - tilemap only",
    "body_proportions": "N/A - tilemap only",
    "limb_proportions": "N/A - tilemap only",
    "torso_shape": "N/A - tilemap only",
    "hand_style": "N/A - tilemap only",
    "feet_style": "N/A - tilemap only"
  },
  "composition": {
    "pose": "N/A - tilemap only",
    "angle": "시점 (예: top-down, 3/4 view)",
    "background": "지형/재질 상세 설명 (재질 종류, 디테일 요소, 색 변화, 붓터치 특징 등)",
    "depth_of_field": "N/A - flat tile texture"
  },
  "tilemap_specific": {
    "brush_style": "붓터치 스타일 (예: visible soft brushwork, layered opaque strokes, textured dry brush)",
    "color_palette": "주요 색·명도 범위 (예: warm greens #6a8f3c~#8fb35a, mid-value, low contrast)",
    "texture_density": "디테일 밀도 (예: sparse details on flat base, dense organic noise)",
    "material_type": "재질 (예: grass, stone floor, dirt path, wooden planks, sand, snow)",
    "perspective": "시점 (예: top-down, 3/4 view)",
    "edge_softness": "경계 붓터치 부드러움 (예: soft blended edges, crisp painterly edges)",
    "lighting_direction": "광원 방향·색온도 (예: top-left warm sunlight, neutral ambient no direction)"
  },
  "negative_prompt": "손맵 타일에서 피해야 할 요소들 (영문 키워드: photorealistic, photo texture, 3D render, grid lines, seams, visible borders, vignette, tiling artifacts, characters, people, objects with strong silhouettes, text, watermark)"
}

**중요 분석 지침 (손맵 타일맵 특화):**

1. **절대 캐릭터/오브젝트를 포함하지 말 것**:
   - 이미지에 캐릭터·건물·소품이 있어도 무시하고 바닥/지형 재질만 분석
   - character 섹션은 모두 "N/A - tilemap only"로 채울 것
   - negative_prompt에 "characters, people" 반드시 포함

2. **손맵 채색 특성 (가장 중요)**:
   - 붓터치의 가시성·방향·레이어링 방식을 구체적으로 기술
   - 리얼 텍스처 사진과 손맵을 명확히 구분 — photorealistic 요소가 있으면 negative_prompt에 강하게 반영

3. **타일링 관점 분석**:
   - 재질의 균질성(어느 부분을 잘라도 비슷한가)을 texture_density에 반영
   - 고대비 디테일 요소(꽃·돌·균열)의 분포 밀도 기술

4. **조명 일관성**:
   - 광원 방향이 뚜렷하면 방향 명시, 없으면 "neutral ambient no direction"

**출력 형식:**
- 반드시 유효한 JSON 형식으로만 응답
- JSON 외의 다른 텍스트는 포함하지 말 것
- tilemap_specific 섹션을 반드시 포함할 것
`;
```

- [ ] **Step 2: useGeminiAnalyzer 분기 추가**

`useGeminiAnalyzer.ts` 상단 import에 `TILEMAP_ANALYZER_PROMPT` 추가. 라인 99의 `PIXELART_BACKGROUND` 분기 앞에:

```typescript
      } else if (sessionType === 'TILEMAP') {
        analysisPrompt = TILEMAP_ANALYZER_PROMPT;
        promptType = 'TILEMAP';
        logger.debug('📋 프롬프트 선택: TILEMAP (손맵 타일 전용, 캐릭터 제외)');
```

참고: 응답은 `JSON.parse`(라인 290)로 직접 파싱되고 섹션 화이트리스트가 없으므로 `tilemap_specific`은 추가 코드 없이 `ImageAnalysisResult`로 전달된다.

- [ ] **Step 3: `TilemapCard.tsx` 신규 작성 (UICard 패턴 복제)**

```tsx
import { memo } from 'react';
import { LayoutGrid } from 'lucide-react';
import { TilemapSpecificAnalysis } from '../../types/analysis';
import { AnalysisCard } from './AnalysisCard';

interface TilemapCardProps {
  tilemapAnalysis: TilemapSpecificAnalysis;
  onUpdate?: (tilemapAnalysis: TilemapSpecificAnalysis) => void;
}

/** 타일맵 세션 전용 분석 카드 — 손맵 채색 특성(tilemap_specific) 편집 */
export const TilemapCard = memo(function TilemapCard({ tilemapAnalysis, onUpdate }: TilemapCardProps) {
  const fields: Array<{ key: keyof TilemapSpecificAnalysis; label: string; icon?: string }> = [
    { key: 'material_type', label: '재질', icon: '🧱' },
    { key: 'brush_style', label: '붓터치 스타일', icon: '🖌️' },
    { key: 'color_palette', label: '색상 팔레트', icon: '🌈' },
    { key: 'texture_density', label: '디테일 밀도', icon: '🌿' },
    { key: 'perspective', label: '시점', icon: '📐' },
    { key: 'edge_softness', label: '경계 부드러움', icon: '〰️' },
    { key: 'lighting_direction', label: '광원 방향', icon: '💡' },
  ];

  return (
    <AnalysisCard<TilemapSpecificAnalysis>
      title="타일맵 분석"
      icon={LayoutGrid}
      iconColor="text-lime-600"
      borderColor="border-lime-200"
      bgColor="bg-lime-100"
      hoverColor="hover:text-lime-600 hover:bg-lime-50"
      focusColor="border-lime-500 focus:ring-lime-500"
      data={tilemapAnalysis}
      fields={fields}
      onUpdate={onUpdate}
    />
  );
});
```

- [ ] **Step 4: AnalysisPanel에 카드 연결**

`AnalysisPanel.tsx`:
1. import: `import { TilemapCard } from './TilemapCard';` + `TilemapSpecificAnalysis` 타입 import.
2. props 인터페이스(라인 18)에 추가: `onTilemapAnalysisUpdate?: (tilemapAnalysis: TilemapSpecificAnalysis) => void;` (컴포넌트 destructure에도 추가).
3. 타입 체크(라인 76 뒤): `const isTilemapType = currentSession?.type === 'TILEMAP';`
4. 상세 모달 카드 그리드(라인 306의 UICard 블록과 나란히):

```tsx
              {isTilemapType && analysisResult.tilemap_specific && (
                <TilemapCard
                  tilemapAnalysis={analysisResult.tilemap_specific}
                  onUpdate={onTilemapAnalysisUpdate}
                />
              )}
```

5. CharacterCard 렌더 조건(라인 320)에 `&& !isTilemapType` 추가 (타일맵은 캐릭터 카드 불필요):

```tsx
              {!isBackgroundType && !isUIType && !isLogoType && !isTilemapType && (
```

- [ ] **Step 5: App.tsx에서 onTilemapAnalysisUpdate 전달**

`onUIAnalysisUpdate`(App.tsx:1468) 블록과 같은 패턴으로 그 옆에 추가:

```tsx
              onTilemapAnalysisUpdate={(tilemapAnalysis) => {
                if (analysisResult) {
                  const updated = { ...analysisResult, tilemap_specific: tilemapAnalysis };
                  setAnalysisResult(updated);
                  saveSessionWithoutTranslation(updated);
                }
              }}
```

- [ ] **Step 6: 타입체크 후 커밋**

Run: `npx tsc --noEmit` → 에러 0

```bash
git add src/lib/gemini/analysisPrompt.ts src/hooks/api/useGeminiAnalyzer.ts src/components/analysis/TilemapCard.tsx src/components/analysis/AnalysisPanel.tsx src/App.tsx
git commit -m "feat: 타일맵 참조 분석 프롬프트·분기·분석 카드 추가"
```

---

### Task 3: 세션 생성·라우팅 통합 (모달·사이드바·App)

**Files:**
- Modify: `src/components/common/NewSessionModal.tsx` (아이콘 import + TILEMAP 버튼)
- Modify: `src/components/common/Sidebar.tsx:13` (getSessionTypeInfo)
- Modify: `src/App.tsx:1019` (handleNewSession), `:1115` 부근 (handleTilemapDataChange), `:1485` (ImageGeneratorPanel props)
- Modify: `src/components/generator/ImageGeneratorPanel.tsx:324` (props 인터페이스만)

**Interfaces:**
- Consumes: `TilemapSessionData` (Task 1), `updateSession`/`updateSessionInList`/`persistSessions` (기존 sessionHelpers)
- Produces:
  - `ImageGeneratorPanelProps.tilemapData?: TilemapSessionData`
  - `ImageGeneratorPanelProps.onTilemapDataChange?: (data: TilemapSessionData) => void`
  - App의 `handleTilemapDataChange(tilemapData: TilemapSessionData): Promise<void>`

- [ ] **Step 1: NewSessionModal에 타일맵 버튼 추가**

lucide import에 `LayoutGrid` 추가. `PIXELART_ICON` 버튼 블록(라인 178~194) 뒤에:

```tsx
              {/* TILEMAP */}
              <button
                onClick={() => setSessionType('TILEMAP')}
                className={`flex flex-col items-start gap-2 p-4 rounded-lg font-semibold transition-all border-2 ${
                  sessionType === 'TILEMAP'
                    ? 'bg-lime-50 border-lime-600 shadow-lg'
                    : 'bg-white border-gray-200 hover:border-lime-300 hover:bg-lime-50/50'
                }`}
              >
                <div className="flex items-center gap-2">
                  <LayoutGrid size={20} className={sessionType === 'TILEMAP' ? 'text-lime-600' : 'text-gray-600'} />
                  <span className={sessionType === 'TILEMAP' ? 'text-lime-900' : 'text-gray-700'}>타일맵</span>
                </div>
                <p className="text-xs text-left text-gray-600">
                  손맵 스타일 바닥타일 세트를 생성합니다 (유니티 Tilemap용)
                </p>
              </button>
```

- [ ] **Step 2: Sidebar 아이콘 매핑 추가**

lucide import에 `LayoutGrid` 추가. `getSessionTypeInfo`(라인 13) switch의 `CONCEPT` case 뒤에:

```typescript
    case 'TILEMAP':
      return { icon: LayoutGrid, bgColor: 'bg-lime-600/20', textColor: 'text-lime-400' };
```

- [ ] **Step 3: App handleNewSession에 초기 데이터**

`CONCEPT` 초기화 블록(App.tsx:1083~1096) 뒤에:

```typescript
    // TILEMAP 세션인 경우 초기 데이터 설정
    if (type === 'TILEMAP') {
      newSession.tilemapData = {
        grid: '4x4',
        sheets: [],
        slotAssignments: [],
      };
    }
```

App.tsx 상단에 `import { TilemapSessionData } from './types/tilemap';` 추가.

- [ ] **Step 4: App에 handleTilemapDataChange 추가**

`handleIllustrationDataChange`(App.tsx:1115) 바로 뒤, 같은 패턴:

```typescript
  // TILEMAP 세션 전용 데이터 변경 → 세션 저장
  const handleTilemapDataChange = useCallback(async (tilemapData: TilemapSessionData) => {
    if (!currentSession || currentSession.type !== 'TILEMAP') return;

    const updatedSession = updateSession(currentSession, { tilemapData });
    const updatedSessions = updateSessionInList(sessions, currentSession.id, updatedSession);
    setSessions(updatedSessions);
    setCurrentSession(updatedSession);
    await persistSessions(updatedSessions);
  }, [currentSession, sessions, setSessions, setCurrentSession]);
```

- [ ] **Step 5: ImageGeneratorPanel props 인터페이스 확장 + App 전달**

`ImageGeneratorPanelProps`(라인 324)에 (import 포함):

```typescript
  tilemapData?: TilemapSessionData; // TILEMAP 세션 전용 데이터
  onTilemapDataChange?: (data: TilemapSessionData) => void; // TILEMAP 데이터 변경 콜백
```

(이 태스크에서는 인터페이스만 추가하고 컴포넌트에서 destructure 하지 않는다 — 사용은 Task 6.)

App.tsx:1485의 일반 세션용 `<ImageGeneratorPanel>` 호출에 추가:

```tsx
                tilemapData={currentSession?.type === 'TILEMAP' ? currentSession.tilemapData : undefined}
                onTilemapDataChange={handleTilemapDataChange}
```

- [ ] **Step 6: 타입체크 후 커밋**

Run: `npx tsc --noEmit` → 에러 0

```bash
git add src/components/common/NewSessionModal.tsx src/components/common/Sidebar.tsx src/App.tsx src/components/generator/ImageGeneratorPanel.tsx
git commit -m "feat: 타일맵 세션 생성 UI·아이콘·데이터 영속화 연결"
```

- [ ] **Step 7: 수동 확인**

`npm run tauri:dev`(또는 기존 dev 세션)에서: 신규 세션 모달에 "타일맵" 버튼 표시 → 생성 시 사이드바에 lime `LayoutGrid` 아이콘 → 참조 업로드·분석 시 "타일맵 분석" 카드 표시.

---

### Task 4: 생성 설정 제약 (그리드 4x4/8x8 · 1:1 · 1K 고정)

**Files:**
- Modify: `src/components/generator/GeneratorSettings.tsx:209` (그리드 블록), `:358` (비율), `:387` (크기)
- Modify: `src/components/generator/ImageGeneratorPanel.tsx:406` (pixelArtGrid 초기값)

**Interfaces:**
- Consumes: `TILEMAP_GRID_LAYOUTS` (Task 1), 기존 `getGridButtonStyle`/`getGridSectionStyle`/`onPixelArtGridChange`
- Produces: 없음 (UI 제약만)

- [ ] **Step 1: TILEMAP 전용 그리드 블록 추가 (GeneratorSettings.tsx)**

기존 그리드 블록(라인 209, TILEMAP은 조건 목록에 없으므로 자동 제외됨) 앞에 별도 블록:

```tsx
          {/* 타일맵 전용 그리드 (4x4/8x8만 지원) */}
          {sessionType === 'TILEMAP' && (
            <div className={getGridSectionStyle(sessionType)}>
              <label className="block text-sm font-semibold text-gray-700 mb-3">
                그리드
              </label>
              <div className="grid grid-cols-2 gap-2">
                {TILEMAP_GRID_LAYOUTS.map((grid) => (
                  <button
                    key={grid}
                    onClick={() => onPixelArtGridChange(grid)}
                    className={`p-2 rounded-md text-xs font-medium border-2 transition-all ${getGridButtonStyle(
                      sessionType,
                      pixelArtGrid === grid
                    )}`}
                  >
                    <div className="font-bold">{grid}</div>
                    <div className="text-[10px] opacity-75">
                      {grid === '4x4' ? '16타일 · 256px' : '64타일 · 128px'}
                    </div>
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-gray-500">
                타일맵은 1:1 비율 · 1K 해상도로 고정됩니다
              </p>
            </div>
          )}
```

import 추가: `import { TILEMAP_GRID_LAYOUTS } from '../../types/tilemap';`

- [ ] **Step 2: 비율·크기 섹션을 TILEMAP에서 숨김**

라인 358의 `{/* 이미지 비율 선택 */}` div와 라인 387의 `{/* 이미지 크기 선택 */}` div를 각각 `{sessionType !== 'TILEMAP' && ( ... )}` 로 감싼다. (내부 코드는 변경 없음.)

- [ ] **Step 3: 패널 그리드 초기값 (ImageGeneratorPanel.tsx:406)**

```typescript
    pixelArtGrid: sessionType === 'TILEMAP' ? '4x4' : IMAGE_GENERATION_DEFAULTS.PIXEL_ART_GRID,
```

(비율·크기 기본값은 이미 `1:1`/`1K` — constants.ts:14·16 — 이므로 변경 불필요. UI를 숨겨 변경 경로를 차단.)

- [ ] **Step 4: 타입체크 후 커밋**

Run: `npx tsc --noEmit` → 에러 0

```bash
git add src/components/generator/GeneratorSettings.tsx src/components/generator/ImageGeneratorPanel.tsx
git commit -m "feat: 타일맵 생성 설정 제약 (4x4/8x8 그리드, 1:1·1K 고정)"
```

---

### Task 5: 시트 분할 + seam 검증 순수 함수

**Files:**
- Create: `src/lib/tilemap/tileSlicer.ts`
- Create: `src/lib/tilemap/seamValidator.ts`

**Interfaces:**
- Consumes: `getPixelArtGridInfo` (types/pixelart.ts), `TilemapGridLayout` (Task 1)
- Produces (Task 6~9가 사용):
  - `sliceTileSheet(sheetDataUrl: string, grid: TilemapGridLayout): Promise<string[]>` — 행우선 타일 PNG dataURL 배열
  - `computeSeamScores(tiles: string[]): Promise<number[]>` — 타일별 0~100 이음새 점수 (100=완벽)

- [ ] **Step 1: `tileSlicer.ts` 작성**

```typescript
import { getPixelArtGridInfo } from '../../types/pixelart';
import { TilemapGridLayout } from '../../types/tilemap';

/** dataURL 이미지를 HTMLImageElement로 로드 */
export function loadImageElement(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('타일 시트 이미지를 로드할 수 없습니다'));
    img.src = dataUrl;
  });
}

/**
 * 타일 시트를 그리드로 분할해 타일 PNG dataURL 배열(행우선)을 반환한다.
 * - 시트 실측 크기가 1024가 아니어도 실측 기준으로 셀 크기를 계산한다.
 * - 정사각형이 아니면 중앙 crop 후 분할한다 (모델이 비정확한 크기를 반환하는 경우 대비).
 */
export async function sliceTileSheet(
  sheetDataUrl: string,
  grid: TilemapGridLayout
): Promise<string[]> {
  const img = await loadImageElement(sheetDataUrl);
  const { rows, cols } = getPixelArtGridInfo(grid);

  // 정사각형 중앙 crop 기준
  const side = Math.min(img.width, img.height);
  const offsetX = Math.floor((img.width - side) / 2);
  const offsetY = Math.floor((img.height - side) / 2);
  const cellW = side / cols;
  const cellH = side / rows;
  const outSize = Math.round(cellW); // 출력 타일 한 변 = 실측 셀 크기

  const canvas = document.createElement('canvas');
  canvas.width = outSize;
  canvas.height = outSize;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context를 생성할 수 없습니다');

  const tiles: string[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      ctx.clearRect(0, 0, outSize, outSize);
      ctx.drawImage(
        img,
        offsetX + c * cellW, offsetY + r * cellH, cellW, cellH,
        0, 0, outSize, outSize
      );
      tiles.push(canvas.toDataURL('image/png'));
    }
  }
  return tiles;
}
```

- [ ] **Step 2: `seamValidator.ts` 작성**

```typescript
import { loadImageElement } from './tileSlicer';

// 경계 스트립 두께(px)와 변당 색 샘플 수 — 휴리스틱 상수
const EDGE_STRIP_PX = 4;
const EDGE_SAMPLES = 32;
// 8x8(64타일)에서 전수 쌍 계산 폭주 방지: 타일당 비교 상대 샘플 상한
const MAX_PARTNERS_PER_TILE = 16;
// 평균 절대 색차(0~255)를 0~100 점수로 매핑할 때의 최악 기준값
// (색차 0 → 100점, 색차 SEAM_ENERGY_WORST 이상 → 0점)
const SEAM_ENERGY_WORST = 64;

/** 타일 한 장의 4변 경계 색 프로파일: 변마다 EDGE_SAMPLES개의 [r,g,b] 평균색 */
interface EdgeProfile {
  top: number[][];
  bottom: number[][];
  left: number[][];
  right: number[][];
}

/** 타일 이미지에서 4변 경계 스트립의 평균색 프로파일 추출 */
async function extractEdgeProfile(tileDataUrl: string): Promise<EdgeProfile> {
  const img = await loadImageElement(tileDataUrl);
  const size = Math.min(img.width, img.height);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('canvas 2d context를 생성할 수 없습니다');
  ctx.drawImage(img, 0, 0, size, size);
  const data = ctx.getImageData(0, 0, size, size).data;

  // (x, y)의 RGB 반환
  const px = (x: number, y: number): [number, number, number] => {
    const i = (y * size + x) * 4;
    return [data[i], data[i + 1], data[i + 2]];
  };

  // 한 변을 따라 EDGE_SAMPLES개 지점에서, 스트립 두께 방향으로 평균한 색을 수집
  const sampleEdge = (
    along: (t: number) => [number, number, number][] // t(0~1) 지점의 스트립 픽셀들
  ): number[][] => {
    const samples: number[][] = [];
    for (let s = 0; s < EDGE_SAMPLES; s++) {
      const t = (s + 0.5) / EDGE_SAMPLES;
      const strip = along(t);
      let r = 0, g = 0, b = 0;
      for (const [pr, pg, pb] of strip) { r += pr; g += pg; b += pb; }
      samples.push([r / strip.length, g / strip.length, b / strip.length]);
    }
    return samples;
  };

  const strip = Math.min(EDGE_STRIP_PX, size);
  const coord = (t: number) => Math.min(size - 1, Math.floor(t * size));

  return {
    top: sampleEdge((t) => Array.from({ length: strip }, (_, d) => px(coord(t), d))),
    bottom: sampleEdge((t) => Array.from({ length: strip }, (_, d) => px(coord(t), size - 1 - d))),
    left: sampleEdge((t) => Array.from({ length: strip }, (_, d) => px(d, coord(t)))),
    right: sampleEdge((t) => Array.from({ length: strip }, (_, d) => px(size - 1 - d, coord(t)))),
  };
}

/** 두 경계 프로파일이 맞닿았을 때의 seam 에너지 = 샘플별 RGB 평균 절대차 (0~255) */
function seamEnergy(a: number[][], b: number[][]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += Math.abs(a[i][0] - b[i][0]) + Math.abs(a[i][1] - b[i][1]) + Math.abs(a[i][2] - b[i][2]);
  }
  return sum / (a.length * 3);
}

/**
 * 변형 타일 세트의 타일별 이음새 점수(0~100)를 계산한다.
 * "임의 두 타일이 이웃해도 이어져야 한다"는 요구에 따라, 각 타일의 4변을
 * 다른 타일들의 반대편 변과 쌍별 비교한 평균 에너지를 점수로 환산한다.
 * (64타일은 타일당 MAX_PARTNERS_PER_TILE개 상대만 균등 샘플링)
 */
export async function computeSeamScores(tiles: string[]): Promise<number[]> {
  const profiles = await Promise.all(tiles.map(extractEdgeProfile));
  const n = profiles.length;

  return profiles.map((p, i) => {
    // 비교 상대 균등 샘플링 (자기 자신 제외)
    const step = Math.max(1, Math.floor(n / MAX_PARTNERS_PER_TILE));
    let total = 0;
    let count = 0;
    for (let j = 0; j < n; j += step) {
      if (j === i) continue;
      const q = profiles[j];
      // 수평 이웃(내 오른쪽 ↔ 상대 왼쪽, 내 왼쪽 ↔ 상대 오른쪽)
      total += seamEnergy(p.right, q.left) + seamEnergy(p.left, q.right);
      // 수직 이웃(내 아래 ↔ 상대 위, 내 위 ↔ 상대 아래)
      total += seamEnergy(p.bottom, q.top) + seamEnergy(p.top, q.bottom);
      count += 4;
    }
    if (count === 0) return 100;
    const energy = total / count;
    return Math.max(0, Math.round(100 - (energy / SEAM_ENERGY_WORST) * 100));
  });
}
```

- [ ] **Step 3: 타입체크 후 커밋**

Run: `npx tsc --noEmit` → 에러 0

```bash
git add src/lib/tilemap/tileSlicer.ts src/lib/tilemap/seamValidator.ts
git commit -m "feat: 타일 시트 분할·seam 점수 계산 순수 함수 추가"
```

---

### Task 6: useTilemapProcessing 훅 + 생성 완료 연결

**Files:**
- Create: `src/hooks/useTilemapProcessing.ts`
- Modify: `src/components/generator/ImageGeneratorPanel.tsx:370` (destructure), `:711` 부근 (onComplete 끝)

**Interfaces:**
- Consumes: `sliceTileSheet`/`computeSeamScores` (Task 5), `saveImageWithKey`/`loadImage`/`deleteImage` (lib/imageStorage.ts), `TilemapSessionData` 등 (Task 1)
- Produces (Task 7~9가 사용) — `useTilemapProcessing(options)` 반환 객체:
  - `grid: TilemapGridLayout` — 현재 유효 그리드
  - `currentTiles: (string | null)[]` — slotAssignments 해석 결과 (슬롯 순 타일 dataURL, 캐시 미로드 시 null)
  - `proposal: TilemapReplacementProposal | null`
  - `processNewSheet(sheetDataUrl: string): Promise<void>` — 생성 완료 시 호출
  - `requestReplacement(slotIndexes: number[]): void` — 다음 생성을 교체 모드로 예약
  - `confirmProposal(): void` / `discardProposal(): Promise<void>`
  - `toggleLock(slotIndex: number): void`
  - `interface TilemapReplacementProposal { sheet: TilemapSheet; sheetTiles: string[]; replacements: Array<{ slotIndex: number; cellIndex: number; seamScore: number }> }`

- [ ] **Step 1: `useTilemapProcessing.ts` 작성**

```typescript
import { useCallback, useEffect, useRef, useState } from 'react';
import { PixelArtGridLayout } from '../types/pixelart';
import {
  TilemapGridLayout,
  TilemapSessionData,
  TilemapSheet,
  isTilemapGridLayout,
} from '../types/tilemap';
import { sliceTileSheet } from '../lib/tilemap/tileSlicer';
import { computeSeamScores } from '../lib/tilemap/seamValidator';
import { saveImageWithKey, loadImage, deleteImage } from '../lib/imageStorage';
import { logger } from '../lib/logger';

/** 교체 재생성 제안: 새 시트에서 seam 점수 상위 셀을 선택 슬롯에 배정 */
export interface TilemapReplacementProposal {
  sheet: TilemapSheet;
  sheetTiles: string[]; // 새 시트의 분할 타일 (미리보기용)
  replacements: Array<{ slotIndex: number; cellIndex: number; seamScore: number }>;
}

interface UseTilemapProcessingOptions {
  enabled: boolean; // sessionType === 'TILEMAP'
  tilemapData?: TilemapSessionData;
  onTilemapDataChange?: (data: TilemapSessionData) => void;
  pixelArtGrid: PixelArtGridLayout; // 패널의 현재 그리드 선택값
}

/**
 * 타일맵 생성 후처리 훅.
 * - 시트 저장(imageStorage) → 분할 → seam 점수 → 슬롯 할당/교체 제안
 * - 세션 재진입 시 저장된 시트를 로드·분할해 타일 캐시 복원
 */
export function useTilemapProcessing({
  enabled,
  tilemapData,
  onTilemapDataChange,
  pixelArtGrid,
}: UseTilemapProcessingOptions) {
  // sheetId → 분할 타일 dataURL[] (휘발성 캐시, 저장 안 함)
  const [tileCache, setTileCache] = useState<Map<string, string[]>>(new Map());
  const [proposal, setProposal] = useState<TilemapReplacementProposal | null>(null);
  // 교체 대상 슬롯 — handleGenerate 클로저의 stale 참조를 피하기 위해 ref로 유지
  const pendingReplaceSlotsRef = useRef<number[]>([]);

  const grid: TilemapGridLayout = isTilemapGridLayout(pixelArtGrid) ? pixelArtGrid : '4x4';

  // 세션 재진입 시: 저장된 시트를 로드해 캐시 복원
  useEffect(() => {
    if (!enabled || !tilemapData || tilemapData.sheets.length === 0) return;
    let cancelled = false;

    (async () => {
      const restored = new Map<string, string[]>();
      for (const sheet of tilemapData.sheets) {
        try {
          const dataUrl = await loadImage(sheet.imageKey);
          if (!dataUrl) {
            logger.warn('⚠️ 타일 시트 이미지 미발견:', sheet.imageKey);
            continue;
          }
          restored.set(sheet.id, await sliceTileSheet(dataUrl, tilemapData.grid));
        } catch (e) {
          logger.error('❌ 타일 시트 복원 실패:', sheet.id, e);
        }
      }
      if (!cancelled && restored.size > 0) {
        setTileCache((prev) => new Map([...prev, ...restored]));
      }
    })();

    return () => { cancelled = true; };
    // sheets 배열 길이 변화 시에만 재실행 (신규 시트는 processNewSheet가 즉시 캐시함)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, tilemapData?.sheets.length, tilemapData?.grid]);

  /** slotAssignments를 타일 dataURL 배열로 해석 */
  const currentTiles: (string | null)[] = (() => {
    if (!enabled || !tilemapData) return [];
    return tilemapData.slotAssignments.map((a) => {
      const tiles = tileCache.get(a.sheetId);
      return tiles?.[a.cellIndex] ?? null;
    });
  })();

  /** 교체 재생성 예약: 다음 processNewSheet가 교체 제안 모드로 동작 */
  const requestReplacement = useCallback((slotIndexes: number[]) => {
    pendingReplaceSlotsRef.current = slotIndexes;
  }, []);

  /** 생성 완료된 시트를 후처리 (저장→분할→점수→할당/제안) */
  const processNewSheet = useCallback(async (sheetDataUrl: string) => {
    if (!enabled || !onTilemapDataChange) return;

    const tiles = await sliceTileSheet(sheetDataUrl, grid);
    const scores = await computeSeamScores(tiles);

    const sheetId = `sheet-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const imageKey = `tilemap-sheet-${sheetId}`;
    await saveImageWithKey(imageKey, sheetDataUrl);
    const sheet: TilemapSheet = { id: sheetId, imageKey, createdAt: new Date().toISOString() };

    setTileCache((prev) => new Map(prev).set(sheetId, tiles));

    const prevData = tilemapData;
    const gridChanged = !prevData || prevData.grid !== grid;
    const pending = pendingReplaceSlotsRef.current;

    if (gridChanged || pending.length === 0 || !prevData || prevData.slotAssignments.length === 0) {
      // 전체 할당: 새 시트가 슬롯 전체를 채움
      // 그리드가 바뀌었으면 이전 시트 풀은 비운다 (스펙 §8 — 히스토리에는 잔존)
      pendingReplaceSlotsRef.current = [];
      onTilemapDataChange({
        grid,
        sheets: gridChanged ? [sheet] : [...prevData.sheets, sheet],
        slotAssignments: tiles.map((_, i) => ({
          slotIndex: i,
          sheetId,
          cellIndex: i,
          seamScore: scores[i],
        })),
      });
      return;
    }

    // 교체 제안: 새 시트에서 점수 상위 셀을 선택 슬롯 수만큼 배정 (락 슬롯 제외)
    const lockedSlots = new Set(
      prevData.slotAssignments.filter((a) => a.locked).map((a) => a.slotIndex)
    );
    const targets = pending.filter((s) => !lockedSlots.has(s));
    const ranked = scores
      .map((score, cellIndex) => ({ cellIndex, score }))
      .sort((a, b) => b.score - a.score);
    setProposal({
      sheet,
      sheetTiles: tiles,
      replacements: targets.map((slotIndex, k) => ({
        slotIndex,
        cellIndex: ranked[k % ranked.length].cellIndex,
        seamScore: ranked[k % ranked.length].score,
      })),
    });
  }, [enabled, onTilemapDataChange, grid, tilemapData]);

  /** 교체 제안 확정: 해당 슬롯만 갱신 + 시트 풀에 추가 */
  const confirmProposal = useCallback(() => {
    if (!proposal || !tilemapData || !onTilemapDataChange) return;
    const bySlot = new Map(proposal.replacements.map((r) => [r.slotIndex, r]));
    onTilemapDataChange({
      ...tilemapData,
      sheets: [...tilemapData.sheets, proposal.sheet],
      slotAssignments: tilemapData.slotAssignments.map((a) => {
        const r = bySlot.get(a.slotIndex);
        return r
          ? { ...a, sheetId: proposal.sheet.id, cellIndex: r.cellIndex, seamScore: r.seamScore }
          : a;
      }),
    });
    pendingReplaceSlotsRef.current = [];
    setProposal(null);
  }, [proposal, tilemapData, onTilemapDataChange]);

  /** 교체 제안 파기: 저장했던 시트 이미지도 정리 */
  const discardProposal = useCallback(async () => {
    if (!proposal) return;
    try {
      await deleteImage(proposal.sheet.imageKey);
    } catch (e) {
      logger.warn('⚠️ 제안 시트 정리 실패(무시):', e);
    }
    setTileCache((prev) => {
      const next = new Map(prev);
      next.delete(proposal.sheet.id);
      return next;
    });
    pendingReplaceSlotsRef.current = [];
    setProposal(null);
  }, [proposal]);

  /** 슬롯 락 토글 (교체 보호) */
  const toggleLock = useCallback((slotIndex: number) => {
    if (!tilemapData || !onTilemapDataChange) return;
    onTilemapDataChange({
      ...tilemapData,
      slotAssignments: tilemapData.slotAssignments.map((a) =>
        a.slotIndex === slotIndex ? { ...a, locked: !a.locked } : a
      ),
    });
  }, [tilemapData, onTilemapDataChange]);

  return {
    grid,
    currentTiles,
    proposal,
    processNewSheet,
    requestReplacement,
    confirmProposal,
    discardProposal,
    toggleLock,
  };
}
```

- [ ] **Step 2: ImageGeneratorPanel에 훅 연결**

1. destructure(라인 370~386)에 `tilemapData, onTilemapDataChange` 추가 + import.
2. 컴포넌트 상단(상태 선언부 뒤)에:

```typescript
  // 타일맵 생성 후처리 (TILEMAP 세션에서만 동작)
  const tilemap = useTilemapProcessing({
    enabled: sessionType === 'TILEMAP',
    tilemapData,
    onTilemapDataChange,
    pixelArtGrid,
  });
```

3. `onComplete` 콜백에서 히스토리 추가(라인 709~711) 직후:

```typescript
            // 타일맵 세션: 시트 분할·seam 검증·슬롯 할당 후처리
            if (sessionType === 'TILEMAP') {
              try {
                setProgressMessage('타일 분할·검증 중...');
                await tilemap.processNewSheet(dataUrl);
              } catch (e) {
                logger.error('❌ 타일맵 후처리 실패:', e);
                alert('타일 분할에 실패했습니다. 시트는 히스토리에 남아 있으니 다시 생성해 주세요.');
              } finally {
                setProgressMessage('');
              }
            }
```

- [ ] **Step 3: 타입체크 후 커밋**

Run: `npx tsc --noEmit` → 에러 0

```bash
git add src/hooks/useTilemapProcessing.ts src/components/generator/ImageGeneratorPanel.tsx
git commit -m "feat: 타일맵 후처리 훅(시트 저장·분할·seam·교체 제안) 및 생성 연결"
```

---

### Task 7: TilemapResultView (시트/타일 토글 · 점수 · 선택 재생성 UI)

**Files:**
- Create: `src/components/tilemap/TilemapResultView.tsx`
- Modify: `src/components/generator/ImageGeneratorPanel.tsx:1091` (GeneratorPreview 분기)

**Interfaces:**
- Consumes: Task 6의 훅 반환값, `TILEMAP_SEAM_WARNING_THRESHOLD`, `TileSlotAssignment`, `LazyImage`(components/common)
- Produces: `TilemapResultView` 컴포넌트. Props:

```typescript
interface TilemapResultViewProps {
  isGenerating: boolean;
  progressMessage: string;
  generatedImage: string | null;            // 최근 생성 시트 (시트 보기용)
  grid: TilemapGridLayout;
  currentTiles: (string | null)[];
  slotAssignments: TileSlotAssignment[];
  proposal: TilemapReplacementProposal | null;
  onToggleLock: (slotIndex: number) => void;
  onRegenerateSelected: (slotIndexes: number[]) => void;
  onConfirmProposal: () => void;
  onDiscardProposal: () => void;
  onExport: () => void;                     // Task 9에서 구현, 이 태스크에서는 prop만
  onManualSave: () => void;                 // 시트 보기의 수동 저장 (기존 handleManualSave)
}
```

- [ ] **Step 1: `TilemapResultView.tsx` 작성**

구현 요건 (전부 이 컴포넌트 내부):
- 내부 상태: `viewMode: 'sheet' | 'tiles'`(기본 `'tiles'`, 데이터 없으면 `'sheet'`), `selectedSlots: Set<number>`, `showPreviewCanvas: boolean`(Task 8에서 사용, 이 태스크에서는 버튼 disabled).
- `isGenerating`이면 기존 GeneratorPreview와 동일한 스피너+`progressMessage` 표시.
- 데이터도 시트도 없으면 EmptyState 문구("이미지 생성 버튼을 눌러 타일 세트를 만들어 보세요").
- 상단 토글 바: `[시트 보기 | 타일 보기]` + 우측에 `미리보기 캔버스`(Task 8 전까지 `disabled`) / `유니티 내보내기` 버튼.
- **시트 보기**: `generatedImage`를 `<LazyImage>`로 중앙 표시 + 좌상단 다운로드 버튼(`onManualSave`) — GeneratorPreview의 fit 모드 레이아웃(`ImageGeneratorPanel.tsx` 기존 코드 참조)을 축약 재사용.
- **타일 보기**: `grid`가 4x4면 `grid-cols-4`, 8x8이면 `grid-cols-8`인 CSS grid. 각 셀:
  - `currentTiles[slotIndex]` 이미지(`<img>` — 타일은 작아 LazyImage 불필요), null이면 회색 placeholder.
  - 우상단 seam 점수 뱃지: `score >= TILEMAP_SEAM_WARNING_THRESHOLD`면 `bg-emerald-500`, 미만이면 `bg-amber-500 text-white` + ⚠ 아이콘.
  - 좌상단 체크박스(선택), 좌하단 자물쇠 토글(`locked`면 `Lock` lucide 아이콘 채움, 클릭 → `onToggleLock`).
  - 선택된 셀은 `ring-2 ring-lime-500`.
- 하단 액션 바 (타일 보기에서만): `선택 재생성 (N)` 버튼 — `selectedSlots.size === 0 || isGenerating`이면 disabled, 클릭 시 `onRegenerateSelected([...selectedSlots])` 호출 후 선택 해제.
- **제안 모드** (`proposal !== null`): 교체 대상 슬롯에 새 타일(`proposal.sheetTiles[r.cellIndex]`)을 오버레이로 표시(`ring-2 ring-blue-500` + "교체 예정" 뱃지), 하단에 파란 확정 바: `제안된 교체 N건 — [확정] [취소]` → `onConfirmProposal`/`onDiscardProposal`.

- [ ] **Step 2: ImageGeneratorPanel 렌더 분기**

라인 1091의 `<GeneratorPreview ...>`를 다음으로 교체:

```tsx
          {sessionType === 'TILEMAP' ? (
            <TilemapResultView
              isGenerating={isGenerating}
              progressMessage={progressMessage}
              generatedImage={generatedImage}
              grid={tilemap.grid}
              currentTiles={tilemap.currentTiles}
              slotAssignments={tilemapData?.slotAssignments ?? []}
              proposal={tilemap.proposal}
              onToggleLock={tilemap.toggleLock}
              onRegenerateSelected={(slots) => {
                tilemap.requestReplacement(slots);
                handleGenerate();
              }}
              onConfirmProposal={tilemap.confirmProposal}
              onDiscardProposal={tilemap.discardProposal}
              onExport={handleTilemapExport}
              onManualSave={handleManualSave}
            />
          ) : (
            <GeneratorPreview
              isGenerating={isGenerating}
              progressMessage={progressMessage}
              generatedImage={generatedImage}
              zoomLevel={zoomLevel}
              onManualSave={handleManualSave}
            />
          )}
```

`handleTilemapExport`는 이 태스크에서는 자리만 만든다 (Task 9에서 실제 구현으로 교체):

```typescript
  // 유니티 내보내기 — Task 9에서 tilemapExporter 연결
  const handleTilemapExport = useCallback(async () => {
    alert('내보내기는 곧 지원됩니다.');
  }, []);
```

> ⚠ 이 임시 alert는 Task 9에서 반드시 실제 구현으로 교체된다. Task 9를 건너뛰면 미완성 — 계획상 Task 9는 필수.

- [ ] **Step 3: 타입체크 후 커밋**

Run: `npx tsc --noEmit` → 에러 0

```bash
git add src/components/tilemap/TilemapResultView.tsx src/components/generator/ImageGeneratorPanel.tsx
git commit -m "feat: 타일맵 결과 뷰 (시트/타일 토글·seam 뱃지·선택 재생성·교체 확정)"
```

- [ ] **Step 4: 수동 확인 (핵심 E2E 1차)**

dev 앱에서 타일맵 세션 생성 → 참조 업로드·분석 → 4x4 생성 → 타일 보기에 16타일+점수 뱃지 → 2개 선택 → "선택 재생성" → 제안 오버레이 → 확정 시 해당 슬롯만 교체되는지, 앱 재시작 후 세션 재진입 시 타일이 복원되는지 확인.

---

### Task 8: TilePreviewCanvas (배치 미리보기)

**Files:**
- Create: `src/components/tilemap/TilePreviewCanvas.tsx`
- Modify: `src/components/tilemap/TilemapResultView.tsx` (모달 연결, 버튼 활성화)

**Interfaces:**
- Consumes: `currentTiles` (Task 6)
- Produces: `TilePreviewCanvas` 컴포넌트. Props:

```typescript
interface TilePreviewCanvasProps {
  tiles: string[]; // 슬롯 타일 dataURL (null 제거된 배열)
  onClose: () => void;
}
```

- [ ] **Step 1: `TilePreviewCanvas.tsx` 작성**

구현 요건 — plain `<canvas>` + 셀 상태 2차원 배열 (Konva 미사용):
- 상수: `MAP_COLS = 12`, `MAP_ROWS = 8`, `CELL_PX = 64`.
- 상태: `mapCells: (number | null)[][]` (초기 전부 null), `selectedTile: number`(기본 0), `tool: 'stamp' | 'eraser'`(기본 stamp), `zoom: 1 | 2`(기본 1), `isDrawing: boolean`.
- 마운트 시 `tiles`를 `HTMLImageElement[]`로 프리로드(`tileSlicer.loadImageElement` 재사용) → `imagesRef`에 보관, 로드 완료 후 그리기 시작.
- 그리기 effect: `mapCells`/`zoom`/이미지 로드 변화 시 canvas 전체 재렌더 — 빈 셀은 `#e5e7eb`(회색) + 연한 격자선, 채워진 셀은 `ctx.drawImage(img, c * CELL_PX * zoom, r * CELL_PX * zoom, CELL_PX * zoom, CELL_PX * zoom)`.
- 포인터: `onMouseDown`(isDrawing=true + 해당 셀 적용), `onMouseMove`(isDrawing 중 적용), `onMouseUp`/`onMouseLeave`(false). 셀 계산: `Math.floor(offsetX / (CELL_PX * zoom))`. stamp면 `selectedTile`, eraser면 null.
- 레이아웃: 고정 오버레이 모달(`fixed inset-0 bg-black/50 z-50`) 안에 흰 패널. 좌측 세로 팔레트: `tiles` 썸네일 목록(48px), 선택 시 `ring-2 ring-lime-500`. 상단 툴바: 스탬프/지우개 토글, `랜덤 채우기`(모든 셀에 `Math.floor(Math.random() * tiles.length)`), `전체 지우기`, 줌 1x/2x, 닫기(X).
- 캔버스 영역은 `overflow-auto` (2x 줌 시 스크롤).
- Esc 키로 닫기 (`useEffect` + keydown listener).
- 맵 상태는 저장하지 않는다 (휘발성, 스펙 §6).

- [ ] **Step 2: TilemapResultView에 연결**

`showPreviewCanvas` 상태로 모달 토글, `미리보기 캔버스` 버튼 활성화 (currentTiles에 null이 있으면 disabled):

```tsx
      {showPreviewCanvas && (
        <TilePreviewCanvas
          tiles={currentTiles.filter((t): t is string => t !== null)}
          onClose={() => setShowPreviewCanvas(false)}
        />
      )}
```

- [ ] **Step 3: 타입체크 후 커밋**

Run: `npx tsc --noEmit` → 에러 0

```bash
git add src/components/tilemap/TilePreviewCanvas.tsx src/components/tilemap/TilemapResultView.tsx
git commit -m "feat: 타일 배치 미리보기 캔버스 (스탬프·랜덤 채우기·줌)"
```

- [ ] **Step 4: 수동 확인**

타일 생성 후 미리보기 열기 → 타일 선택·스탬프·드래그 → 랜덤 채우기로 이음새 육안 확인 → 지우개·줌 2x·Esc 닫기 동작 확인.

---

### Task 9: 유니티 내보내기 (tilemapExporter)

**Files:**
- Create: `src/lib/tilemap/tilemapExporter.ts`
- Modify: `src/components/generator/ImageGeneratorPanel.tsx` (Task 7의 임시 `handleTilemapExport` 교체)

**Interfaces:**
- Consumes: `getSessionImageFolder` (lib/config/paths.ts), `getPixelArtGridInfo`, `loadImageElement` (Task 5), Tauri `writeFile`/`writeTextFile`/`mkdir`/`join`
- Produces: `exportTilemapForUnity(params: { sessionName: string; grid: TilemapGridLayout; tiles: string[] }): Promise<string>` — 생성된 폴더 절대 경로 반환

- [ ] **Step 1: `tilemapExporter.ts` 작성**

```typescript
import { join } from '@tauri-apps/api/path';
import { mkdir, writeFile, writeTextFile, exists } from '@tauri-apps/plugin-fs';
import { getPixelArtGridInfo } from '../../types/pixelart';
import { TilemapGridLayout } from '../../types/tilemap';
import { getSessionImageFolder } from '../config/paths';
import { loadImageElement } from './tileSlicer';

/** dataURL → PNG 바이트 배열 */
function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64Data = dataUrl.split(',')[1];
  if (!base64Data) throw new Error('Data URL 형식이 잘못되었습니다');
  const binaryString = atob(base64Data);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/** 교체 반영된 최종 타일들로 1024 시트를 재합성 */
async function composeFinalSheet(tiles: string[], grid: TilemapGridLayout): Promise<string> {
  const { rows, cols, cellSize } = getPixelArtGridInfo(grid);
  const canvas = document.createElement('canvas');
  canvas.width = cellSize * cols;  // 4x4=1024, 8x8=1024
  canvas.height = cellSize * rows;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context를 생성할 수 없습니다');

  for (let i = 0; i < tiles.length; i++) {
    const img = await loadImageElement(tiles[i]);
    const r = Math.floor(i / cols);
    const c = i % cols;
    ctx.drawImage(img, c * cellSize, r * cellSize, cellSize, cellSize);
  }
  return canvas.toDataURL('image/png');
}

/** 유니티 임포트 안내 텍스트 */
function buildImportGuide(grid: TilemapGridLayout): string {
  const { cellSize, totalFrames } = getPixelArtGridInfo(grid);
  return `StyleStudio 타일맵 내보내기 — 유니티 임포트 가이드
=====================================================

구성:
- tilesheet.png : ${totalFrames}개 타일이 ${grid} 그리드로 배치된 시트 (1024x1024)
- tiles/tile_00.png ~ : 개별 타일 PNG (${cellSize}x${cellSize}px, 행우선 순서)

유니티 설정 (tilesheet.png 사용 시):
1. tilesheet.png를 프로젝트에 임포트
2. Inspector에서:
   - Texture Type: Sprite (2D and UI)
   - Sprite Mode: Multiple
   - Pixels Per Unit: ${cellSize}  (타일 1개 = 1유닛)
   - Filter Mode: Bilinear (손맵 스타일 권장)
3. Sprite Editor 열기 → Slice → Type: Grid By Cell Size → X:${cellSize}, Y:${cellSize} → Slice → Apply
4. Window > 2D > Tile Palette에서 새 팔레트 생성 후 슬라이스된 스프라이트를 드래그해 등록
5. Tilemap에 배치 — 모든 타일은 상호 호환 변형이므로 자유롭게 섞어 칠할 수 있습니다

개별 PNG(tiles/) 사용 시:
- 폴더째 임포트 후 전체 선택 → 위와 동일한 Sprite 설정 → Tile Palette에 드래그
`;
}

/**
 * 타일맵을 유니티용으로 내보낸다.
 * ~/Downloads/AI_Gen/{세션명}/tilemap_{timestamp}/ 에
 * tilesheet.png + tiles/tile_NN.png + IMPORT_GUIDE.txt 를 기록하고 폴더 경로를 반환.
 */
export async function exportTilemapForUnity(params: {
  sessionName: string;
  grid: TilemapGridLayout;
  tiles: string[];
}): Promise<string> {
  const { sessionName, grid, tiles } = params;
  const { totalFrames } = getPixelArtGridInfo(grid);
  if (tiles.length !== totalFrames) {
    throw new Error(`타일 수가 그리드와 맞지 않습니다 (${tiles.length}/${totalFrames})`);
  }

  const sessionFolder = await getSessionImageFolder(sessionName);
  const exportFolder = await join(sessionFolder, `tilemap_${Date.now()}`);
  const tilesFolder = await join(exportFolder, 'tiles');
  if (!(await exists(exportFolder))) await mkdir(exportFolder, { recursive: true });
  if (!(await exists(tilesFolder))) await mkdir(tilesFolder, { recursive: true });

  // 1) 교체 반영 최종 시트 재합성
  const sheetDataUrl = await composeFinalSheet(tiles, grid);
  await writeFile(await join(exportFolder, 'tilesheet.png'), dataUrlToBytes(sheetDataUrl));

  // 2) 개별 타일
  for (let i = 0; i < tiles.length; i++) {
    const name = `tile_${String(i).padStart(2, '0')}.png`;
    await writeFile(await join(tilesFolder, name), dataUrlToBytes(tiles[i]));
  }

  // 3) 임포트 가이드
  await writeTextFile(await join(exportFolder, 'IMPORT_GUIDE.txt'), buildImportGuide(grid));

  return exportFolder;
}
```

- [ ] **Step 2: 패널의 임시 handleTilemapExport 교체**

```typescript
  // 유니티용 내보내기: 교체 반영 시트 + 개별 타일 + 가이드
  const handleTilemapExport = useCallback(async () => {
    const tiles = tilemap.currentTiles;
    if (tiles.length === 0 || tiles.some((t) => t === null)) {
      alert('내보낼 타일이 아직 없습니다. 먼저 타일 세트를 생성해 주세요.');
      return;
    }
    try {
      const folder = await exportTilemapForUnity({
        sessionName,
        grid: tilemap.grid,
        tiles: tiles as string[],
      });
      alert(`유니티용 타일맵을 내보냈습니다.\n\n${folder}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('❌ 타일맵 내보내기 실패:', error);
      alert('타일맵 내보내기에 실패했습니다.\n\n' + message);
    }
  }, [tilemap.currentTiles, tilemap.grid, sessionName]);
```

- [ ] **Step 3: 타입체크 후 커밋**

Run: `npx tsc --noEmit` → 에러 0

```bash
git add src/lib/tilemap/tilemapExporter.ts src/components/generator/ImageGeneratorPanel.tsx
git commit -m "feat: 타일맵 유니티 내보내기 (재합성 시트·개별 PNG·임포트 가이드)"
```

- [ ] **Step 4: 수동 확인**

내보내기 실행 → `~/Downloads/AI_Gen/{세션명}/tilemap_*/`에 tilesheet.png(1024², 교체 타일 반영), tiles/ 16(or 64)장, IMPORT_GUIDE.txt 확인.

---

### Task 10: 위키·문서 갱신 + 버전 범프 + 최종 검증

**Files:**
- Create: `wiki/tilemap/overview.md`
- Modify: `wiki/README.md` (카테고리 맵·빠른 진입 표·파일 목록·주요 파일 좌표)
- Modify: `CLAUDE.md` (카테고리 맵에 `tilemap` 추가)
- Modify: `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `CHANGELOG.md` (bump-version.sh 경유)

**Interfaces:** 없음 (문서·버전)

- [ ] **Step 1: 최종 빌드 검증**

Run: `npm run build`
Expected: tsc + vite build 모두 성공. 실패 시 원인 수정 후 재실행 (성공 전까지 다음 단계 진행 금지).

- [ ] **Step 2: 수동 E2E 최종 체크리스트**

1. 타일맵 세션 생성 → 손맵 참조 업로드 → 분석(타일맵 카드 확인)
2. 4x4 생성 → 타일 16장·점수 뱃지 → 8x8로 변경 후 생성 → 풀 리셋 확인
3. 불량 슬롯 2개 선택 재생성 → 제안 → 확정
4. 락 슬롯이 교체에서 제외되는지
5. 미리보기 랜덤 채우기 → 이음새 육안 확인
6. 내보내기 → 유니티 임포트 (가능하면 실제 유니티에서 확인)
7. 앱 재시작 → 세션 재진입 → 타일 복원 확인

- [ ] **Step 3: `wiki/tilemap/overview.md` 작성**

기존 위키 문서 형식(개요 문단 → 관련 파일 → 데이터 모델 → 핵심 흐름 → 회귀 증상별 원인 표)을 따라 작성. 반드시 포함할 내용:
- 변형 타일 세트 개념(상호 seamless)·4x4/8x8·1:1·1K 고정
- "타일 개별 저장 없음 — 시트+slotAssignments만 영속, 타일은 런타임 분할" 설계
- 교체 재생성(시트 추가 생성→불량 슬롯 교체) 흐름과 locked 규칙
- 그리드 변경 시 시트 풀 리셋 규칙
- 주요 파일 좌표: `types/tilemap.ts`, `hooks/useTilemapProcessing.ts`, `lib/tilemap/*`(tileSlicer/seamValidator/tilemapExporter), `components/tilemap/*`, `sessionPrompts.ts`의 `generateTilemapPrompt`, `analysisPrompt.ts`의 `TILEMAP_ANALYZER_PROMPT`
- 함정: seam 점수는 휴리스틱(임계값 70·SEAM_ENERGY_WORST 64 상수), 미리보기 맵은 비저장, imageStorage 키 `tilemap-sheet-*`는 세션 삭제 시 정리되지 않음(기존 히스토리 이미지와 동일한 한계)

- [ ] **Step 4: `wiki/README.md` 갱신**

- 카테고리 맵 문단에 `tilemap`(타일맵) 추가
- "빠른 진입" 표에 최소 3행: "타일이 서로 이어지지 않음/seam 경고", "선택 재생성·교체가 동작 안 함", "내보낸 시트에 교체 타일이 반영 안 됨" → `tilemap/overview.md`
- 카테고리별 파일 목록에 `### tilemap/` 섹션 추가
- 주요 파일 좌표 표에 `useTilemapProcessing.ts`·`lib/tilemap/` 행 추가

- [ ] **Step 5: `CLAUDE.md` 카테고리 맵 갱신**

`pixelart` 뒤에 `· tilemap(타일맵)` 추가.

- [ ] **Step 6: 버전 범프**

`scripts/bump-version.sh`를 먼저 읽어 사용법 확인 후 실행 (현재 0.4.21 → 0.4.22, 프로젝트는 feat도 패치 증가 관례). CHANGELOG.md에 타일맵 세션 신규 기능 항목 추가 (스크립트가 자동 처리하지 않는 경우 수동).

- [ ] **Step 7: 커밋**

```bash
git add wiki/ CLAUDE.md package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml CHANGELOG.md
git commit -m "docs: 타일맵 위키 추가 및 v0.4.22 버전 범프"
```

---

## Self-Review 결과 (계획 작성 시 수행)

- **스펙 커버리지**: 스펙 §2(데이터 모델)→Task 1, §3(통합 체크리스트)→Task 1·3, §4(분석·설정·프롬프트)→Task 1·2·4, §5(분할·검증·교체·결과 뷰)→Task 5·6·7, §6(미리보기)→Task 8, §7(내보내기)→Task 9, §8(엣지: 비정상 크기→Task 5 중앙 crop, 후처리 실패→Task 6 try/catch, 그리드 변경 리셋→Task 6 gridChanged, 재진입 복원→Task 6 useEffect), §9~10(검증·위키·버전)→Task 10. 누락 없음.
- **타입 일관성**: `sliceTileSheet`/`computeSeamScores`/`processNewSheet`/`requestReplacement`/`confirmProposal`/`discardProposal`/`toggleLock`/`exportTilemapForUnity` 명칭이 정의(Task 5·6·9)와 사용처(Task 6·7·9)에서 일치함을 교차 확인.
- **Task 7의 임시 alert**: 유일한 중간 산출물 — Task 9에서 반드시 교체됨을 양쪽 태스크에 명시.
