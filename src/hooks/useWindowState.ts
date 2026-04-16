// 창 크기 및 위치 저장/복원 커스텀 훅

import { useEffect } from 'react';
import { getCurrentWindow, PhysicalPosition, PhysicalSize } from '@tauri-apps/api/window';
import { saveWindowState, getWindowState } from '../lib/storage';
import { logger } from '../lib/logger';

export function useWindowState() {
  useEffect(() => {
    const appWindow = getCurrentWindow();

    // 저장된 창 상태 복원
    const restoreWindowState = async () => {
      try {
        const savedState = await getWindowState();

        if (savedState && !savedState.maximized) {
          // 창 위치/크기 유효성 검사
          const isValidPosition =
            savedState.x >= -100 && // 약간의 음수는 허용 (멀티 모니터)
            savedState.y >= -100 &&
            savedState.x < 10000 && // 비정상적으로 큰 값 방지
            savedState.y < 10000;

          const isValidSize =
            savedState.width >= 800 &&
            savedState.width <= 10000 &&
            savedState.height >= 600 &&
            savedState.height <= 10000;

          if (isValidPosition && isValidSize) {
            // 유효한 경우에만 저장된 크기와 위치 복원
            logger.debug('🪟 저장된 창 상태 복원:', savedState);
            await appWindow.setPosition(new PhysicalPosition(savedState.x, savedState.y));
            await appWindow.setSize(new PhysicalSize(savedState.width, savedState.height));
          } else {
            // 유효하지 않으면 기본 최대화
            logger.warn('🪟 저장된 창 상태가 유효하지 않음, 기본 최대화 적용:', savedState);
            await appWindow.maximize();
          }
        } else if (savedState && savedState.maximized) {
          // 최대화 상태였으면 최대화
          logger.debug('🪟 창 최대화 상태 복원');
          await appWindow.maximize();
        } else {
          // 저장된 상태가 없으면 기본 최대화
          logger.debug('🪟 기본 최대화 상태 적용');
          await appWindow.maximize();
        }
      } catch (error) {
        console.error('❌ 창 상태 복원 실패:', error);
        // 에러 발생 시 기본 최대화
        try {
          await appWindow.maximize();
        } catch (e) {
          console.error('❌ 창 최대화 실패:', e);
        }
      }
    };

    // 앱 시작 시 창 상태 복원
    restoreWindowState();

    // 창 크기/위치 변경 시 저장
    let saveTimeout: ReturnType<typeof setTimeout> | null = null;

    const handleWindowChange = async () => {
      // 디바운싱: 0.5초 후에 저장
      if (saveTimeout) {
        clearTimeout(saveTimeout);
      }

      saveTimeout = setTimeout(async () => {
        try {
          const position = await appWindow.outerPosition();
          const size = await appWindow.outerSize();
          const maximized = await appWindow.isMaximized();

          const windowState = {
            x: position.x,
            y: position.y,
            width: size.width,
            height: size.height,
            maximized,
          };

          await saveWindowState(windowState);
          logger.debug('🪟 창 상태 저장:', windowState);
        } catch (error) {
          console.error('창 상태 저장 실패:', error);
        }
      }, 500);
    };

    // 창 이벤트 리스너 등록
    const setupListeners = async () => {
      try {
        const unlistenResize = await appWindow.onResized(handleWindowChange);
        const unlistenMove = await appWindow.onMoved(handleWindowChange);

        // 클린업
        return () => {
          unlistenResize();
          unlistenMove();
          if (saveTimeout) {
            clearTimeout(saveTimeout);
          }
        };
      } catch (error) {
        console.error('창 이벤트 리스너 등록 실패:', error);
        return () => {};
      }
    };

    let cleanup: (() => void) | undefined;

    setupListeners().then((fn) => {
      cleanup = fn;
    });

    return () => {
      if (cleanup) {
        cleanup();
      }
    };
  }, []);
}
