# 타일맵 (Tilemap)

유니티 Tilemap용 **손맵(hand-painted) 변형 타일 세트**를 생성하는 세션. 한 재질(예: 잔디)의 타일 N장을 **모두 서로 seamless**하게(임의 순서로 이웃해도 이어지도록) 한 번에 만든다. 픽셀아트와 마찬가지로 "스프라이트 시트 = 프롬프트 지시"이며 그리드는 **4x4(16타일)·8x8(64타일)만 지원**, 비율·해상도는 **1:1·1K로 고정**(다른 세션과 달리 `GeneratorSettings`에서 비율/크기 선택 UI 자체가 숨겨짐). 생성된 시트는 클라이언트에서 그리드로 **분할(slice)**하고, 타일 4변의 경계색을 비교하는 **seam 점수(휴리스틱)**를 매겨 이음새 품질을 배지로 보여준다. 불량 타일은 새 시트를 추가 생성해 **선택 슬롯만 교체**할 수 있고, 락(lock)된 슬롯은 교체에서 제외된다. 타일은 개별 파일로 저장하지 않으며, **시트 이미지 + slotAssignments 매핑만 영속화**하고 타일은 매번 런타임에 시트를 분할해 재구성한다.

## 관련 파일

- `src/types/tilemap.ts` — 타입·상수. `TilemapGridLayout`(`:7`, `PixelArtGridLayout`의 부분집합 `'4x4'|'8x8'`), `TILEMAP_GRID_LAYOUTS`(`:10`), `TILEMAP_SEAM_WARNING_THRESHOLD = 70`(`:13`), `TilemapSheet`(`:16`), `TileSlotAssignment`(`:26`), `TilemapSessionData`(`:35`, `Session.tilemapData`), `isTilemapGridLayout`(`:42`)
- `src/hooks/useTilemapProcessing.ts` — 후처리 훅. 재진입 시 시트 로드·분할 복원(`:48` `useEffect`), `currentTiles` 파생(`:77`), `processNewSheet`(`:91`, 저장→분할→점수→전체할당 또는 교체 제안), `requestReplacement`(`:86`, ref로 대기), `confirmProposal`(`:145`)·`discardProposal`(`:163`)·`toggleLock`(`:180`)
- `src/lib/tilemap/tileSlicer.ts` — `sliceTileSheet`(`:19`, 실측 크기 기준 중앙 crop 후 그리드 분할), `loadImageElement`(`:5`)
- `src/lib/tilemap/seamValidator.ts` — `computeSeamScores`(`:79`, 타일 4변 경계 스트립 색 비교 휴리스틱). 상수: `EDGE_STRIP_PX=4`·`EDGE_SAMPLES=32`·`MAX_PARTNERS_PER_TILE=16`·`SEAM_ENERGY_WORST=64`(`:4-10`)
- `src/lib/tilemap/tilemapExporter.ts` — `exportTilemapForUnity`(`:69`, 시트 재합성 + 개별 PNG + 가이드 텍스트 저장), `composeFinalSheet`(`:21`, 교체 반영본 재합성), `buildImportGuide`(`:39`)
- `src/components/tilemap/TilemapResultView.tsx` — 결과 뷰. 시트/타일 뷰 토글(`:44`), seam 배지·락 토글·선택 체크박스(`:180`), 제안 확정/취소 액션바(`:252`), 선택 재생성 버튼(`:272`)
- `src/components/tilemap/TilePreviewCanvas.tsx` — 배치 미리보기 모달(plain canvas, 12x8 맵, 스탬프/지우개/랜덤 채우기/줌 1x·2x). **맵 상태 비저장**(`:22` 주석)
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
- 가이드 텍스트에는 Sprite Mode: Multiple, Pixels Per Unit = cellSize, Sprite Editor Slice(Grid By Cell Size) 등 유니티 Tile Palette 등록 절차가 포함된다.

### 6) 재진입 복원
- `useTilemapProcessing`의 첫 `useEffect`(`:48`)가 `tilemapData.sheets` 각각을 `imageStorage.loadImage`로 로드 후 `sliceTileSheet`로 재분할해 `tileCache`를 복원한다. 시트 개수(`sheets.length`)와 `grid` 변화에만 반응하도록 의도적으로 의존성을 제한(`eslint-disable react-hooks/exhaustive-deps`) — 신규 시트는 `processNewSheet`가 즉시 캐시하므로 이 이펙트를 재실행할 필요가 없다.

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
