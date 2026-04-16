import { useState, useEffect, useCallback } from 'react'
import {
  GoogleUser,
  getCurrentUser,
  startGoogleLogin,
  completeGoogleLogin,
  logout as authLogout,
  cancelPendingAuth,
} from '../lib/services/authService'

// 인증 상태 타입
export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated' | 'awaiting_code'

interface UseAuthReturn {
  status: AuthStatus
  user: GoogleUser | null
  error: string | null
  login: () => Promise<void>
  completeLogin: (code: string) => Promise<void>
  cancelLogin: () => void
  logout: () => Promise<void>
  checkAuth: () => Promise<void>
}

export function useAuth(): UseAuthReturn {
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [user, setUser] = useState<GoogleUser | null>(null)
  const [error, setError] = useState<string | null>(null)

  // 인증 상태 확인
  const checkAuth = useCallback(async () => {
    setStatus('loading')
    setError(null)

    try {
      const currentUser = await getCurrentUser()
      if (currentUser) {
        setUser(currentUser)
        setStatus('authenticated')
        console.log('[Auth] 인증됨:', currentUser.email)
      } else {
        setUser(null)
        setStatus('unauthenticated')
        console.log('[Auth] 인증 안됨')
      }
    } catch (err) {
      console.error('[Auth] 인증 확인 실패:', err)
      setUser(null)
      setStatus('unauthenticated')
      setError(err instanceof Error ? err.message : '인증 확인에 실패했습니다.')
    }
  }, [])

  // Google 로그인 시작 (브라우저 열기)
  const login = useCallback(async () => {
    setError(null)

    try {
      console.log('[Auth] Google 로그인 시작...')
      setStatus('awaiting_code')

      // 브라우저 열고 pending 상태로 전환
      // startGoogleLogin은 completeGoogleLogin이 호출될 때까지 대기
      startGoogleLogin()
        .then((loggedInUser) => {
          setUser(loggedInUser)
          setStatus('authenticated')
          console.log('[Auth] 로그인 성공:', loggedInUser.email)
        })
        .catch((err) => {
          console.error('[Auth] 로그인 실패:', err)
          setError(err instanceof Error ? err.message : '로그인에 실패했습니다.')
          setStatus('unauthenticated')
        })
    } catch (err) {
      console.error('[Auth] 로그인 시작 실패:', err)
      setError(err instanceof Error ? err.message : '로그인 시작에 실패했습니다.')
      setStatus('unauthenticated')
    }
  }, [])

  // 인증 코드로 로그인 완료
  const completeLogin = useCallback(async (code: string) => {
    setError(null)

    try {
      console.log('[Auth] 인증 코드로 로그인 완료 시도...')
      const loggedInUser = await completeGoogleLogin(code.trim())
      setUser(loggedInUser)
      setStatus('authenticated')
      console.log('[Auth] 로그인 성공:', loggedInUser.email)
    } catch (err) {
      console.error('[Auth] 로그인 완료 실패:', err)
      setError(err instanceof Error ? err.message : '로그인에 실패했습니다.')
      setStatus('unauthenticated')
    }
  }, [])

  // 로그인 취소
  const cancelLogin = useCallback(() => {
    cancelPendingAuth()
    setStatus('unauthenticated')
    setError(null)
    console.log('[Auth] 로그인 취소됨')
  }, [])

  // 로그아웃
  const logout = useCallback(async () => {
    try {
      await authLogout()
      setUser(null)
      setStatus('unauthenticated')
      setError(null)
      console.log('[Auth] 로그아웃 완료')
    } catch (err) {
      console.error('[Auth] 로그아웃 실패:', err)
      setError(err instanceof Error ? err.message : '로그아웃에 실패했습니다.')
    }
  }, [])

  // 컴포넌트 마운트 시 인증 상태 확인
  useEffect(() => {
    checkAuth()
  }, [checkAuth])

  return {
    status,
    user,
    error,
    login,
    completeLogin,
    cancelLogin,
    logout,
    checkAuth,
  }
}
