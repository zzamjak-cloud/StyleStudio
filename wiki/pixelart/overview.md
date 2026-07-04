# 픽셀아트 (Pixel Art)

게임용 픽셀아트를 생성하는 세션 3종(**픽셀 캐릭터·픽셀 배경·픽셀 아이콘**)과, 이들이 공유하는 **그리드 레이아웃(1x1~8x8) 기반 스프라이트 시트** 생성 방식을 다룬다. 핵심은 **단일 이미지 한 장 안에 N×N 프레임을 배치**하도록 Gemini에 프롬프트로 지시하는 것 — 클라이언트에는 이미지를 잘라 붙이는 canvas 분할/합성 코드가 없다. 픽셀아트 세션은 참조 이미지를 `pixelart_specific` 분석으로 파싱해 해상도·팔레트·시대(NES/SNES 등)를 프롬프트에 반영한다. `pixelArtUpscaler.ts`(Nearest-Neighbor 업스케일)는 존재하지만 **현재 어디서도 호출되지 않는 미사용 유틸리티**다.

## 관련 파일

- `src/types/pixelart.ts` — 그리드 타입·정보. `PixelArtGridLayout`(`pixelart.ts:6`)·`PixelArtGridInfo`·`getPixelArtGridInfo`(`pixelart.ts:25`)
- `src/lib/pixelArtUpscaler.ts` — Nearest-Neighbor 업스케일. `upscalePixelArt`·`upscalePixelArtToSize`·`isLikelyPixelArt`. **미사용(dead code)**
- `src/lib/prompts/sessionPrompts.ts` — 프롬프트 빌더. `generatePixelArtCharacterPrompt`(`:390`)·`generatePixelArtBackgroundPrompt`(`:431`)·`generatePixelArtIconPrompt`(`:468`)·`parseResolutionEstimate`(`:27`)·`promptGenerators` 맵(`:57`)
- `src/lib/config/sessionConfig.ts` — 세션별 UI 설정. `SESSION_CONFIG`의 `PIXELART_CHARACTER`(`:220`)/`PIXELART_BACKGROUND`(`:242`)/`PIXELART_ICON`(`:264`), 그리드별 설명 문자열(`grids`). 헬퍼: `getGridDescription`·`getGridLabel`·`getGridButtonStyle`·`getPromptPlaceholder`(`:327`, `startsWith('PIXELART_')` 분기)
- `src/types/session.ts` — `SessionType` 유니온(`:7`, `PIXELART_CHARACTER|PIXELART_BACKGROUND|PIXELART_ICON`), `Session.pixelArtGrid?`(`:52`)
- `src/types/analysis.ts` — `PixelArtSpecificAnalysis`(`:35`), `ImageAnalysisResult.pixelart_specific?`(`:79`)
- `src/lib/gemini/analysisPrompt.ts` — `PIXELART_ANALYZER_PROMPT`(`:215`)·`PIXELART_BACKGROUND_ANALYZER_PROMPT`(`:330`)
- `src/hooks/api/useGeminiAnalyzer.ts` — 세션 타입별 분석 프롬프트 분기(`:97`)
- `src/lib/prompts/thinkingPrefix.ts` — `PREFIXES.pixelart`(`:100`), `buildThinkingPrefix`(`:118`)
- `src/components/generator/GeneratorSettings.tsx` — 그리드 선택 UI(`:225`, PIXELART_*/CHARACTER/BACKGROUND/ICON에서 노출), `onPixelArtGridChange`
- `src/components/generator/ImageGeneratorPanel.tsx` — `pixelArtGrid` 상태·전달(`:407` 기본값, `setPixelArtGrid`, 생성 시 전달, 히스토리 복원 `:948`)
- `src/components/chat/ChatAISettings.tsx` — 채팅 세션 그리드 선택(`:53`, `['1x1','2x2','3x3','4x4']`만 노출)
- `src/hooks/useChatImageGeneration.ts` — 채팅 그리드 프롬프트 문자열(`:22`)
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
- 캐릭터·아이콘은 순백 배경(그라디언트·체크무늬·투명 금지)을 명시 — 후처리 배경 제거·타일 분리를 쉽게 하기 위함.

## 그리드 레이아웃 & 스프라이트 시트 (핵심)

- **스프라이트 시트 = 프롬프트 지시**다. `getPixelArtGridInfo`로 rows/cols/frameCount를 계산해 "N개 프레임을 R행 C열로 배치"를 프롬프트에 넣고, 모델이 **단일 1024px 이미지 안에** 격자로 그린다. 클라이언트에 crop/compose canvas 코드는 **없다**.
- 프롬프트 생성기(`generatePixelArt*Prompt`)는 `pixelArtGrid`가 `'1x1'`이면 단일 이미지 프롬프트, 그 외면 스프라이트 시트 프롬프트로 분기한다.
- 채팅 세션은 별도 경로(`useChatImageGeneration.ts:22`)로 `[그리드 레이아웃: 4x4 — 하나의 이미지 안에 16개 프레임을 4행 4열로 균등 배치]` 문자열을 붙인다. 채팅 UI(`ChatAISettings`)는 `1x1~4x4`만 노출.
- **⛔ NO GRID LINES**: 모든 그리드 프롬프트에 "셀 사이에 선·경계·구분선을 그리지 말 것, 그리드는 개념적 배치일 뿐"이라는 강한 지시가 포함된다. 실제 픽셀에 격자선이 새겨지는 것을 막는다.
- 그리드 개념은 픽셀아트 전용이 아니다 — `CHARACTER`/`BACKGROUND`/`ICON`/`UI`/`LOGO` 세션도 `pixelArtGrid`를 받아 바리에이션 그리드를 생성한다(같은 `getPixelArtGridInfo` 재사용).
- 기본값은 `'1x1'`(`constants.ts:12`, `useChatSession`/`App.tsx` 초기화).

## 분석 파이프라인 (pixelart_specific)

- 픽셀아트 세션의 참조 이미지는 전용 분석 프롬프트로 파싱: `PIXELART_BACKGROUND`은 `PIXELART_BACKGROUND_ANALYZER_PROMPT`, 캐릭터·아이콘은 `PIXELART_ANALYZER_PROMPT`(`useGeminiAnalyzer.ts:97`).
- 결과는 `ImageAnalysisResult.pixelart_specific`(`PixelArtSpecificAnalysis`)에 담긴다.
- 프롬프트 생성기는 `analysis.pixelart_specific.resolution_estimate`를 `parseResolutionEstimate`로 파싱(`"64x64"`→64) → 셀당 해상도로 사용. 파싱 실패·미존재 시 기본 **128**, 범위는 **16~512**로 clamp.

## 업스케일 (pixelArtUpscaler) — 현재 미사용

`src/lib/pixelArtUpscaler.ts`는 3개 함수를 export하지만 **레포 어디서도 import/호출되지 않는다**(dead code로 확인).

- `upscalePixelArt(dataUrl, scaleFactor=2)`: Canvas에 `imageSmoothingEnabled=false`(+ moz/webkit/ms 벤더 접두)로 그려 **Nearest-Neighbor** 확대 → 픽셀 경계 보존(Bilinear/Bicubic처럼 뭉개지지 않음). PNG data URL 반환.
- `upscalePixelArtToSize(dataUrl, targetSize=512)`: 긴 변 기준 배율 자동 계산(`ceil(target/max)`), **2~8배로 clamp** 후 `upscalePixelArt` 호출.
- `isLikelyPixelArt(dataUrl)`: 긴 변 512px 이하면 `true`(해상도만 보는 단순 휴리스틱, 팔레트 분석 없음).

> 스프라이트 시트는 모델이 1024px로 직접 생성하므로 현재 업스케일 단계가 파이프라인에 연결돼 있지 않다. 저해상도 픽셀아트 확대가 필요해지면 이 유틸을 생성 후처리에 연결하는 것이 진입점이다.

## 회귀 증상별 원인

| 증상 | 원인 |
|------|------|
| 생성물에 격자선이 그려짐 | 프롬프트의 `NO GRID LINES` 지시가 약하거나 모델이 무시 — 프롬프트 헤더/그리드 블록 확인 |
| 셀당 해상도가 이상함 | `resolution_estimate` 파싱 실패 → `parseResolutionEstimate` 기본 128 / 16~512 clamp 적용 |
| 그리드 선택 UI가 안 보임 | `sessionType`이 그리드 지원 목록(`GeneratorSettings.tsx:225`)에 없음. 채팅은 `1x1~4x4`만 |
| 6x6/8x8이 채팅에서 안 나옴 | `ChatAISettings.tsx:53`이 `['1x1','2x2','3x3','4x4']`만 노출 — 의도적 제한 |
| 프레임 수가 그리드와 안 맞음 | `getPixelArtGridInfo.totalFrames`(=rows*cols)와 프롬프트 `frameCount` 불일치 |
| 픽셀아트가 흐릿/안티앨리어싱됨 | 프롬프트의 `no anti-aliasing`·`crisp pixel edges` 누락 또는 모델 무시 |
| 배경이 순백이 아님 | 캐릭터·아이콘만 `#FFFFFF` 강제, 배경 세션은 미강제 |
| 업스케일 함수가 동작 안 함 | 정상 — `pixelArtUpscaler`는 미사용(dead code), 파이프라인 미연결 |
| PixelArtGridLayout 타입 불일치 | `types/pixelart.ts`와 `sessionConfig.ts` 두 곳 중복 정의 — 한쪽만 수정 시 발생 |
| 픽셀 세션인데 일반 분석 결과 | `useGeminiAnalyzer.ts:97` 분기 미적용 → `pixelart_specific` 누락 → 해상도 기본 128 사용 |
