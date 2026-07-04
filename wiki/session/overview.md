# 세션 코어 & 앱 셸

StyleStudio 의 작업 단위는 **세션(Session)** 이다. 세션은 12종 타입(`SessionType`) 중 하나를 가지며, 각 타입은 참조 이미지·분석 결과·생성 히스토리 또는 타입별 전용 데이터(chatData/conceptData/illustrationData)를 보관한다. 모든 세션은 Tauri `plugin-store` 의 `settings.json` 에 배열로 영속화되고(→ `session/storage.md`), 대용량 base64 이미지는 AppData 파일 저장소로 분리된다(→ `imageStorage.ts`). 앱 셸(`App.tsx`)은 좌측 `Sidebar`(세션/폴더 트리)와 우측 메인 패널로 구성되며, `currentSession.type` + `currentView` 에 따라 lazy 로딩된 패널(Chat/Concept/Illustration/Generator/Analysis)을 스위칭한다. 세션 상태는 `useSessionManagement`, 폴더 상태는 `useFolderManagement`, 자동 저장은 `useAutoSave` + `sessionHelpers.persistSessions`(디바운스)가 담당한다.

## 관련 파일

- `src/App.tsx` — 앱 셸. 패널 라우팅(BASIC→ChatPanel / CONCEPT→ConceptPanel / ILLUSTRATION→setup·generator / 그 외→AnalysisPanel·ImageGeneratorPanel), lazy 로딩(`lazy`/`Suspense` + `PanelFallback`), 신규/분석/생성 흐름, 폴더 삭제 Ctrl+Z 되돌리기, 세션 저장 디바운스 관리
- `src/hooks/useSessionManagement.ts` — 세션 상태(`sessions`/`currentSession`)·API 키·앱 초기화(`initializeApp`)·세션 CRUD 핸들러(선택/삭제/내보내기/불러오기/순서변경)·히스토리·문서 관리
- `src/hooks/useFolderManagement.ts` — 폴더 상태·CRUD·이동(→ `folders/overview.md`)
- `src/hooks/useAutoSave.ts` — 분석 결과 변경 감지 → 세션 저장 트리거(`triggerManualSave`). 진행 상태(`progress`) 반환
- `src/utils/sessionHelpers.ts` — 세션 순수 함수(`createNewSession`/`updateSession`/`updateSessionInList`/`addSessionToList`/`removeSessionFromList`) + **디바운스 저장**(`persistSessions`/`flushPendingSessions`)
- `src/lib/config/sessionConfig.ts` — 세션 타입별 라벨·아이콘·색상·그리드 설명(→ `session/session-config.md`)
- `src/lib/storage.ts` — 영속화 계층(→ `session/storage.md`)
- `src/components/common/Sidebar.tsx` — 세션/폴더 트리 UI·드래그앤드롭·인라인 rename
- `src/components/common/NewSessionModal.tsx` — 신규 세션 타입 선택 모달·자동 이름 생성
- `src/components/Header.tsx` — 타이틀·버전 표시 헤더. **주의: 현재 `App.tsx` 에서 미사용**(App 은 Sidebar 헤더의 설정 버튼을 씀). 독립 컴포넌트로만 존재
- `src/types/session.ts` — `Session`/`SessionType`/`GenerationHistoryEntry`/`GenerationSettings`
- `src/types/constants.ts` — `SESSION_LIMITS`(constants.ts:177), `STORAGE_KEYS`(constants.ts:189)
- `src/utils/dateUtils.ts` — 날짜/시간 포맷(`formatDateTime`/`formatRelativeTime`/`formatTimestampForFilename` 등)
- `src/utils/comparison.ts` — 분석 결과 필드별 얕은 비교(`hasStyleChanged` 등, JSON.stringify 대체)

## 데이터 모델

```
SessionType =
  'BASIC' | 'STYLE' | 'CHARACTER' | 'BACKGROUND' | 'ICON'
  | 'PIXELART_CHARACTER' | 'PIXELART_BACKGROUND' | 'PIXELART_ICON'
  | 'UI' | 'LOGO' | 'ILLUSTRATION' | 'CONCEPT'   // 12종 (session.ts:7)

Session = {
  id: string                        // Date.now().toString() (+ random suffix on import 충돌)
  name: string
  type: SessionType
  createdAt, updatedAt: string      // ISO 8601
  referenceImages: string[]         // base64(레거시) 또는 IndexedDB/파일 키(신규)
  imageKeys?: string[]              // 저장소 키 배열 (있으면 우선 사용)
  analysis: ImageAnalysisResult     // style/character/composition/negative_prompt (+ui_specific/logo_specific)
  imageCount: number                // 참조 이미지 개수 (손상 감지용)
  generationHistory?: GenerationHistoryEntry[]
  autoSavePath?: string             // @deprecated v0.4.4 이후
  referenceDocuments?: ReferenceDocument[]   // UI 세션 전용
  folderId?: string | null          // 소속 폴더 (null/undefined=루트). ※ 실권위는 session_folder_map
  illustrationData?: IllustrationSessionData // ILLUSTRATION 전용
  chatData?: ChatSessionData        // BASIC 전용
  conceptData?: ConceptSessionData  // CONCEPT 전용
}

GenerationHistoryEntry = {
  id, timestamp, prompt, negativePrompt?, additionalPrompt?,
  imageBase64,                      // 저장 시 IndexedDB/파일 키로 치환됨
  settings: GenerationSettings, isPinned?, referenceDocumentIds?
}
```

- `SESSION_LIMITS`(constants.ts:177): `MAX_SESSIONS=50`, `MAX_HISTORY_PER_SESSION=100`, `AUTO_SAVE_INTERVAL=5000`. (단, 코드상 실제 디바운스는 `sessionHelpers` 의 `SAVE_DEBOUNCE_MS=500`, `App` 의 1000ms 타이머를 사용 — `AUTO_SAVE_INTERVAL` 상수는 참조되지 않음)

## 세션 타입별 전용 데이터 · 패널 매핑

`App.tsx` 렌더 분기(App.tsx:1127~1334)는 `selectedFolderId` → `currentSession.type` → `currentView` 순으로 판정한다.

| 타입 | 전용 데이터 | 패널 | 초기화 위치 |
|------|-----------|------|-----------|
| `BASIC` | `chatData` | `ChatPanel` (App.tsx:1177) | `handleNewSession` (App.tsx:899) |
| `CONCEPT` | `conceptData` | `ConceptPanel` (App.tsx:1185) | App.tsx:914 |
| `ILLUSTRATION` | `illustrationData` | setup 폼 → `ImageGeneratorPanel` (App.tsx:1194) | App.tsx:891 |
| 그 외 9종 | `analysis`+`referenceImages` | `AnalysisPanel` → `ImageGeneratorPanel` (App.tsx:1256) | 빈 analysis |

- **패널 lazy 로딩**: `ImageGeneratorPanel`/`IllustrationSetupPanel`/`ChatPanel`/`ConceptPanel` 은 `lazy(() => import(...))` 로 코드 분할(App.tsx:13~24). 첫 진입 전까지 번들 로드를 미룬다. 로딩 중엔 `PanelFallback`(스피너).
- 패널에 `key={currentSession.id}` 를 줘서 세션 전환 시 패널이 새로 마운트되도록 강제(Chat/Concept, App.tsx:1179·1187).

## 세션 생성 흐름

1. Sidebar `ImagePlus` 버튼 → `handleReset` → `NewSessionModal` 오픈(App.tsx:845).
2. 모달에서 타입 선택 → `generateSessionName`(NewSessionModal.tsx:17, 타입 라벨_N 자동명, 동일 타입 최대 인덱스+1) → `onCreate(name, type)`.
3. `handleNewSession`(App.tsx:850): 빈 `emptyAnalysis` 로 `createNewSession` → 이름·`folderId`(현재 폴더) 설정 → 타입별 전용 데이터 초기화 → `setSessions`/`setCurrentSession` → `persistSessions` → `moveSessionToFolder`(폴더 매핑 저장).
4. **분석 기반 생성**: 이미지 업로드 후 분석하면 `performAnalysis`(App.tsx:407) 가 빈 세션이면 업데이트, 아니면 신규 생성/강화 모드로 분기.

## 세션 전환·복원 흐름

- **선택**: Sidebar 클릭 → `handleSelectSessionWithFolderDeselect` → `setCurrentSession`.
- **복원 effect**(App.tsx:377): `currentSession` 변경 시 `referenceImages` → `uploadedImages`, `analysis` → `analysisResult` 복원. `lastRestoredSessionIdRef` 로 **같은 세션 내부 업데이트(autoSave)에서는 재복원 스킵**(base64 배열 재복사·리렌더 연쇄 차단).
- **빈 플레이스홀더 분석**(App.tsx:61 `isEmptyPlaceholderAnalysis`): 신규 세션의 빈 analysis 는 UI 상태에서 `null` 로 강등 → `ImageUpload` 화면 표시(흰 화면 방지).
- **폴더 진입 자동 선택**(App.tsx:212): 현재 폴더의 첫 세션 자동 선택, 세션 없고 하위 폴더만 있으면 폴더 도움말 표시.

## 자동 저장 흐름 (핵심)

두 단계 디바운스가 겹쳐 있다.

1. **`useAutoSave`**(useAutoSave.ts): `analysisResult` 변경을 `detectChangedSections` 로 감지, **변경 없으면 저장 스킵**(useAutoSave.ts:69). 변경 시 세션 객체 구성 → `onSessionUpdate`(=App 의 `handleSessionUpdate`) 호출.
2. **`App.handleSessionUpdate`**(App.tsx:263): 최신 sessions 를 `sessionsRef` 로 참조(콜백 안정성) → 상태 갱신 → **1000ms 타이머** 후 `flushPendingSessions` → `persistSessions`.
3. **`sessionHelpers.persistSessions`**(sessionHelpers.ts:96): 다시 **500ms 디바운스**(`SAVE_DEBOUNCE_MS`) 후 `saveSessions` 한 번만 실행. 짧은 시간 다수 변경 시 거대한 `settings.json` 직렬화 폭주 방지.
4. **즉시 플러시**: 언마운트 cleanup·`beforeunload`·세션 전환 시 `flushPendingSessions`(App)·`flushPersistedSessions`(sessionHelpers)로 대기분 즉시 기록(App.tsx:306·318).
- **경량 저장**(`handleSessionSaveOnly`, App.tsx:291): React 상태를 건드리지 않고 디스크에만 100ms 후 저장(세션 전환 시 언마운트 렉 방지).

## 세션 삭제

- `handleDeleteSession`(useSessionManagement.ts:124): 목록에서 제거 후, 현재 세션이 삭제 대상이면 **이전 세션 → 없으면 다음 세션 → 없으면 null** 로 선택 이동. `persistSessions` 로 저장. (참조 이미지 파일은 별도 정리 — `deleteSessionImages` 는 폴더 삭제 경로에서 세션 삭제를 통해 호출되지 않음; 히스토리 삭제 시 `deleteImage` orphan 정리만 수행, useSessionManagement.ts:282)

## 회귀 증상별 원인

| 증상 | 원인 |
|------|------|
| 신규 세션 진입 시 흰 화면 | 빈 플레이스홀더 analysis 가 UI 상태로 들어감 → `isEmptyPlaceholderAnalysis` 로 `null` 강등 필요(App.tsx:61) |
| 세션 전환 시 UI 렉 | 큰 base64 배열 재복사 → `lastRestoredSessionIdRef` 로 동일 세션 재복원 스킵(App.tsx:377), 전환 시 `handleSessionSaveOnly` 경량 저장 |
| 저장이 몰릴 때 클릭 반응 지연 | `settings.json` 직렬화 폭주 → `persistSessions` 500ms 디바운스(sessionHelpers.ts:74) |
| 앱 종료/새로고침 시 마지막 변경 유실 | 디바운스 대기분 미플러시 → `beforeunload`·cleanup 에서 `flushPersistedSessions`(App.tsx:311·320) |
| 폴더 진입 시 다른 폴더 세션이 보임 | 폴더 진입 effect 가 현재 세션 초기화 안 함 → App.tsx:212 에서 `setCurrentSession(null)` 처리 |
| 세션 이름 자동번호 중복 | 삭제 후 번호 재사용 → `generateSessionName` 이 최대 인덱스+1 사용(NewSessionModal.tsx:17) |
| 패널 전환 시 이전 세션 상태 잔존 | 패널 리마운트 안 됨 → `key={currentSession.id}` 부여(App.tsx:1179) |
