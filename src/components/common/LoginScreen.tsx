import { useState } from 'react'
import { Loader2, AlertCircle, Building2, ArrowLeft, ExternalLink } from 'lucide-react'

interface LoginScreenProps {
  onLogin: () => Promise<void>
  onCancelLogin: () => void
  error: string | null
  isAwaitingCode: boolean
  appName?: string
}

export function LoginScreen({
  onLogin,
  onCancelLogin,
  error,
  isAwaitingCode,
  appName = 'Style Studio'
}: LoginScreenProps) {
  const [isLoading, setIsLoading] = useState(false)

  const handleLogin = async () => {
    setIsLoading(true)
    try {
      await onLogin()
    } finally {
      setIsLoading(false)
    }
  }

  const handleCancel = () => {
    onCancelLogin()
  }

  // 브라우저 로그인 대기 화면 (자동 콜백)
  if (isAwaitingCode) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-900 via-indigo-900 to-blue-900">
        <div className="max-w-md w-full mx-4">
          <div className="bg-white/95 backdrop-blur-sm border border-gray-200 rounded-2xl shadow-2xl p-8">
            {/* 뒤로가기 */}
            <button
              onClick={handleCancel}
              className="flex items-center gap-2 text-gray-500 hover:text-gray-700 transition-colors mb-6"
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="text-sm">취소</span>
            </button>

            {/* 안내 */}
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-blue-100 rounded-xl flex items-center justify-center mx-auto mb-4">
                <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
              </div>
              <h2 className="text-xl font-semibold text-gray-900 mb-2">
                브라우저에서 로그인 해주세요
              </h2>
              <p className="text-sm text-gray-600">
                브라우저에서 Google 로그인을 완료하면<br />
                자동으로 앱에 로그인됩니다.
              </p>
            </div>

            {/* 에러 메시지 */}
            {error && (
              <div className="flex items-start gap-2 text-sm text-red-600 bg-red-50 rounded-lg p-3 mb-4">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {/* 도움말 */}
            <div className="bg-gray-50 rounded-lg p-4 text-sm">
              <p className="text-gray-600 text-center">
                <ExternalLink className="w-4 h-4 inline-block mr-1" />
                브라우저 창이 열리지 않았다면<br />
                다시 시도해 주세요.
              </p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // 초기 로그인 화면
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-900 via-indigo-900 to-blue-900">
      <div className="max-w-md w-full mx-4">
        {/* 카드 */}
        <div className="bg-white/95 backdrop-blur-sm border border-gray-200 rounded-2xl shadow-2xl p-8">
          {/* 로고 및 타이틀 */}
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-gradient-to-br from-purple-500 to-blue-500 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
              <span className="text-3xl">🎨</span>
            </div>
            <h1 className="text-2xl font-bold text-gray-900">{appName}</h1>
            <p className="text-gray-600 mt-2">
              Loadcomplete.com 계정으로 로그인하세요
            </p>
          </div>

          {/* 조직 정보 */}
          <div className="flex items-center gap-2 text-sm text-gray-600 bg-gray-100 rounded-lg p-3 mb-6">
            <Building2 className="w-4 h-4 flex-shrink-0" />
            <span>이 앱은 Loadcomplete.com 조직 구성원만 사용할 수 있습니다.</span>
          </div>

          {/* 에러 메시지 */}
          {error && (
            <div className="flex items-start gap-2 text-sm text-red-600 bg-red-50 rounded-lg p-3 mb-6">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* 로그인 버튼 */}
          <button
            onClick={handleLogin}
            disabled={isLoading}
            className="w-full flex items-center justify-center gap-3 px-6 py-3 bg-white text-gray-700 font-medium rounded-lg border border-gray-300 hover:bg-gray-50 hover:shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <>
                {/* Google 로고 */}
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  />
                </svg>
                <span>Google 계정으로 로그인</span>
              </>
            )}
          </button>

          {/* 도움말 */}
          <p className="text-xs text-center text-gray-500 mt-6">
            로그인에 문제가 있으신가요?<br />
            관리자에게 문의하세요.
          </p>
        </div>

        {/* 저작권 */}
        <p className="text-center text-xs text-white/50 mt-6">
          © 2025 Loadcomplete. All rights reserved.
        </p>
      </div>
    </div>
  )
}
