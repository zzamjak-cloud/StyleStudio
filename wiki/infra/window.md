# 윈도우 상태 · 드래그앤드롭 · 로거

데스크톱 셸 주변의 세 가지 유틸리티: **창 크기/위치 저장·복원**(`useWindowState`), **전역 파일 드래그앤드롭 이벤트 버스**(`windowDragDropBus`), **환경별 로거**(`logger`). 셋 다 Tauri API 를 얇게 감싸며 앱 전역에서 공유된다.

## 관련 파일
- `src/hooks/useWindowState.ts` — 창 상태 복원·저장 훅. `useWindowState()`
- `src/lib/windowDragDropBus.ts` — 전역 드래그앤드롭 리스너 멀티플렉서. `subscribeWindowDragDrop()`
- `src/lib/logger.ts` — dev/prod 분기 로거. `logger`
- `src/lib/storage.ts` — `saveWindowState`/`getWindowState`(창 상태 영속, store 담당 에이전트 소유)

## 데이터 모델

```ts
// storage.ts
WindowState = { x: number, y: number, width: number, height: number, maximized: boolean }

// windowDragDropBus.ts
WindowDragDropEvent = { payload: {
  type: 'enter' | 'over' | 'leave' | 'drop',
  paths?: string[],
  position?: { x: number, y: number }
} }
```

## 창 상태 (useWindowState.ts)

Tauri `getCurrentWindow()` 를 사용해 창 크기/위치를 `store`(`saveWindowState`/`getWindowState`)에 영속화한다.

**복원**(마운트 시, `useWindowState.ts:13-59`):
- 저장 상태가 최대화면 → `maximize()`
- 비최대화면 → **유효성 검사** 후 복원:
  - 위치: `-100 ≤ x,y < 10000`(멀티모니터 음수 소폭 허용) (`:19-24`)
  - 크기: `800 ≤ width ≤ 10000`, `600 ≤ height ≤ 10000` (`:25-29`)
  - 유효하지 않으면 기본 `maximize()`
- 저장 상태 없으면 기본 `maximize()`
- 모든 예외 경로에서 fallback `maximize()` (`:50-58`)

**저장**(`:64-93`): `onResized`/`onMoved` 이벤트에 **0.5초 디바운스**로 `outerPosition`·`outerSize`·`isMaximized` 를 묶어 저장. 클린업에서 리스너 해제 + 타이머 정리.

> 참고: 현재 코드베이스에서 `useWindowState()` 는 **정의만 있고 호출부가 없다**(마운트 안 됨). 창은 `tauri.conf.json` 의 `maximized: true` 로 시작한다. 창 상태 영속이 필요하면 최상위 컴포넌트에서 이 훅을 호출하면 된다.

## 드래그앤드롭 버스 (windowDragDropBus.ts)

Tauri 의 `onDragDropEvent` 는 창당 하나만 유의미하므로, **전역 리스너 1개**를 두고 여러 구독자에게 팬아웃하는 버스 패턴.

- `subscribeWindowDragDrop(handler)` → 핸들러를 `Map` 에 등록 + 최초 호출 시 전역 리스너 lazy 초기화. **unsubscribe 함수 반환** (`windowDragDropBus.ts:46-54`)
- `ensureGlobalDragDropListener()` — `listenerInitialized`/`initializePromise` 가드로 리스너를 **한 번만** 등록. 등록된 리스너는 이벤트를 모든 핸들러에 브로드캐스트하며 각 핸들러 실패는 개별 catch (`:20-44`)
- 핸들러는 동기/비동기 모두 지원(`Promise.resolve(handler(...))`).

이미지 파일 드롭 업로드 등에서 이 버스를 구독한다. 여러 컴포넌트가 동시에 드롭을 받아도 리스너 중복 등록이 없다.

## 로거 (logger.ts)

`import.meta.env.DEV` 기준 분기 (`logger.ts:6`):

| 메서드 | dev | prod |
|--------|-----|------|
| `debug` | `console.log` | 무시 |
| `info` | `console.log` | 무시 |
| `warn` | `console.warn` | 무시 |
| `error` | `console.error` | **항상 출력** |

프로덕션 콘솔 노이즈를 줄이되 에러는 보존한다. `apiErrorHandler`·`ErrorBoundary`·`useWindowState`·`useGeminiTranslator` 등이 사용. (단, 일부 파일은 여전히 raw `console.*` 를 직접 쓰기도 함 — 예: `useWindowState` 의 catch 블록.)

## 회귀 증상별 원인

| 증상 | 원인 |
|------|------|
| 재시작 시 창 위치 복원 안 됨 | `useWindowState()` 미마운트(호출부 없음) |
| 복원된 창이 화면 밖/비정상 크기 | 유효성 검사에서 걸러져 `maximize()` 로 fallback |
| 창 상태 저장이 과도하게 잦음 | 0.5초 디바운스(`useWindowState.ts:73`) |
| 드롭 이벤트가 한 컴포넌트에만 감 | 버스 미구독 — `onDragDropEvent` 직접 호출 시 리스너 충돌 |
| 드롭 리스너 중복 등록 | 버스 가드(`listenerInitialized`) 우회 |
| 프로덕션에 debug 로그 노출 | raw `console.log` 직접 사용(logger 미사용) |
