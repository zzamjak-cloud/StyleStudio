import { useState, useEffect, useCallback } from 'react'
import { check, Update } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'

// 업데이트 상태 타입
export type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error'

interface UpdateState {
  status: UpdateStatus
  update: Update | null
  progress: number
  error: string | null
}

interface UseAutoUpdateReturn {
  status: UpdateStatus
  update: Update | null
  progress: number
  error: string | null
  checkForUpdate: () => Promise<void>
  downloadAndInstall: () => Promise<void>
  dismissUpdate: () => void
}

export function useAutoUpdate(): UseAutoUpdateReturn {
  const [state, setState] = useState<UpdateState>({
    status: 'idle',
    update: null,
    progress: 0,
    error: null,
  })

  // 업데이트 확인
  const checkForUpdate = useCallback(async () => {
    setState(prev => ({ ...prev, status: 'checking', error: null }))

    try {
      const update = await check()

      if (update) {
        console.log(`[AutoUpdate] 새 버전 발견: ${update.version}`)
        setState(prev => ({
          ...prev,
          status: 'available',
          update,
        }))
      } else {
        console.log('[AutoUpdate] 최신 버전입니다.')
        setState(prev => ({ ...prev, status: 'idle' }))
      }
    } catch (error) {
      // 릴리스 서버가 설정되지 않은 경우 (개발 환경) 조용히 무시
      const errorMessage = error instanceof Error ? error.message : String(error)
      if (errorMessage.includes('Could not fetch') || errorMessage.includes('network error')) {
        console.log('[AutoUpdate] 업데이트 서버 미설정 - 건너뜀')
        setState(prev => ({ ...prev, status: 'idle' }))
      } else {
        console.error('[AutoUpdate] 업데이트 확인 실패:', error)
        setState(prev => ({
          ...prev,
          status: 'error',
          error: errorMessage,
        }))
      }
    }
  }, [])

  // 다운로드 및 설치
  const downloadAndInstall = useCallback(async () => {
    if (!state.update) return

    setState(prev => ({ ...prev, status: 'downloading', progress: 0 }))

    try {
      let downloaded = 0
      let contentLength = 0

      await state.update.downloadAndInstall((event) => {
        switch (event.event) {
          case 'Started':
            contentLength = event.data.contentLength || 0
            console.log(`[AutoUpdate] 다운로드 시작: ${contentLength} bytes`)
            break
          case 'Progress':
            downloaded += event.data.chunkLength
            const progress = contentLength > 0
              ? Math.round((downloaded / contentLength) * 100)
              : 0
            setState(prev => ({ ...prev, progress }))
            break
          case 'Finished':
            console.log('[AutoUpdate] 다운로드 완료')
            setState(prev => ({ ...prev, status: 'ready', progress: 100 }))
            break
        }
      })

      // 앱 재시작
      console.log('[AutoUpdate] 앱 재시작 중...')
      await relaunch()
    } catch (error) {
      console.error('[AutoUpdate] 다운로드/설치 실패:', error)
      setState(prev => ({
        ...prev,
        status: 'error',
        error: error instanceof Error ? error.message : '업데이트 설치에 실패했습니다.',
      }))
    }
  }, [state.update])

  // 업데이트 무시
  const dismissUpdate = useCallback(() => {
    setState({
      status: 'idle',
      update: null,
      progress: 0,
      error: null,
    })
  }, [])

  // 앱 시작 시 자동으로 업데이트 확인 (3초 후)
  useEffect(() => {
    const timer = setTimeout(() => {
      checkForUpdate()
    }, 3000)

    return () => clearTimeout(timer)
  }, [checkForUpdate])

  return {
    status: state.status,
    update: state.update,
    progress: state.progress,
    error: state.error,
    checkForUpdate,
    downloadAndInstall,
    dismissUpdate,
  }
}
