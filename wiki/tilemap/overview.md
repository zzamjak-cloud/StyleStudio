# 타일맵 (Tilemap)

유니티 Tilemap용 타일 세트를 생성하는 세션. 그리드는 **4x4(16타일)·8x8(64타일)만 지원**, 비율·해상도는 **1:1·1K로 고정**(다른 세션과 달리 `GeneratorSettings`에서 비율/크기 선택 UI 자체가 숨겨짐). 두 가지 모드가 있고, **모드에 따라 파이프라인이 완전히 다르다**.

| 모드 | AI에게 받는 것 | 코드가 하는 것 | 타일 상호 교환 |
|------|---------------|---------------|---------------|
| `variation` | 타일 N장이 그리드로 배치된 **타일 시트** | 그리드 분할(`sliceTileSheet`) + seam 점수 | 프롬프트 준수에 의존(보장 없음) |
| `ruletile` | 재질 2종 + 프린지가 담긴 **머티리얼 시트** | 지형 경계를 **절차적으로 합성**(`ruleTileComposer`) | **계약으로 보장**(전수 증명됨) |

타일은 개별 파일로 저장하지 않으며, **시트 이미지 + slotAssignments 매핑만 영속화**하고 타일은 매번 런타임에 재구성한다(variation은 분할, ruletile은 합성).

## 관련 파일

### 공통
- `src/types/tilemap.ts` — 타입·상수. `TilemapGridLayout`(`'4x4'|'8x8'`), `TilemapMode`, `TILEMAP_SEAM_WARNING_THRESHOLD = 70`, `TilemapSheet`(모드에 따라 타일 시트/머티리얼 시트), `TileSlotAssignment`, `TilemapSessionData`(`composerVersion` 포함), `isTilemapGridLayout`
- `src/hooks/useTilemapProcessing.ts` — 후처리 훅. 재진입 복원 `useEffect`(모드별로 분할/합성 분기), `currentTiles`·`baseTile`·`needsRecompose` 파생, `processNewSheet`, `requestReplacement`/`confirmProposal`/`discardProposal`/`toggleLock`(룰타일이면 전부 no-op)
- `src/lib/tilemap/tilemapExporter.ts` — `exportTilemapForUnity`(시트 재합성 + 개별 PNG + 룰타일이면 `tiles/tile_base.png` + 가이드), `composeFinalSheet`, `buildRoleTable`·`buildRuleGrid`(signature → 유니티 3x3 규칙 표 자동 생성)
- `src/components/tilemap/TilemapResultView.tsx` — 결과 뷰. 시트/타일 뷰 토글, 뱃지(룰타일은 `describeSlot`, variation은 seam 점수), 락·선택·제안 액션바
- `src/components/tilemap/TilePreviewCanvas.tsx` — 배치 미리보기 **전체 화면 모달**(24x16 맵, 스탬프/지우개/랜덤 채우기, 줌 0.5x·1x·2x, 패닝). 맵 상태 비저장. 룰타일이면 `signatureFromMap` → `signatureToSlot`으로 생성 단계와 **같은 표**를 조회
- `src/components/tilemap/EdgeStylePicker.tsx` — 경계선 모양 썸네일 드롭다운 + 아웃라인(두께·색) 설정
- `dev/tilemap-preview.html` + `dev/tilemap-preview.tsx` — 미리보기 캔버스 dev 하네스(합성 재질로 세트를 만들어 실제 조작 검증)
- `src/lib/prompts/sessionPrompts.ts` — `generateTilemapPrompt`(모드 분기), `generateTilemapVariationPrompt`, `generateTilemapRuleTilePrompt`. `buildPromptForSession`이 `sessionType === 'TILEMAP'`이면 참조 유무와 무관하게 최우선 분기
- `src/lib/gemini/analysisPrompt.ts` — `TILEMAP_ANALYZER_PROMPT`(손맵 텍스처 전용 분석, character 필드는 전부 `N/A`)
- `src/components/analysis/TilemapCard.tsx` — `tilemap_specific` 분석 편집 카드
- `src/components/generator/GeneratorSettings.tsx` — TILEMAP 전용 그리드·모드 토글, 룰타일 지형 2필드. 비율·크기 UI를 `sessionType !== 'TILEMAP'`로 숨김

### variation 전용
- `src/lib/tilemap/tileSlicer.ts` — `sliceTileSheet`(실측 크기 기준 중앙 crop 후 그리드 분할), `loadImageElement`
- `src/lib/tilemap/seamValidator.ts` — `computeSeamScores`(타일 4변 경계 스트립 색 비교 휴리스틱)

### ruletile 전용 (v3 절차적 합성 파이프라인)
- `src/lib/tilemap/seamlessTexture.ts` — **1단계**. `extractRegion`, `makeSeamless`(분리형 주기 크로스페이드), `measureWrapContinuity`
- `src/lib/tilemap/edgeProfile.ts` — **2단계**. `NEIGHBOR` 8방향 비트, `TRANSITION_INSET_RATIO`, `terrainSDF`, `warpOffset`, `warpedTerrainSDF`, `buildTerrainMask`, `borderTerrainProfile`(검증용), `signatureFromMap`
- `src/lib/tilemap/autotileSignature.ts` — **3단계**. `reduceToBlob`/`reduceToSides`, `SIGNATURES_4BIT`(16종)·`SIGNATURES_BLOB`(47종), `buildSlotTable`, `buildSignatureIndex`, `signatureToSlot`, `describeSignature`/`describeSlot`, `BASE_TILE_FILENAME`
- `src/lib/tilemap/ruleTileComposer.ts` — **4단계**. `buildRuleTileSet`, `COMPOSER_VERSION`
- `src/lib/tilemap/tilemapSelfCheck.ts` + `dev/tilemap-check.html` — 단계별 게이트 검사(dev 전용)

## 생성 모델 고정 (덕테이프)

TILEMAP은 `TILEMAP_FIXED_IMAGE_MODEL = 'gpt-image-2'`(덕테이프)로 **고정**이며 모델 드롭다운을 노출하지 않는다(`GeneratorSettings`가 읽기 전용 표시로 대체). 타일맵은 프롬프트가 지정한 레이아웃을 정확히 지켜야 하는데(변형=NxN 그리드, 룰타일=머티리얼 시트 3패널) 나노바나나 계열은 이를 자주 무시해 사용할 수 없는 결과를 냈다.

- `ImageGeneratorPanel`이 초기값을 덕테이프로 잡고, **어긋나면 되돌리는 이펙트**도 둔다 — 히스토리 복원 등으로 다른 모델이 들어와도 사용자가 드롭다운으로 되돌릴 방법이 없기 때문이다.
- **고급 설정 블록 전체를 숨긴다** — 덕테이프는 Seed/Temperature/Top-K/Top-P를 지원하지 않는다.
- OpenAI 키가 없으면 모델 표시 아래에 경고를 띄운다(드롭다운이 없어 기존 안내 문구가 노출되지 않으므로).

## 데이터 모델

```
TilemapSessionData = {      // Session.tilemapData
  grid: '4x4' | '8x8'
  sheets: TilemapSheet[]           // 시트 이미지 키 목록 (imageStorage: tilemap-sheet-{id})
  slotAssignments: TileSlotAssignment[]  // 슬롯 수 = 현재 grid의 totalFrames
  mode?: 'variation' | 'ruletile'  // 미지정 시 'variation' (v1 세션 호환)
  baseTerrain?: string             // 룰타일: 베이스 지형 입력 원문
  overlayTerrain?: string          // 룰타일: 오버레이 지형 입력 원문
  composerVersion?: number         // 룰타일: 합성 알고리즘 버전. 없거나 다르면 재생성 필요
  edgeStyle?: TilemapEdgeStyle     // 룰타일: 경계선 모양 프리셋 (미지정 시 'blades')
  outline?: TilemapOutline         // 룰타일: 경계 아웃라인 {enabled, thicknessPx, color}
}
```

- **타일은 저장하지 않는다.** `sheets`와 `slotAssignments`만 영속화하고, 실제 타일 PNG는 세션 진입 시 휘발성 `tileCache`(`sheetId → 타일 dataURL[]`)로만 재구성한다.
- 룰타일의 **베이스 타일**(순수 베이스 지형)은 그리드 슬롯 밖의 별도 타일이다. `baseTileCache`에 따로 들고 있으며, 내보내기에서 `tiles/tile_base.png`로 나간다.
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

[코드] 1) cropMaterialSwatch(1:1 크롭) + makeSeamless → wrap 연속 텍스처 2장 (크기 = cellSize)
       2) buildSlotTable(grid)로 슬롯 배치 결정
       3) 슬롯마다 warpedTerrainSDFResolved 부호로 베이스/오버레이 **이진 결정** (1px AA만)
          + 아웃라인이 켜져 있으면 |SDF| < 반두께를 지정 색으로 덮음
       4) 순수 베이스 텍스처 = 베이스 타일 (슬롯 밖)
```

**모든 타일이 텍스처를 오프셋 (0,0)으로 동일하게 샘플링**한다. 두 타일을 나란히 놓으면 접합부가 그 텍스처 자신의 wrap 경계와 정확히 같은 지점이 되어 이어진다. 이게 교체 가능성의 두 번째 축이다(첫 번째는 엣지 계약).

## 경계 렌더링 — 섞지 않고 맞물린다

초기 구현은 경계 밴드(`k × 0.55`, T=128이면 편측 약 17px)에서 AI가 그린 프린지 색을 **알파 블렌딩**했다. 이건 잘못된 설계였다 — 알파 블렌딩은 원리적으로 두 텍스처의 **평균**을 만들므로, 참조 이미지를 아무리 선명한 것으로 바꿰도 그 밴드는 탁해진다("얼버무리는 느낌", "약간의 투명도가 있는 텍스쳐가 섞이는 느낌").

지금은 **이진 결정**이다:
- 픽셀마다 `warpedTerrainSDF` 부호로 베이스/오버레이를 정하고 **1px만 안티에일리어싱**한다. 그 이상 섞지 않는다.
- 손맵스러운 경계는 색을 섞어서가 아니라 `edgeProfile`의 **블레이드 옥타브**(`bladeAmplitudeRatio` 0.30 / `bladeFrequencyPx` 6)로 만든다 — 고주파·고진폭 변위가 두 지형을 손가락처럼 맞물리게 한다. 픽셀은 100% 베이스 또는 100% 오버레이이므로 탁해질 수 없다.
- 블레이드도 warp와 같은 창(`warpEdgeFalloffRatio`)을 곱하므로 타일 변에서 0 → **엣지 계약 유지**.
- 프린지 스트립 추출과 하단 전환 패널은 함께 제거했다. 덕분에 모델이 맞춰야 할 레이아웃이 2패널로 단순해지고 지형당 스와치 면적이 두 배가 됐다.

> 경계를 다시 부드럽게 하고 싶어도 **알파 블렌딩으로 돌아가면 안 된다.** `bladeFrequencyPx`를 키워(잔가지를 굵게) 조절한다.

전용 게이트가 있다: 순수 단색 재질 2종으로 합성해 **중간색 픽셀 비율**을 센다(현재 0.99%, 허용 3%). 밴드 블렌딩이 되살아나면 즉시 실패한다.

## 경계선 모양 프리셋 + 아웃라인

지형 경계는 코드가 만들므로, 재질과 **독립적으로** 모양을 고를 수 있다. 예전에는 어떤 지형을 뽑아도 경계 모양이 똑같았다.

- 프리셋 **7종**은 `lib/tilemap/edgeStyles.ts`에: 잔가지(기본)·굵은 맞물림·거친 찢김·물결·조약돌·매끈함·각진 형태. 각각 `TerrainMaskOptions`의 진폭·주파수·코너 반경만 다르다.
- 프리셋은 `types/tilemap.ts`의 `TilemapEdgeStyle` 문자열 유니온만 참조한다 — 프리셋 본체를 types에 두면 `edgeProfile.ts` ↔ `types/tilemap.ts` 순환 참조가 된다.
- **UI는 썸네일 드롭다운**(`components/tilemap/EdgeStylePicker.tsx`). 썸네일은 합성기와 **같은 `warpedTerrainSDFResolved`**로 그린다 — 색만 대표색으로 바꾸고 기하는 동일하다. 썸네일이 실제 결과와 어긋나면 눈으로 고르는 의미가 없어진다.
- **아웃라인**은 `|SDF| < 반두께`를 지정 색으로 덮는 하드 스텐실이다(1px 안티에일리어싱만). 두께는 셀 128px 기준이며 4x4(셀 256px)에서는 2배로 환산해, 유니티 PPU 128 임포트 시 세계 두께가 같게 보인다.
- 프리셋/아웃라인은 **계약을 깨지 않는다**: 변위장은 어떤 값이든 창에 의해 타일 변에서 0이 되고, 코너 라운딩은 인셋 라인에 접하므로 변 위 판정과 무관하다. 아웃라인은 SDF의 *크기*까지 공유 변에서 일치해야 선이 안 끊기는데, 변에서는 x 제약이 비활성이라 SDF가 y만의 함수로 줄어들어 일치한다 — 전용 게이트로 확인한다(불일치 0개).

### 즉시 반영
프리셋·아웃라인을 바꾸면 **재생성 없이 즉시 반영된다.** 합성은 로컬 연산(세트 전체 약 0.5초)이고 API 비용이 없기 때문이다.

`useTilemapProcessing`에는 **관심사가 다른 두 이펙트**가 있다. 하나로 합치면 비동기 경합과 의존성 추적이 얽혀 재합성이 누락된다:

1. **저장소 복원** (`sheetIds`·`grid`·`mode` 의존) — imageStorage에서 머티리얼 시트를 읽어 **저장된** 경계 설정으로 합성하고, 원본 dataURL을 `materialSheetsRef`에 캐시한다.
2. **경계 설정 재합성** (`edgeStyle`·`outlineKey` 의존) — 캐시된 머티리얼 시트로 **패널의 현재 선택**으로 다시 합성한다. IndexedDB 왕복이 없어 체감상 즉시다. 컬러 피커가 드래그 중 값을 연속으로 쏘므로 120ms 디바운스한다. 진행 중에는 `isRecomposing`이 true가 되어 결과 뷰 상단에 "재생성 아님" 표시가 뜬다.

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

`~/Downloads/AI_Gen/{세션명}/tilemap_{yymmdd_HHMMSS}/` 에 `tilesheet.png` + `tiles/tile_NN.png` + (룰타일이면) `tiles/tile_base.png` + `IMPORT_GUIDE.txt`.

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

단계별 게이트 13건:
1. `makeSeamless` wrap 연속성 — 판정은 **분위수 기준**(경계 스텝 ≤ 내부 스텝 P95). "좌열==우열 픽셀 동일"은 열 중복을 뜻하므로 틀린 기준이고, 내부 *평균* 대비 배수도 틀린 기준이다(크로스페이드가 기울기를 위치별로 재분배함)
2. 엣지 계약 전수 — 인접 쌍 2048건, 베이스 이웃 변 512건, 전이 위치 768건
3. signature 테이블 — 16/47종, 축약 멱등성, raw 256종 슬롯 해석
4. 합성 타일 접합 연속성 — 실제 12x8 맵 배치 후 접합부 스텝 vs 타일 내부 스텝 P95

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
| 아웃라인이 타일 경계에서 끊김 | SDF **크기**가 공유 변에서 어긋난 것. `dev/tilemap-check.html`의 "경계 품질" 게이트가 잡는다 |
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
| 모델/고급 설정 UI가 안 보임 | 의도된 동작 — TILEMAP은 덕테이프 고정 (위 "생성 모델 고정" 절) |
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
