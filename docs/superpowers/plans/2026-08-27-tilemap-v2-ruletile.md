# 타일맵 v2 (랜덤성 개정 + 룰타일 모드) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 변형 모드의 점무늬 규칙성을 제거하고, 유니티 Rule Tile용 지형 전환 세트를 생성하는 룰타일 모드를 추가한다.

**Architecture:** v1 파이프라인(분석→생성→분할→결과 뷰→내보내기)을 그대로 두고 `TilemapMode('variation'|'ruletile')` 분기를 얹는다. 룰타일은 셀별 역할 지시 대신 **거시 구도(4x4=패치, 8x8=도넛)를 그리게 한 뒤 분할**하고, 정적 역할 테이블(`ruleTileLayout.ts`)이 분할 결과에 의미를 부여한다. 룰타일 모드에서는 seam 점수·선택 재생성·락이 비활성(역할 고정), 미리보기 캔버스는 이웃 기반 오토타일 스탬프로 동작한다.

**Tech Stack:** v1과 동일 (React 19 + TS + plain canvas + Tauri fs)

**Spec:** `docs/superpowers/specs/2026-08-27-tilemap-session-design.md` §12 (v2 개정)

## Global Constraints

- 코드 주석·커밋 메시지·UI 문구: 한국어. 식별자: 영어.
- 검증: 태스크마다 `npx tsc --noEmit` 0 에러, 마지막에 `npm run build` (테스트 인프라 없음).
- v1 세션 하위호환: `tilemapData.mode`가 없으면 `'variation'`으로 간주. 기존 변형 모드 동작(디테일 규칙 제외)은 회귀 없어야 함.
- 룰타일 역할 이름 계약(전 태스크 공유): `'corner_nw'|'corner_ne'|'corner_sw'|'corner_se'|'edge_n'|'edge_s'|'edge_w'|'edge_e'|'concave_nw'|'concave_ne'|'concave_sw'|'concave_se'|'fill'|'base'`
- 오목 코너 명명 규칙: **base가 보이는 대각 방향** 기준 (구멍의 NW 모서리를 담은 셀 = 그 셀의 SE 사분면에 base → `concave_se`).
- 좌표 규약: 행우선, `cellIndex = row * cols + col`.

---

### Task 1: 타입·역할 레이아웃 (`TilemapMode`, `ruleTileLayout.ts`)

**Files:**
- Modify: `src/types/tilemap.ts`
- Create: `src/lib/tilemap/ruleTileLayout.ts`

**Interfaces:**
- Consumes: `TilemapGridLayout` (기존)
- Produces (이후 태스크 전부가 사용):
  - `type TilemapMode = 'variation' | 'ruletile'`
  - `TilemapSessionData`에 `mode?: TilemapMode; baseTerrain?: string; overlayTerrain?: string;` 추가
  - `type RuleTileRole = 'corner_nw'|...|'base'` (위 계약 그대로)
  - `getRuleTileRoles(grid: TilemapGridLayout): RuleTileRole[]` — 길이 16/64, 행우선
  - `RULE_TILE_ROLE_LABELS: Record<RuleTileRole, string>` — 한국어 축약 라벨
  - `pickRoleCell(roles: RuleTileRole[], role: RuleTileRole, variant?: number): number` — 해당 역할 셀 인덱스 반환(변형 있으면 variant로 순환, 없으면 -1)

- [ ] **Step 1: `src/types/tilemap.ts`에 모드 타입 추가**

`TilemapGridLayout` 정의 아래에:

```typescript
/** 타일셋 모드: 변형 세트(상호교환) vs 룰타일 지형 전환 세트(역할 고정) */
export type TilemapMode = 'variation' | 'ruletile';
```

`TilemapSessionData`에 필드 추가 (전부 옵셔널 — v1 세션 하위호환):

```typescript
  mode?: TilemapMode;        // 미지정 시 'variation' (v1 세션 호환)
  baseTerrain?: string;      // 룰타일: 베이스 지형 입력 원문 (예: "잔디")
  overlayTerrain?: string;   // 룰타일: 오버레이 지형 입력 원문 (예: "흙길")
```

- [ ] **Step 2: `src/lib/tilemap/ruleTileLayout.ts` 신규 작성**

```typescript
import { TilemapGridLayout } from '../../types/tilemap';

/**
 * 룰타일 셀 역할.
 * 오목(concave) 코너는 base가 보이는 대각 방향으로 명명한다
 * (예: 구멍의 NW 모서리를 담은 셀은 셀의 SE 사분면에 base가 보임 → concave_se).
 */
export type RuleTileRole =
  | 'corner_nw' | 'corner_ne' | 'corner_sw' | 'corner_se'
  | 'edge_n' | 'edge_s' | 'edge_w' | 'edge_e'
  | 'concave_nw' | 'concave_ne' | 'concave_sw' | 'concave_se'
  | 'fill' | 'base';

/** 결과 뷰 뱃지용 한국어 축약 라벨 */
export const RULE_TILE_ROLE_LABELS: Record<RuleTileRole, string> = {
  corner_nw: '코너↖', corner_ne: '코너↗', corner_sw: '코너↙', corner_se: '코너↘',
  edge_n: '엣지↑', edge_s: '엣지↓', edge_w: '엣지←', edge_e: '엣지→',
  concave_nw: '오목↖', concave_ne: '오목↗', concave_sw: '오목↙', concave_se: '오목↘',
  fill: '풀', base: '베이스',
};

/**
 * 4x4 패치 구도의 셀 역할 (행우선 16칸).
 * 오버레이 패치가 캔버스 12.5%~87.5%를 덮으므로 외곽 링=전환, 중앙 2x2=풀.
 */
const ROLES_4X4: RuleTileRole[] = [
  'corner_nw', 'edge_n', 'edge_n', 'corner_ne',
  'edge_w',    'fill',   'fill',   'edge_e',
  'edge_w',    'fill',   'fill',   'edge_e',
  'corner_sw', 'edge_s', 'edge_s', 'corner_se',
];

/**
 * 8x8 도넛 구도의 셀 역할 (행우선 64칸).
 * 외곽 전환은 12.5%~87.5% 경계(외곽 링 셀), 중앙 구멍은 2x2셀(행·열 3~4)에 순수 base,
 * 구멍 전환선은 행·열 2·5 셀을 지난다.
 * 구멍 주변: 북쪽 셀(2,3)(2,4)은 남쪽에 base가 보임 → edge_s 변형,
 * 서쪽 셀(3,2)(4,2)는 동쪽에 base → edge_e 변형 (내곽 엣지는 외곽 반대 방향과 동일 역할).
 */
const ROLES_8X8: RuleTileRole[] = [
  'corner_nw', 'edge_n', 'edge_n', 'edge_n', 'edge_n', 'edge_n', 'edge_n', 'corner_ne',
  'edge_w',    'fill',   'fill',   'fill',   'fill',   'fill',   'fill',   'edge_e',
  'edge_w',    'fill',   'concave_se', 'edge_s', 'edge_s', 'concave_sw', 'fill', 'edge_e',
  'edge_w',    'fill',   'edge_e', 'base',   'base',   'edge_w', 'fill',   'edge_e',
  'edge_w',    'fill',   'edge_e', 'base',   'base',   'edge_w', 'fill',   'edge_e',
  'edge_w',    'fill',   'concave_ne', 'edge_n', 'edge_n', 'concave_nw', 'fill', 'edge_e',
  'edge_w',    'fill',   'fill',   'fill',   'fill',   'fill',   'fill',   'edge_e',
  'corner_sw', 'edge_s', 'edge_s', 'edge_s', 'edge_s', 'edge_s', 'edge_s', 'corner_se',
];

/** 그리드별 룰타일 셀 역할 테이블 (행우선) */
export function getRuleTileRoles(grid: TilemapGridLayout): RuleTileRole[] {
  return grid === '8x8' ? ROLES_8X8 : ROLES_4X4;
}

/**
 * 특정 역할의 셀 인덱스를 고른다. 같은 역할 셀이 여럿이면 variant로 순환 선택.
 * 해당 역할이 세트에 없으면 -1 (호출부에서 fill 등으로 폴백).
 */
export function pickRoleCell(roles: RuleTileRole[], role: RuleTileRole, variant: number = 0): number {
  const candidates: number[] = [];
  for (let i = 0; i < roles.length; i++) {
    if (roles[i] === role) candidates.push(i);
  }
  if (candidates.length === 0) return -1;
  return candidates[((variant % candidates.length) + candidates.length) % candidates.length];
}
```

> ⚠ ROLES_8X8 검증 포인트 (구현자가 직접 재확인할 것): 구멍은 (3,3)(3,4)(4,3)(4,4)=base. 구멍 북쪽 (2,3)(2,4)는 남쪽에 base → **edge_s**. 구멍 남쪽 (5,3)(5,4)는 북쪽에 base → **edge_n**. 구멍 서쪽 (3,2)(4,2)는 동쪽에 base → **edge_e**. 구멍 동쪽 (3,5)(4,5)는 서쪽에 base → **edge_w**. 구멍 NW 대각 (2,2)는 SE에 base → **concave_se**. (2,5)=concave_sw, (5,2)=concave_ne, (5,5)=concave_nw. 위 배열이 이 규칙과 일치하는지 행·열을 세어 검증.

- [ ] **Step 3: 타입체크 후 커밋**

Run: `npx tsc --noEmit` → 0 에러

```bash
git add src/types/tilemap.ts src/lib/tilemap/ruleTileLayout.ts
git commit -m "feat: 타일맵 모드 타입·룰타일 셀 역할 레이아웃 추가"
```

---

### Task 2: 프롬프트 — 변형 규칙 3 개정 + 룰타일 프롬프트

**Files:**
- Modify: `src/lib/prompts/sessionPrompts.ts` (`generateTilemapPrompt`, `PromptGenerationParams`)

**Interfaces:**
- Consumes: `TilemapMode` (Task 1)
- Produces: `PromptGenerationParams`에 `tilemapMode?: TilemapMode; tilemapBaseTerrain?: string; tilemapOverlayTerrain?: string;` 추가 (Task 3의 handleGenerate가 전달)

- [ ] **Step 1: PromptGenerationParams 확장**

```typescript
  tilemapMode?: TilemapMode;          // TILEMAP: 변형/룰타일 모드
  tilemapBaseTerrain?: string;        // TILEMAP 룰타일: 베이스 지형 (영어 번역본)
  tilemapOverlayTerrain?: string;     // TILEMAP 룰타일: 오버레이 지형 (영어 번역본)
```

`TilemapMode` import 추가 (`../../types/tilemap`).

- [ ] **Step 2: generateTilemapPrompt를 모드 분기로 재구성**

기존 함수를 다음 구조로 교체한다. 변형 모드 프롬프트는 기존 내용을 유지하되 **규칙 3만 교체**하고 규칙 7을 추가한다:

```typescript
function generateTilemapPrompt(params: PromptGenerationParams): string {
  if (params.tilemapMode === 'ruletile') {
    return generateTilemapRuleTilePrompt(params);
  }
  return generateTilemapVariationPrompt(params);
}
```

`generateTilemapVariationPrompt` = 기존 본문에서 규칙 3을 다음으로 교체:

```
3. SPARSE, SCATTERED DETAILS: roughly HALF of the cells must be PURE base texture with NO distinctive detail at all. In the remaining cells, place small details OFF-CENTER at a different position in every cell (anywhere within the inner 60% safe zone - never at the exact center), varying their size and count. NEVER repeat the same motif twice (each flower, pebble or tuft design appears only once in the whole sheet).
```

그리고 규칙 6 뒤에 추가:

```
7. NO REPEATING PATTERN: when these tiles are shuffled and tiled, the result must look like ONE natural continuous ground - if a regular polka-dot pattern of centered details emerges, the sheet has FAILED.
```

- [ ] **Step 3: generateTilemapRuleTilePrompt 신설**

```typescript
/**
 * TILEMAP 룰타일(지형 전환) 프롬프트.
 * 셀별 역할을 지시하지 않고 거시 구도(4x4=패치, 8x8=도넛)를 그리게 한 뒤
 * 분할하면 ruleTileLayout의 역할 테이블과 맞아떨어진다 (스펙 §12.2).
 */
function generateTilemapRuleTilePrompt(params: PromptGenerationParams): string {
  const { pixelArtGrid, analysis } = params;
  const grid = pixelArtGrid === '8x8' ? '8x8' : '4x4';
  const base = params.tilemapBaseTerrain || 'grass';
  const overlay = params.tilemapOverlayTerrain || 'dirt path';

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

  const donutSection = grid === '8x8'
    ? `
🕳️ CENTER HOLE (donut composition): cut a square hole of PURE ${base} in the middle of the ${overlay} area. The hole spans from 37.5% to 62.5% of the canvas (both axes). The hole's painted transition band must be centered on the 31.25% and 68.75% lines. So the final image is a ${overlay} ring (donut) sitting on ${base}.`
    : '';

  return `🎯 HAND-PAINTED TERRAIN TRANSITION TILESET (Unity Rule Tile source, single 1024x1024 image)

Paint ONE picture: a field of ${base} covering the ENTIRE canvas, with ONE large organic patch of ${overlay} on top of it. This image will be sliced into a ${grid} grid to produce corner / edge / fill transition tiles, so the patch geometry must be EXACT:

📐 PATCH GEOMETRY (critical):
- The ${overlay} patch covers the square region from 12.5% to 87.5% of the canvas (both axes).
- The painted transition between ${base} and ${overlay} must be a band CENTERED on that boundary line, no wider than 6% of the canvas on each side.
- Corners of the patch are gently rounded (radius about half a grid cell), staying within the corner cells.
- Inside the patch: continuous ${overlay} texture. Outside: continuous ${base} texture.${donutSection}
${styleSpec}
🧱 RULES:
1. HAND-PAINTED ONLY: visible painterly brushwork, stylized game-art shading - NOT photorealistic, NOT a photo texture, NOT 3D rendered.
2. The transition band is hand-painted and organic (soft irregular brush edge, small overlaps like grass blades over the ${overlay}) but must NEVER wander outside its 6% band.
3. UNIFORM TEXTURES: both ${base} and ${overlay} areas are statistically uniform - consistent hue, brightness and stroke density. Sparse small details only, placed off-center and never repeated.
4. NO GRID LINES: do NOT draw any lines, borders, dividers, or separators between grid cells. The grid is purely conceptual.
5. CONSISTENT LIGHTING: one light direction and color temperature across the whole canvas.

⛔ AVOID: photorealistic, 3D render, photo texture, grid lines, seams, visible borders, vignette, text, objects, characters.

Paint the ${base} field with the ${overlay} ${grid === '8x8' ? 'donut ring' : 'patch'} now.`;
}
```

- [ ] **Step 4: 타입체크 후 커밋**

Run: `npx tsc --noEmit` → 0 에러

```bash
git add src/lib/prompts/sessionPrompts.ts
git commit -m "feat: 타일맵 변형 랜덤성 규칙 개정·룰타일 프롬프트 추가"
```

---

### Task 3: 모드 UI + 생성 경로 + 훅 모드 처리

**Files:**
- Modify: `src/components/generator/GeneratorSettings.tsx` (모드 토글 + 지형 2필드)
- Modify: `src/components/generator/ImageGeneratorPanel.tsx` (상태·번역·빌더 전달·후처리)
- Modify: `src/hooks/useTilemapProcessing.ts` (mode 저장·seam 스킵·proposal 비활성)

**Interfaces:**
- Consumes: Task 1·2 산출물
- Produces:
  - `GeneratorState`에 `tilemapMode: TilemapMode; tilemapBaseTerrain: string; tilemapOverlayTerrain: string;`
  - GeneratorSettings props에 `tilemapMode`, `tilemapBaseTerrain`, `tilemapOverlayTerrain` + `onTilemapModeChange`, `onTilemapBaseTerrainChange`, `onTilemapOverlayTerrainChange`
  - `useTilemapProcessing` options에 `mode: TilemapMode` 추가; 반환에 `mode: TilemapMode`(유효 모드: tilemapData?.mode ?? 'variation' — 단 processNewSheet는 현재 선택 모드 사용) — 정확한 규칙은 Step 3 참조

- [ ] **Step 1: 패널 상태·초기값**

`GeneratorState`에 3필드 추가. 초기값:

```typescript
    tilemapMode: (sessionType === 'TILEMAP' ? (tilemapData?.mode ?? 'variation') : 'variation') as TilemapMode,
    tilemapBaseTerrain: tilemapData?.baseTerrain ?? '',
    tilemapOverlayTerrain: tilemapData?.overlayTerrain ?? '',
```

destructure + `updateState` 헬퍼 콜백 3종 추가 (기존 setter 패턴 그대로).

- [ ] **Step 2: handleGenerate 룰타일 경로**

TILEMAP && `tilemapMode === 'ruletile'`일 때:
- `tilemapBaseTerrain`/`tilemapOverlayTerrain`이 비었으면 `alert('베이스 지형과 오버레이 지형을 입력해주세요. (예: 잔디 / 흙길)')` 후 return.
- 두 필드 각각 `containsKorean`이면 `translateToEnglish`로 번역 (additionalPrompt 번역과 같은 try 블록 안).
- `buildPromptForSession` 호출에 `tilemapMode`, `tilemapBaseTerrain`(번역본), `tilemapOverlayTerrain`(번역본) 전달. (변형 모드는 `tilemapMode: 'variation'`만 전달 — 기존 인자 유지.)

- [ ] **Step 3: useTilemapProcessing 모드 처리**

options에 `mode: TilemapMode` 추가 (패널이 `tilemapMode` 상태를 전달). 규칙:

- `processNewSheet`: 룰타일이면 `computeSeamScores` **호출 생략** (seamScore undefined), `pendingReplaceSlotsRef` 무시(항상 전체 할당), `onTilemapDataChange`에 `mode`, `baseTerrain: options.baseTerrain`, `overlayTerrain: options.overlayTerrain` 저장. — 이를 위해 options에 `baseTerrain?: string; overlayTerrain?: string;`(원문, 저장용)도 추가하고 패널이 전달.
- **모드 전환도 그리드 변경과 동일하게 풀 리셋**: `gridChanged` 판정을 `const setChanged = !prevData || prevData.grid !== grid || (prevData.mode ?? 'variation') !== mode;`로 확장 (변수명 `setChanged`로 교체).
- `requestReplacement`/`confirmProposal`/`discardProposal`/`toggleLock`: 룰타일 모드면 즉시 return (no-op — UI에서도 숨기지만 이중 방어).
- 반환에 `effectiveMode: TilemapMode`(= `tilemapData?.mode ?? 'variation'` — **보유 세트의 모드**, displayGrid와 같은 원리로 보유 데이터 우선) 추가.

- [ ] **Step 4: GeneratorSettings 모드 UI**

TILEMAP 그리드 블록 위에 모드 토글 섹션:

```tsx
          {/* 타일맵 모드 선택 */}
          {sessionType === 'TILEMAP' && (
            <div className={getGridSectionStyle(sessionType)}>
              <label className="block text-sm font-semibold text-gray-700 mb-3">타일셋 모드</label>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => onTilemapModeChange('variation')} className={`p-2 rounded-md text-xs font-medium border-2 transition-all ${getGridButtonStyle(sessionType, tilemapMode === 'variation')}`}>
                  <div className="font-bold">변형 세트</div>
                  <div className="text-[10px] opacity-75">한 지형의 다양한 바리에이션</div>
                </button>
                <button onClick={() => onTilemapModeChange('ruletile')} className={`p-2 rounded-md text-xs font-medium border-2 transition-all ${getGridButtonStyle(sessionType, tilemapMode === 'ruletile')}`}>
                  <div className="font-bold">룰타일 세트</div>
                  <div className="text-[10px] opacity-75">지형 전환 (유니티 Rule Tile)</div>
                </button>
              </div>
              {tilemapMode === 'ruletile' && (
                <div className="mt-3 space-y-2">
                  <input value={tilemapBaseTerrain} onChange={(e) => onTilemapBaseTerrainChange(e.target.value)} placeholder="베이스 지형 (예: 잔디)" className="w-full p-2 border border-gray-300 rounded-lg text-sm" />
                  <input value={tilemapOverlayTerrain} onChange={(e) => onTilemapOverlayTerrainChange(e.target.value)} placeholder="오버레이 지형 (예: 흙길)" className="w-full p-2 border border-gray-300 rounded-lg text-sm" />
                  <p className="text-[11px] text-gray-500">
                    {pixelArtGrid === '8x8'
                      ? '8x8: 오목 코너·순수 베이스까지 포함한 완전한 Rule Tile 세트'
                      : '4x4: 코너·엣지·풀 16타일 (오목 코너 없음 — 넓은 영역용)'}
                  </p>
                </div>
              )}
            </div>
          )}
```

props 인터페이스·destructure에 6개 항목 추가, 패널에서 전달.

- [ ] **Step 5: 타입체크 후 커밋**

Run: `npx tsc --noEmit` → 0 에러

```bash
git add src/components/generator/GeneratorSettings.tsx src/components/generator/ImageGeneratorPanel.tsx src/hooks/useTilemapProcessing.ts
git commit -m "feat: 타일맵 모드 토글·지형 입력·룰타일 생성 경로 연결"
```

---

### Task 4: 결과 뷰 룰타일 분기 (역할 뱃지·컨트롤 숨김)

**Files:**
- Modify: `src/components/tilemap/TilemapResultView.tsx`, `src/components/generator/ImageGeneratorPanel.tsx` (prop 전달)

**Interfaces:**
- Consumes: `getRuleTileRoles`/`RULE_TILE_ROLE_LABELS` (Task 1), `effectiveMode` (Task 3)
- Produces: `TilemapResultViewProps`에 `mode: TilemapMode` 추가

- [ ] **Step 1: TilemapResultView 모드 분기**

- props에 `mode: TilemapMode` 추가. 패널에서 `mode={tilemap.effectiveMode}` 전달.
- `mode === 'ruletile'`일 때:
  - seam 점수 뱃지 대신 **역할 라벨 뱃지**: `const roles = getRuleTileRoles(grid);` → 각 슬롯에 `RULE_TILE_ROLE_LABELS[roles[slotIndex]]`를 우상단 뱃지로 (배경 `bg-sky-600 text-white`).
  - 선택 체크박스·락 토글·"선택 재생성" 버튼 숨김. 대신 하단에 안내 문구: "룰타일 세트는 역할이 고정되어 슬롯 교체가 없습니다 — 마음에 안 들면 다시 생성하세요."
  - 제안 오버레이/확정 바는 룰타일에서 발생하지 않음(훅이 proposal을 만들지 않음) — 렌더 조건은 기존 그대로 둬도 무방.
- `mode === 'variation'`은 기존 동작 그대로 (회귀 금지).

- [ ] **Step 2: 타입체크 후 커밋**

Run: `npx tsc --noEmit` → 0 에러

```bash
git add src/components/tilemap/TilemapResultView.tsx src/components/generator/ImageGeneratorPanel.tsx
git commit -m "feat: 타일맵 결과 뷰 룰타일 분기 (역할 뱃지·교체 컨트롤 숨김)"
```

---

### Task 5: 미리보기 캔버스 룰타일 오토타일 스탬프

**Files:**
- Modify: `src/components/tilemap/TilePreviewCanvas.tsx`, `src/components/tilemap/TilemapResultView.tsx` (props 전달)

**Interfaces:**
- Consumes: `getRuleTileRoles`/`pickRoleCell`/`RuleTileRole` (Task 1)
- Produces: `TilePreviewCanvasProps`에 `mode: TilemapMode; roles?: RuleTileRole[];` 추가 (roles는 ruletile일 때 `getRuleTileRoles(grid)`)

- [ ] **Step 1: 룰타일 페인팅 모델**

`mode === 'ruletile'`일 때 동작 변경:
- 셀 상태를 `(number|null)[][]` 그대로 쓰되 의미를 바꾼다: **null=베이스, 1=오버레이** (타일 인덱스가 아님).
- 좌측 팔레트 숨김 — 도구는 "오버레이 칠하기(스탬프)" / "지우개"만. 랜덤 채우기 버튼 숨김(룰타일에 무의미), "전체 지우기" 유지.
- 렌더 시 셀별 타일 결정 함수:

```typescript
/**
 * 룰타일 오토타일 선택: 4방(N/E/S/W) 이웃의 오버레이 여부로 역할을 정하고,
 * 4방이 모두 오버레이인데 대각이 비면 해당 방향 오목 코너를 쓴다 (없으면 fill 폴백).
 * variant는 (row*31+col*17)로 결정적 순환 — 같은 맵은 항상 같은 그림.
 */
function resolveRuleTileCell(
  map: (number | null)[][], row: number, col: number,
  roles: RuleTileRole[],
): number {
  const isOverlay = (r: number, c: number): boolean =>
    r >= 0 && r < map.length && c >= 0 && c < map[0].length && map[r][c] !== null;

  const n = isOverlay(row - 1, col), s = isOverlay(row + 1, col);
  const w = isOverlay(row, col - 1), e = isOverlay(row, col + 1);
  const variant = row * 31 + col * 17;
  const pick = (role: RuleTileRole): number => {
    const idx = pickRoleCell(roles, role, variant);
    return idx >= 0 ? idx : pickRoleCell(roles, 'fill', variant);
  };

  // base가 보이는 방향 조합으로 역할 결정 (base = 오버레이 아닌 쪽)
  if (!n && !w && s && e) return pick('corner_nw');
  if (!n && !e && s && w) return pick('corner_ne');
  if (!s && !w && n && e) return pick('corner_sw');
  if (!s && !e && n && w) return pick('corner_se');
  if (!n && s) return pick('edge_n');
  if (!s && n) return pick('edge_s');
  if (!w && e) return pick('edge_w');
  if (!e && w) return pick('edge_e');
  if (n && s && w && e) {
    // 대각 검사: 비어 있는 대각 방향의 오목 코너
    if (!isOverlay(row - 1, col - 1)) return pick('concave_nw');
    if (!isOverlay(row - 1, col + 1)) return pick('concave_ne');
    if (!isOverlay(row + 1, col - 1)) return pick('concave_sw');
    if (!isOverlay(row + 1, col + 1)) return pick('concave_se');
    return pick('fill');
  }
  // 고립/한 줄 등 세트에 없는 형태는 fill로 폴백
  return pick('fill');
}
```

> 주의 — 오목 명명 재확인: `concave_nw`는 base가 NW 대각에 보이는 타일. `resolveRuleTileCell`에서 NW 대각이 비었을 때 `concave_nw`를 고르는 위 매핑이 Task 1 라벨 정의("base가 보이는 대각 방향")와 일치한다.

- 비오버레이 셀 렌더: `pickRoleCell(roles,'base',variant)`가 있으면 그 타일(8x8 세트), 없으면(4x4) 기존 회색 배경.
- 그리기 effect에서 `mode==='ruletile'`이면 `resolveRuleTileCell` 결과 인덱스의 타일 이미지를 그림.

- [ ] **Step 2: TilemapResultView에서 props 전달**

```tsx
        <TilePreviewCanvas
          tiles={previewTiles}
          mode={mode}
          roles={mode === 'ruletile' ? getRuleTileRoles(grid) : undefined}
          onClose={() => setShowPreviewCanvas(false)}
        />
```

(변형 모드는 기존 동작 그대로.)

- [ ] **Step 3: 타입체크 후 커밋**

Run: `npx tsc --noEmit` → 0 에러

```bash
git add src/components/tilemap/TilePreviewCanvas.tsx src/components/tilemap/TilemapResultView.tsx
git commit -m "feat: 미리보기 캔버스 룰타일 오토타일 스탬프 (이웃 기반 자동 선택)"
```

---

### Task 6: 내보내기 가이드·문서·버전·최종 검증

**Files:**
- Modify: `src/lib/tilemap/tilemapExporter.ts` (룰타일 가이드), `src/components/generator/ImageGeneratorPanel.tsx` (mode 전달)
- Modify: `wiki/tilemap/overview.md`, `wiki/README.md`
- Modify: 버전 3파일 + CHANGELOG (0.4.23)

- [ ] **Step 1: exportTilemapForUnity에 mode 파라미터**

params에 `mode: TilemapMode` 추가 (패널은 `tilemap.effectiveMode` 전달). `buildImportGuide(grid, mode)`:
- variation: 기존 가이드 유지.
- ruletile: 가이드에 추가 — ① 셀 위치(행,열)→역할 표를 `getRuleTileRoles`로 생성해 텍스트로 출력, ② Unity Rule Tile 설정 절차(2D Tilemap Extras 패키지 → Create > 2D > Tiles > Rule Tile → 역할별 스프라이트에 이웃 규칙 지정: 엣지↑=위쪽 이웃 없음 등 화살표 규칙 설명), ③ 4x4 세트에는 오목 코너가 없어 좁은 꺾인 길은 8x8 세트 권장 문구.

- [ ] **Step 2: 위키 갱신**

`wiki/tilemap/overview.md`에 v2 섹션: 모드 2종, 룰타일 구도(패치/도넛)와 역할 테이블 좌표(`ruleTileLayout.ts`), 모드별 동작 차이(seam·교체 비활성), 미리보기 오토타일 스탬프, 랜덤성 규칙 개정. `wiki/README.md` 빠른 진입 표에 "룰타일 역할이 어긋남/오목 코너가 안 나옴" 행 추가.

- [ ] **Step 3: 버전 범프 0.4.23**

`scripts/bump-version.sh 0.4.23` 실행. **주의: CHANGELOG.md가 CRLF라 스크립트의 자동 갱신이 조용히 실패한다(위키 auto-update.md 함정 참조)** — 실행 후 CHANGELOG에 0.4.23 항목이 없으면 수동 추가. 스크립트가 만든 자동 커밋/태그는 유지해도 되고, 문서 변경과 커밋을 합치려면 v1 때처럼 soft reset 후 단일 커밋 + 재태깅.

- [ ] **Step 4: 최종 검증·커밋**

Run: `npm run build` → 성공. 커밋:

```bash
git add -A
git commit -m "docs: 타일맵 v2 위키 갱신 및 v0.4.23 버전 범프"
```

---

## Self-Review 결과 (계획 작성 시 수행)

- **스펙 §12 커버리지**: 12.1(랜덤성)→Task 2, 12.2 구도·역할 테이블→Task 1·2, 모드·입력 UI→Task 3, 모드별 동작 차이→Task 3·4, 미리보기 오토타일→Task 5, 내보내기 가이드·문서→Task 6. 누락 없음.
- **타입 일관성**: `TilemapMode`/`RuleTileRole`/`getRuleTileRoles`/`pickRoleCell`/`RULE_TILE_ROLE_LABELS`/`effectiveMode` 명칭이 정의(Task 1·3)와 사용처(Task 2~6)에서 일치함을 교차 확인.
- **위험 지점 명시**: ROLES_8X8 배열과 오목 명명 규칙은 두 곳(Task 1 주의문, Task 5 주의문)에서 재검증하도록 지시.
