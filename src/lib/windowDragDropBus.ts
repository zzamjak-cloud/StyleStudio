import { getCurrentWindow } from '@tauri-apps/api/window';

type DragDropEventPayload = {
  type: 'enter' | 'over' | 'leave' | 'drop';
  paths?: string[];
  position?: { x: number; y: number };
};

export type WindowDragDropEvent = {
  payload: DragDropEventPayload;
};

type DragDropHandler = (event: WindowDragDropEvent) => void | Promise<void>;

const handlers = new Map<number, DragDropHandler>();
let nextHandlerId = 1;
let listenerInitialized = false;
let initializePromise: Promise<void> | null = null;

async function ensureGlobalDragDropListener(): Promise<void> {
  if (listenerInitialized) return;
  if (initializePromise) return initializePromise;

  initializePromise = (async () => {
    try {
      const appWindow = getCurrentWindow();
      await appWindow.onDragDropEvent((event) => {
        const normalizedEvent = event as unknown as WindowDragDropEvent;
        for (const handler of handlers.values()) {
          Promise.resolve(handler(normalizedEvent)).catch((error) => {
            console.error('드래그 핸들러 실행 실패:', error);
          });
        }
      });
      listenerInitialized = true;
    } catch (error) {
      console.error('전역 드래그 리스너 등록 실패:', error);
    } finally {
      initializePromise = null;
    }
  })();

  return initializePromise;
}

export function subscribeWindowDragDrop(handler: DragDropHandler): () => void {
  const handlerId = nextHandlerId++;
  handlers.set(handlerId, handler);
  void ensureGlobalDragDropListener();

  return () => {
    handlers.delete(handlerId);
  };
}
