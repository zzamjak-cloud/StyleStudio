# 타일맵 세션 설계 스펙

- **날짜**: 2026-08-27
- **상태**: 설계 승인됨 (구현 전)
- **목표**: 유니티 Tilemap에 바로 적용 가능한 손맵(hand-painted) 스타일 바닥타일 세트를 AI로 생성하는 신규 세션 타입 `TILEMAP` 추가

---

## 1. 배경 · 요구사항

- **손맵 채색**: 리얼(photorealistic)이 아닌, 붓터치가 보이는 그린 듯한(painterly) 채색의 바닥타일.
- **유니티 Tilemap 직결**: 생성 결과를 유니티 Tilemap 워크플로(Sprite Editor 슬라이스 → Tile Palette)에 바로 투입 가능해야 함.
- **그리드**: 4x4(16타일 · 셀 256px), 8x8(64타일 · 셀 128px) **2종만** 지원. 1K(1024×1024) 시트 기준.
- **분할**: 1K 시트 생성 후 그리드로 나눠 **개별 타일 이미지**를 얻는다 (클라이언트 canvas 분할 — 본 프로젝트 최초의 실제 시트 분할 구현).
- **타일링 품질**: 타일 간 랜덤성(다양성)을 유지하면서 어느 타일끼리 이웃해도 이어지는(seamless) 구성.
- **Canvas 도구**: 생성된 타일을 스탬프로 찍어 가상 맵을 칠해보는 **배치 미리보기 캔버스** (이음새 육안 검증용).

### 확정된 방향 (사용자 승인)

| 결정 항목 | 확정안 |
|-----------|--------|
| 타일셋 구조 | **변형(variation) 타일 세트** — 모든 타일이 상호 seamless한 동일 지형 변형. 오토타일(지형 전환) 아님 |
| Canvas 용도 | **타일 배치 미리보기** (스탬프·랜덤 채우기) — 타일 직접 편집 아님 |
| 내보내기 | **시트 1장 + 개별 타일 PNG 둘 다** + 유니티 임포트 가이드 |
| Seamless 확보 | **프롬프트 규칙 + 분할 후 seam 점수 검증 + 불량 슬롯 교체 재생성** |
| 아키텍처 | **A안: 기존 분석·생성 파이프라인 재사용** — AnalysisPanel → ImageGeneratorPanel 흐름 그대로, 타일맵 고유 기능은 생성 후처리 레이어로 추가 |

---

## 2. 데이터 모델

### 2.1 신규 타입 (`src/types/tilemap.ts` — 단일 정의처)

> `PixelArtGridLayout`이 두 곳에 중복 정의된 기존 함정을 반복하지 않는다. 타일맵 타입은 이 파일에만 정의한다.

```typescript
/** 타일맵 그리드 레이아웃 (PixelArtGridLayout의 부분집합) */
export type TilemapGridLayout = '4x4' | '8x8';

/** 생성된 타일 시트 1장 (원본 1024 이미지는 imageStorage 키로 보관) */
export interface TilemapSheet {
  id: string;
  imageKey: string;      // imageStorage 키 (base64 직접 보관 금지)
  createdAt: string;     // ISO 8601
}

/** 슬롯 → (시트, 셀) 매핑. 슬롯 수 = 그리드 타일 수(16 또는 64) */
export interface TileSlotAssignment {
  slotIndex: number;     // 0 ~ N-1
  sheetId: string;       // TilemapSheet.id
  cellIndex: number;     // 해당 시트 내 셀 번호 (행우선)
  seamScore?: number;    // 0~100 이음새 점수 (계산 후 기록)
  locked?: boolean;      // 교체 재생성에서 보호
}

/** TILEMAP 세션 전용 데이터 */
export interface TilemapSessionData {
  grid: TilemapGridLayout;
  sheets: TilemapSheet[];
  slotAssignments: TileSlotAssignment[];
}
```

**핵심 결정 — 타일 개별 저장 금지.** 타일은 시트의 결정적 분할 결과이므로 시트(1024 PNG)만 저장하고, 타일 이미지는 세션 진입/렌더 시 canvas 분할로 파생한다. 8x8=64장의 개별 이미지를 저장해 `settings.json`/imageStorage를 비대화시키지 않는다.

### 2.2 분석 결과 확장 (`src/types/analysis.ts`)

```typescript
export interface TilemapSpecificAnalysis {
  brush_style: string;         // 예: "visible soft brushwork, layered strokes"
  color_palette: string;       // 주요 색·명도 범위
  texture_density: string;     // 디테일 밀도
  material_type: string;       // grass / stone / dirt / wood / sand ...
  perspective: string;         // top-down / 3/4 view
  edge_softness: string;       // 경계 붓터치의 부드러움
  lighting_direction: string;  // 광원 방향·색온도
}
// ImageAnalysisResult.tilemap_specific?: TilemapSpecificAnalysis 추가
```

### 2.3 세션 (`src/types/session.ts`)

- `SessionType` 유니온에 `'TILEMAP'` 추가 (13번째).
- `Session.tilemapData?: TilemapSessionData` 필드 추가.
- `GenerationSettings.pixelArtGrid`는 그대로 재사용 (TILEMAP에서는 UI가 4x4/8x8만 노출).

---

## 3. 세션 통합 체크리스트

위키 `session/session-config.md`의 "타입 추가 함정"을 전부 반영한다.

| 파일 | 작업 |
|------|------|
| `src/types/session.ts` | `SessionType`에 `'TILEMAP'`, `tilemapData?` 필드 |
| `src/lib/config/sessionConfig.ts` | `SESSION_CONFIG.TILEMAP` 추가 — 라벨 "타일맵", 아이콘 🧱, lime/emerald 색상 계열, `grids` 6키 전부 문구 작성(UI는 4x4/8x8만 노출), placeholder, gridLabel. `Record<SessionType,...>`이므로 누락 시 컴파일 에러로 강제됨 |
| `src/components/common/Sidebar.tsx` | `getSessionTypeInfo`에 lucide `LayoutGrid` + lime 색상 매핑 (**SESSION_CONFIG와 별도 — 양쪽 모두 갱신**) |
| `src/components/common/NewSessionModal.tsx` | 타일맵 생성 버튼 (자동 이름 "타일맵_N"은 기존 `generateSessionName`이 처리) |
| `src/App.tsx` | 라우팅 **신규 분기 없음** — 분석 기반 9종과 동일하게 AnalysisPanel → ImageGeneratorPanel. `handleNewSession`에서 `tilemapData` 초기화(`grid:'4x4'`, 빈 배열) |
| `src/types/constants.ts` | 필요 시 타일맵 기본값 상수 |

---

## 4. 생성 파이프라인

### 4.1 참조 분석

- `src/lib/gemini/analysisPrompt.ts`에 `TILEMAP_ANALYZER_PROMPT` 추가 — 손맵 채색 특성(§2.2 필드)을 JSON으로 추출. 기존 `PIXELART_ANALYZER_PROMPT` 구조를 본뜬다.
- `src/hooks/api/useGeminiAnalyzer.ts` 세션 타입 분기에 TILEMAP 연결 → `analysis.tilemap_specific`에 저장.
- `AnalysisPanel`에 타일맵 카드 1장 추가 — 공통 `AnalysisCard`/`useFieldEditor` 재사용 (위키 `analysis/analysis-cards.md` 패턴).

### 4.2 생성 설정 제약 (`GeneratorSettings.tsx`)

- TILEMAP 분기: 그리드 버튼 **4x4 · 8x8 두 개만** 노출 (기본 4x4). 기존 1x1~4x4 버튼 블록과 별도 렌더.
- 비율 **1:1 고정**, 해상도 **1K 고정** (2K/4K 비활성) — 분할 셀 크기 계산이 1024 기준이기 때문.

### 4.3 타일맵 프롬프트 (`src/lib/prompts/sessionPrompts.ts`)

`generateTilemapPrompt` 신설, `promptGenerators` 맵 등록. 헤더 `HAND-PAINTED TILEMAP VARIATION SET`. **타일링 규칙 6조**:

1. **균질 베이스** — 전체 1024 캔버스가 단일 재질의 통계적으로 균일한 손맵 텍스처 (색상·명도·붓터치 밀도 균일).
2. **조용한 경계 존** — 각 셀 가장자리 약 15% 영역은 고대비 디테일 금지, 공통 베이스 톤 유지. *임의 타일 조합 seamless의 핵심 장치.*
3. **중앙 디테일 랜덤성** — 꽃·돌·균열 등 고유 디테일은 각 셀 중앙부에만, 셀마다 서로 다르게 배치.
4. **NO GRID LINES** — 기존 픽셀아트 규칙 재사용: 셀 경계선·구분선 절대 금지, 그리드는 개념적 배치.
5. **일관 조명** — 광원 방향·색온도·그림자 방향 전체 통일 (`tilemap_specific.lighting_direction` 반영).
6. **손맵 채색 강제** — visible brushwork, painterly stylized shading, NOT photorealistic.

- 셀 배치는 `getPixelArtGridInfo` 재사용 ("N cells in RxC layout").
- negative prompt: `photorealistic, 3D render, photo texture, grid lines, seams, visible borders, vignette, tiling artifacts`.
- 참조 있으면 `tilemap_specific` 분석값(재질·팔레트·붓스타일)을 스펙 섹션으로 삽입, 참조 없으면 사용자 프롬프트 기반.
- 번역·모델 선택·히스토리·저장은 기존 `handleGenerate` 경로 그대로 (신규 코드 없음).

---

## 5. 타일 후처리

생성 완료 시 TILEMAP 세션에서만 실행되는 후처리 체인.

### 5.1 시트 분할 — `src/lib/tilemap/tileSlicer.ts` (순수 함수)

- 입력: 시트 dataURL, `TilemapGridLayout` → 출력: 타일 dataURL 배열 (행우선).
- canvas `drawImage` 부분 복사로 분할. 4x4→256px×16장, 8x8→128px×64장.
- 시트 실측 크기가 1024가 아니면 실측/그리드로 셀 크기 계산 (모델이 1008 등 비정확 크기를 반환하는 경우 대비).

### 5.2 이음새 검증 — `src/lib/tilemap/seamValidator.ts` (순수 함수)

- 각 타일 4변의 경계 픽셀 스트립(폭 4px)을 추출.
- "임의 두 타일이 이웃했을 때"의 seam 에너지 = 맞닿는 두 스트립의 RGB 평균 절대차. 수평(우변↔좌변)·수직(하변↔상변) 쌍별 계산 — 4x4는 전수(256쌍×2), 8x8은 균등 샘플링(슬롯당 상한).
- 타일별 점수 = 해당 타일이 관여한 쌍 에너지 평균을 0~100으로 정규화(100=완벽). 임계값(초기값 70, 상수) 미만이면 경고 뱃지.
- `slotAssignments[].seamScore`에 기록.

### 5.3 교체 재생성 (선택 재생성)

변형 타일은 **상호 교환 가능**하므로 단일 셀 인페인팅(실패율 높음)을 쓰지 않는다.

1. 결과 뷰에서 불량 슬롯 선택(체크) → "선택 재생성".
2. 같은 프롬프트·설정으로 **시트 1장 추가 생성** → `sheets`에 축적, 히스토리에도 기록.
3. 새 시트를 분할·검증 후, 선택 슬롯마다 seam 점수 상위 타일을 **자동 제안** → 사용자 확정 시 `slotAssignments`의 해당 슬롯만 갱신.
4. `locked` 슬롯은 교체 대상에서 제외.

### 5.4 결과 뷰 — `src/components/tilemap/TilemapResultView.tsx`

- `ImageGeneratorPanel` 생성 결과 표시부에 TILEMAP 분기로 삽입.
- **시트 보기 ↔ 타일 보기** 토글.
- 타일 보기: 슬롯 그리드(4×4/8×8 배열)로 각 타일 렌더 + seam 점수 뱃지 + 선택 체크박스 + 락 토글 + "선택 재생성" 버튼 + "미리보기 캔버스 열기" + "유니티용 내보내기".

---

## 6. 배치 미리보기 캔버스 — `src/components/tilemap/TilePreviewCanvas.tsx`

- 모달 형태 (ConceptSketchPanel 패턴). **Konva 미사용** — 그리드 스냅 스탬프 방식이므로 plain `<canvas>` + 셀 상태 2차원 배열(`(slotIndex|null)[][]`)이 더 단순.
- 좌측: 타일 팔레트(현재 슬롯 타일들, 선택 하이라이트).
- 캔버스: 클릭/드래그로 선택 타일 스탬프. 맵 크기 예: 12×8셀(가로 스크롤 없이 표시 가능한 크기, 셀 표시 크기 64px 내외).
- 도구: **랜덤 채우기**(맵 전체를 무작위 슬롯 타일로 — 이음새 검증 핵심 시나리오), 지우개, 전체 지우기, 줌 1x/2x.
- **비저장 휘발성 도구** — 맵 상태는 세션에 저장하지 않음 (YAGNI).

---

## 7. 유니티 내보내기

"유니티용 내보내기" 버튼 → 기존 `paths.ts` 규칙: `~/Downloads/AI_Gen/{세션명}/tilemap_{timestamp}/`

| 산출물 | 내용 |
|--------|------|
| `tilesheet.png` | **교체 타일이 반영된 최종 시트를 canvas로 재합성**한 1024 PNG 1장. 유니티 Sprite Editor에서 Grid by Cell Size(256/128)로 슬라이스 |
| `tiles/tile_00.png …` | 개별 타일 PNG (슬롯 순, 2자리 0패딩) |
| `IMPORT_GUIDE.txt` | 유니티 임포트 안내: Sprite Mode=Multiple, Pixels Per Unit=셀 크기, Grid by Cell Size 슬라이스, 손맵이므로 Filter=Bilinear 권장, Tile Palette 구성 순서 |

- 파일 쓰기는 기존 생성물 자동 저장과 동일한 Tauri fs 경로 사용. 폴더명은 `sanitizeFolderName` 적용.

---

## 8. 에러 처리 · 엣지 케이스

- **시트 크기 비정상**: 실측 크기 기반 셀 계산 (§5.1). 정사각형이 아니면 경고 토스트 후 중앙 크롭.
- **분할/검증 실패**: 후처리 실패해도 생성 자체는 성공 처리 — 시트 원본은 히스토리에 남고, 결과 뷰에 "분할 실패, 다시 시도" 액션 표시.
- **API 에러**: 기존 `apiErrorHandler` 경로 그대로 (신규 처리 없음).
- **히스토리 복원**: 히스토리에서 시트 복원 시 현재 `slotAssignments`와의 관계를 명확히 — 복원은 시트 이미지 표시만 하고, 슬롯 매핑은 세션의 최신 상태 유지 (기존 "복원했는데 재생성 안 됨" 함정과 동일한 기대치).
- **세션 전환/재진입**: `tilemapData`는 세션에 영속되므로 재진입 시 시트 로드(imageStorage) → 분할 → 결과 뷰 복원.
- **그리드 변경 (4x4↔8x8)**: 셀 크기가 달라 기존 시트의 타일은 새 그리드 슬롯과 호환되지 않는다. 그리드를 바꾼 뒤 **새로 생성하는 시점**에 `tilemapData.grid` 갱신 + `sheets`·`slotAssignments`를 새 시트 기준으로 초기화·재구성한다. 이전 그리드의 시트는 생성 히스토리에만 남는다 (`sheets`에 grid 필드를 두지 않는 대신 풀 자체를 비우는 단순 규칙).

## 9. 검증 계획

- `tileSlicer`/`seamValidator`는 순수 함수로 분리 (테스트 인프라 부재 — 수동 검증 + 향후 단위 테스트 진입점 확보).
- `npm run build` 통과.
- E2E 수동 시나리오: 세션 생성 → 참조 업로드·분석 → 4x4 생성 → 분할·점수 확인 → 불량 슬롯 교체 재생성 → 미리보기 랜덤 채우기 → 내보내기 → 유니티에서 임포트 확인(사용자).

## 10. 마무리 작업

- 위키 갱신: `wiki/tilemap/overview.md` 신설 + `wiki/README.md` 카테고리 맵·빠른 진입 표·주요 파일 좌표 갱신.
- `CLAUDE.md` 카테고리 맵에 `tilemap` 추가.
- 버전 범프: `scripts/bump-version.sh` (3파일 + CHANGELOG 동시 갱신).

## 11. 범위 제외 (YAGNI)

- 오토타일(지형 전환) 세트, Rule Tile/에셋(.asset) 생성, 타일 직접 편집(브러시), 미리보기 맵 저장, 후처리 경계 블렌딩, 2K/4K 시트, 4x4·8x8 외 그리드.
