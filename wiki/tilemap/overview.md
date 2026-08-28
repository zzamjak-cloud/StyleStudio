# 타일맵 (Tilemap)

유니티 Tilemap용 타일 세트를 생성하는 세션. 그리드는 **4x4(16타일)·8x8(64타일)만 지원**하되 **룰타일 모드는 8x8 고정**, 비율·해상도는 **1:1·1K로 고정**, 이미지 품질도 **medium 고정**(다른 세션과 달리 `GeneratorSettings`에서 비율/크기/품질/모델 선택 UI 자체가 숨겨짐). 두 가지 모드가 있고, **모드에 따라 파이프라인이 완전히 다르다**.

| 모드 | AI에게 받는 것 | 코드가 하는 것 | 타일 상호 교환 |
|------|---------------|---------------|---------------|
| `variation` | 타일 N장이 그리드로 배치된 **타일 시트** | 그리드 분할(`sliceTileSheet`) + seam 점수 | 프롬프트 준수에 의존(보장 없음) |
| `ruletile` | 재질 2종 + 프린지가 담긴 **머티리얼 시트** | 지형 경계를 **절차적으로 합성**(`ruleTileComposer`) | **계약으로 보장**(전수 증명됨) |

타일은 개별 파일로 저장하지 않으며, **시트 이미지 + slotAssignments 매핑만 영속화**하고 타일은 매번 런타임에 재구성한다(variation은 분할, ruletile은 합성).

## 관련 파일

### 공통
- `src/types/tilemap.ts` — 타입·상수. `TilemapGridLayout`(`'4x4'|'8x8'`), `TILEMAP_RULETILE_GRID = '8x8'`(룰타일 강제 그리드), `TilemapMode`, `TILEMAP_SEAM_WARNING_THRESHOLD = 70`, `TilemapSheet`(모드에 따라 타일 시트/머티리얼 시트), `TileSlotAssignment`, `TilemapSessionData`(`composerVersion` 포함), `TilemapOutline`(`opacity` 포함)·`DEFAULT_TILEMAP_OUTLINE2`·`outlineOpacity`, `isTilemapGridLayout`
- `src/hooks/useTilemapProcessing.ts` — 후처리 훅. 재진입 복원 `useEffect`(모드별로 분할/합성 분기), `currentTiles`·`baseTiles`·`needsRecompose` 파생, `processNewSheet`, `requestReplacement`/`confirmProposal`/`discardProposal`/`toggleLock`(룰타일이면 전부 no-op)
- `src/lib/tilemap/tilemapExporter.ts` — `exportTilemapForUnity`(시트 재합성 + 개별 PNG + 룰타일이면 `tiles/tile_base*.png`(변형 8장) + 가이드), `composeFinalSheet`, `buildRoleTable`·`buildRuleGrid`(signature → 유니티 3x3 규칙 표 자동 생성)
- `src/components/tilemap/TilemapResultView.tsx` — 결과 뷰. 시트/타일 뷰 토글, 뱃지(룰타일은 `describeSlot`, variation은 seam 점수), 락·선택·제안 액션바
- `src/components/tilemap/TilePreviewCanvas.tsx` — 배치 미리보기 **전체 화면 모달**(24x16 맵, 스탬프/지우개/랜덤 채우기, 줌 0.5x·1x·2x, 패닝). 맵 상태 비저장. 룰타일이면 `signatureFromMap` → `signatureToSlot`으로 생성 단계와 **같은 표**를 조회
- `src/components/tilemap/EdgeStylePicker.tsx` — 경계선 모양 썸네일 드롭다운 + 아웃라인(방향·폭·색·투명도, 2단계) 설정
- `dev/tilemap-preview.html` + `dev/tilemap-preview.tsx` — 미리보기 캔버스 dev 하네스(합성 재질로 세트를 만들어 실제 조작 검증)
- `src/lib/prompts/sessionPrompts.ts` — `generateTilemapPrompt`(모드 분기), `generateTilemapVariationPrompt`, `generateTilemapRuleTilePrompt`. `buildPromptForSession`이 `sessionType === 'TILEMAP'`이면 참조 유무와 무관하게 최우선 분기
- `src/lib/gemini/analysisPrompt.ts` — `TILEMAP_ANALYZER_PROMPT`(손맵 텍스처 전용 분석, character 필드는 전부 `N/A`)
- `src/components/analysis/TilemapCard.tsx` — `tilemap_specific` 분석 편집 카드
- `src/components/generator/GeneratorSettings.tsx` — TILEMAP 전용 그리드·모드 토글, 룰타일 지형 2필드. 비율·크기·품질 UI와 모델 표시를 `sessionType !== 'TILEMAP'`로 숨김. 룰타일이면 그리드 버튼 대신 `8x8 (룰타일 고정)` 읽기 전용 표시

### variation 전용
- `src/lib/tilemap/tileSlicer.ts` — `sliceTileSheet`(실측 크기 기준 중앙 crop 후 그리드 분할), `loadImageElement`
- `src/lib/tilemap/seamValidator.ts` — `computeSeamScores`(타일 4변 경계 스트립 색 비교 휴리스틱)

### ruletile 전용 (v3 절차적 합성 파이프라인)
- `src/lib/tilemap/seamlessTexture.ts` — **1단계**. `extractRegion`, `makeSeamless`(분리형 주기 크로스페이드), `measureWrapContinuity`
- `src/lib/tilemap/edgeProfile.ts` — **2단계**. `NEIGHBOR` 8방향 비트, `TRANSITION_INSET_RATIO`, `terrainSDF`, `warpOffset`, `warpedTerrainSDF`, `buildTerrainMask`, `borderTerrainProfile`(검증용), `signatureFromMap`
- `src/lib/tilemap/autotileSignature.ts` — **3단계**. `reduceToBlob`/`reduceToSides`, `SIGNATURES_4BIT`(16종)·`SIGNATURES_BLOB`(47종), `buildSlotTable`, `buildSignatureIndex`, `signatureToSlot`, `describeSignature`/`describeSlot`, `BASE_TILE_FILENAME`·`baseTileFilename`
- `src/lib/tilemap/ruleTileComposer.ts` — **4단계**. `buildRuleTileSet`, `COMPOSER_VERSION`(현재 7), `resolveOutlineBands`·`sampleOutline`(썸네일과 공유)
- `src/lib/tilemap/tilemapSelfCheck.ts` + `dev/tilemap-check.html` — 단계별 게이트 검사(dev 전용)

## 고정값 (덕테이프 · medium · 8x8)

TILEMAP은 사용자가 고를 수 없는 값이 여럿이다. **바꿀 수 없는 값은 사이드바에 표시조차 하지 않는다** — 읽기 전용 표시는 자리만 차지하고 "왜 못 바꾸지"라는 오해를 만든다. 대신 어긋난 값이 들어오면 되돌리는 **방어 이펙트**를 `ImageGeneratorPanel`에 둔다(UI가 없으므로 사용자가 직접 되돌릴 방법이 없다).

| 값 | 고정 | 방어 이펙트 | UI |
|---|---|---|---|
| 이미지 모델 | `TILEMAP_FIXED_IMAGE_MODEL = 'gpt-image-2'`(덕테이프) | `imageModel !== 덕테이프`면 되돌림 | 없음 (키 없을 때 경고만) |
| 이미지 품질 | `medium` | `imageQuality !== 'medium'`이면 되돌림 | 없음 |
| 비율·해상도 | 1:1 · 1K | — | 없음 |
| 그리드 (룰타일) | `TILEMAP_RULETILE_GRID = '8x8'` | 룰타일인데 8x8이 아니면 되돌림 | 읽기 전용 표시 |

- **모델**: 타일맵은 프롬프트가 지정한 레이아웃을 정확히 지켜야 하는데(변형=NxN 그리드, 룰타일=머티리얼 시트 2패널) 나노바나나 계열은 이를 자주 무시해 사용할 수 없는 결과를 냈다. OpenAI 키가 없으면 경고 문구만 띄운다 — 없으면 생성이 그냥 실패한다.
- **품질**: 룰타일 머티리얼 시트는 설계상 **디테일 없는 균질 필드**라 high로 올려도 얻는 게 없고 비용·시간만 늘어난다.
- **그리드(룰타일)**: 4x4는 상하좌우만 구분하는 4비트 16종이라 **오목 코너가 없다** — 좁게 꺾인 길과 안쪽 모서리를 표현하지 못해 "완벽한 룰타일"이 되지 않는다. 8x8(blob 47종 + 변형 17종)만 전 조합을 담는다. 변형 모드는 4x4/8x8 모두 선택 가능하다.
- **고급 설정 블록 전체를 숨긴다** — 덕테이프는 Seed/Temperature/Top-K/Top-P를 지원하지 않는다.

## 데이터 모델

```
TilemapSessionData = {      // Session.tilemapData
  grid: '4x4' | '8x8'
  sheets: TilemapSheet[]           // 시트 이미지 키 목록 (imageStorage: tilemap-sheet-{id})
  slotAssignments: TileSlotAssignment[]  // 슬롯 수 = 현재 grid의 totalFrames
  mode?: 'variation' | 'ruletile'  // 미지정 시 'variation' (v1 세션 호환)
  baseTerrain?: string             // 룰타일: 베이스 지형 입력 원문 (빈 값 = 투명)
  overlayTerrain?: string          // 룰타일: 오버레이 지형 입력 원문 (빈 값 = 투명)
  transparentBase?: boolean        // 룰타일: 생성 시점에 굳힌 투명 여부
  transparentOverlay?: boolean
  composerVersion?: number         // 룰타일: 합성 알고리즘 버전. 없거나 다르면 재생성 필요
  edgeStyle?: TilemapEdgeStyle     // 룰타일: 경계선 모양 프리셋 (미지정 시 'chunky')
  outline?: TilemapOutline         // 룰타일: 1단계 아웃라인 띠 {enabled, thicknessPx, color, opacity}
  outline2?: TilemapOutline        // 룰타일: 2단계 띠 (1단계에 이어 붙는다)
  outlineSide?: 'outer' | 'inner'  // 룰타일: 띠가 뻗는 방향 (미지정 시 'outer')
}
```

- **타일은 저장하지 않는다.** `sheets`와 `slotAssignments`만 영속화하고, 실제 타일 PNG는 세션 진입 시 휘발성 `tileCache`(`sheetId → 타일 dataURL[]`)로만 재구성한다.
- 룰타일의 **베이스 타일**(순수 베이스 지형)은 그리드 슬롯 밖의 별도 타일이며 **변형 8장**이다(`baseTiles: string[]`). `baseTileCache`(sheetId → string[])에 들고 있고, 내보내기에서 `tiles/tile_base.png` + `tile_base_1..7.png`로 나간다(0번은 기존 파일명 유지 — 이미 임포트한 프로젝트가 깨지지 않게).
- `TilemapGridLayout`은 `PixelArtGridLayout`의 부분집합이라 `getPixelArtGridInfo`를 그대로 재사용한다(4x4→cellSize 256, 8x8→cellSize 128, 둘 다 1024 캔버스 기준).

---

# 룰타일 v3 — 절차적 합성

## v2가 실패한 이유 (재발 방지)

v2는 "큰 그림 1장을 그리게 하고 → 그리드로 자르고 → 셀 좌표로 역할을 붙이는" 방식이었다. 이 구조는 룰타일이 될 수 없다:

1. **엣지 계약이 없었다.** 잘라낸 타일은 "원래 붙어 있던 이웃"과만 이어진다. 같은 역할 타일들의 경계 픽셀을 일치시키는 코드가 어디에도 없었다(`seamValidator`는 점수만 매기고 룰타일 모드에선 계산조차 생략).
2. **모델의 % 정확도에 의존했다.** 8x8 도넛 프롬프트가 외곽 전환선을 6.25%로 지시했으나 실측은 약 13.5%(0.6셀 어긋남) — `corner_nw`로 내보낸 타일이 실제로는 순수 잔디였다. 나노바나나 프로는 구도 자체를 무시하고 3분할 패널을 그렸다.
3. **역할 세트가 부족했다(14종).** 고립 셀·1칸 폭 통로·끝단이 전부 `fill`(순수 오버레이 덩어리)로 폴백됐다.
4. **4x4에 `base` 역할이 없어** 미리보기 배경이 통째로 회색 박스로 나왔다.

> 교훈: 생성 모델에게 **기하학적 정밀도**를 요구하지 말 것. 화풍·재질만 받고 기하는 코드가 만든다.

## 엣지 계약 (핵심 불변식)

> 타일 변을 따라 지형이 갈리는 위치는 항상 정규 상수 `k = size * TRANSITION_INSET_RATIO`(= T/4)이며, **오목 코너의 반경도 반드시 같은 `k`**다.

이것만 지키면 임의 조합이 이어진다. 증명: 우리 셀 서쪽 변의 `y < k` 구간이 무엇인지는 `(N, W, NW)` 세 이웃으로 정해지고, 서쪽 이웃 셀의 동쪽 변 같은 구간은 자신의 `(N, E, NE)` = 우리의 `(NW, 자기자신, N)`로 정해진다. 네 조합을 전개하면 항상 같은 결론이 나온다(`edgeProfile.ts` 상단 표 참조). 코드로도 **전수 검증**한다(가로·세로 2048쌍).

### 왜 인셋이 T/2가 아니라 T/4인가
T/2로 두면 상하 양쪽이 베이스인 **1칸 폭 통로**에서 오버레이 영역이 선으로 수축해 사라진다(고립 셀도 동일). T/4면 통로가 높이 T/2의 띠가 되어 16종·47종 전부 표현 가능하다. **이 상수를 T/2로 되돌리면 통로·고립 셀이 전부 깨진다.**

### warp(유기적 흔들림)의 제약
손맵 느낌을 위해 경계에 잡음 변위를 주지만, 변위장은 **타일 변에서 정확히 0**이어야 한다. 0이 아니면 변의 내용이 타일 내부 값을 참조하게 되어 위 증명이 깨진다(인접 타일은 서로 다른 signature이므로 내부는 일치하지 않는다). 대가로 변 근처 얇은 띠에서 경계가 곧게 지나가며, 프린지 브러시가 이를 가린다.

## 파이프라인

```
[AI]  머티리얼 시트 1장 (좌우 2등분, 전환 패널 없음)
       ├ 좌 절반 : 순수 베이스 지형 스와치 (디테일 없는 균질 필드)
       └ 우 절반 : 순수 오버레이 지형 스와치
      (한쪽 지형이 투명이면 캔버스 전체가 남은 지형 하나의 스와치 — 아래 "투명 지형")

[코드] 1) cropMaterialSwatch(1:1 크롭) + makeSeamless → wrap 연속 **정규 텍스처** 2장 (크기 = cellSize)
          + 패널의 다른 위치를 크롭해 **텍스처 변형 8장씩** (아래 "재질 랜덤성")
       2) buildSlotTable(grid)로 슬롯 배치 결정
       3) 슬롯마다 (베이스 변형, 오버레이 변형)을 해시로 고른 뒤,
          warpedTerrainSDFResolved 부호로 베이스/오버레이 **이진 결정** (1px AA만)
          + 아웃라인 레이어(굵은 것부터)를 |SDF| < 반두께 만큼 지정 색·불투명도로 덮음
       4) 베이스 텍스처 변형 8장 = 베이스 타일 8장 (슬롯 밖)
```

**모든 타일이 텍스처를 오프셋 (0,0)으로 동일하게 샘플링**한다. 두 타일을 나란히 놓으면 접합부가 그 텍스처 자신의 wrap 경계와 정확히 같은 지점이 되어 이어진다. 이게 교체 가능성의 두 번째 축이다(첫 번째는 엣지 계약).

## 재질 랜덤성 — 변은 공유하고 안쪽만 다르다

v4까지는 64장이 **모두 같은 텍스처**를 같은 오프셋으로 샘플링했다. 경계 모양은 슬롯마다 달라도 재질 표정이 동일해서, 세트 전체를 화면에 깔면 "한 타일의 반복"으로 보였다.

유니티 Rule Tile은 변형을 **런타임에 무작위로** 고르므로, 어떤 두 텍스처가 이웃해도 이어져야 한다 = **모든 변형의 변 픽셀이 완전히 동일해야 한다**. 그래서 변형을 이렇게 만든다:

```
variant = (1 - a(x,y)) * canonical + a(x,y) * crop
a = 0  (변에서 EDGE_HOLD_PX=2px 까지)      → 변 근처는 정규 텍스처 그대로
a: 0→1 (VARIANT_RAMP_RATIO=0.12 구간, 스무스스텝)
a = 1  (내부)                              → 패널의 다른 위치를 크롭한 것 = 랜덤성
```

- `crop`은 `makeSeamless`를 거치지 않는다 — 변이 어차피 정규 텍스처라 필요 없고, 크로스페이드 유령도 피한다.
- 크롭 위치는 **황금비 저불일치 수열**로 패널 전체에 흩는다. 규칙적 격자로 잡으면 변형끼리 겹치는 영역이 많아 차이가 잘 안 난다.
- 슬롯마다 베이스·오버레이 변형을 **독립 해시로** 고른다(8 x 8 = 64 조합). 결정적이라 같은 시트는 항상 같은 결과다.
- 스와치 여유가 없으면(모델이 규격보다 작은 이미지를 준 경우) 변형 없이 정규 1장으로 폴백한다.
- 베이스 지형은 맵의 대부분을 덮으므로 **베이스 타일도 8장** 내보낸다. 유니티에서는 Random Tile(2D Tilemap Extras)로 묶어 쓴다.

> 전용 게이트가 있다(`재질 변형 — 변 픽셀 동일성 + 내부 랜덤성`). 변 픽셀은 **정확히 일치**(허용 오차 1), 내부는 평균 채널 차 2 이상이어야 통과한다. 두 조건을 함께 재는 이유: 변만 검사하면 "변형이 사실상 같아짐" 회귀를 놓치고, 내부만 검사하면 접합이 깨진 걸 놓친다.

## 경계 렌더링 — 섞지 않고 맞물린다

초기 구현은 경계 밴드(`k × 0.55`, T=128이면 편측 약 17px)에서 AI가 그린 프린지 색을 **알파 블렌딩**했다. 이건 잘못된 설계였다 — 알파 블렌딩은 원리적으로 두 텍스처의 **평균**을 만들므로, 참조 이미지를 아무리 선명한 것으로 바꿰도 그 밴드는 탁해진다("얼버무리는 느낌", "약간의 투명도가 있는 텍스쳐가 섞이는 느낌").

지금은 **이진 결정**이다:
- 픽셀마다 `warpedTerrainSDF` 부호로 베이스/오버레이를 정하고 **1px만 안티에일리어싱**한다. 그 이상 섞지 않는다.
- 손맵스러운 경계는 색을 섞어서가 아니라 `edgeProfile`의 **블레이드 옥타브**(`bladeAmplitudeRatio` 0.30 / `bladeFrequencyPx` 6)로 만든다 — 고주파·고진폭 변위가 두 지형을 손가락처럼 맞물리게 한다. 픽셀은 100% 베이스 또는 100% 오버레이이므로 탁해질 수 없다.
- 블레이드도 warp와 같은 창(`warpEdgeFalloffRatio`)을 곱하므로 타일 변에서 0 → **엣지 계약 유지**.
- 프린지 스트립 추출과 하단 전환 패널은 함께 제거했다. 덕분에 모델이 맞춰야 할 레이아웃이 2패널로 단순해지고 지형당 스와치 면적이 두 배가 됐다.

> 경계를 다시 부드럽게 하고 싶어도 **알파 블렌딩으로 돌아가면 안 된다.** `bladeFrequencyPx`를 키워(잔가지를 굵게) 조절한다.

전용 게이트가 있다: 순수 단색 재질 2종으로 합성해 **중간색 픽셀 비율**을 센다(현재 0.99%, 허용 3%). 밴드 블렌딩이 되살아나면 즉시 실패한다.

## 투명 지형 — 어떤 바닥에도 얹는 길

지형 입력 필드를 **비우면 그 지형은 재질 대신 알파 0**으로 합성된다. 베이스를 비우면 오버레이와 아웃라인만 남으므로, 프로젝트의 어떤 바닥 타일맵 위에 레이어를 얹어도 그대로 쓸 수 있는 길 타일이 된다. 반대로 오버레이를 비우면 베이스만 남는다 — 어느 쪽을 비울지는 사용자가 고른다. **둘 다 비우는 것은 막는다**(아웃라인 말고 남는 게 없다).

- **프롬프트가 바뀐다.** 한쪽이 투명이면 쓰지 않을 반쪽을 그리게 할 이유가 없으므로 **캔버스 전체를 남은 지형 하나의 스와치**로 요청한다(`generateTilemapRuleTilePrompt`의 solo 분기). 스와치 면적이 두 배가 되고, "대비되는 두 재질을 만들라"는 압력이 사라져 요청한 재질이 흔들리지 않는다. `extractMaterials`도 같은 조건에서 캔버스 전체를 크롭한다.
- **합성이 프리멀티플라이드 알파**로 바뀌었다. 경계 1px AA와 아웃라인 덮기가 모두 알파를 건드리는데, 스트레이트 알파로 섞으면 투명 픽셀의 (의미 없는) RGB 0이 결과에 끼어들어 경계에 **검은 테두리**가 생긴다. 누산은 프리멀티플라이드로 하고 마지막에 한 번만 언프리멀티플라이한다.
- **아웃라인은 투명한 쪽으로도 뻗는다.** 아웃라인은 경계선(SDF=0)을 중심으로 그리므로 투명 영역 위에도 source-over로 얹힌다 — 안 그러면 반쪽짜리 윤곽선이 된다.
- 베이스가 투명이면 칠할 바닥이 없으므로 **`baseTiles`는 빈 배열**이고 `tile_base*.png`도 나가지 않는다. 임포트 가이드가 "바닥을 채우라" 대신 "다른 바닥 위 레이어에 그리라"로 바뀐다.
- 투명 여부는 **생성 시점에 `tilemapData.transparentBase/Overlay`로 굳힌다.** 지형 문자열이 비었는지로 매번 파생하면, 사용자가 패널의 입력 필드를 지운 순간 보유 세트의 해석이 바뀌어 경계 설정을 만질 때마다 결과가 달라진다(패널 입력은 "다음 생성 목표"다 — `grid`·`mode`와 같은 원리).
- 결과 뷰의 시트·타일 셀과 미리보기 캔버스의 바닥 셀은 **체커보드**로 그린다. 흰 배경에 투명 타일을 얹으면 "흰 재질"과 구별되지 않고, 미리보기의 회색 "타일 없음" 박스와도 헷갈린다.

> 전용 게이트가 있다(`투명 지형 — 알파 0 · 검은 테두리 없음 · 아웃라인 관통`). halo 판정은 색 일치가 아니라 **휘도**로 한다: 두 기준색(재질·아웃라인)의 볼록 결합은 휘도가 `min(두 휘도)` 아래로 내려갈 수 없으므로, 그 아래면 검은색이 섞인 것이다. 색 일치로 재면 아웃라인 가장자리의 정상 AA 픽셀까지 위반으로 세어 기준이 무뎌진다.

## 경계선 모양 프리셋 + 아웃라인

지형 경계는 코드가 만들므로, 재질과 **독립적으로** 모양을 고를 수 있다. 예전에는 어떤 지형을 뽑아도 경계 모양이 똑같았다.

- 프리셋 **9종**은 `lib/tilemap/edgeStyles.ts`에: **굵은 맞물림(기본)**·잔가지·거친 찢김·물결·조약돌·매끈함·직선형·각진 폴리곤·각진 맞물림. 각각 `TerrainMaskOptions`의 진폭·주파수·코너 반경·`angular`만 다르다.
- **각진(폴리곤) 경계**는 `angular: true`로 만든다. 기본 값잡음은 격자값을 5차 스무스스텝으로 보간해 변위장이 C2 연속이라 **부드러운 곡선만** 나온다. `angular`면 선형 보간으로 바꿔 격자선에서 기울기가 꺾이고, 경계가 직선 구간 + 뚜렷한 꼭짓점의 폴리곤 곡선이 된다(캐주얼·로우폴리). 진폭을 줄여 "거의 직선"으로 만든 `sharp`(직선형)와는 다른 축이다 — `sharp`는 여전히 곡선이고 작을 뿐이다.
- 기본값은 `chunky`(굵은 맞물림)다. 이전 기본이던 `blades`(잔가지)는 셀 128px에서 잔가지가 너무 가늘게 보였다.
- 프리셋은 `types/tilemap.ts`의 `TilemapEdgeStyle` 문자열 유니온만 참조한다 — 프리셋 본체를 types에 두면 `edgeProfile.ts` ↔ `types/tilemap.ts` 순환 참조가 된다.
- **UI는 썸네일 드롭다운**(`components/tilemap/EdgeStylePicker.tsx`). 썸네일은 합성기와 **같은 `warpedTerrainSDFResolved`**로 그린다 — 색만 대표색으로 바꾸고 기하는 동일하다. 썸네일이 실제 결과와 어긋나면 눈으로 고르는 의미가 없어진다.
- **아웃라인**은 경계선에서 **한쪽 방향으로만** 뻗는 띠를 지정 색으로 덮는 하드 스텐실이다(1px 안티에일리어싱만). 폭은 셀 128px 기준이며 4x4(셀 256px)에서는 2배로 환산해, 유니티 PPU 128 임포트 시 세계 두께가 같게 보인다. 폭 범위는 1~12px.
- **불투명도**(`opacity`, 0~1)는 스텐실의 *덮는 양*을 줄인다. 윤곽선이 아니라 **그림자처럼** 깔 때 쓴다. 지형을 알파 블렌딩하는 것과는 다르다 — 베이스/오버레이 판정은 여전히 이진이다.
- 해석기·샘플러(`resolveOutlineBands`/`sampleOutline`)는 `ruleTileComposer`에서 **export해 썸네일이 그대로 재사용**한다 — 썸네일이 실제 결과와 어긋나면 눈으로 고르는 의미가 없다.

### 계단식 단방향 띠 (감싸지 않는다)

```
  [오버레이 재질] │ 1단계 띠 │ 2단계 띠 │ [베이스 재질/투명]
                 ↑ 경계선(SDF=0)      바깥쪽(outer) →
```

처음 구현은 두 아웃라인이 모두 `|SDF| < 반두께`로 경계선을 **가운데 두고 양쪽에** 퍼졌다. 그러면 굵은 쪽이 얇은 쪽을 **감싸는** 동심 구조밖에 나오지 않아 두 색을 단계별로 늘어놓을 수 없었다. 지금은:

- 각 띠가 `outlineSide`로 지정한 **한쪽으로만** 뻗고(`outer`=오버레이 바깥, `inner`=안쪽), 2단계 띠는 1단계 띠가 끝나는 지점에서 **이어서** 시작한다.
- `thicknessPx`는 이제 **한쪽 방향 폭**이다(양쪽 합이 아니다). 예전 값 그대로면 두 배 굵게 보인다.
- 방향은 **두 띠에 공통**으로 적용된다 — 서로 반대로 뻗으면 "계단"이 되지 않는다.
- 보조 띠 UI는 1단계가 켜져 있을 때만 노출한다.

**띠를 하나씩 순서대로 합성하면 안 된다.** 맞닿는 지점에서 두 띠가 각각 0.5만 덮어 아래 재질이 25% 비치는 **1px 틈**이 생긴다(투명 베이스에서는 반투명 선). 그래서 `sampleOutline`이 가중치를 `clamp(t-start+0.5) - clamp(t-end+0.5)` 로 잡아 맞닿는 지점에서 **정확히 서로 보완**(합 1)되게 하고, 기여분을 **먼저 다 합친 뒤 한 번에** 합성한다.

**엣지 계약**: 예전에는 SDF의 *크기*만 공유 변에서 일치하면 됐지만 방향이 생겼으니 **부호까지** 일치해야 한다. 부호는 지형 판정 그 자체라 엣지 계약이 이미 보장한다.

> 전용 게이트가 있다(`계단식 아웃라인 — 단방향(바깥/안쪽) · 순서·폭`). 합성기와 **같은 SDF를 다시 계산해** 픽셀마다 기대 색(오버레이 / 1단계 / 2단계 / 베이스)을 만들고 대조하며, 띠 사이 1px 틈과 `inner` 방향까지 확인한다. 띠 사이 판정은 "정확히 50:50인가"가 아니라 **두 아웃라인 색이 공유하는 채널이 유지되는가**로 한다 — 혼합 비율은 위치에 따라 연속으로 변하므로 특정 비율을 요구하면 정상 픽셀이 걸린다.
- 프리셋/아웃라인은 **계약을 깨지 않는다**: 변위장은 어떤 값이든 창에 의해 타일 변에서 0이 되고, 코너 라운딩은 인셋 라인에 접하므로 변 위 판정과 무관하다. 아웃라인은 SDF의 *크기*까지 공유 변에서 일치해야 선이 안 끊기는데, 변에서는 x 제약이 비활성이라 SDF가 y만의 함수로 줄어들어 일치한다 — 전용 게이트로 확인한다(불일치 0개).

### 즉시 반영
프리셋·아웃라인을 바꾸면 **재생성 없이 즉시 반영된다.** 합성은 로컬 연산(세트 전체 약 0.5초)이고 API 비용이 없기 때문이다.

`useTilemapProcessing`에는 **관심사가 다른 두 이펙트**가 있다. 하나로 합치면 비동기 경합과 의존성 추적이 얽혀 재합성이 누락된다:

1. **저장소 복원** (`sheetIds`·`grid`·`mode` 의존) — imageStorage에서 머티리얼 시트를 읽어 **저장된** 경계 설정으로 합성하고, 원본 dataURL을 `materialSheetsRef`에 캐시한다.
2. **경계 설정 재합성** (`edgeStyle`·`outlineKey` 의존) — 캐시된 머티리얼 시트로 **패널의 현재 선택**으로 다시 합성한다. IndexedDB 왕복이 없어 체감상 즉시다. 컬러 피커가 드래그 중 값을 연속으로 쏘므로 120ms 디바운스한다. 진행 중에는 `isRecomposing`이 true가 되어 결과 뷰에 "재생성 아님" 토스트가 뜬다. 이 표시는 **레이아웃을 차지하지 않는 떠 있는 토스트여야 한다** — 인라인 배너로 두면 경계 설정을 만질 때마다 배너가 생겼다 사라지며 아래 보기 영역이 밀려 화면이 출렁이고, 아웃라인을 조금씩 바꿔가며 결과를 비교하는 이 기능의 사용 흐름 자체가 깨진다.

`outlineKey`는 `makeOutlineKey(outline, outline2)`가 만드는 내용 기반 문자열이다(아웃라인은 객체라 매 렌더 새 참조라서 의존성으로 바로 못 쓴다). **`TilemapOutline`에 필드를 추가하면 반드시 여기에도 넣어야 한다** — 빠뜨리면 그 값 변경이 재합성을 트리거하지 못한다.

세 번째 이펙트가 패널 선택을 `tilemapData`에 영속화한다(재진입 시 복원용).

## signature 테이블

- 8비트 이웃 마스크(`NEIGHBOR.N=1, NE=2, E=4, SE=8, S=16, SW=32, W=64, NW=128`)
- **정규화**: 대각 비트는 인접 두 변이 **모두** 오버레이일 때만 의미가 있다(그때만 오목 코너가 생긴다). 나머지는 버린다.
- `4x4`(16슬롯) → 4비트 축약 **16종** 정확히 대응. 대각을 구분하지 않아 오목 코너 없음
- `8x8`(64슬롯) → blob 축약 **47종** + 남는 **17슬롯은 변형 타일**
  - 47종 유도: 변 조합 16가지의 유효 대각 수 d에 대해 2^d 합 = 1 + 4 + (4x2) + 2 + (4x4) + 16 = 47
- **변형이 계약을 깨지 않는 이유**: 변형은 warp 시드만 다르고, warp는 변에서 0이므로 변 위의 지형 판정이 동일하다. 유니티 Rule Tile의 `Output: Random`으로 묶어 쓰면 반복 리듬이 완화된다.
- 뱃지 라벨은 `describeSignature`가 signature에서 파생한다(v2의 고정 14종 열거형 대체). 방향은 **베이스가 보이는 쪽**을 가리킨다: `고립`·`끝단→`·`통로↔`·`코너↖`·`엣지↑`·`오목↘`·`채움`

## 미리보기 == 유니티

`TilePreviewCanvas`는 `signatureFromMap` → `signatureToSlot`으로 **생성 단계와 같은 표**를 조회한다. 별도 규칙을 손으로 짜지 않으므로 미리보기와 유니티 Rule Tile의 동작이 구조적으로 일치한다. 베이스 셀은 전용 베이스 타일로 그린다.

### 조작
전체 화면 모달(97vw x 95vh), 맵 24x16, 줌 0.5x·1x·2x.

| 조작 | 동작 |
|---|---|
| 좌클릭 드래그 | 현재 도구(칠하기/지우개) |
| **Alt + 드래그** | 도구와 무관하게 즉시 지우기 |
| **가운데 클릭 드래그** | 패닝 |
| **Space + 드래그** | 패닝 |
| Esc | 닫기 |

**드래그/패닝 진행 플래그는 반드시 `ref`로 둔다.** state로 두면 mousedown 직후 첫 mousemove가 아직 이전 렌더의 값(false)을 읽어 한 프레임 동안 패닝 대신 칠하기가 된다. 커서 모양 표시용으로만 별도 state를 둔다. (dev 하네스에서 합성 이벤트로 재현·검증했다)

가운데 클릭은 `e.preventDefault()` + `onAuxClick` 억제가 필요하다 — 안 하면 브라우저 자동 스크롤이 끼어든다. 창 포커스를 잃으면 `keyup`을 놓치므로 `blur`에서 플래그를 풀어준다.

## 화풍 지정 = 참조 이미지 (스타일 프리셋은 제거됨)

한때 10종 아트 스타일 드롭다운(카툰·수채화·벡터·셀 셰이딩 등)이 있었으나 **제거했다.** 재발 방지를 위해 이유를 남긴다.

룰타일 프롬프트는 재질 스와치에 대해 `NO large shapes, NO paths, NO objects, NO scattered focal details` — "풍경이 아니라 천 조각" 을 요구한다. 그런데 **벡터·셀 셰이딩·라인아트·아이소메트릭의 정체성은 형태와 윤곽선에 있다.** 형태를 금지한 스와치에서는 표현할 것이 남지 않아 색조만 살짝 다른 같은 필드가 나왔고, 결과물이 "같은 이미지에 포토샵 필터를 먹인" 수준이었다. 프롬프트 조정으로 해결되는 문제가 아니다(스와치의 형태 금지는 파이프라인의 전제다).

**대체 경로**: 참조 이미지. 타일맵 전용 분석(`TILEMAP_ANALYZER_PROMPT`)이 붓터치·팔레트·디테일 밀도·시점·경계 부드러움·광원 방향을 뽑아 `analysis.tilemap_specific`에 담고, 두 모드 프롬프트가 이를 `styleSpec` 섹션으로 삽입한다. 캔에 담긴 프리셋보다 정확하다.

> 다시 스타일 프리셋을 넣고 싶어지면: 질감 기반 스타일(수채화·과슈·리얼리티·픽셀아트)만 표현 가능하고, 형태 기반은 **지형 경계 렌더링 분기**(프린지 on/off·warp 진폭·코너 반경)까지 구현해야 의미가 생긴다.

## 내보내기

`~/Downloads/AI_Gen/{세션명}/tilemap_{yymmdd_HHMMSS}/` 에 `tilesheet.png` + `tiles/tile_NN.png` + (룰타일이면) `tiles/tile_base*.png` + `IMPORT_GUIDE.txt`.

**전부 PNG이고 알파가 보존된다.** 타일은 `canvas.toDataURL('image/png')` 결과이고 `dataUrlToBytes`가 재인코딩 없이 그대로 파일에 쓴다 — 중간에 canvas로 다시 그리거나 JPEG로 변환하면 투명 영역이 흰색으로 굳는다. "투명 지형" 게이트가 산출 타일이 실제 PNG 바이트인지까지 확인한다.

결과 뷰 "시트 보기"의 **다운로드 버튼**도 실제 바이트 포맷을 따라 `.png`로 저장한다 — 예전에는 세션 타입 목록으로 확장자를 골라 투명 PNG를 `.jpg`로 내보냈다(`wiki/generator/overview.md`의 "저장 확장자" 절).

폴더명 타임스탬프는 `formatExportStamp()`가 **로컬 시각** 기준 `yymmdd_HHMMSS`로 만든다(예: 2026-08-27 13:44:55 → `tilemap_260827_134455`). epoch 밀리초는 사람이 읽을 수 없어 폴더 정렬·식별이 어려웠다.

### 세션 폴더에 남는 파일
타일맵 세션 폴더(`~/Downloads/AI_Gen/{세션명}/`)에는 **`tilemap_{타임스탬프}/` 폴더만** 생긴다.

다른 세션이 하는 공통 자동 저장(`style-studio-{epoch}.jpg` — AI 원본을 세션 폴더에 그대로 떨어뜨림)은 TILEMAP에서 **의도적으로 건너뛴다**(`ImageGeneratorPanel`의 `sessionType !== 'TILEMAP'` 가드). 타일맵에서 AI 원본은 최종 산출물이 아니기 때문이다 — 룰타일이면 재질 스와치 3패널, 변형이면 분할 전 시트다. 폴더와 나란히 놓이면 "시트 이미지와 동기화되지 않은 잉여 파일"로 보인다. AI 원본이 필요하면 히스토리(imageStorage)에 그대로 남아 있고, 시트 보기의 다운로드 버튼으로 언제든 저장할 수 있다.

> 이 가드를 제거하면 내보내기 폴더 옆에 잉여 jpg가 다시 생긴다.

### 자동 내보내기
생성이 끝나고 **슬롯 전체가 확정되면** `ImageGeneratorPanel`이 곧바로 `exportTilemapForUnity`를 호출한다. 교체 제안 대기 상태(variation 모드의 선택 재생성)에서는 최종 상태가 아니므로 건너뛴다.

- `processNewSheet`가 확정 payload(`{tiles, baseTile, grid, mode}`)를 **반환**한다. `onTilemapDataChange` → 리렌더는 비동기라 호출부가 `currentTiles`를 바로 읽을 수 없기 때문이다. 여기서 `tilemap.currentTiles`를 읽으면 이전 세트가 나간다.
- 자동 내보내기 실패는 `alert`을 띄우지 않고 로그만 남긴다 — 생성 결과를 잃게 하면 안 되고, 사용자는 "유니티 내보내기" 버튼으로 재시도할 수 있다.
- 내보낸 폴더는 결과 뷰 상단에 초록 배너로 표시된다(`autoExportFolder` prop). 다음 생성 시작 시 초기화된다.

## 시트 보기 = 내보내기 결과

결과 뷰의 "시트 보기"는 AI 원본이 아니라 `composeFinalSheet`로 만든 **합성 시트**를 표시한다. 이게 곧 내보내는 `tilesheet.png`다.

- AI 원본을 띄우면 실제 산출물과 다르다. 특히 룰타일은 원본이 **머티리얼 시트**(재질 스와치 3패널)라 완전히 다른 그림이다.
- `useTilemapProcessing`이 `composedSheet`를 파생하고(`currentTiles` 내용 변화에 반응), 결과 뷰는 `composedSheet ?? generatedImage`를 쓴다.
- 시트 보기의 다운로드 버튼(`handleManualSave`)도 **화면에 보이는 이미지**를 저장한다. TILEMAP이면 `composedSheet`를 저장하도록 분기되어 있다 — 표시와 저장이 어긋나면 안 된다.

룰타일 가이드의 3x3 규칙 표는 `buildRuleGrid`가 signature 비트에서 **자동 생성**한다(This / Not / Any). 의미 없는 대각은 반드시 `Any`(화살표 미클릭)여야 하며, This/Not으로 고정하면 매칭이 실패한다.

## 성능 함정 (실측으로 확인)

- **옵션 해석은 픽셀 루프 밖에서 한 번만.** SDF는 픽셀마다 호출된다(8x8 세트 = 100만회). `resolveMaskOptions`로 미리 풀어 `terrainSDFResolved`/`warpedTerrainSDFResolved`에 넘긴다. 편의 래퍼(`terrainSDF`/`warpedTerrainSDF`/`warpOffset`)는 루프 밖에서만 쓴다. 오목 코너 판정도 배열 리터럴 없이 네 코너를 직접 전개한다.
- **`setTimeout(0)`으로 양보하면 안 된다.** 백그라운드 탭에서 setTimeout은 **1초로 클램프**되므로 타일당 1회 양보 x 64장 = 64초가 된다. `MessageChannel` 메시지는 스로틀 대상이 아니라 즉시 돌아온다(`ruleTileComposer.yieldToEventLoop`). 실측: 합성 계산 자체는 세트 전체가 **0.5초**다(SDF 16384회 = 5.8ms, toDataURL 1.5ms/타일).

## 검증 (dev 전용)

`npm run dev` 후 `http://localhost:1420/dev/tilemap-check.html`. 프로덕션 번들에는 포함되지 않는다.

단계별 게이트 21건:
1. `makeSeamless` wrap 연속성 — 판정은 **분위수 기준**(경계 스텝 ≤ 내부 스텝 P95). "좌열==우열 픽셀 동일"은 열 중복을 뜻하므로 틀린 기준이고, 내부 *평균* 대비 배수도 틀린 기준이다(크로스페이드가 기울기를 위치별로 재분배함)
2. 엣지 계약 전수 — 인접 쌍 2048건, 베이스 이웃 변 512건, 전이 위치 768건
3. signature 테이블 — 16/47종, 축약 멱등성, raw 256종 슬롯 해석
4. 합성 타일 접합 연속성 — 실제 12x8 맵 배치 후 접합부 스텝 vs 타일 내부 스텝 P95
5. 경계 품질 — 중간색 픽셀 비율(선명도) + 아웃라인 접합 연속성
6. 경계선 프리셋 9종 정합성·형태 상이성
7. 재질 변형 — 변 픽셀 동일성 + 내부 랜덤성
8. 계단식 아웃라인 — 단방향·순서·폭 (SDF 재계산 대조)
9. 투명 지형 — 알파 0 · 검은 테두리 없음 · 아웃라인 관통

## 회귀 증상별 원인

| 증상 | 원인 |
|------|------|
| 룰타일이 서로 안 이어짐 / 격자선이 보임 | 계약 위반. `dev/tilemap-check.html`을 먼저 돌려 어느 게이트가 깨졌는지 확인. `TRANSITION_INSET_RATIO`를 바꿨거나, warp가 변에서 0이 아니게 됐거나(`warpEdgeFalloffRatio`), 오목 반경이 `k`가 아니게 된 경우가 대부분 |
| 1칸 폭 통로/고립 셀이 사라짐 | 인셋이 T/2로 되돌아갔다. `TRANSITION_INSET_RATIO`는 0.25여야 한다 |
| 미리보기가 유니티와 다르게 나옴 | 미리보기가 `signatureToSlot`이 아닌 자체 규칙을 쓰고 있다. 두 곳이 같은 표를 봐야 한다 |
| 미리보기 배경이 회색 박스 | `baseTile`이 전달되지 않았다. 훅 → 결과 뷰 → 미리보기 순으로 prop 연결 확인 |
| 재질에 유령/겹침이 보임 | `makeSeamless` 크로스페이드가 디테일을 두 위치에 겹친 것. 입력은 **디테일 없는 균질 필드**여야 한다 — 프롬프트 규칙 2가 약해졌는지 확인 |
| 경계 물결이 타일 크기로 반복됨 | 구조적 한계(warp가 모든 타일에서 동일해야 계약이 성립). 8x8의 변형 슬롯을 유니티에서 `Output: Random`으로 묶어야 완화된다 |
| 기존 룰타일 세션이 이상함 | `composerVersion`이 없는(v2 이전) 세트다. `needsRecompose`가 true — 재생성이 필요하다 |
| 내보낸 시트에 교체 타일이 반영 안 됨 | `exportTilemapForUnity`는 원본 시트가 아니라 `composeFinalSheet`로 현재 `currentTiles`를 재합성한다 |
| 시트 보기가 내보내기 결과와 다름 | 시트 보기는 `composedSheet`를 써야 한다. `generatedImage`(AI 원본)로 되돌아갔는지 확인 — 룰타일은 원본이 머티리얼 시트라 완전히 다른 그림이다 |
| 자동 내보내기가 이전 세트를 내보냄 | 자동 내보내기가 `tilemap.currentTiles`를 읽고 있다. 상태 반영이 비동기이므로 `processNewSheet`의 **반환값**을 써야 한다 |
| 자동 내보내기가 안 됨 (variation) | 교체 제안 대기 상태다 — 최종 상태가 아니므로 의도적으로 건너뛴다. 확정 후 수동 내보내기 버튼을 쓰면 된다 |
| 경계가 얼버무려짐 / 반투명하게 섞인 느낌 | 알파 블렌딩이 되살아났다 — 위 "경계 렌더링" 절. `dev/tilemap-check.html`의 "경계 선명도" 게이트가 잡아낸다 |
| 결과물이 흐릿함 | 두 가지가 원인이었고 v2 합성기에서 고쳤다: ① 재질을 타일 크기로 **다운스케일**하던 것을 1:1 크롭으로 교체 ② `makeSeamless` 코사인 창이 하필 `t=0.25`(= 인셋 `k=T/4`, 지형 경계가 지나가는 자리)에서 50:50 블렌딩이라 경계가 뭉개졌던 것을 **평탄부를 가진 창**으로 교체. 두 지점을 되돌리면 흐림이 재발한다 |
| 지형을 바꿰도 경계 모양이 똑같음 | 경계선 프리셋을 안 바꾼 것 — 설정 패널의 "경계선 모양" 썸네일 드롭다운 |
| 64장이 전부 같은 재질로 보임 | 텍스처 변형이 죽었다 — 위 "재질 랜덤성" 절. `dev/tilemap-check.html`의 "재질 변형" 게이트가 내부 상이성 하한(평균 차 2)으로 잡는다. 스와치가 균질을 넘어 **완전 단색**이면 변형해도 차이가 없는 게 정상이다 |
| 변형을 넣었더니 격자선이 다시 보임 | 변형의 변 픽셀이 정규 텍스처와 어긋났다(`EDGE_HOLD_PX`/`VARIANT_RAMP_RATIO`를 건드렸거나 `crop`을 변까지 덮게 만든 경우). "재질 변형" 게이트의 변 픽셀 검사가 잡는다 |
| 각진 프리셋인데 여전히 부드러움 | `angular` 플래그가 `valueNoise`까지 전달되지 않았다 — `computeWarp`가 네 옥타브 + 블레이드 전부에 `ang`를 넘겨야 한다 |
| 아웃라인이 하나만 보임 | 보조 띠 UI가 1단계 `enabled`에 종속이라 1단계가 꺼져 있으면 노출되지 않는다. 또는 2단계 폭이 0이다 |
| 두 아웃라인이 서로를 감싼다 | 대칭(`|SDF| < 반두께`) 방식으로 되돌아갔다 — 위 "계단식 단방향 띠" 절. `dev/tilemap-check.html`의 "계단식 아웃라인" 게이트가 잡는다 |
| 두 띠 사이에 반투명한 1px 선이 보인다 | 띠를 순차 source-over 하고 있다. `sampleOutline`로 기여분을 합산한 뒤 한 번에 얹어야 한다 |
| 아웃라인이 예전보다 두 배 굵다 | `thicknessPx`가 양쪽 합에서 **한쪽 폭**으로 바뀌었다 — 값을 절반으로 줄이면 예전과 같다 |
| 아웃라인 투명도를 바꿔도 반영 안 됨 | `makeOutlineKey`에 `opacity`가 빠졌다 — 위 "즉시 반영" 절 |
| 룰타일인데 4x4로 생성됨 | 8x8 강제 이펙트가 빠졌다 — `ImageGeneratorPanel`의 `tilemapMode === 'ruletile'` → `TILEMAP_RULETILE_GRID` 되돌림 |
| 투명 지형 경계에 검은 테두리가 생김 | 합성이 스트레이트 알파로 되돌아갔다 — 위 "투명 지형" 절. `dev/tilemap-check.html`의 "투명 지형" 게이트가 휘도로 잡는다 |
| 지형을 비웠는데 투명이 안 됨 | 보유 세트는 `tilemapData.transparentBase/Overlay`(생성 시점 값)를 따른다 — 필드를 지운 것만으로는 안 바뀌고 **재생성해야** 한다 |
| 투명 베이스인데 아웃라인이 반쪽만 나옴 | 아웃라인이 알파를 건드리지 않고 색만 덮고 있다 — source-over(`pa = cover + pa*keep`)여야 한다 |
| 투명 타일이 흰색으로 보임 | 체커보드 배경(`CHECKER_BG`)이 빠졌다. PNG 자체는 알파 0이 맞는지 게이트로 확인 |
| 지형 하나만 입력했는데 시트가 좌우 2분할로 나옴 | 프롬프트의 solo 분기가 빠졌다 — `generateTilemapRuleTilePrompt`의 `soloTerrain` |
| 아웃라인이 타일 경계에서 끊김 | SDF **크기**가 공유 변에서 어긋난 것. `dev/tilemap-check.html`의 "경계 품질" 게이트가 잡는다 |
| 경계 설정을 바꿀 때마다 화면이 위아래로 출렁임 | "재합성 중" 표시가 인라인 배너로 되돌아갔다 — 떠 있는 토스트(`absolute` + `pointer-events-none`)여야 레이아웃이 밀리지 않는다 |
| 경계선/아웃라인 변경이 타일 보기에 안 반영됨 | 재합성 이펙트가 저장소 복원 이펙트와 합쳐졌는지 확인 — 위 "즉시 반영" 절의 두 이펙트 분리가 전제다 |
| 미리보기에서 패닝 첫 프레임이 칠해짐 | 진행 플래그가 state로 되돌아갔다 — 위 "조작" 절 |
| 룰타일 생성/설정 변경이 수십 초 걸림 | `setTimeout` 양보가 되살아났다 — 위 "성능 함정" 절 |
| 화풍이 마음에 안 듦 | 스타일 프리셋은 제거됐다 — 참조 이미지를 쓴다(위 "화풍 지정" 절) |
| 내보내기 폴더 옆에 잉여 jpg가 생김 | 공통 자동 저장 가드(`sessionType !== 'TILEMAP'`)가 풀렸다 — 위 "세션 폴더에 남는 파일" 절 |
| 선택 재생성·교체·락이 동작 안 함 (룰타일) | 의도된 동작. 룰타일은 역할 고정 세트라 `requestReplacement`/`confirmProposal`/`discardProposal`/`toggleLock`이 `effectiveMode === 'ruletile'`이면 전부 no-op |
| 그리드/모드 바꿨는데 이전 타일이 남아있음 | 다음 **생성 실행 시점**에만 리셋된다(`processNewSheet`의 `setChanged` 체크) |
| 재진입 시 회색 박스만 표시 | `tilemap-sheet-*` imageStorage 키 유실 — 콘솔의 "⚠️ 타일 시트 이미지 미발견" 확인. 세션 삭제 시 이 키들은 정리되지 않아 orphan으로 남을 수 있음 |
| 미리보기 캔버스 버튼이 비활성화됨 | `currentTiles`에 `null`이 있으면 비활성 — 모든 슬롯이 채워져야 열림 |
| 비율/해상도 선택 UI가 안 보임 | 의도된 동작 — TILEMAP은 1:1·1K 고정 |
| 모델/품질/고급 설정 UI가 안 보임 | 의도된 동작 — TILEMAP은 덕테이프·medium 고정 (위 "고정값" 절). 바꿀 수 없는 값은 표시하지 않는다 |
| 룰타일에서 그리드 버튼이 안 보임 | 의도된 동작 — 룰타일은 8x8 고정 (위 "고정값" 절) |
| 타일맵 생성이 API 키 오류로 실패 | 덕테이프는 OpenAI 키를 쓴다. Gemini 키만 있으면 타일맵은 생성되지 않는다 |

---

# 변형(variation) 모드

한 재질(예: 잔디)의 타일 N장을 서로 seamless하게 만들어 임의 배치하는 모드. **v3 변경 사항 없음.**

## 핵심 흐름
1. `processNewSheet`: 시트를 `sliceTileSheet`로 분할 → `computeSeamScores`로 타일별 이음새 점수(0~100) → `imageStorage`에 시트 저장 → 전체 할당 또는 교체 제안
2. 선택 재생성: `TilemapResultView`에서 슬롯 선택 → `requestReplacement(slotIndexes)`로 대기열 설정 후 **통상 생성을 다시 실행해야** `processNewSheet`가 교체 제안 분기를 탄다
3. 결과는 `proposal`(파란 "교체 예정" 리본)로 미리 보이고 확정/취소 선택. `locked: true` 슬롯은 대상에서 제외
4. 그리드/모드 변경 시 다음 생성에서 풀 리셋(`setChanged`)

## 프롬프트
`generateTilemapVariationPrompt`의 **타일링 규칙 7조**: 균질 베이스 · 조용한 경계 존(외곽 15%) · 약 절반은 순수 베이스로 남기고 나머지는 디테일을 매번 다른 오프셋에(정중앙 금지) · NO GRID LINES · 일관 조명 · 손맵 채색 강제 · 셔플 후 규칙적 도트 패턴이 보이면 실패.

## 회귀 증상
| 증상 | 원인 |
|------|------|
| 타일이 안 이어짐 / seam 경고가 많음 | seam 점수는 RGB 경계 스트립 비교 **휴리스틱**(alpha 무시, `SEAM_ENERGY_WORST=64`로 정규화)이라 실제 시각 이음새와 완전히 일치하지 않는다. 모델이 타일링 규칙을 안 지킨 게 더 근본 원인 — **변형 모드는 구조적 보장이 없다**(룰타일과 달리) |
| 락 슬롯인데도 교체됨 | 락은 `processNewSheet`의 교체 대상 필터에서 걸러진다 — 락을 켠 *이후*에 재생성해야 하며 진행 중인 `proposal`에는 소급 적용 안 됨 |
| 시트가 정사각형이 아닌데 분할이 이상함 | `sliceTileSheet`가 짧은 변 기준 중앙 crop 후 분할한다 — 동작은 하지만 crop 밖은 손실 |
