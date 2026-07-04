# 인증 — Google OAuth (Loopback + PKCE)

앱 전체가 **Google OAuth 로그인 게이트** 뒤에 있다(`main.tsx` 의 `<AuthGuard>`). 데스크톱용 **loopback 리다이렉트 + PKCE(S256)** 방식으로, Rust 가 로컬 HTTP 서버(`127.0.0.1:9528`)를 띄워 Google 콜백을 받고, 프런트가 인증 코드를 토큰으로 교환한다. **`loadcomplete.com` 도메인 구성원만** 허용한다(hd 클레임 또는 이메일 도메인 검증). 토큰·사용자 정보는 Tauri `store`(`auth.json`)에 영속되며, 만료 시 refresh token 으로 자동 갱신한다.

## 관련 파일
- `src/lib/services/authService.ts` — OAuth 코어(PKCE·토큰 교환/갱신·저장·도메인검증). `startGoogleLogin`/`completeGoogleLogin`/`getCurrentUser`/`getValidAccessToken`/`logout`
- `src/hooks/useAuth.ts` — React 인증 상태 머신. `useAuth()`
- `src/components/common/AuthGuard.tsx` — 인증 게이트 + `UserInfo`
- `src/components/common/LoginScreen.tsx` — 로그인 화면 / 브라우저 대기 화면
- `src-tauri/src/oauth_server.rs` — 로컬 콜백 HTTP 서버(`start_oauth_server` 커맨드)
- `src-tauri/src/lib.rs:14` — `invoke_handler`(`start_oauth_server`) 등록
- `src-tauri/capabilities/default.json:90-102` — OAuth 오리진 HTTP allow
- `.env` / `.env.example` — `VITE_GOOGLE_CLIENT_ID`·`VITE_GOOGLE_CLIENT_SECRET`·`VITE_ALLOWED_DOMAIN`

## 데이터 모델

```ts
GoogleUser = { email: string, name: string, picture?: string, hd?: string /* hosted domain */ }

GoogleTokens = { access_token: string, refresh_token?: string, id_token: string, expires_at: number /* epoch ms */ }

AuthStatus = 'loading' | 'authenticated' | 'unauthenticated' | 'awaiting_code'
```

저장 위치(Tauri store): 파일 `auth.json`, 키 `google_tokens`·`google_user` (`authService.ts:23-26`).

## OAuth 흐름 (전체)

```
useAuth.login()
  └─ authService.startGoogleLogin()
       1. PKCE codeVerifier/codeChallenge + state(CSRF) 생성       (:269-273)
       2. 'oauth-callback'/'oauth-error' 이벤트 리스너 등록          (:279-297)
       3. invoke('start_oauth_server')  → Rust 가 127.0.0.1:9528 서버 起動
       4. openUrl(Google auth URL) — 시스템 브라우저로 로그인        (:304-319)
       5. 5분 타임아웃 설정                                          (:322-327)
  [사용자가 브라우저에서 로그인]
  Google → http://127.0.0.1:9528/?code=...&state=...
  └─ oauth_server.rs: code/state 추출 → emit('oauth-callback')      → 성공 HTML 응답
  └─ 리스너가 completeGoogleLogin(code, state) 호출                  (:279-287)
       6. state 검증 → exchangeCodeForTokens(code, verifier)        (:356-361)
       7. decodeIdToken → validateDomain(loadcomplete.com)          (:364-369)
       8. saveTokens + saveUser → resolve(user)                      (:371-377)
```

### PKCE / URL 파라미터 (authService.ts:304-314)
`response_type=code`, `scope=openid email profile`, `code_challenge_method=S256`, `state`(CSRF), `hd=loadcomplete.com`(계정 선택 힌트), `prompt=select_account`, `access_type=offline`(refresh token 수령).

### Rust 콜백 서버 (oauth_server.rs)
- `start_oauth_server` 커맨드 → 별도 스레드에서 `tiny_http` 서버를 `127.0.0.1:9528` 에 起動 (`oauth_server.rs:27-44`)
- **단일 요청만** 처리(`incoming_requests().next()`) — 콜백 1회 후 종료 (`:47`)
- `error` 파라미터 → `emit('oauth-error')` + 에러 HTML (`:55-67`)
- `code` 파라미터 → `emit('oauth-callback', {code, state})` + 성공 HTML(3초 후 자동 닫힘) (`:71-87`, `:167-170`)
- 포트 점유 실패 시 `oauth-error`(`server_start_failed`) (`:34-41`)

### 도메인 검증 (authService.ts:239-251)
`user.hd === 'loadcomplete.com'` 또는 `email.endsWith('@loadcomplete.com')` 중 하나면 통과. 실패 시 `이 앱은 loadcomplete.com 사용자만…` 에러로 reject.

## 토큰 수명 관리 (authService.ts)

- `getCurrentUser()` — 토큰 로드 → 만료면 refresh, refresh token 없으면 로그아웃(null) (`:393-416`)
- `isTokenExpired()` — `Date.now() >= expires_at - 60000`(1분 여유) (`:149-151`)
- `refreshAccessToken()` — `grant_type=refresh_token`, **10초 AbortController 타임아웃**, 기존 refresh token 유지 (`:154-196`)
- `getValidAccessToken()` — API 호출용 유효 access token 반환(만료 시 자동 갱신) (`:425-447`)
- `exchangeCodeForTokens()` — `grant_type=authorization_code` + `code_verifier`(PKCE) (`:199-236`)
- `decodeIdToken()` — JWT payload 를 **UTF-8 디코딩**(한글 이름 지원) 후 파싱 (`:81-107`)

## 상태 머신 (useAuth.ts)

| 액션 | 전이 |
|------|------|
| 마운트 → `checkAuth()` | `loading` → `authenticated`/`unauthenticated` |
| `login()` | `awaiting_code` → 성공 시 `authenticated` |
| `completeLogin(code)` | 수동 코드 입력 경로(자동 콜백 실패 대비) |
| `cancelLogin()` | `cancelPendingAuth()` → `unauthenticated` |
| `logout()` | `authenticated` → `unauthenticated` |

`login()` 은 `startGoogleLogin()` 을 **await 하지 않고**(.then/.catch) 즉시 `awaiting_code` 로 전환 — 브라우저 로그인 동안 대기 화면 노출 (`useAuth.ts:64-74`).

## 게이트 · UI

- `AuthGuard`(`AuthGuard.tsx:11-41`): `loading` → 스피너, `unauthenticated`/`awaiting_code` → `LoginScreen`, `authenticated` → children.
- `LoginScreen`(`LoginScreen.tsx`): 초기 화면(Google 버튼) / `isAwaitingCode` 시 "브라우저에서 로그인 해주세요" 대기 화면 + 취소.
- `UserInfo`(`AuthGuard.tsx:44-70`): 사용자 아바타·이름·이메일 + 로그아웃(헤더용). `SettingsModal` 에도 계정/로그아웃 섹션 존재.

## 리소스 정리 (cleanup)

`cleanup()`(`authService.ts:337-344`)이 `pendingAuth` 의 리스너 2개(`unlistenCallback`/`unlistenError`)·타임아웃을 해제하고 `pendingAuth = null`. 성공·실패·취소·타임아웃 모든 경로에서 호출.

## 회귀 증상별 원인

| 증상 | 원인 |
|------|------|
| 로그인 시작 시 throw(환경변수) | `.env` 의 `VITE_GOOGLE_CLIENT_ID`/`SECRET` 누락 (`authService.ts:14-16`) |
| 콜백이 앱에 안 돌아옴 | 포트 9528 점유(→`server_start_failed`), 또는 Google redirect URI ≠ `http://127.0.0.1:9528` |
| "Invalid state parameter" | CSRF state 불일치(재시도 중 이전 세션 콜백) (`:356`) |
| "loadcomplete.com 사용자만" | 개인 계정 로그인 — hd/이메일 도메인 미일치 (`:367`) |
| 5분 후 자동 실패 | 브라우저 로그인 미완료 타임아웃 (`:322-327`) |
| 재시작 후 재로그인 요구 | refresh token 없음(`access_type=offline` 미적용/최초 동의 안 함) → `getCurrentUser` null |
| 한글 이름 깨짐 | (해결됨) `decodeIdToken` UTF-8 디코딩 (`:92-97`) |
| OAuth HTTP 차단 | `capabilities/default.json` 의 accounts/oauth2 오리진 allow 필요 |
