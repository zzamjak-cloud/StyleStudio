# 인프라 — Tauri 데스크톱 셸

StyleStudio 는 **Tauri 2 + React 19 + Vite 7** 데스크톱 앱이다. 프런트엔드는 Vite 로 번들되어 `../dist` 에 빌드되고, Rust 셸(`src-tauri`)이 이를 웹뷰로 감싼다. Rust 백엔드는 최소한이며 커맨드는 **`start_oauth_server` 단 하나**(Google OAuth 콜백 수신용). 나머지 네이티브 기능(파일시스템·다이얼로그·HTTP·스토어·업데이터·딥링크·오프너)은 전부 공식 Tauri 플러그인으로 처리한다. 앱 버전은 **`package.json` + `tauri.conf.json` + `Cargo.toml` 3곳을 항상 동일하게** 맞춰야 하며, `scripts/bump-version.sh` 가 이를 일괄 갱신한다.

## 관련 파일

### Rust 셸
- `src-tauri/src/main.rs` — 엔트리. `stylestudio_tauri_lib::run()` 호출. 릴리스 빌드에서 `windows_subsystem = "windows"`(콘솔 창 억제)
- `src-tauri/src/lib.rs` — `run()`. Tauri 빌더에 플러그인 등록 + `invoke_handler`(`start_oauth_server`)
- `src-tauri/src/oauth_server.rs` — OAuth 콜백 로컬 HTTP 서버(자세히는 `wiki/auth/overview.md`)
- `src-tauri/Cargo.toml` — Rust 의존성·버전. lib 이름 `stylestudio_tauri_lib`

### 설정
- `src-tauri/tauri.conf.json` — 앱 메타·윈도우·번들·업데이터·딥링크 설정
- `src-tauri/tauri.local.conf.json` — 로컬 빌드 오버라이드(`createUpdaterArtifacts: false`)
- `src-tauri/capabilities/default.json` — 메인 윈도우 권한(퍼미션) 정의
- `vite.config.ts` — Vite. 고정 포트 **1420**(`strictPort`), `src-tauri` 감시 제외
- `package.json` — 프런트 의존성·스크립트·버전

### 스크립트
- `scripts/bump-version.sh` — 3파일 버전 동기 + CHANGELOG + 커밋/태그
- `scripts/ci/append_tauri_signing_env.py` — CI 서명키 주입
- `.github/workflows/release.yml` — 태그 push 시 빌드·서명·`latest.json` 배포

## 기술 스택

| 영역 | 스택 |
|------|------|
| 셸 | Tauri 2 (`tauri`, `tauri-build`) |
| 프런트 | React 19, TypeScript 5.8, Vite 7 |
| 상태관리 | Zustand 5 |
| 스타일 | Tailwind CSS 3.4 (+`@tailwindcss/typography`) |
| 캔버스 | Konva 10 / react-konva 19 |
| AI | `@google/generative-ai` (Gemini) |
| 로컬 저장 | `idb`(IndexedDB) + `@tauri-apps/plugin-store` |
| 아이콘 | `lucide-react` |
| 파일 파싱 | `pdfjs-dist`, `xlsx` |

## Tauri 플러그인 (lib.rs:5-14)

`lib.rs` 의 빌더에 등록된 플러그인. 각각 프런트에서 `@tauri-apps/plugin-*` 로 호출한다.

| 플러그인 | 용도 |
|----------|------|
| `opener` | 시스템 브라우저/파일탐색기 열기(OAuth URL, 결과 폴더) |
| `store` | `auth.json` 등 KV 영속화(토큰·사용자·창 상태) |
| `dialog` | 파일 열기/저장/메시지 다이얼로그 |
| `fs` | 파일 읽기/쓰기(생성 이미지 저장) |
| `http` | 외부 API 호출(Gemini·Google OAuth) |
| `updater` | 인앱 자동 업데이트(`wiki/infra/auto-update.md`) |
| `process` | 업데이트 후 `relaunch()` |
| `deep_link` | `stylestudio://` 커스텀 스킴 |

## 윈도우·보안 (tauri.conf.json)

- 메인 윈도우: 1400×900, **`maximized: true`**(시작 시 최대화), resizable, decorations 있음 (`tauri.conf.json:12-26`)
- `security.csp: null` — CSP 미설정 (`tauri.conf.json:28`)
- 딥링크 스킴 `stylestudio` (`tauri.conf.json:56-62`)

## 권한 모델 (capabilities/default.json)

메인 윈도우에 부여된 퍼미션. 파일시스템은 `$DOWNLOAD`·`$APPDATA`·`$APPLOCALDATA` 스코프로 열려 있고 `read/write` 는 `**` 전역 허용(`default.json:64-85`). HTTP 는 아래 3개 오리진으로 제한(`default.json:90-103`):
- `https://openrouter.ai/*` (OpenRouter — 모든 AI 호출)
- `https://oauth2.googleapis.com/*` (토큰 교환)
- `https://accounts.google.com/*` (OAuth)

`opener:allow-open-path` 는 `$DOWNLOAD/AI_Gen` 이하만 허용(`default.json:15-28`).

## 빌드 / 실행

```bash
npm run tauri:dev          # 개발 (Vite 1420 + Tauri 웹뷰)
npm run tauri:build        # 프로덕션 (업데이터 아티팩트 생성)
npm run tauri:build:local  # 로컬 빌드 (업데이터 아티팩트 미생성)
```

- `beforeDevCommand: npm run dev`, `beforeBuildCommand: npm run build`(`tsc && vite build`) (`tauri.conf.json:7-9`)
- `frontendDist: ../dist` — Vite 산출물을 셸이 로드 (`tauri.conf.json:10`)
- macOS 서명 identity `"-"`(ad-hoc). CI 서명은 `release.yml` + `append_tauri_signing_env.py`

## 진입 구조

`main.tsx` → `<AuthGuard><App/></AuthGuard>` 로 앱 전체가 인증 게이트 뒤에 있다. `App` 은 최상위를 `<ErrorBoundary>` 로 감싼다(`src/App.tsx:1060`). 인앱 업데이트 모달·설정 모달도 `App` 에서 렌더링(`src/App.tsx:1512`).

## 회귀 증상별 원인

| 증상 | 원인 |
|------|------|
| dev 서버 포트 충돌로 실행 실패 | Vite `strictPort: true`(1420 고정) — 점유 프로세스 종료 필요 (`vite.config.ts:16-18`) |
| Gemini/OAuth 호출이 CSP/권한 차단 | `capabilities/default.json` HTTP allow 목록에 오리진 누락 |
| 결과 폴더 "열기" 실패 | `opener:allow-open-path` 스코프(`$DOWNLOAD/AI_Gen`) 밖 경로 |
| 업데이트 확인은 되는데 설치 안 됨 | 로컬 빌드(`tauri.local.conf.json`)는 업데이터 아티팩트 미생성 |
| 버전 표시 불일치 | 3파일 중 하나만 수정 — `bump-version.sh` 로 일괄 갱신 |
| 릴리스 콘솔 창 뜸 | `main.rs:2` `windows_subsystem` 지시자 제거됨 |
