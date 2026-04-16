import { Store } from '@tauri-apps/plugin-store'
import { openUrl } from '@tauri-apps/plugin-opener'
import { invoke } from '@tauri-apps/api/core'
import { listen, UnlistenFn } from '@tauri-apps/api/event'

// Google OAuth 설정
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID
const GOOGLE_CLIENT_SECRET = import.meta.env.VITE_GOOGLE_CLIENT_SECRET
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const ALLOWED_DOMAIN = import.meta.env.VITE_ALLOWED_DOMAIN || 'loadcomplete.com'

// 환경 변수 검증
if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
  throw new Error('Google OAuth 환경 변수가 설정되지 않았습니다. .env 파일을 확인하세요.')
}

// Loopback 리다이렉트 (Google이 데스크톱 앱에서 허용하는 방식)
const REDIRECT_HOST = '127.0.0.1'
const REDIRECT_PORT = 9528 // StyleStudio용 포트 (GamePlanner와 다름)
const REDIRECT_URI = `http://${REDIRECT_HOST}:${REDIRECT_PORT}`

// 스토어 키
const AUTH_STORE_KEY = 'auth.json'
const TOKEN_KEY = 'google_tokens'
const USER_KEY = 'google_user'

// 토큰 타입
interface GoogleTokens {
  access_token: string
  refresh_token?: string
  id_token: string
  expires_at: number
}

// 사용자 정보 타입
export interface GoogleUser {
  email: string
  name: string
  picture?: string
  hd?: string // Hosted domain (Google Workspace)
}

// OAuth 콜백 이벤트 페이로드
interface OAuthCallbackPayload {
  code: string
  state: string | null
}

interface OAuthErrorPayload {
  error: string
  error_description: string | null
}

// PKCE 코드 생성
function generateCodeVerifier(): string {
  const array = new Uint8Array(32)
  crypto.getRandomValues(array)
  return base64UrlEncode(array)
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(verifier)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return base64UrlEncode(new Uint8Array(hash))
}

function base64UrlEncode(buffer: Uint8Array): string {
  let binary = ''
  buffer.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

// ID 토큰 디코딩 (간단한 JWT 파싱)
function decodeIdToken(idToken: string): GoogleUser {
  const parts = idToken.split('.')
  if (parts.length !== 3) {
    throw new Error('Invalid ID token format')
  }

  const payload = parts[1]
  // Base64 디코딩 후 UTF-8로 변환
  const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
  const binaryString = atob(base64)

  // UTF-8 디코딩 (한글 등 유니코드 문자 지원)
  const bytes = new Uint8Array(binaryString.length)
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }
  const decoded = new TextDecoder('utf-8').decode(bytes)

  const claims = JSON.parse(decoded)

  return {
    email: claims.email,
    name: claims.name,
    picture: claims.picture,
    hd: claims.hd, // Hosted domain
  }
}

// 스토어 가져오기
async function getAuthStore(): Promise<Store> {
  return await Store.load(AUTH_STORE_KEY)
}

// 토큰 저장
async function saveTokens(tokens: GoogleTokens): Promise<void> {
  const store = await getAuthStore()
  await store.set(TOKEN_KEY, tokens)
  await store.save()
}

// 토큰 불러오기
async function loadTokens(): Promise<GoogleTokens | null> {
  const store = await getAuthStore()
  return (await store.get<GoogleTokens>(TOKEN_KEY)) ?? null
}

// 사용자 정보 저장
async function saveUser(user: GoogleUser): Promise<void> {
  const store = await getAuthStore()
  await store.set(USER_KEY, user)
  await store.save()
}

// 사용자 정보 불러오기
async function loadUser(): Promise<GoogleUser | null> {
  const store = await getAuthStore()
  return (await store.get<GoogleUser>(USER_KEY)) ?? null
}

// 토큰 삭제 (로그아웃)
async function clearAuth(): Promise<void> {
  const store = await getAuthStore()
  await store.delete(TOKEN_KEY)
  await store.delete(USER_KEY)
  await store.save()
}

// 토큰 만료 확인
function isTokenExpired(tokens: GoogleTokens): boolean {
  return Date.now() >= tokens.expires_at - 60000 // 1분 여유
}

// 토큰 갱신 (10초 타임아웃)
async function refreshAccessToken(refreshToken: string): Promise<GoogleTokens> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 10000)

  try {
    const response = await window.fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }).toString(),
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new Error('Token refresh failed')
    }

    const data = await response.json() as {
      access_token: string
      id_token: string
      expires_in: number
      refresh_token?: string
    }

    const tokens: GoogleTokens = {
      access_token: data.access_token,
      id_token: data.id_token,
      refresh_token: refreshToken, // 기존 refresh token 유지
      expires_at: Date.now() + data.expires_in * 1000,
    }

    await saveTokens(tokens)
    return tokens
  } finally {
    clearTimeout(timeoutId)
  }
}

// 인증 코드를 토큰으로 교환
async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string
): Promise<GoogleTokens> {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      code,
      code_verifier: codeVerifier,
      grant_type: 'authorization_code',
      redirect_uri: REDIRECT_URI,
    }).toString(),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Token exchange failed: ${error}`)
  }

  const data = await response.json() as {
    access_token: string
    id_token: string
    expires_in: number
    refresh_token?: string
  }

  return {
    access_token: data.access_token,
    id_token: data.id_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
  }
}

// 도메인 검증
function validateDomain(user: GoogleUser): boolean {
  // hd (hosted domain) 체크
  if (user.hd === ALLOWED_DOMAIN) {
    return true
  }

  // 이메일 도메인 백업 체크
  if (user.email.endsWith(`@${ALLOWED_DOMAIN}`)) {
    return true
  }

  return false
}

// OAuth 인증 상태
let pendingAuth: {
  codeVerifier: string
  state: string
  resolve: (user: GoogleUser) => void
  reject: (error: Error) => void
  unlistenCallback?: UnlistenFn
  unlistenError?: UnlistenFn
  timeoutId?: ReturnType<typeof setTimeout>
} | null = null

// OAuth 로그인 시작 (자동 콜백 서버 사용)
export async function startGoogleLogin(): Promise<GoogleUser> {
  return new Promise(async (resolve, reject) => {
    try {
      // PKCE 코드 생성
      const codeVerifier = generateCodeVerifier()
      const codeChallenge = await generateCodeChallenge(codeVerifier)

      // 상태 토큰 생성 (CSRF 방지)
      const state = generateCodeVerifier()

      // pending 상태 저장
      pendingAuth = { codeVerifier, state, resolve, reject }

      // OAuth 콜백 이벤트 리스너 등록
      const unlistenCallback = await listen<OAuthCallbackPayload>('oauth-callback', async (event) => {
        console.log('[Auth] OAuth 콜백 수신:', event.payload)
        try {
          await completeGoogleLogin(event.payload.code, event.payload.state ?? undefined)
          // completeGoogleLogin에서 resolve 호출됨
        } catch {
          // completeGoogleLogin에서 reject 호출됨
        }
      })

      const unlistenError = await listen<OAuthErrorPayload>('oauth-error', (event) => {
        console.error('[Auth] OAuth 에러:', event.payload)
        cleanup()
        reject(new Error(event.payload.error_description || event.payload.error))
      })

      // 리스너 저장 (cleanup용)
      pendingAuth.unlistenCallback = unlistenCallback
      pendingAuth.unlistenError = unlistenError

      // Rust 백엔드에서 로컬 OAuth 서버 시작
      console.log('[Auth] OAuth 콜백 서버 시작...')
      await invoke('start_oauth_server')

      // Google OAuth URL 생성
      const authUrl = new URL(GOOGLE_AUTH_URL)
      authUrl.searchParams.set('client_id', GOOGLE_CLIENT_ID)
      authUrl.searchParams.set('redirect_uri', REDIRECT_URI)
      authUrl.searchParams.set('response_type', 'code')
      authUrl.searchParams.set('scope', 'openid email profile')
      authUrl.searchParams.set('code_challenge', codeChallenge)
      authUrl.searchParams.set('code_challenge_method', 'S256')
      authUrl.searchParams.set('state', state)
      authUrl.searchParams.set('hd', ALLOWED_DOMAIN) // 도메인 힌트 (UI 필터링)
      authUrl.searchParams.set('prompt', 'select_account')
      authUrl.searchParams.set('access_type', 'offline') // refresh token 받기 위해

      console.log('[Auth] 브라우저에서 Google 로그인 열기...')

      // 시스템 브라우저로 열기
      await openUrl(authUrl.toString())

      // 타임아웃 설정 (5분)
      pendingAuth.timeoutId = setTimeout(() => {
        if (pendingAuth) {
          cleanup()
          reject(new Error('로그인 시간이 초과되었습니다. 다시 시도해주세요.'))
        }
      }, 5 * 60 * 1000)

    } catch (error) {
      cleanup()
      reject(error)
    }
  })
}

// 리소스 정리
function cleanup() {
  if (pendingAuth) {
    if (pendingAuth.unlistenCallback) pendingAuth.unlistenCallback()
    if (pendingAuth.unlistenError) pendingAuth.unlistenError()
    if (pendingAuth.timeoutId) clearTimeout(pendingAuth.timeoutId)
    pendingAuth = null
  }
}

// 인증 코드로 로그인 완료 (자동 또는 수동)
export async function completeGoogleLogin(authCode: string, returnedState?: string): Promise<GoogleUser> {
  if (!pendingAuth) {
    throw new Error('로그인 세션이 없습니다. 다시 로그인을 시작해주세요.')
  }

  const { codeVerifier, state, resolve, reject } = pendingAuth

  try {
    // state 검증 (제공된 경우)
    if (returnedState && returnedState !== state) {
      throw new Error('Invalid state parameter')
    }

    // 토큰 교환
    const tokens = await exchangeCodeForTokens(authCode, codeVerifier)

    // ID 토큰에서 사용자 정보 추출
    const user = decodeIdToken(tokens.id_token)

    // 도메인 검증
    if (!validateDomain(user)) {
      throw new Error(`이 앱은 ${ALLOWED_DOMAIN} 사용자만 사용할 수 있습니다.`)
    }

    // 토큰 및 사용자 정보 저장
    await saveTokens(tokens)
    await saveUser(user)

    cleanup()
    resolve(user)
    return user

  } catch (error) {
    cleanup()
    reject(error as Error)
    throw error
  }
}

// 로그아웃
export async function logout(): Promise<void> {
  cleanup()
  await clearAuth()
}

// 현재 인증된 사용자 가져오기
export async function getCurrentUser(): Promise<GoogleUser | null> {
  const tokens = await loadTokens()
  if (!tokens) {
    return null
  }

  // 토큰 만료 확인 및 갱신
  if (isTokenExpired(tokens)) {
    if (tokens.refresh_token) {
      try {
        await refreshAccessToken(tokens.refresh_token)
      } catch {
        // 갱신 실패 시 로그아웃
        await clearAuth()
        return null
      }
    } else {
      await clearAuth()
      return null
    }
  }

  return await loadUser()
}

// 인증 상태 확인
export async function isAuthenticated(): Promise<boolean> {
  const user = await getCurrentUser()
  return user !== null
}

// 유효한 액세스 토큰 가져오기
export async function getValidAccessToken(): Promise<string | null> {
  const tokens = await loadTokens()
  if (!tokens) {
    return null
  }

  if (isTokenExpired(tokens)) {
    if (tokens.refresh_token) {
      try {
        const newTokens = await refreshAccessToken(tokens.refresh_token)
        return newTokens.access_token
      } catch {
        await clearAuth()
        return null
      }
    } else {
      await clearAuth()
      return null
    }
  }

  return tokens.access_token
}

// pending 인증 상태 확인
export function hasPendingAuth(): boolean {
  return pendingAuth !== null
}

// pending 인증 취소
export function cancelPendingAuth(): void {
  if (pendingAuth) {
    pendingAuth.reject(new Error('로그인이 취소되었습니다.'))
    cleanup()
  }
}
