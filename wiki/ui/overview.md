# 공통 UI 컴포넌트

앱 전역에서 재사용되는 공통 UI 컴포넌트 모음. 설정(`SettingsModal`), 확인 다이얼로그(`ConfirmDialog` + `useConfirmDialog`), 에러 경계(`ErrorBoundary`), 지연 이미지(`LazyImage`), 리사이저(`Resizer`), 진행 표시(`ProgressIndicator`), 빈 상태(`EmptyState`). 대부분 Tailwind 스타일이며 `lucide-react` 아이콘을 쓴다.

## 관련 파일
- `src/components/common/SettingsModal.tsx` — API 키·저장경로·계정 설정 모달. `SettingsModal`(memo)
- `src/components/common/ConfirmDialog.tsx` — 커스텀 확인 다이얼로그. `ConfirmDialog`
- `src/hooks/useConfirmDialog.tsx` — Promise 기반 확인 훅. `useConfirmDialog()`
- `src/components/common/ErrorBoundary.tsx` — React 에러 경계(class). `ErrorBoundary`
- `src/components/common/LazyImage.tsx` — IndexedDB 키 지연 디코딩 이미지. `LazyImage`(memo)
- `src/components/common/Resizer.tsx` — 드래그 리사이즈 핸들. `Resizer`
- `src/components/common/ProgressIndicator.tsx` — 우하단 진행 토스트. `ProgressIndicator`
- `src/components/common/EmptyState.tsx` — 세션 없을 때 빈 화면. `EmptyState`

## SettingsModal

설정 모달(`SettingsModal.tsx`). props: `isOpen`, `onClose`, `currentGeminiApiKey`, `currentOpenAIApiKey`, `onSave(gemini, openai)`.
- Gemini / ChatGPT(OpenAI) API 키 입력(password 필드, 발급 링크 포함) (`:103-150`)
- 생성 이미지 저장 위치 안내 + "폴더 열기"(`getAiGenRoot` → `openPath`) (`:152-174`)
- 로그인 계정 표시 + 로그아웃(`useAuth`, 로그아웃 후 `window.location.reload()`) (`:39-53, 176-207`)
- 앱 버전 표시(`getVersion()`, 실패 시 `0.0.0`) (`:35-37, 219`)
- **저장 검증**: Gemini 키 비어있으면 alert, 아니면 저장 후 1.5초 뒤 자동 닫힘 (`:55-66`)

## ConfirmDialog + useConfirmDialog

`window.confirm()` 대체용(Tauri 환경 안정성). **훅이 Promise 를 반환**해 `await confirm(...)` 으로 분기.

`useConfirmDialog()`(`useConfirmDialog.tsx:42-112`) 반환:
- `confirm(options): Promise<boolean>` — 다이얼로그를 열고 사용자 응답을 resolve (`:55-63`)
- `ConfirmDialog` — JSX 에 포함할 렌더 컴포넌트

```ts
ConfirmOptions = { title, message, type?, confirmText?, cancelText? }
ConfirmDialogType = 'warning' | 'info' | 'success' | 'danger'
```

`ConfirmDialog.tsx` 특징: 타입별 아이콘/색상(`getTypeStyles`, `:33-68`), 배경 클릭·**ESC=취소 / Enter=확인** (`:73-86`), 확인 버튼 `autoFocus`. 사용 패턴:
```tsx
const { confirm, ConfirmDialog } = useConfirmDialog();
if (await confirm({ title:'삭제', message:'…', type:'danger' })) { /* … */ }
return <>{/* … */}<ConfirmDialog/></>;
```

## ErrorBoundary

class 컴포넌트 에러 경계(`ErrorBoundary.tsx`). `App` 최상위를 감쌈(`App.tsx:1060`).
- `getDerivedStateFromError` + `componentDidCatch`(에러를 `logger.error` 로 로깅) (`:29-44`)
- 커스텀 `fallback` prop 지원, 없으면 기본 에러 화면(에러 메시지 + 컴포넌트 스택) (`:56-93`)
- "다시 시도"(`handleReset`, 상태 초기화) / "페이지 새로고침"(`window.location.reload`) (`:95-107`)

## LazyImage

`memo` 이미지 컴포넌트(`LazyImage.tsx`). `src` 가 `data:` URL 이면 그대로, 아니면 **IndexedDB 키로 간주**해 마운트 시 `loadImage(key)` 로 비동기 base64 변환. 디코딩 전엔 placeholder(`animate-pulse`) 표시 (`:41-44`). settings.json 에서 분리된 히스토리/메시지 이미지를 **보이는 시점에만** 메모리로 올리기 위한 컴포넌트. `cancelled` 플래그로 언마운트 경합 방지 (`:31-39`).

## Resizer

드래그 리사이즈 핸들(`Resizer.tsx`). props: `onResize(delta)`, `direction: 'horizontal' | 'vertical'`(기본 `vertical`).
- 마우스다운 시 `document` 전역 mousemove/mouseup 리스너 + `body` 커서(`row-resize`/`col-resize`)·`userSelect:none` (`:38-44`)
- **delta = 현재 - 직전 좌표**(증분)를 콜백 (`:17-21`)
- vertical: 높이 8px 가로 핸들 / horizontal: 폭 8px 세로 핸들, 호버 시 파란 핸들 강조 (`:46-117`)

## ProgressIndicator

우하단 고정 진행 토스트(`ProgressIndicator.tsx`). 세션 저장 등 장시간 작업 표시. props: `stage`(`idle|translating|saving|complete`), `message`, `percentage`, `estimatedSecondsLeft`.
- `stage === 'idle'` 이면 렌더 안 함 (`:15-17`)
- `complete` → 체크 아이콘 / 그 외 → 스핀 + 점 3개 바운스 애니메이션 (`:24-56`)
- 그라디언트 진행 바(`percentage%`) + 인라인 keyframes (`:60-102`)

## EmptyState

세션이 하나도 없을 때의 빈 화면(`EmptyState.tsx`). props: `onNewSession`. 중앙 정렬 아이콘·안내문·"새 세션 만들기" 버튼. `bg-background`/`text-foreground` 등 테마 토큰 사용.

## 회귀 증상별 원인

| 증상 | 원인 |
|------|------|
| 확인창이 안 뜨거나 응답 무한대기 | `<ConfirmDialog/>` 를 JSX 에 미포함(훅만 호출) |
| 확인창 Enter/ESC 무반응 | 포커스가 오버레이 밖 — `onKeyDown` 은 다이얼로그 루트에 바인딩 (`ConfirmDialog.tsx:80`) |
| 저장 버튼 눌러도 안 닫힘 | Gemini 키 공란 → alert 후 return (`SettingsModal.tsx:56-65`) |
| 이미지가 placeholder 에서 안 넘어감 | `loadImage(key)` 가 null 반환(IndexedDB 키 없음) (`LazyImage.tsx:33-35`) |
| 리사이즈가 안 멈춤/텍스트 선택됨 | mouseup 미수신 — 전역 리스너/`userSelect` 복원 확인 (`Resizer.tsx:23-27`) |
| 진행 토스트가 안 보임 | `stage === 'idle'` (`ProgressIndicator.tsx:15`) |
| 에러 화면 대신 흰 화면 | `ErrorBoundary` 밖에서 에러(렌더 외 비동기 에러는 미포착) |
| 로그아웃 후 로그인 화면 안 뜸 | `window.location.reload()` 실패 (`SettingsModal.tsx:47`) |
