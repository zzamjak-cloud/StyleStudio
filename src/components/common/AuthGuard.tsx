import { ReactNode } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { LoginScreen } from './LoginScreen'
import { Loader2 } from 'lucide-react'

interface AuthGuardProps {
  children: ReactNode
  appName?: string
}

export function AuthGuard({ children, appName }: AuthGuardProps) {
  const { status, error, login, cancelLogin } = useAuth()

  // 로딩 중
  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-900 via-indigo-900 to-blue-900">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 animate-spin text-purple-400" />
          <p className="text-white/70">인증 확인 중...</p>
        </div>
      </div>
    )
  }

  // 인증 안됨 또는 코드 입력 대기 중
  if (status === 'unauthenticated' || status === 'awaiting_code') {
    return (
      <LoginScreen
        onLogin={login}
        onCancelLogin={cancelLogin}
        error={error}
        isAwaitingCode={status === 'awaiting_code'}
        appName={appName}
      />
    )
  }

  // 인증됨 - 자식 컴포넌트 렌더링
  return <>{children}</>
}

// 사용자 정보 표시 컴포넌트 (헤더 등에서 사용)
export function UserInfo() {
  const { user, logout } = useAuth()

  if (!user) return null

  return (
    <div className="flex items-center gap-3">
      {user.picture && (
        <img
          src={user.picture}
          alt={user.name}
          className="w-8 h-8 rounded-full"
        />
      )}
      <div className="hidden md:block">
        <p className="text-sm font-medium text-gray-900">{user.name}</p>
        <p className="text-xs text-gray-500">{user.email}</p>
      </div>
      <button
        onClick={logout}
        className="text-xs text-gray-500 hover:text-gray-700 transition-colors"
      >
        로그아웃
      </button>
    </div>
  )
}
