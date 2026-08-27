# 타일맵 (Tilemap)

유니티 Tilemap용 **손맵(hand-painted) 변형 타일 세트**를 생성하는 세션. 한 재질(예: 잔디)의 타일 N장을 **모두 서로 seamless**하게(임의 순서로 이웃해도 이어지도록) 한 번에 만든다. 픽셀아트와 마찬가지로 "스프라이트 시트 = 프롬프트 지시"이며 그리드는 **4x4(16타일)·8x8(64타일)만 지원**, 비율·해상도는 **1:1·1K로 고정**(다른 세션과 달리 `GeneratorSettings`에서 비율/크기 선택 UI 자체가 숨겨짐). 생성된 시트는 클라이언트에서 그리드로 **분할(slice)**하고, 타일 4변의 경계색을 비교하는 **seam 점수(휴리스틱)**를 매겨 이음새 품질을 배지로 보여준다. 불량 타일은 새 시트를 추가 생성해 **선택 슬롯만 교체**할 수 있고, 락(lock)된 슬롯은 교체에서 제외된다. 타일은 개별 파일로 저장하지 않으며, **시트 이미지 + slotAssignments 매핑만 영속화**하고 타일은 매번 런타임에 시트를 분할해 재구성한다.

## 관련 파일

- `src/types/tilemap.ts` — 타입·상수. `TilemapGridLayout`(`:7`, `PixelArtGridLayout`의 부분집합 `'4x4'|'8x8'`), `TILEMAP_GRID_LAYOUTS`(`:10`), `TILEMAP_SEAM_WARNING_THRESHOLD = 70`(`:13`), `TilemapSheet`(`:16`), `TileSlotAssignment`(`:26`), `TilemapSessionData`(`:35`, `Session.tilemapData`), `isTilemapGridLayout`(`:42`)
- `src/hooks/useTilemapProcessing.ts` — 후처리 훅. 재진입 시 시트 로드·분할 복원(`:65` `useEffect`, 세션 전환 시 `proposal`도 함께 정리), `currentTiles` 파생(`:98`), `processNewSheet`(`:113`, 저장→분할→점수→전체할당 또는 교체 제안), `requestReplacement`(`:107`, ref로 대기), `confirmProposal`(`:174`)·`discardProposal`(`:193`)·`toggleLock`(`:211`)
- `src/lib/tilemap/tileSlicer.ts` — `sliceTileSheet`(`:19`, 실측 크기 기준 중앙 crop 후 그리드 분할), `loadImageElement`(`:5`)
- `src/lib/tilemap/seamValidator.ts` — `computeSeamScores`(`:79`, 타일 4변 경계 스트립 색 비교 휴리스틱). 상수: `EDGE_STRIP_PX=4`·`EDGE_SAMPLES=32`·`MAX_PARTNERS_PER_TILE=16`·`SEAM_ENERGY_WORST=64`(`:4-10`)
- `src/lib/tilemap/tilemapExporter.ts` — `exportTilemapForUnity`(`:113`, 시트 재합성 + 개별 PNG + 가이드 텍스트 저장, `mode` 파라미터로 가이드 분기), `composeFinalSheet`(`:22`, 교체 반영본 재합성), `buildRoleTable`(`:40`, 룰타일 모드 전용, (행,열)→역할 텍스트), `buildImportGuide`(`:54`, `mode`에 따라 variation/ruletile 분기)
- `src/lib/tilemap/ruleTileLayout.ts` — 룰타일 역할 좌표 테이블. `RuleTileRole`(`:8`, corner_*/edge_*/concave_*/fill/base 14종), `RULE_TILE_ROLE_LABELS`(`:15`, 한국어 뱃지 라벨), `ROLES_4X4`(`:26`, 16칸 행우선, 오목 없음), `ROLES_8X8`(`:40`, 64칸 행우선, 오목 4종 포함), `getRuleTileRoles(grid)`(`:52`), `pickRoleCell(roles, role, variant)`(`:60`, 동일 역할 다중 셀은 variant로 순환 선택, 없으면 -1)
- `src/components/tilemap/TilemapResultView.tsx` — 결과 뷰. 시트/타일 뷰 토글(`:44`), seam 배지·락 토글·선택 체크박스(`:200` 부근), 제안 확정/취소 액션바(`:289`/`:295`), 선택 재생성 버튼(`:312`). 룰타일 모드에서는 `getRuleTileRoles(grid)`로 슬롯별 역할 뱃지(`RULE_TILE_ROLE_LABELS`)를 표시(`:249-267`)하고 seam 배지 대신 이 역할 뱃지가 노출됨
- `src/components/tilemap/TilePreviewCanvas.tsx` — 배치 미리보기 모달(plain canvas, 12x8 맵, 스탬프/지우개/랜덤 채우기/줌 1x·2x). **맵 상태 비저장**(`:22` 주석). 룰타일 모드에서는 `resolveRuleTileCell`(`:30`)이 스탬프 대상 셀의 8방향 이웃을 검사해 알맞은 역할 타일을 오토타일처럼 자동 선택(`pickRoleCell` 기반, 이웃 정보 없으면 fill로 폴백)
- `src/lib/prompts/sessionPrompts.ts` — `generateTilemapPrompt`(`:667`), `buildPromptForSession`(`:76`)이 `sessionType === 'TILEMAP'`이면 참조 유무와 무관하게 최우선 분기(`:78-80`)
- `src/lib/gemini/analysisPrompt.ts` — `TILEMAP_ANALYZER_PROMPT`(`:428`, 손맵 텍스처 전용 분석 프롬프트, character 필드는 전부 `N/A - tilemap only`)
- `src/components/analysis/TilemapCard.tsx` — `tilemap_specific` 분석 편집 카드(재질·붓터치·팔레트·디테일 밀도·시점·경계 부드러움·광원 방향)
- `src/components/generator/GeneratorSettings.tsx` — TILEMAP 전용 그리드 블록(`:211`, `TILEMAP_GRID_LAYOUTS` 버튼), 비율(`:389`)·크기(`:420`) 선택 UI를 `sessionType !== 'TILEMAP'`로 숨김
- `src/types/session.ts` — `SessionType`에 `TILEMAP` 추가, `Session.tilemapData?: TilemapSessionData`
- `src/types/analysis.ts` — `TilemapSpecificAnalysis`, `ImageAnalysisResult.tilemap_specific?`

## 데이터 모델

```
TilemapGridLayout = '4x4' | '8x8'   // PixelArtGridLayout의 부분집합

TilemapSheet = {
  id: string
  imageKey: string        // imageStorage 키: `tilemap-sheet-{id}`
  createdAt: string       // ISO 8601
}

TileSlotAssignment = {
  slotIndex: number        // 0 ~ (타일 수-1), 행우선 — "이 슬롯에 무슨 타일이 배정됐는가"
  sheetId: string          // 어느 시트에서 왔는지
  cellIndex: number        // 그 시트 안의 몇 번째 셀인지 (행우선)
  seamScore?: number       // 0~100
  locked?: boolean         // 교체 재생성에서 보호
}

TilemapSessionData = {      // Session.tilemapData
  grid: TilemapGridLayout
  sheets: TilemapSheet[]           // 지금까지 생성된 모든 시트 (교체 이력 포함)
  slotAssignments: TileSlotAssignment[]  // 슬롯 수 = 현재 grid의 totalFrames
  mode?: TilemapMode               // 미지정 시 'variation' (v1 세션 호환)
  baseTerrain?: string             // 룰타일: 베이스 지형 입력 원문
  overlayTerrain?: string          // 룰타일: 오버레이 지형 입력 원문
}
```

- **타일 자체는 저장하지 않는다.** `sheets`(원본 시트 이미지들)와 `slotAssignments`(어느 슬롯이 어느 시트의 어느 셀인지)만 영속화하고, 실제 타일 PNG는 `useTilemapProcessing`이 세션 진입 시 시트를 `sliceTileSheet`로 **매번 런타임 분할**해 휘발성 `tileCache`(`sheetId → 타일 dataURL[]`)로만 들고 있는다.
- `TilemapGridLayout`은 `PixelArtGridLayout`(`types/pixelart.ts`)의 부분집합이라 `getPixelArtGridInfo` 등 픽셀아트 그리드 유틸을 그대로 재사용한다(4x4→cellSize 256, 8x8→cellSize 128, 둘 다 1024 캔버스 기준).

## 핵심 흐름

### 1) 생성 → 후처리 (`processNewSheet`)
1. 시트 dataURL을 `sliceTileSheet`로 그리드 분할 → 타일 dataURL 배열(행우선).
2. `computeSeamScores`로 타일별 이음새 점수(0~100) 계산.
3. `imageStorage`에 `tilemap-sheet-{id}` 키로 시트 저장(타일은 저장 안 함), `tileCache`에 즉시 캐시.
4. **분기**: `gridChanged`(그리드가 바뀌었거나 이전 데이터 없음)이거나 대기 중인 교체 슬롯이 없으면 → **전체 할당**(`onTilemapDataChange`로 새 시트가 모든 슬롯을 채움). 그리드가 바뀌었으면 `sheets`를 새 배열로 교체(이전 시트는 영속 데이터에서 제거, 히스토리에는 원본 이미지가 남아있어 잔존).
5. 대기 중인 교체 슬롯이 있으면 → **교체 제안**(`proposal` state에만 반영, 아직 `tilemapData`는 변경 안 함). 락된 슬롯은 대상에서 제외, 나머지 슬롯에 새 시트의 seam 점수 상위 셀부터 배정.

### 2) 선택 재생성 → 교체 제안 → 확정/취소
- `TilemapResultView`의 타일 보기에서 슬롯 체크박스로 선택 후 "선택 재생성" 클릭 → `onRegenerateSelected` → 상위(ImageGeneratorPanel)에서 `requestReplacement(slotIndexes)`로 대기열 설정 후 통상적인 생성 흐름(`processNewSheet`) 재실행.
- 결과는 `proposal`(파란 리본 "교체 예정" 배지)로 미리 보여지고, 하단 액션바에서 **확정**(`confirmProposal`: 대상 슬롯의 `sheetId`/`cellIndex`/`seamScore`를 갱신하고 새 시트를 `sheets`에 추가) 또는 **취소**(`discardProposal`: 저장했던 시트 이미지를 `imageStorage`에서 삭제하고 캐시 정리) 선택.
- `locked: true`인 슬롯은 `pending` 대상에서 걸러져 교체되지 않는다.

### 3) 그리드 변경 시 풀 리셋
- `processNewSheet`에서 `pixelArtGrid`(패널의 현재 그리드 선택)가 기존 `tilemapData.grid`와 다르면 `gridChanged = true` → 다음 생성이 **전체 할당**으로 강제되고 `sheets` 배열이 새 시트 하나로 교체된다. 이전 그리드의 시트 이미지는 세션 데이터에서 사라지지만(imageStorage 키 자체는 정리되지 않음), 히스토리 패널에는 원본 생성물이 남아 있다.

### 4) 미리보기 캔버스 (배치 시뮬레이션)
- `TilePreviewCanvas`는 12×8 맵에 현재 슬롯 타일들을 스탬프/랜덤 채우기로 배치해보는 **plain canvas 도구**. 세션 데이터와 완전히 분리된 컴포넌트 로컬 state(`mapCells`)이며 저장되지 않는다 — 육안 seam 확인용 임시 도구.
- 열기 버튼은 `currentTiles`에 `null`(미생성 슬롯)이 하나라도 있으면 비활성화된다.

### 5) 내보내기 (`exportTilemapForUnity`)
- 확정된 `currentTiles`(교체 반영 최종 상태)를 받아 `composeFinalSheet`로 그리드 크기에 맞춰 1024 시트를 **재합성**(원본 시트가 아니라 교체 이후 최종 배치를 다시 그림) 후 `~/Downloads/AI_Gen/{세션명}/tilemap_{timestamp}/`에 `tilesheet.png` + `tiles/tile_NN.png`(행우선, 2자리 zero-pad) + `IMPORT_GUIDE.txt`를 기록.
- `mode`(패널의 `tilemap.effectiveMode`) 파라미터가 가이드 내용을 분기한다. variation 모드는 기존과 동일한 Sprite Mode: Multiple 안내. ruletile 모드는 여기에 더해 `buildRoleTable`로 (행,열)→역할 표(`tile_NN.png` 파일명 병기)와 유니티 Rule Tile 설정 절차(2D Tilemap Extras 패키지 설치 → `Create > 2D > Tiles > Rule Tile` → Default Sprite=fill 역할 → 역할별 스프라이트에 3x3 화살표로 이웃 규칙 지정 → 4x4는 오목 코너가 없어 좁은 꺾인 길엔 8x8 권장 문구)가 추가된다.

## v2: 모드 (변형/룰타일)

타일셋 모드는 `TilemapMode = 'variation' | 'ruletile'`(`types/tilemap.ts:10`)이며, 패널의 그리드 블록 아래 모드 토글(`GeneratorSettings.tsx:227,231`)로 선택한다. 보유 세트의 실제 모드는 `tilemapData.mode` 우선, 없으면 `'variation'` 폴백(`useTilemapProcessing.effectiveMode`, `:59`) — v1 세션은 자동으로 variation 취급된다. 룰타일 모드 선택 시 패널에 베이스/오버레이 지형 2필드(예: "잔디"/"흙길")가 노출되고, 저장 시 `tilemapData.baseTerrain`/`overlayTerrain`으로 영속화된다.

### 구도 (룰타일 프롬프트)
`generateTilemapRuleTilePrompt`(`sessionPrompts.ts:731`)는 셀별 지시 없이 **거시 구도**만 지정해, 분할 후 `ruleTileLayout.ts`의 역할 테이블과 기하학적으로 맞아떨어지게 한다.
- **4x4(패치)**: 오버레이 지형이 캔버스 **12.5%~87.5%** 정사각 영역을 덮음(전환 밴드는 그 경계선 기준 편측 6% 폭). 모서리는 셀 반 개 정도의 라운드.
- **8x8(도넛)**: 외곽 전환선은 **6.25%~93.75%**(외곽 링 셀 중앙, 편측 밴드 3%)로 4x4와 다른 그리드 의존 수치를 쓴다(셀 폭이 8x8은 12.5%이므로 4x4와 같은 12.5% inset을 쓰면 셀 경계선과 겹쳐 어긋난다). 중앙에는 **31.25%~68.75%**(밴드 포함) 구멍을 뚫고, 그 안쪽 **37.5%~62.5%**는 순수 베이스로 남겨 베이스가 다시 드러남(구멍 전환 밴드도 같은 편측 3%, 31.25%/68.75% 선 중심) — 결과물은 오버레이 "도넛 링"이 베이스 위에 놓인 모양. 그리드별 상수는 `generateTilemapRuleTilePrompt`(`sessionPrompts.ts`)의 `inset`/`outset`/`bandHalf`에서 계산.

### `ruleTileLayout.ts` 좌표
- `ROLES_4X4`(16칸, 오목 없음): 모서리 4개 `corner_*`, 각 변 2칸씩 `edge_*`, 중앙 2x2 `fill`.
- `ROLES_8X8`(64칸, 오목 4종 포함): 외곽 링이 `corner_*`/`edge_*`, 중앙 2x2(행·열 3~4)가 순수 `base`, 그 사이 링이 `fill`이며 구멍 모서리 대각선 셀 4개가 `concave_*`(구멍의 NW 모서리를 담은 셀은 자신의 SE 사분면에 base가 보이므로 `concave_se`로 명명 — 대각 반대 방향 이름 규칙). 구멍 주변 내곽 `edge_*` 8칸은 외곽 `edge_*`와 같은 라벨이지만 반대 방향을 향한 변형(베이스가 안쪽에서 드러나는 전환)이다.
- `getRuleTileRoles(grid)`로 그리드별 역할 배열을, `pickRoleCell(roles, role, variant)`로 특정 역할의 셀 인덱스를 조회한다(동일 역할이 여럿이면 variant로 순환, 없으면 -1 → 호출부에서 fill 등으로 폴백).

### 모드별 동작 차이
보유 세트가 룰타일 모드이면 `useTilemapProcessing`의 여러 동작이 **이중 방어(no-op)** 로 비활성화된다: `requestReplacement`(`:107`)·`confirmProposal`(`:174`)·`discardProposal`(`:193`)·`toggleLock`(`:211`) 모두 `effectiveMode === 'ruletile'`이면 즉시 return — 패널의 다음 생성 목표 `mode`가 아니라 **보유 데이터의 `effectiveMode`** 기준이다(모드를 variation→ruletile로 바꾸는 도중에도 아직 보유한 세트가 variation이면 교체 UI가 계속 동작해야 하므로). seam 점수 계산은 다음 생성 목표 `mode`로 생략(`processNewSheet`의 `isRuletile` 분기, `:117`)하고 항상 **전체 할당**만 수행(교체 제안 없음). 모드를 전환하면 그리드 변경과 동일하게 `setChanged = true`가 되어 다음 생성 시 슬롯이 풀 리셋된다(`:130`). 세션 전환 시에는 `useEffect`(`:65`)가 캐시 교체와 함께 `proposal`도 초기화해, 다른 세션에서 대기 중이던 제안이 새 세션에 잘못 확정되는 사고를 막는다.

### 결과 뷰 역할 뱃지
`TilemapResultView`는 룰타일 모드에서 seam 배지 대신 `getRuleTileRoles(grid)`로 슬롯별 `RULE_TILE_ROLE_LABELS` 한국어 뱃지("코너↖", "엣지↑", "오목↘", "풀", "베이스" 등)를 표시한다.

### 미리보기 오토타일 스탬프
`TilePreviewCanvas`의 `resolveRuleTileCell`(`:30`)은 룰타일 모드에서 스탬프 대상 셀의 상하좌우/대각 이웃 존재 여부를 검사해 알맞은 역할(`corner_*`/`edge_*`/`concave_*`/`fill`)을 `pickRoleCell`로 골라 자동 배치한다 — 실제 유니티 Rule Tile의 동작을 미리보기에서 근사 시뮬레이션. variation 모드는 기존과 동일하게 아무 타일이나 랜덤 스탬프.

### 랜덤성 규칙 개정
변형 모드 프롬프트(`generateTilemapVariationPrompt`, `sessionPrompts.ts:683`)의 타일링 규칙 3·7조는 v2에서 "완전 균일 반복 금지"를 더 명확히 하도록 재작성됨: 규칙 3은 약 절반의 셀을 순수 베이스(디테일 없음)로 남기고 나머지는 디테일을 매번 다른 오프셋 위치에 배치하도록(정중앙 금지) 강제하며, 규칙 7은 셔플 배치 후 규칙적인 도트 패턴이 나타나면 실패로 간주하도록 명시한다. 룰타일 모드는 별도 규칙 세트(`generateTilemapRuleTilePrompt`의 5조: 손맵 채색·전환 밴드 폭 고정·균일 텍스처·격자선 금지·일관 조명)를 쓴다.

### 6) 재진입 복원
- `useTilemapProcessing`의 첫 `useEffect`(`:65`)가 `tilemapData.sheets` 각각을 `imageStorage.loadImage`로 로드 후 `sliceTileSheet`로 재분할해 `tileCache`를 복원한다. 시트 개수(`sheets.length`)와 `grid` 변화에만 반응하도록 의도적으로 의존성을 제한(`eslint-disable react-hooks/exhaustive-deps`) — 신규 시트는 `processNewSheet`가 즉시 캐시하므로 이 이펙트를 재실행할 필요가 없다.

## 프롬프트·분석

- `buildPromptForSession`(`sessionPrompts.ts:76`)은 `sessionType === 'TILEMAP'`이면 **참조 이미지 유무와 무관하게** `generateTilemapPrompt`로 최우선 분기한다(다른 세션은 `hasReferenceImages` 여부로 갈림).
- `generateTilemapPrompt`는 그리드에 맞는 타일 수·배치를 명시하고 **타일링 규칙 6조**(균질 베이스·조용한 경계 존·중앙 디테일 랜덤성·NO GRID LINES·일관 조명·손맵 채색 강제)를 프롬프트에 강제 삽입. 참조 분석(`analysis.tilemap_specific`)이 있으면 재질·붓터치·팔레트 등을 스타일 스펙 섹션으로 추가 삽입한다.
- 분석 단계는 전용 `TILEMAP_ANALYZER_PROMPT`(`analysisPrompt.ts:428`)를 사용 — 캐릭터 관련 필드는 전부 `N/A`, `composition.background`에 재질·디테일·색 변화·붓터치를 담고 `tilemap_specific`(`TilemapCard`가 편집)로 별도 추출.

## 회귀 증상별 원인

| 증상 | 원인 |
|------|------|
| 타일이 서로 이어지지 않음 / seam 경고가 많음 | seam 점수는 RGB 경계 스트립 비교 **휴리스틱**(alpha 무시, `SEAM_ENERGY_WORST=64` 상수로 정규화) — 실제 시각 이음새와 완전히 일치하지 않을 수 있음. 모델이 타일링 규칙(`generateTilemapPrompt`의 6조)을 지키지 않았을 가능성이 더 근본 원인 |
| 선택 재생성·교체가 동작 안 함 | `requestReplacement`로 대기열을 설정한 뒤 반드시 통상 생성 흐름을 재실행해야 `processNewSheet`가 교체 제안 분기를 탄다 — 대기열만 설정하고 생성을 안 누르면 아무 일도 없음 |
| 내보낸 시트에 교체 타일이 반영 안 됨 | `exportTilemapForUnity`는 원본 시트가 아니라 `composeFinalSheet`로 **현재 `currentTiles`를 재합성**한다. `currentTiles`(=slotAssignments 파생)가 최신 확정 상태를 반영하는지 확인 |
| 락 슬롯인데도 교체됨 | `confirmProposal`이 아니라 `processNewSheet`의 교체 대상 필터(`lockedSlots`)에서 걸러지는 구조 — 락을 켠 *이후*에 재생성을 요청해야 함, 이미 진행 중인 `proposal`에는 소급 적용 안 됨 |
| 그리드 바꿨는데 이전 타일이 남아있음 | 그리드 변경은 다음 **생성 실행 시점**에만 리셋된다(`processNewSheet`의 `gridChanged` 체크) — 그리드 버튼만 누르고 생성 전이면 화면엔 이전 그리드 데이터가 그대로 보임 |
| 재진입 시 타일이 안 보이고 회색 박스만 표시 | `tilemap-sheet-*` imageStorage 키가 유실됐거나 로드 실패(`loadImage`가 `null`) — 콘솔의 "⚠️ 타일 시트 이미지 미발견" 로그 확인. 세션 삭제 시 이 키들은 정리되지 않으므로(기존 히스토리 이미지와 동일한 한계) orphan 데이터로 남을 수 있음 |
| 미리보기 캔버스에서 배치한 맵이 재진입 시 사라짐 | 정상 동작 — `TilePreviewCanvas`는 세션 데이터와 무관한 비영속 컴포넌트 로컬 state |
| 미리보기 캔버스 버튼이 비활성화됨 | `currentTiles`에 `null`(아직 안 채워진 슬롯)이 있으면 비활성 — 모든 슬롯이 채워져야 열림 |
| 비율/해상도 선택 UI가 안 보임 | 의도된 동작 — TILEMAP은 1:1·1K로 고정, `GeneratorSettings.tsx`가 `sessionType !== 'TILEMAP'` 조건으로 해당 UI를 숨김 |
| 시트가 정사각형이 아닌데 분할이 이상함 | `sliceTileSheet`가 실측 크기 기준 **중앙 crop**(짧은 변 기준 정사각형) 후 분할하도록 방어 처리되어 있음 — 모델이 1024x1024가 아닌 크기를 반환해도 동작하지만 crop된 영역 밖은 손실됨 |
| 룰타일 역할이 어긋남 / 오목 코너가 안 나옴 | `ruleTileLayout.ts`의 `ROLES_4X4`/`ROLES_8X8` 배열(행우선 인덱스↔역할 매핑)과 `sessionPrompts.ts`의 프롬프트 기하 수치(4x4: 12.5%~87.5% 패치·편측 밴드 6%, 8x8: 6.25%~93.75% 패치·편측 밴드 3%·구멍 31.25%~68.75%·순수 베이스 37.5%~62.5%)가 서로 어긋나면 분할 후 셀 위치와 의도한 역할이 안 맞음 — 8x8은 셀 폭이 12.5%라 4x4와 같은 inset을 쓰면 셀 경계선과 겹쳐 반 셀 어긋나므로 그리드별 상수를 반드시 분리해야 한다. 4x4는 오목 역할 자체가 없으므로(설계상) 오목이 필요하면 8x8을 써야 함 |
