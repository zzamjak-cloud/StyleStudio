# AI 에이전트 연동 (MCP 서버 `ss-mcp`) — 대량 배치 생성

로컬 AI 에이전트(Claude Code CLI·데스크톱, Codex CLI·데스크톱, Claude 데스크톱)가 StyleStudio 의
**세션별 생성 기능을 대량 배치로** 쓰게 하는 MCP stdio 서버. 앱이 **꺼져 있어도** 앱 설정의 OpenRouter
키로 동작하며, 결과는 **파일로만** 남긴다(세션을 만들지 않는다).

- 서버는 TypeScript(`mcp/`)이고 **앱 소스(`src/`)를 그대로 번들**한다 — 세션 프롬프트 템플릿·분석 프롬프트·
  모델 카탈로그·OpenRouter 클라이언트·픽셀 정규화·타일맵 합성기가 앱과 같은 코드라 어긋나지 않는다.
- 앱에는 **JS 번들 `ss-mcp.mjs`(약 3.4MB — pdf.js 1.5MB·xlsx 0.9MB·zod 0.4MB 가 대부분, 설치 파일 기준 +1MB 안팎)만** 넣고 사용자 PC 의 **Node 20.16+** 로 실행한다. Node 가 없으면 설정 화면에서 단일 실행 파일(런타임 포함)을 한 번 내려받는다 — 아래 "배포 방식".
- 지원 세션: 생성기 계열(STYLE·CHARACTER·BACKGROUND·ICON·UI·LOGO·PIXELART 3종·BASIC) · CONCEPT · ILLUSTRATION · 채팅(BASIC) 편집 체인 · TILEMAP.

## 관련 파일

| 역할 | 파일 |
|------|------|
| 서버 진입점·공용 도구 등록 | `mcp/src/index.ts` |
| stdout 보호 (console.log → stderr, **첫 import**) | `mcp/src/stdio-guard.ts` |
| 도구 공통 (응답·오류·공용 zod 스키마, `register…Tool`) | `mcp/src/toolkit.ts` |
| **실행 엔진** (작업 단위·동시 실행·재시도·타임아웃·비용·매니페스트·순차 체인) | `mcp/src/engine.ts` |
| 실행 흐름 (계획 요약 → dry run → 안전 상한 → 시작 → 대기) | `mcp/src/runner.ts` |
| 공통 검증 (모델·비율·크기·품질, 스타일 소스, 출력 폴더, 상한) | `mcp/src/common.ts` |
| 저장 (셀 분할·픽셀 정규화·포맷, 예상 파일 수) | `mcp/src/output.ts` |
| 생성기 세션 계획 (`ss_generate_batch`) | `mcp/src/batch.ts`, 프롬프트 `mcp/src/prompt.ts` |
| 컨셉 (`ss_concept_batch`) | `mcp/src/concept.ts` |
| 일러스트 (`ss_illustration_batch`) | `mcp/src/illustration.ts` |
| 편집 체인 (`ss_edit_chain`) | `mcp/src/chain.ts` |
| 타일맵 (`ss_tilemap_batch`) · 순수 JS canvas shim | `mcp/src/tilemap.ts`, `mcp/src/canvas-shim.ts` |
| 참조 문서 (pdf·xlsx·csv·md·txt·json·웹·구글 시트) | `mcp/src/documents.ts` (변환 규칙은 앱과 공유: `src/lib/utils/documentText.ts`) |
| 참조 분석 → 스타일 프로필 | `mcp/src/analyze.ts` |
| 앱 데이터 (키·세션 스타일 소스·경로 보호·안전한 쓰기) | `mcp/src/env.ts` |
| 순수 JS 이미지 입출력 (pngjs·jpeg-js) | `mcp/src/imageio.ts` |
| 실측 비용 기록·견적 | `mcp/src/costlog.ts` |
| 테스트 (`npm run mcp:test`, bun test — 엔진·문서·타일맵 게이트 24건 포함) | `mcp/test/*.test.ts` |
| 빌드 (`ss-mcp.mjs` → `src-tauri/binaries/`, `--standalone` 은 릴리스 자산) | `scripts/build-mcp.mjs`, `.github/workflows/release.yml` "MCP" 단계들 |
| 클라이언트 설정 등록·해제, 사본 배치 (`ServerLaunch` = command+args) | `src-tauri/src/mcp_setup.rs` |
| 런타임 결정 (Node 우선 / 실행 파일) · Tauri command | `src-tauri/src/mcp_commands.rs` |
| Node 20.16+ 탐지 · 실행 파일 다운로드(SHA-256·버전 검증) | `src-tauri/src/mcp_runtime.rs` |
| 설정 모달 섹션 "AI 에이전트 연동 (MCP)" | `src/components/common/McpSettingsSection.tsx`, `src/lib/services/mcpService.ts` |

**앱과 공유하려고 순수 함수로 뺀 모듈** (React·Tauri·DOM 비의존 — 여기에 그런 의존을 넣으면 MCP 가 깨진다):
`src/lib/prompts/conceptPrompt.ts`(컨셉 자동 프롬프트·크기 매핑 ← `useConceptGeneration`), `src/lib/prompts/chatPrompt.ts`
(대화 맥락·그리드/픽셀 prefix·문서 요약 ← `useChatImageGeneration`), `src/lib/utils/documentText.ts`(엑셀·CSV·HTML·구글 시트·PDF 텍스트 ← `fileParser`).

## 도구

| 도구 | 용도 | API 호출 |
|------|------|---------|
| `ss_info` | 데이터 경로, 키 설정 여부·출처(env/settings), 크레딧(`/api/v1/key`), 기본 출력 폴더, 작업 목록 | 키 조회 1회 |
| `ss_models` | 모델별 지원 옵션(`imageModels.ts` 그대로), 세션 타입별 기능, 카메라 id, 컨셉 프리셋, 실측 평균 비용 | 없음 |
| `ss_list_sessions` | 화풍 재사용용 기존 세션 목록 (`has_analysis`, `reference_count`) | 없음 |
| `ss_analyze` | 참조 이미지 → 앱 분석기(`useGeminiAnalyzer`) → **스타일 프로필 JSON**. 타일맵은 `session_type=TILEMAP` | 분석 1회 |
| `ss_generate_batch` | 생성기 계열 세션. items 그리드 패킹·n·투명 배경·카메라·UI 문서·픽셀 정규화 | 요청 N회 |
| `ss_concept_batch` | 컨셉 아트. 장르·플레이 방식·레퍼런스 게임·아트 스타일, **`matrix` 로 장르×스타일 조합** | 요청 N회 |
| `ss_illustration_batch` | 같은 캐릭터 세트(≤5명)로 여러 장면. 장면별 카메라·그리드·구도 스케치(+라벨 분석) | 요청 N회 (+스케치 분석) |
| `ss_edit_chain` | 채팅 "이어서 편집하기" — 단계마다 직전 결과를 참조로. 체인끼리 병렬 | 단계 수만큼 |
| `ss_tilemap_batch` | 타일맵 변형 세트·룰타일 → 앱 합성기 → 유니티용 타일 + `tileset.json` | 세트당 1회 |
| `ss_job_status` / `ss_cancel_job` | 작업 진행·결과 / 취소(대기 단위만 건너뜀) | 없음 |
| `ss_split_grid` / `ss_pixelate` | 받은 파일 후처리 (셀 분할 / 앱과 같은 픽셀 정규화) | 없음 |

모든 생성 도구 공통(`toolkit.runSchema`): `dest_dir`, `concurrency`(기본 4, 최대 8), **안전 상한 3종**
`max_requests`(기본 30)·`max_images`(기본 60 — `n` 으로 요청당 10장까지 받으므로 따로 막는다)·`max_cost_usd`(실측 견적이 있을 때만),
`dry_run`(API 호출 없이 요청 수·이미지 수·파일 수·견적·구성), `wait_seconds`(기본 40).

### 실행 엔진 (`engine.ts`) — 도구는 작업 단위만 만든다

- **WorkUnit**: `call`(비율·크기·품질·배경·n·참조 이미지) + `buildPrompt(tr)` + `save(bytes)` — 또는 **`run(ctx)`**(단위 안에서
  `ctx.generate` 를 여러 번 순차 호출: 편집 체인, 스케치 분석이 앞서야 하는 일러스트). `texts` 에 넣은 한글만 번역된다.
- 번역: 작업 전체에서 한 줄짜리는 1회로 묶고, 여러 줄은 단건(`[n]` 줄 파싱이 첫 줄만 남기는 문제).
- **오류 분류**: 공유 클라이언트의 `API 오류 (ddd)` 만 `ImageApiError(status)` 로 본다 — 상태 코드 판정(재시도·401/402 중단·사용자 문구)은 이것에만 한다.
  (예전엔 모든 오류 메시지의 "(ddd)" 를 읽어 문서 다운로드의 401 이 "API 키 오류"로 작업 전체를 중단시켰다.)
- 재시도: 이미지 API 429·408·5xx 와 **연결 단계 네트워크 오류**(fetch failed·ECONNRESET 등)만 지수 대기(최대 4회).
  **타임아웃·"응답은 왔는데 이미지 없음"은 재시도하지 않는다** — 서버는 이미 생성·과금했을 수 있다. **401·402 는 나머지 단위를 즉시 중단**.
  요청당 5분 타임아웃(`AbortSignal.timeout`, 공유 클라이언트의 `signal`).
- **취소는 매 호출 직전에 확인한다**(`callWithRetry` 첫 시도 포함) — 체인 단계 사이에서도 멈춘다. 멈춘 단위는 `skipped`(`CancelledError`), 그때까지 파일은 보존.
  (예전엔 새 단위를 꺼낼 때만 확인해서 30단계 체인을 취소해도 남은 단계가 전부 과금됐다.)
- 단위별 요청 수는 `WorkUnit.requests`(기본 1, 체인은 단계 수)로 명시한다 — `run` 사용 여부로 추정하면 일러스트(`run` + n장 1회)가 n배로 집계돼 정상 배치가 상한에 걸렸다.
- **비용 기록은 저장보다 먼저**, 저장(후처리)이 실패하면 원본을 `_raw` 로 남긴다(과금된 결과를 버리지 않는다).
  `ctx.saveSafely` 가 **저장 즉시** 결과(`record.files`·`job.files`)에 반영한다 — 체인 중간 단계가 실패해도 앞 단계 파일이 결과·매니페스트에 남아,
  에이전트가 "결과 없음"으로 보고 다시 돌려 이중 과금하지 않는다. 저장 콜백은 비동기도 받는다(타일맵 합성).
- 번역이 실패하면 원문으로 진행한다(작업이 pending 인 채 실패로 끝나지 않게). 작업마다 `manifest-<job>.json`
  (단위별 실제 프롬프트 — 체인은 단계별 배열 —, usage, generation_id, 파일, 오류).
- `cancelled` 는 실제로 건너뛴 단위가 있을 때만. 클라이언트가 끊기면(stdin 종료) 진행 중 작업을 마치고(최대 10분) 종료.

### 생성기 계열 (`ss_generate_batch`)

- `tasks[]`: `{name, prompt, items[], count, grid, aspect_ratio, quality, image_size, negative_prompt}`, `options`: `max_grid`(기본 4x4), `transparent_background`,
  `camera_angle`/`camera_lens`, `reference_documents`(UI), `pixelate`, `pixel_output`, `split_grid`, `keep_sheet`, `output_format`.
- **items 그리드 패킹** (`prompt.packItems`): 묶음마다 담을 수 있는 가장 작은 그리드(40개 → 4x4·4x4·3x3 = 요청 3회), 셀별 `항목명.png`.
- **`n`** (`count`): gpt 계열은 요청 1회에 최대 10장. 앱은 `n` 을 안 보낸다 — 공유 클라이언트의 `generateImagesViaOpenRouter`(n·usage 지원).
- 프롬프트: **참조 있음** → 앱 템플릿(`buildPromptForSession`) 1회, items 는 셀 번호 목록으로 템플릿 VARIATIONS 자리에. **참조 없음** → 앱은 원문만
  보내 그리드·배경 지시가 빠지므로 MCP 전용 래퍼(`noReferencePrompt`)가 세션 성격·그리드·NO GRID LINES·순백 배경·픽셀 규칙을 붙인다.
- 입력 상한: `count`·`items` 각 1000, `tasks` 200, 계획 `PLAN_HARD_LIMIT`=1000(계획 단계에서 즉시 끊어 서버 폭주 방지). items+count 동시 지정·빈 items 는 오류.

### 컨셉 (`ss_concept_batch`)

- 프롬프트는 공유 `buildConceptBasePrompt`(장르·플레이·레퍼런스 게임·스타일 자동 구성 + "N개의 다양한 베리에이션"), 참조 이미지(1장)가 있을 때만 CONCEPT 템플릿 1회.
- 기본 비율 9:16, 크기 1k/2k/3k → 1K/2K/4K(`CONCEPT_SIZE_MAP`, Gemini 계열만 의미). **앱처럼 번역하지 않는다**(한국어 그대로) — `translate: true` 로 켤 수 있다.
- `matrix: {genres[≤30], art_styles[≤30]}` 는 조합마다 컨셉 하나(`장르_스타일` 폴더)를 만든다. `defaults` 가 모든 컨셉에 깔린다.
  **matrix 행에서 `defaults.prompt` 는 자동 구성 뒤 추가 지시로 붙는다** — 앱 규칙(`prompt` 가 있으면 자동 구성 생략)을 그대로 적용하면 조합이 사라지고 같은 요청이 N번 과금된다.

### 일러스트 (`ss_illustration_batch`)

- 앱과 같이 장면 프롬프트만 번역, 카메라는 `cameraSettings` 로 따로(캐릭터 정확도 우선), 참조 순서 [캐릭터들(≤3장씩) → 배경(≤5) → 스케치].
- 구도 스케치 + `labels`(캐릭터 이름·0~1 좌표)를 주면 앱의 `analyzeCompositionSketch`(Flash, 장면당 1회 — count 로 나뉜 요청끼리 공유)로 배치 규칙을 넣는다.
- **앱보다 나은 점(앱은 그대로)**: ① 참조 상한(gpt 16/gemini 14)을 넘으면 앱은 맨 뒤의 스케치가 먼저 잘린다 → `planIllustrationReferences` 가
  스케치를 지키고 배경 → 캐릭터 추가 이미지 순으로 줄인다(캐릭터당 최소 1장). ② 어느 참조가 어느 캐릭터인지 `REFERENCE IMAGE MAP` 을 프롬프트 끝에 붙인다.
- 캐릭터·배경 분석(`analyzeIllustrationCharacter` 등)은 앱에서도 호출처가 없고 프롬프트에 쓰이지 않아 MCP 도 쓰지 않는다.

### 편집 체인 (`ss_edit_chain`)

- 공유 `chatPrompt.ts` 로 앱과 같은 프롬프트: [이전 단계 대화 맥락(최근 6턴, 빈 AI 메시지 제외)] + [그리드·픽셀 모드 prefix] + [문서 요약] + 단계 지시.
- 참조 = [직전 결과(첫 단계는 `start_image`)] + 단계 첨부(중복 제거, 모델 상한). 체인 안은 순차, 체인끼리 병렬. 단계마다 `<체인>_stepNN` 파일.
- 앱과 다른 점: 직전 결과를 JPEG/정규화 확대본이 아니라 **모델이 준 원본 바이트**로 다음 참조에 넣는다(재압축 손실 없음). 채팅은 번역하지 않는다(앱과 동일, `translate` 로 켬).
- `documents` 는 실행 시 한 번만 읽고 요약(문서당 Flash 1회, 1000자 미만은 원문)해서 모든 단계에 넣는다 — dry run 은 요약 비용이 들지 않는다.

### 타일맵 (`ss_tilemap_batch`)

- 세트 하나 = 시트 생성 요청 1회 + **앱 합성기 그대로**(`buildVariationTileSet`·`buildRuleTileSet`·`composeFinalSheet`) + 내보내기.
  `tasks[]`: `{name, mode: variation|ruletile, terrain | base_terrain/overlay_terrain(빈 값=투명), grid(variation 4x4|8x8, ruletile 8x8 강제), edge_style, outline, outline2, outline_side, prompt, count}`.
  모델은 타일맵 호환(덕테이프 계열 — `getTilemapImageModels`)만, 비율 1:1. 화풍은 `ss_analyze session_type=TILEMAP` 프로필의 `tilemap_specific`.
- 프롬프트는 `buildPromptForSession({sessionType:'TILEMAP', tilemapMode, …})` **1회**(앱의 이중 감싸기 버그를 고친 뒤와 같은 결과). 한글 지형은 엔진 번역.
- 앱은 생성물을 흰 배경 JPEG(q0.92)로 바꾼 뒤 합성기에 넣는다 — `options.match_app_jpeg`(기본 true)로 같은 변환(앱 `convertBase64ToJpeg` 를 shim 위에서 그대로)을 재현한다.
- 출력(세트별 폴더): `tilesheet.png`, `tiles/tile_NN.png`, 룰타일 베이스 타일, `IMPORT_GUIDE.txt`(앱 `buildImportGuide`), **`tileset.json`**(모드·그리드·셀 크기·PPU 128,
  슬롯별 파일·signature·변형·역할·유니티 3x3 규칙 This/Not/Any·`rule_grid`, `default_sprite`, 베이스 목록 — 앱 `buildRuleGrid` 와 64슬롯 일치를 테스트로 고정), `source_sheet.*`.
  폴더가 이미 차 있으면 `_2` 새 폴더를 쓴다(같은 폴더에 쓰면 `writeUnique` 가 파일명을 바꿔 json 참조가 어긋난다). 합성이 실패하면 과금된 시트만 `source_sheet_raw.*`.
- **canvas shim** (`canvas-shim.ts`): 앱 합성기가 쓰는 canvas API 부분집합을 순수 JS 로 구현해 MCP 프로세스에만 `document`·`Image`·`ImageData` 를 넣는다
  (진짜 DOM 이 있으면 건드리지 않는다). drawImage 3·5·9 인자(1:1 정수는 비트 복사, 스무딩 off 최근접 / on 쌍선형·2배 넘는 축소는 박스 평균),
  get/put/createImageData, createLinearGradient(픽셀 중심 샘플·알파 8비트 양자화), fillRect(소수 변 커버리지), globalAlpha, save/restore,
  composite `source-over`·`destination-in`·`destination-out`·`source-in`·`copy`(지원 밖은 예외), toDataURL png/jpeg. 네이티브 모듈 없음.
- **앱 셀프체크 게이트 전부(v0.10.1 기준 24건)를 Node 에서 shim 위로 그대로 돌린다** (`bun test mcp/test/tilemap.test.ts`, 약 9초) — 2026-10-08 전부 PASS. 테스트는 게이트 개수를 고정하지 않는다(앱에 게이트가 늘면 함께 돈다).
  shim 을 고치거나 합성기 상수를 만지면 이 테스트로 확인할 것.
- 한계: 반투명 픽셀은 Chrome(프리멀티플라이드)과 ±1, 그라디언트 디더링 없음, 스무딩 확대 차이는 모델이 규격보다 작은 이미지를 준 폴백(`extractRegion`)에서만,
  JPEG 바이트는 libjpeg 와 비트 단위로 다르다(jpeg-js). variation 크로스페이드의 옅은 겹침은 앱과 같은 알고리즘 한계.
- 실측(gpt-image-2 low): 세트당 약 $0.008, 변형 4x4 세트 파일 20개 · 룰타일 8x8 세트 76개.

### 참조 문서 (`documents.ts`)

- `{content}` | `{path: pdf·xlsx·xls·csv·md·markdown·txt·json}` | `{url: 웹페이지·구글 스프레드시트}`. 변환 규칙은 앱 `fileParser` 와 같은 `documentText.ts`.
- **앱 데이터 폴더 파일은 문서로 읽지 않는다**(`assertReadableDocument`) — `settings.json` 의 API 키가 프롬프트·매니페스트로 새지 않게.
- pdf.js 로드 실패 promise 는 캐시하지 않고(다음 호출에서 재시도), 문서마다 `pdf.destroy()` 로 같은 스레드 워커를 정리한다.
- UI 세션은 앱처럼 본문 전체(10만 자 상한), 편집 체인은 요약. **PDF 는 텍스트만** — 앱은 canvas 로 내장 이미지도 뽑지만 MCP 는 하지 않는다.
- pdf.js 는 Node legacy 빌드를 쓰고 **워커 모듈을 번들에 넣어 `globalThis.pdfjsWorker` 로 같은 스레드에서 돌린다** — 단일 스크립트 배포라 워커 파일 경로를 찾을 수 없어서. 번들이 약 1.5MB 늘었다.

## 앱 쪽 함께 고친 것 — 프롬프트 이중 감싸기

`ImageGeneratorPanel.handleGenerate` 가 `buildPromptForSession` 으로 완성한 프롬프트를 `useImageGenerator` 가 **다시** 감싸고 있었다.
참조가 있으면 템플릿 중첩(픽셀 규칙·AVOID 중복), 타일맵은 룰타일 프롬프트가 variation 템플릿 안에 통째로 들어갔고,
히스토리의 `prompt` 는 실제 전송문과 달랐다. → 패널이 `promptIsFinal: true` 를 넘기면 훅은 재조립하지 않고 투명 배경 치환만 한다.
(컨셉 세션은 원문을 넘기므로 여전히 훅이 1회 감싼다.)

## 배포 방식 — 앱 크기를 지키기 위해 런타임을 번들하지 않는다

처음엔 Bun `--compile` 단일 실행 파일(런타임 포함, Windows 116MB·압축 39MB, mac 유니버설은 2배)을 앱에 넣었다가
설치 파일이 4.8MB → 약 45MB 로 커져 되돌렸다. 서버 코드 자체는 0.9MB 다.

| 실행 방법 | 등록되는 command / args | 조건 |
|---|---|---|
| **Node (기본)** | node 절대 경로 / [`app_local_data_dir/mcp/ss-mcp.mjs`] | Node 20.16+ 탐지됨 (`mcp_runtime::find_node`) |
| 단일 실행 파일 | `app_local_data_dir/mcp/ss-mcp(.exe)` / [] | Node 없음 → 설정 화면 "실행 파일 다운로드" |

- **Node 탐지**: PATH → (macOS/Linux) **로그인 셸 `$SHELL -ilc 'command -v node'`** → Homebrew·/usr/local·Volta·nvm(최신 우선) → (Windows) `Program Files\nodejs`. Finder 로 띄운 macOS 앱 PATH 에는 Homebrew·nvm 이 없어 PATH 만 보면 오판한다. `--version` 버전 ≥ 20.16 만 채택(번들의 pdfjs-dist 5.x engines 요구 — MCP SDK 자체는 18 이면 되지만 PDF 파싱이 20.16 을 요구), 실제 경로로 정규화(Windows `\\?\` 접두사 제거). 콘솔 창이 깜빡이지 않게 `CREATE_NO_WINDOW`.
- node 를 **절대 경로로** 등록한다 — GUI 클라이언트(Claude 데스크톱)는 셸 PATH 를 모른다. nvm 으로 버전을 바꿔 경로가 사라지면 상태가 `outdated` 가 되어 "갱신" 으로 다시 등록한다.
- **실행 파일 다운로드** (`download_standalone`): `https://github.com/zzamjak-cloud/StyleStudio/releases/download/v<앱 버전>/ss-mcp-{windows-x64.exe|macos-universal}.gz` + `.sha256`.
  받으면서 SHA-256 검증 → gzip 해제 → **`--version` 이 앱 버전과 같은지 실행해 확인** → `install_server`(실행 중 사본 교체 규칙) — 하나라도 실패하면 아무것도 설치하지 않고 임시 파일을 지운다.
  100MB 급이라 앱 업데이트 때 자동으로 받지 않는다 — 버전이 다르면 설정 화면이 다시 받으라고 안내한다.
- 서버 `--version` 은 `package.json` 버전(= 앱 버전)을 찍고 바로 끝난다 — 런타임·다운로드 검증용.
- 테스트: `mcp_runtime` 테스트가 tiny_http 로컬 서버로 해시 불일치·실행 불가·404 를 고정. 실제 실행 파일 전 과정은
  `SS_MCP_STANDALONE=<exe> SS_MCP_VERSION=<버전> cargo test --lib installs_real_standalone_binary -- --ignored`.

## 등록 방식 (설정 → AI 에이전트 연동)

| 클라이언트 | 설정 파일 | 형식 | 같은 파일을 쓰는 앱 |
|---|---|---|---|
| Claude Code | `~/.claude.json` | JSON `mcpServers` | CLI + 데스크톱 앱 Code 탭 |
| Codex | `$CODEX_HOME/config.toml` (기본 `~/.codex`) | TOML `[mcp_servers.stylestudio]` | CLI + Codex 데스크톱 앱 |
| Claude 데스크톱 | `%APPDATA%\Claude\claude_desktop_config.json` (mac `~/Library/Application Support/Claude/`) | JSON | 채팅 앱 |

등록 항목: 이름 `stylestudio`, command·args = 위 "배포 방식" 표, env `STYLESTUDIO_DATA_DIR` = 앱 `app_data_dir`.
설정 파일 규칙(테스트로 고정): 쓰기 전 `<파일>.ssbak` 백업(`fs::copy` 로 권한 보존), **원자적 교체**(`.sstmp` → rename,
읽은 뒤 바뀌었으면 최대 3회 재시도), 같은 이름 항목은 우리 값(`command`·`args`·`env.STYLESTUDIO_DATA_DIR`)만 갱신하고
사용자가 넣은 키는 보존, `mcpServers` 가 객체가 아니면 오류, 해제 시 우리 항목이 없으면 파일을 다시 쓰지 않음,
수동 조각(`config_snippet`)도 같은 직렬화기 사용(TOML 백슬래시 경로 함정).
Codex 경로는 **앱 프로세스의** `CODEX_HOME` 을 따른다 — 셸 rc 에서만 export 했다면 UI 에 표시된 경로를 확인할 것.

### 실행 파일 사본 — 업데이트 잠금 회피

- 번들 원본: 리소스 `binaries/ss-mcp.mjs` (`bundle.resources: ["binaries/*"]`). 개발 빌드는 tauri-build 가 `target/debug/binaries/` 로 복사한다.
- 등록되는 것은 **`app_local_data_dir/mcp/` 사본**(스크립트 또는 내려받은 실행 파일)이다. 에이전트가 띄운 서버는 세션 내내 상주해 실행 파일을 잠그므로
  원본을 등록하면 앱 업데이트가 잠긴 파일에서 멈춘다(msi/nsis 를 모두 내보내 NSIS 훅 대신 사본 방식).
- `install_server`: 내용이 같으면 무시, 다르면 기존 사본을 `.old-<ts>` 로 **이름 변경**(실행 중이어도 가능) 후 복사, 실패하면 되돌림. `INSTALL_LOCK` 으로 직렬화.
- 앱 시작 시 `refresh_installed_server` 가 "등록돼 있고 설치된 스크립트가 번들과 다르면" 교체 → 앱 업데이트가 다음 에이전트 세션부터 반영. **디버그 빌드는 건너뛴다**(dev·정식이 사본 위치를 공유).
- 상태 `outdated` = command·데이터 경로 불일치 **또는** 사본이 번들과 다름 → "갱신" 버튼.

## 빌드

- 로컬: `npm run mcp:build` (Bun 필요) → `src-tauri/binaries/ss-mcp.mjs`. `tauri:build`·`tauri:build:local` 이 먼저 실행한다. 단일 실행 파일은 `node scripts/build-mcp.mjs --standalone` (→ `src-tauri/target/ss-mcp-standalone/`, 앱에 넣지 않는다).
  검증: `npm run mcp:typecheck`, `npm run mcp:test`.
- **`--define import.meta.env.DEV=false` 가 필수** — 앱 `logger.ts` 가 Vite 의 `import.meta.env.DEV` 를 읽는다.
- CI: `release.yml` 이 tauri-action **이전에** `oven-sh/setup-bun` → `ss-mcp.mjs` 빌드(앱 번들용) → 단일 실행 파일을 빌드해 **릴리스 자산으로만 업로드**(macOS 는 arm64·x64 크로스 컴파일 후 lipo + ad-hoc 재서명·`codesign -v`, `.gz` + `.sha256`, `gh release upload --clobber`). 모두 `continue-on-error` — 실패해도 앱 릴리스는 나간다.
- 산출물은 커밋하지 않는다(`.gitignore` `src-tauri/binaries/ss-mcp*`). `binaries/README.md` 가 glob 빈 매치를 막는다.

## 안전장치 · 함정

- **앱 데이터에 쓰지 않는다.** 모든 쓰기(배치 출력·task 하위 폴더·`ss_analyze` 프로필·`ss_split_grid`/`ss_pixelate`)가 `env.assertWritable` 을 지난다 — `app_data_dir` 와 `app_local_data_dir`(웹뷰·MCP 사본) 안이면 거부. 판정은 문자열 접두사가 아니라 실제 경로(`realpathSync.native`, 존재하는 조상까지) + `path.relative` 관계라 형제 폴더(`…-tauri-exports`) 오탐과 junction·8.3 이름 우회가 없다. 모든 파일은 `writeUnique`(`wx`, `_2`…)로만 쓴다 — `ss_analyze` 의 `save_path` 도 `.json` 만, 덮어쓰기 없음.
- **API 키는 어떤 응답에도 싣지 않는다.** `OPENROUTER_API_KEY` 환경변수가 있으면 우선 — 다른 계정으로 과금될 수 있어 `ss_info.api_key_source`(env|settings)로 출처를 알린다.
- 기존 세션을 스타일 소스로 쓸 때 참조 이미지는 `imageKeys` 우선·같은 인덱스 인라인 폴백(앱 `loadSessions` 와 같은 규칙), 키는 `/`·`\`·`..`·`:` 포함 시 거부.
  **새 세션은 빈 문자열로 채운 더미 분석을 가진다** — `hasMeaningfulAnalysis` 로 걸러야 빈 분석이 프롬프트에 섞이지 않는다.
- 번들된 앱 코드가 `console.log` 를 쓰면 stdout(JSON-RPC)이 깨진다 → `stdio-guard.ts` 가 **첫 import** 로 stderr 로 돌린다. import 순서를 바꾸지 말 것.
- 셀 분할은 균등 분할이다 — 모델이 셀 경계를 정확히 지키지 않으면 이웃 셀이 살짝 섞일 수 있다(그리드는 1:1 비율 권장, 셀 목록이 "margin" 을 지시).
- 레거시 IndexedDB 에만 남은 참조 이미지는 읽을 수 없다(웹뷰 저장소) — 앱에서 세션을 한 번 열면 파일 저장소로 승격된다.
- 참조 이미지 파일은 (경로·수정 시각·크기) 기준으로 캐시한다(`readReferenceFile`) — 체인 단계·컨셉 조합마다 같은 파일을 다시 읽고 축소하지 않는다.
- **canvas shim 은 MCP 프로세스 전역에 `document`·`Image`·`ImageData` 를 넣는다**(`window` 는 넣지 않는다). 앞으로 `typeof document` 로 브라우저를 판별하는
  앱 코드가 번들에 들어오면 Node 경로가 조용히 바뀔 수 있다 — 그런 분기를 공유 모듈에 넣지 말 것.

### 알려진 한계 (의도적으로 남긴 것)

- **보조 호출은 작업 비용·견적·상한에 들어가지 않는다**: 한글 번역(작업당 1~수 회), 편집 체인 문서 요약(문서당 1회), 일러스트 스케치 분석(장면당 1회) — 모두 Flash 텍스트 호출이라 이미지 대비 소액이다. dry run 은 이들을 호출하지 않는다.
- 편집 체인 견적 키는 시작 이미지 기준 참조 수라, 단계에 첨부가 있으면 실측 키와 달라 "일부만 실측"으로 남을 수 있다.
- 타일맵 내보내기가 합성 뒤 쓰기 단계에서 실패하면 반쯤 쓴 `_N` 폴더가 남고 원본 시트가 원래 폴더에 `source_sheet_raw` 로 한 번 더 저장된다.
