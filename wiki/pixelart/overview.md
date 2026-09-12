# 픽셀아트 (Pixel Art)

게임용 픽셀아트를 생성하는 세션 3종(**픽셀 캐릭터·픽셀 배경·픽셀 아이콘**)과, 이들이 공유하는 **그리드 레이아웃(1x1~8x8) 기반 스프라이트 시트** 생성 방식을 다룬다. 핵심은 **단일 이미지 한 장 안에 N×N 프레임을 배치**하도록 Gemini에 프롬프트로 지시하는 것 — 클라이언트에는 이미지를 잘라 붙이는 canvas 분할/합성 코드가 없다. 픽셀아트 세션은 참조 이미지를 `pixelart_specific` 분석으로 파싱해 해상도·팔레트·외곽선·음영·시점을 프롬프트에 반영한다(시대 라벨 기본값은 레트로 콘솔이 아니라 `Modern indie pixel art`). 생성 직후에는 **픽셀 정규화**(`lib/pixelart/`)가 돌아 AI가 "픽셀처럼 보이게" 그린 1024px 이미지를 실제 픽셀 격자에 맞춰 재구성한다 — `pixelArtUpscaler.ts`(Nearest-Neighbor)는 그 마지막 확대 단계로 연결돼 있다(더 이상 dead code가 아니다).

## 관련 파일

- `src/types/pixelart.ts` — 그리드 타입·정보. `PixelArtGridLayout`(`pixelart.ts:6`)·`PixelArtGridInfo`·`getPixelArtGridInfo`(`pixelart.ts:25`)
- `src/lib/pixelart/pixelate.ts` — **픽셀 정규화 본체**. `pixelateDataUrl`(canvas 경계)·`pixelateRgba`(순수 함수)·`estimatePixelGrid`·`evaluateGridCandidates`·`downsampleToLogical`·`quantizeToPalette`. 타입: `PixelateSizeOption`·`PaletteSizeOption`·`RgbaImage`·`GridEstimate`
- `src/lib/pixelart/palette.ts` — 팔레트 양자화. `buildPalette`(최원점 초기화 + k-means)·`estimatePaletteSize`(자동 색 수)·`nearestColorIndex`
- `src/lib/pixelArtUpscaler.ts` — Nearest-Neighbor 업스케일. `upscalePixelArt`는 `pixelateDataUrl`의 마지막 단계로 **사용 중**. `upscalePixelArtToSize`·`isLikelyPixelArt`는 여전히 미사용
- `src/lib/prompts/sessionPrompts.ts` — 프롬프트 빌더. `generatePixelArtCharacterPrompt`(`:468`)·`generatePixelArtBackgroundPrompt`(`:519`)·`generatePixelArtIconPrompt`(`:572`)·`parseResolutionEstimate`(`:28`)·`promptGenerators` 맵(`:131`). 픽셀 공통 헬퍼: `PIXELART_MODERN_STYLE_RULES`(`:43`)·`buildPixelArtAvoidSection`(`:59`)·`buildPixelArtSpecSection`(`:94`)
- `src/lib/config/sessionConfig.ts` — 세션별 UI 설정. `SESSION_CONFIG`의 `PIXELART_CHARACTER`(`:220`)/`PIXELART_BACKGROUND`(`:242`)/`PIXELART_ICON`(`:264`), 그리드별 설명 문자열(`grids`). 헬퍼: `getGridDescription`·`getGridLabel`·`getGridButtonStyle`·`getPromptPlaceholder`(`:327`, `startsWith('PIXELART_')` 분기)
- `src/types/session.ts` — `SessionType` 유니온(`:7`, `PIXELART_CHARACTER|PIXELART_BACKGROUND|PIXELART_ICON`), `Session.pixelArtGrid?`(`:52`)
- `src/types/analysis.ts` — `PixelArtSpecificAnalysis`(`:35`), `ImageAnalysisResult.pixelart_specific?`(`:79`)
- `src/lib/gemini/analysisPrompt.ts` — `PIXELART_ANALYZER_PROMPT`(`:215`)·`PIXELART_BACKGROUND_ANALYZER_PROMPT`(`:334`). 두 프롬프트 모두 **디더링 기재 금지**(캐릭터 `:293`, 배경 `:418`·`:427`)와 `Modern indie pixel art` 기본값 지침을 포함한다.
- `src/hooks/api/useGeminiAnalyzer.ts` — 세션 타입별 분석 프롬프트 분기(`:97`)
- `src/lib/prompts/thinkingPrefix.ts` — `PREFIXES.pixelart`(`:100`), `buildThinkingPrefix`(`:118`)
- `src/components/generator/GeneratorSettings.tsx` — 그리드 선택 UI(PIXELART_*/CHARACTER/BACKGROUND/ICON에서 노출), `onPixelArtGridChange`. **픽셀 정규화 설정 블록**(토글·픽셀 해상도·팔레트 색 수)은 PIXELART_* 세션에만 노출
- `src/components/generator/ImageGeneratorPanel.tsx` — `pixelArtGrid` 상태·전달(`:407` 기본값, `setPixelArtGrid`, 생성 시 전달, 히스토리 복원 `:948`)
- `src/components/chat/ChatAISettings.tsx` — 채팅 세션 그리드 선택(`:53`, `['1x1','2x2','3x3','4x4']`만 노출)
- `src/hooks/useChatImageGeneration.ts` — 채팅 프롬프트 prefix(`buildSettingsPrefix`)·**픽셀아트 모드 분기**(정규화 + PNG 유지)
- `src/components/chat/ChatAISettings.tsx` — 채팅 그리드(1x1~4x4)·**픽셀아트 모드 설정**(토글/해상도/팔레트)
- `src/components/chat/ChatPanel.tsx` — 채팅 이미지 자동·수동 저장. 확장자는 `getImageSaveFormat`으로 **실제 바이트 기준** 결정
- `src/components/common/NewSessionModal.tsx` — 픽셀 세션 생성 버튼(픽셀 캐릭터 `:144`·배경 `:162`·아이콘 `:180`)
- `src/components/common/Sidebar.tsx` — PIXELART_* 아이콘(Grid3x3)·teal 색상(`:25`)
- `src/types/constants.ts` — `IMAGE_GENERATION_DEFAULTS.PIXEL_ART_GRID = '1x1'`(`:12`)

## 데이터 모델

```
PixelArtGridLayout = '1x1' | '2x2' | '3x3' | '4x4' | '6x6' | '8x8'

PixelArtGridInfo = {
  rows, cols            // 행·열
  totalFrames           // = rows * cols
  cellSize              // 각 셀 px (1024 캔버스 분할)
  recommendedPixelSize  // 권장 픽셀아트 크기
}

PixelArtSpecificAnalysis = {   // 참조 이미지 분석 결과 (pixelart 세션 전용)
  resolution_estimate    // "64x64" | "128x128" | "256x240 NES" ...
  color_palette_count    // "16 colors" ...
  pixel_density          // "Low-res 8-bit" ...
  style_era              // "NES 8-bit" | "SNES 16-bit" | "GBA 32-bit" ...
  perspective            // "Top-down" | "Side-view" | "Isometric" ...
  outline_style, shading_technique, anti_aliasing
}
```

`getPixelArtGridInfo`가 반환하는 그리드별 값(1024px 캔버스 기준):

| layout | rows×cols | totalFrames | cellSize | recommendedPixelSize |
|--------|-----------|-------------|----------|----------------------|
| 1x1 | 1×1 | 1 | 1024 | 256 |
| 2x2 | 2×2 | 4 | 512 | 128 |
| 3x3 | 3×3 | 9 | ~341 | 85 |
| 4x4 | 4×4 | 16 | 256 | 64 |
| 6x6 | 6×6 | 36 | ~170 | 42 |
| 8x8 | 8×8 | 64 | 128 | 32 |

> `PixelArtGridLayout`은 `types/pixelart.ts:6`과 `lib/config/sessionConfig.ts:3` **두 곳에 중복 정의**되어 있다(리팩터링 후보).

## 세션 3종

| 세션 타입 | 라벨 | 아이콘 | 프롬프트 헤더 | 배경 |
|-----------|------|--------|---------------|------|
| `PIXELART_CHARACTER` | 픽셀아트 캐릭터 | 🎮 | `PIXEL ART SPRITE SHEET` | 순백(#FFFFFF) 강제 |
| `PIXELART_BACKGROUND` | 픽셀아트 배경 | 🏞️ | `PIXEL ART BACKGROUND SET` | (강제 없음) |
| `PIXELART_ICON` | 픽셀아트 아이콘 | 💎 | `PIXEL ART ICON SET` | 순백(#FFFFFF) 강제, 중앙 정렬 |

- 세 세션 모두 `SESSION_CONFIG`에서 cyan/teal 색상, 그리드별 설명 문자열(`grids`)을 가진다. 예: 캐릭터 `4x4` → "완전한 애니메이션 시퀀스(공격 동작 16프레임)".
- 프롬프트 공통 요구사항: 참조 스타일 일치, 동일 색상 팔레트(제한 색), **crisp pixel edges(no anti-aliasing)**, 셀당 해상도 = `parseResolutionEstimate`로 분석에서 추출한 값.
- **최신 픽셀아트 채색 규칙(`PIXELART_MODERN_STYLE_RULES`, `sessionPrompts.ts:43`)**: 세 세션의 **1x1·그리드 모든 분기**에 주입된다. hue shifting + 하드 에지 색 띠(3~5단계)를 요구하고, **디더링·체커보드·스티플·하프톤·그라데이션을 명시 금지**한다(모델이 "pixel art"만 보고 구세대 디더 채색을 기본값으로 끌어오는 것을 차단). 배경 세션에는 하늘·물·벽 같은 넓은 면을 색 띠로 처리하라는 `SKY / LARGE FLAT AREAS` 블록이 추가된다.
- **`⛔ AVOID` 섹션(`buildPixelArtAvoidSection`, `sessionPrompts.ts:59`)**: 분석 결과 `negative_prompt`를 생성 프롬프트로 전달한다(이전에는 분석 패널 표시 전용이라 생성에 아무 영향이 없었다). 디더링 계열 키워드 10종은 분석 결과에 없어도 항상 강제 포함, 대소문자 무시 중복 제거.
- **`📐 MATCH REFERENCE SPEC` 섹션(`buildPixelArtSpecSection`)**: `pixelart_specific`의 `color_palette_count`·`outline_style`·`shading_technique`·`perspective`를 프롬프트에 전달한다(이전에는 `resolution_estimate`만 사용).
- 캐릭터·아이콘은 순백 배경(그라디언트·체크무늬·투명 금지)을 명시 — 후처리 배경 제거·타일 분리를 쉽게 하기 위함.
- **투명 배경(알파 PNG) 토글**이 켜져 있으면 이 순백 배경 지시가 `applyTransparentBackground`(`sessionPrompts.ts`)로 치환된다 — `PIXELART_CHARACTER`·`PIXELART_ICON`은 `TRANSPARENT_BACKGROUND_CAPABLE_SESSIONS`에 포함되어 gpt-image-2.5 계열(`supports.transparentBackground`)에서 노출된다. 켜면 JPEG 변환도 건너뛰어 알파를 보존한 PNG가 그대로 픽셀 정규화 단계로 들어간다(`downsampleToLogical`가 코어 과반 기준으로 알파를 이진화). 상세는 `generator/settings.md`의 "투명 배경" 절.

## 그리드 레이아웃 & 스프라이트 시트 (핵심)

- **스프라이트 시트 = 프롬프트 지시**다. `getPixelArtGridInfo`로 rows/cols/frameCount를 계산해 "N개 프레임을 R행 C열로 배치"를 프롬프트에 넣고, 모델이 **단일 1024px 이미지 안에** 격자로 그린다. 클라이언트에 crop/compose canvas 코드는 **없다**.
- 프롬프트 생성기(`generatePixelArt*Prompt`)는 `pixelArtGrid`가 `'1x1'`이면 단일 이미지 프롬프트, 그 외면 스프라이트 시트 프롬프트로 분기한다.
- 채팅 세션은 별도 경로(`buildSettingsPrefix`)로 `[그리드 레이아웃: 4x4 — 하나의 이미지 안에 16개 프레임을 4행 4열로 균등 배치]` 문자열을 붙인다. 채팅 UI(`ChatAISettings`)는 `1x1~4x4`만 노출.
- **⛔ NO GRID LINES**: 모든 그리드 프롬프트에 "셀 사이에 선·경계·구분선을 그리지 말 것, 그리드는 개념적 배치일 뿐"이라는 강한 지시가 포함된다. 실제 픽셀에 격자선이 새겨지는 것을 막는다.
- 그리드 개념은 픽셀아트 전용이 아니다 — `CHARACTER`/`BACKGROUND`/`ICON`/`UI`/`LOGO` 세션도 `pixelArtGrid`를 받아 바리에이션 그리드를 생성한다(같은 `getPixelArtGridInfo` 재사용).
- 기본값은 `'1x1'`(`constants.ts:12`, `useChatSession`/`App.tsx` 초기화).

## 분석 파이프라인 (pixelart_specific)

- 픽셀아트 세션의 참조 이미지는 전용 분석 프롬프트로 파싱: `PIXELART_BACKGROUND`은 `PIXELART_BACKGROUND_ANALYZER_PROMPT`, 캐릭터·아이콘은 `PIXELART_ANALYZER_PROMPT`(`useGeminiAnalyzer.ts:97`).
- 결과는 `ImageAnalysisResult.pixelart_specific`(`PixelArtSpecificAnalysis`)에 담긴다.
- 프롬프트 생성기는 `analysis.pixelart_specific.resolution_estimate`를 `parseResolutionEstimate`로 파싱(`"64x64"`→64) → 셀당 해상도로 사용. 파싱 실패·미존재 시 기본 **128**, 범위는 **16~512**로 clamp.

## 픽셀 정규화 (pixelate) — 생성 후처리

AI는 1024px 캔버스에 **"픽셀아트처럼 보이는" 그림**을 그린다. 확대하면 ① 블록 경계가 1~2px 흐리고 ② 블록 안에서도 색이 미세하게 변하며 ③ 블록 격자가 이미지 전체에 일정하게 정렬돼 있지 않다. 프롬프트로는 이 세 개를 잡을 수 없어 **생성 직후 결정론적으로 재구성**한다.

`ImageGeneratorPanel.tsx`의 `onComplete`에서 흰색 배경 제거 바로 뒤에 실행되며, 실패하면 원본을 그대로 쓴다(배경 제거와 동일한 방어 패턴). 적용 대상은 `sessionType.startsWith('PIXELART_')`인 세션뿐 — 일반 세션 결과를 블록화하면 그림이 망가진다.

### 4단계 파이프라인 (`lib/pixelart/pixelate.ts`)

1. **논리 해상도 결정**(`resolveGrid`)
   - **그리드 세션(2x2~8x8)은 계산으로 확정**: `(cols x N) x (rows x N)`. 프레임 경계가 픽셀 격자에 정확히 맞아 스프라이트 시트 분리가 깨지지 않는다. 위상은 항상 0.
   - **1x1은 격자 자동 감지**(`estimatePixelGrid`): 후보 `[32,40,48,64,80,96,128,160,192,256]`마다 위상까지 탐색.
   - 사용자가 해상도를 지정하면 그 값을 쓰되 위상만 자동으로 맞춘다. 셀이 `MIN_CELL_SIZE`(2px) 미만이면 그리드 권장값으로 폴백한다.
2. **셀 대표색 추출**(`downsampleToLogical`): 셀 **중앙 60% 코어 영역의 최빈색**. 평균을 쓰면 흐린 경계가 섞여 원본에 없던 중간색이 생긴다 — 이게 "확대하면 뭉개진 컬러"의 정체다. 알파는 코어 과반 기준으로 이진화(반투명 경계 제거).
3. **팔레트 양자화**(`palette.ts`): 최원점 초기화 + k-means로 K색 팔레트를 만들고 최근접 색으로 스냅. **오차확산(디더링)은 구현하지 않는다** — 프롬프트 쪽 디더링 금지와 같은 방향.
4. **정수배 NN 업스케일**: `upscalePixelArt`로 1024 근처까지 정수배 확대. 소수 배율은 픽셀을 다시 뭉갠다.

1~3단계는 canvas에 의존하지 않는 **순수 함수**(`RgbaImage` 입출력)라 브라우저 없이 검증할 수 있다. canvas는 `pixelateDataUrl`에서만 쓴다.

### 격자 감지 판정 기준 (틀리기 쉬운 지점)

두 지표를 **순서대로** 쓴다. 어느 하나만으로는 반드시 틀린다:

| 지표 | 단독으로 쓰면 | 이유 |
|------|--------------|------|
| enrichment (격자선 에지 밀도) | 진짜 격자의 **약수** 격자를 못 가린다 | 128격자 이미지에서 32·64·128 후보의 격자선은 모두 진짜 경계 위에만 놓여 밀도가 사실상 같다(실측 2.26 / 2.25 / 2.24) → 순서 탓에 가장 거친 32가 뽑힌다 |
| coverage (격자선이 담은 에지 비율) | **세밀한 후보가 항상 이긴다** | 블록 내부 노이즈가 모든 열에 에지를 흩뿌리는데, 셀 4px이면 ±1 창이 전체 열의 75%를 덮어 노이즈를 공짜로 주워담는다 |

→ ① enrichment가 최고치의 70% 이상인 후보만 남기고(어긋난 후보는 1.0 근처로 탈락) ② 그중 **coverage 최대**를 고른다. 약수 격자는 진짜 경계의 일부만 담아 coverage가 명확히 낮다(0.21 / 0.42 / 0.84). enrichment 최고치가 `MIN_ENRICHMENT`(1.35) 미만이면 격자 없음으로 보고 원본 해상도를 논리 해상도로 취급한다(일반 이미지에 격자를 억지로 씌우지 않는다).

### 팔레트 초기화 (틀리기 쉬운 지점)

median-cut의 균등 인구 분할은 색 클러스터 경계를 존중하지 않아 **인접한 두 색을 병합하고 다른 색을 둘로 쪼개는** 초기값을 만들고, k-means는 그 지역해에서 못 빠져나온다(실측: 8색 이미지에서 빨강이 둘로 갈라지고 어두운색+갈색이 하나로 합쳐져 26%의 픽셀이 오답). 그래서 **빈도 가중 최원점(maximin) 초기화**(점수 = `count x 최근접거리제곱`)를 쓴다 — 난수 없이 결정론적이며, 같은 조건에서 복원율 73% → 100%로 올랐다.

자동 색 수(`estimatePaletteSize`)도 고정 격자 버킷으로 세면 안 된다: 노이즈 색이 버킷 경계를 걸쳐 한 색이 여러 버킷으로 갈라진다(8색 이미지가 37버킷). 거리 문턱 기반 그리디 클러스터링으로 지각적 동일색을 묶은 뒤 누적 95% 커버리지 지점을 센다.

### 설정 (PIXELART_* 세션 전용)

| 설정 | 값 | 기본 | 저장 위치 |
|------|-----|------|-----------|
| 픽셀 정규화 | on/off | **on** | `IMAGE_GENERATION_DEFAULTS.PIXELATE` |
| 픽셀 해상도 | `auto`/32/64/128 (그리드 세션은 프레임당) | `auto` | `PIXELATE_SIZE` |
| 팔레트 색 수 | `auto`/8/16/32/48 | `auto` | `PIXELATE_PALETTE_SIZE` |

`GenerationSettings`(`types/session.ts`)에 `pixelate`·`pixelateSize`·`pixelatePaletteSize`로 기록되어 히스토리 복원 시 함께 되살아난다(구버전 히스토리엔 없으므로 `??`로 현재 값 유지).

> **AI 원본은 보존되지 않는다.** 표시·자동저장·히스토리 모두 정규화 결과를 쓴다(WYSIWYG). 히스토리는 항목당 이미지 키가 하나뿐(`{sessionId}-gen-{entryId}`)이라 원본을 함께 남기려면 `storage.ts`의 키·마이그레이션·export/import·orphan 정리를 모두 확장해야 한다. 원본이 필요하면 토글을 끄고 생성한다.

> 논리 해상도 원본(N×N PNG)은 `pixelateDataUrl`이 `logicalDataUrl`로 돌려주지만 **아직 어디에도 저장하지 않는다**. 게임 엔진용 N×N 내보내기와 스프라이트 시트 프레임 분리를 붙일 때의 진입점이다.

## 채팅 세션의 픽셀아트 모드

채팅(`BASIC`)은 범용 세션이라 **세션 타입으로 픽셀아트 의도를 알 수 없다.** `ChatGenerationSettings`에 `stylePreset`·`customStyle` 필드가 있지만 **타입 선언만 있고 어디서도 쓰이지 않는 dead field**라 판정에 쓸 수 없다. 그래서 명시적 토글(`pixelArtMode`)로 판정한다.

토글이 켜지면 픽셀아트 세션과 **같은 기준**이 걸린다:

1. **프롬프트**: `buildSettingsPrefix`가 `🎮 PIXEL ART MODE` + `PIXELART_MODERN_STYLE_RULES`(픽셀 세션과 공유하는 상수 — `sessionPrompts.ts`에서 export)를 그리드 힌트와 함께 앞에 붙인다.
2. **JPEG 변환 건너뜀**: 채팅의 기본 경로는 `convertBase64ToJpeg`로 내부 표준 JPEG로 통일하는데, **손실 압축이 픽셀 경계에 링잉을 만들어 정규화 결과를 다시 뭉갠다.** 픽셀아트 모드는 PNG를 그대로 유지한다.
3. **픽셀 정규화**: `pixelateDataUrl`에 `pixelateSize`·`pixelatePaletteSize`·`pixelArtGrid`를 넘긴다. 실패하면 JPEG로 되돌리지 않고 **PNG 원본**을 넘긴다(JPEG 폴백은 픽셀을 더 망친다).
4. **저장 확장자**: `ChatPanel`의 자동·수동 저장이 `.jpg`를 하드코딩하고 있었다 → `getImageSaveFormat`으로 **실제 바이트 기준** 판별로 교체. 이걸 안 고치면 PNG 바이트가 `.jpg`로 나간다(`lib/utils/imageDataUrl.ts`가 막으려던 바로 그 버그).

설정은 `ChatSessionData.settings`에 저장되어 세션에 지속된다. 기본값은 **off** — 채팅은 픽셀아트 전용 세션이 아니므로 켜져 있으면 일반 이미지를 블록화해 버린다.

> **한계**: 어노테이션·부분 편집 경로(`ImageAnnotator`)는 여전히 JPEG로 재인코딩해 모델에 보낸다(`quality 0.85/0.9`). 참조 이미지가 열화되지만, 결과물은 다시 정규화를 거치므로 최종 픽셀은 선명하게 유지된다.

## 회귀 증상별 원인

| 증상 | 원인 |
|------|------|
| 생성물에 격자선이 그려짐 | 프롬프트의 `NO GRID LINES` 지시가 약하거나 모델이 무시 — 프롬프트 헤더/그리드 블록 확인 |
| 셀당 해상도가 이상함 | `resolution_estimate` 파싱 실패 → `parseResolutionEstimate` 기본 128 / 16~512 clamp 적용 |
| 그리드 선택 UI가 안 보임 | `sessionType`이 그리드 지원 목록(`GeneratorSettings.tsx:225`)에 없음. 채팅은 `1x1~4x4`만 |
| 6x6/8x8이 채팅에서 안 나옴 | `ChatAISettings.tsx:53`이 `['1x1','2x2','3x3','4x4']`만 노출 — 의도적 제한 |
| 프레임 수가 그리드와 안 맞음 | `getPixelArtGridInfo.totalFrames`(=rows*cols)와 프롬프트 `frameCount` 불일치 |
| 픽셀아트가 흐릿/안티앨리어싱됨 | 프롬프트의 `no anti-aliasing`·`crisp pixel edges` 누락 또는 모델 무시 |
| 채색이 구세대 디더링(체커보드 점박이)으로 나옴 | `PIXELART_MODERN_STYLE_RULES` 주입 누락 또는 모델 무시. 분석 프롬프트가 `dithered`류 단어를 결과에 실어보냈는지도 확인(`analysisPrompt.ts:427` 금지 지침) |
| 분석 네거티브가 생성에 반영 안 됨 | `buildPixelArtAvoidSection`은 픽셀 세션 3종에만 연결됨 — 다른 세션은 여전히 `negative_prompt` 미전달 |
| 분석 결과가 NES/8-bit로만 잡힘 | 분석 프롬프트 기본값은 `Modern indie pixel art`(`analysisPrompt.ts:222,252`). 레트로 라벨은 콘솔 팔레트 제약이 명확할 때만 붙도록 유도 |
| 배경이 순백이 아님 | 캐릭터·아이콘만 `#FFFFFF` 강제, 배경 세션은 미강제. 투명 배경 토글이 켜져 있으면 의도된 동작(순백 지시가 알파 지시로 치환됨) |
| 확대하면 픽셀이 흐리고 색이 뭉개짐 | 픽셀 정규화 토글이 꺼져 있음. 켜져 있는데도 그러면 격자 감지 실패(로그의 `격자 정합` 점수 확인 — 1.35 미만이면 격자 미인정) |
| 정규화 결과가 원본과 너무 다르게 단순함 | 정상 동작 — 2단계 최빈색 추출이 미세 계조를 의도적으로 버린다. 팔레트 색 수를 올리면 완화되지만 그만큼 다시 뭉개진다 |
| 논리 해상도가 엉뚱하게 잡힘 | 1x1 자동 감지 오검출 → 픽셀 해상도를 32/64/128로 직접 지정. 그리드 세션은 자동 감지를 쓰지 않으므로 이 증상이 없다 |
| 정규화 후 스프라이트 프레임 경계가 어긋남 | 그리드 세션인데 `grid` 파라미터가 전달되지 않아 자동 감지 경로로 갔는지 확인(`pixelateDataUrl`에 `grid: pixelArtGrid`) |
| AI 원본을 다시 보고 싶음 | 보존되지 않음 — 토글을 끄고 재생성해야 한다(생성은 비결정적이라 같은 그림은 아니다) |
| `upscalePixelArtToSize`가 동작 안 함 | 정상 — 이 함수와 `isLikelyPixelArt`는 여전히 미사용. 쓰이는 것은 `upscalePixelArt`뿐 |
| 채팅에서 픽셀아트가 정규화되지 않음 | `ChatAISettings`의 **픽셀아트 모드**가 꺼져 있음(기본 off). 세션 타입만으로는 판정하지 않는다 |
| 채팅 픽셀아트가 저장 후 다시 뭉개짐 | 저장 확장자·포맷 확인. 픽셀아트 모드는 PNG를 유지해야 하며, JPEG로 나가면 경계에 링잉이 생긴다 |
| 채팅 픽셀아트 파일이 `.jpg`로 저장됨 | `ChatPanel`이 `getImageSaveFormat`을 쓰는지 확인(과거 `.jpg` 하드코딩 버그) |
| 채팅 스타일 프리셋이 반영 안 됨 | `stylePreset`·`customStyle`은 타입에만 있는 dead field — 구현 자체가 없다 |
| PixelArtGridLayout 타입 불일치 | `types/pixelart.ts`와 `sessionConfig.ts` 두 곳 중복 정의 — 한쪽만 수정 시 발생 |
| 픽셀 세션인데 일반 분석 결과 | `useGeminiAnalyzer.ts:97` 분기 미적용 → `pixelart_specific` 누락 → 해상도 기본 128 사용 |
