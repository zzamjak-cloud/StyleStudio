# 폴더 계층 관리

세션은 폴더 트리로 조직된다. 폴더의 **부모 관계는 `Folder.parentId`**(null=루트), **세션의 소속은 `session_folder_map`**(sessionId→folderId) 이 권위를 가진다(세션 객체의 `folderId` 필드는 레거시/보조). 폴더 상태·CRUD·이동은 `useFolderManagement` 훅이 담당하고, 폴더/세션 저장은 `saveFolderData`(폴더 배열 + 매핑을 함께 저장)로 이뤄진다. `Sidebar` 는 전체 폴더 트리를 평탄화한 `visibleItems`를 렌더하고, 폴더 아이콘 왼쪽 `>` 토글로 하위 폴더·세션을 펼친다. 커스텀 마우스 기반 **드래그앤드롭**(순서변경·폴더로 이동)과 인라인 rename 을 제공한다. 폴더 삭제는 백업을 떠 **Ctrl+Z 로 되돌릴 수 있다**(App.tsx). 폴더는 하위 폴더·세션을 통째로 파일로 내보내고 불러올 수 있다.

## 관련 파일

- `src/hooks/useFolderManagement.ts` — 폴더 상태(`folders`/`currentFolderId`/`sessionFolderMap`)·`folderPath` 계산·CRUD·이동·import/복원
- `src/components/common/Sidebar.tsx` — 폴더/세션 트리 UI. 드래그앤드롭(`handleMouseMove`/`handleMouseUp`), 인라인 rename, 컨텍스트 메뉴, 삭제 다이얼로그
- `src/lib/storage.ts` — `saveFolders`/`loadFolders`/`saveSessionFolderMap`/`loadSessionFolderMap`/`saveFolderData`/`loadFolderData`, 폴더 내보내기/불러오기(`exportFolderToFile`/`importFolderFromFile`/`importFromFile`)
- `src/types/folder.ts` — `Folder`/`FolderPath`/`FolderData`
- `src/App.tsx` — 폴더 삭제 백업 + Ctrl+Z 복원(App.tsx:176), 폴더 내보내기/불러오기 오케스트레이션(App.tsx:593·613)

## 데이터 모델

```
Folder = {
  id: string             // Date.now()+random (folder.ts / useFolderManagement.ts:135)
  name: string
  parentId: string | null  // 부모 폴더 (null=루트)
  createdAt, updatedAt: string
  order: number          // 같은 레벨 내 정렬 순서
}

FolderPath = { id, name }   // 브레드크럼용

FolderData = {
  folders: Folder[]
  sessionFolderMap: Record<sessionId, folderId|null>  // ★ 세션 소속의 권위
}

FolderExportData = {        // storage.ts:869, 폴더 파일 포맷
  exportVersion: '1.0'; exportedAt: string
  folder: Folder; subfolders: Folder[]; sessions: Session[]
  folderHierarchy: Record<folderId, parentId|null>
  sessionFolderMap: Record<sessionId, folderId|null>
}
```

## 폴더 계층 · 조회

- `folderPath`(useFolderManagement.ts:91): `currentFolderId` 에서 `parentId` 를 거슬러 올라가 브레드크럼 배열 생성.
- `getCurrentFolderSubfolders`(useFolderManagement.ts:109): `parentId === currentFolderId` 인 폴더를 `order` 순 정렬.
- `getSessionsInFolder`(useFolderManagement.ts:116): `sessionFolderMap[id]` 로 소속 판정. **매핑이 undefined/null 이면 루트**로 취급.
- Sidebar 는 `folders`와 `sessions`를 `session_folder_map` 기준으로 전체 트리 평탄화(`visibleItems`)해 렌더. `expandedFolderIds`에 포함된 폴더만 하위 항목을 표시한다. 폴더 행의 `ChevronRight` 토글이 펼침/접힘을 담당하며, 더블클릭으로 내부 진입하는 구조는 사용하지 않는다.

## 폴더 CRUD

- `createFolder(name, parentId=currentFolderId)`(useFolderManagement.ts:133): `order` = 같은 부모 폴더 수. Sidebar 는 `handleCreateFolderWithDefaultName`으로 "새 폴더 (N)" 중복 회피 자동명 생성. 폴더가 선택되어 있으면 그 폴더의 자식으로 생성하고 자동으로 펼친다. 단축키 `Ctrl/Cmd+Shift+N`.
- `renameFolder`(useFolderManagement.ts:158): 인라인 편집(더블클릭/컨텍스트 메뉴/`F2`/`Enter`, Sidebar.tsx:549~630) → Enter 확정, Esc/Blur 취소.
- `deleteFolder(folderId, deleteContents, sessions, onDeleteSession)`(useFolderManagement.ts:176):
  - `deleteContents=true` → 하위 폴더·세션 전부 삭제(재귀 `getChildFolderIds`).
  - `deleteContents=false` → 하위 폴더·세션을 **상위 폴더로 승격** 후 폴더만 삭제.
  - Sidebar 다이얼로그가 두 옵션 제공(Sidebar.tsx:1035~1063).

## 드래그앤드롭 (Sidebar)

HTML5 DnD 가 아닌 **마우스 이벤트 직접 처리**:

- `handleMouseDown`(Sidebar.tsx:640): 버튼 위 클릭은 무시. 시작 좌표 기록.
- 임계값 `DRAG_THRESHOLD=5px` 초과 시 드래그 활성(Sidebar.tsx:381), 커서 따라 프리뷰 렌더.
- 드롭 판정(`handleMouseMove`):
  - **폴더 중앙 30%**(높이 0.35~0.65) 위 → 그 폴더 **자식으로 이동**(`dropTargetFolderId`). 세션을 다른 폴더의 자식으로 옮기는 기본 경로다.
  - 그 외 상/하단 → 같은 타입 기준 **순서 변경**(`dragOverIndex`). 세션은 대상 세션의 `parentFolderId`로 이동 후 순서 반영 가능.
- `handleMouseUp`: 상태를 로컬 변수로 스냅 후 초기화 → `onMoveSessionToFolder`/`onMoveFolderToFolder`/`onReorderSessions`/`onReorderFolders` 호출. 폴더에 드롭하면 대상 폴더를 자동으로 펼친다.
- `moveFolderToFolder`(useFolderManagement.ts:286): **자기 자신/자손 폴더로 이동 차단**(사이클 방지, targetId 부모 체인 검사).
- `SessionListItem`/`FolderListItem` 은 `React.memo` — 비활성 아이템 리렌더 차단(Sidebar.tsx:75·195).

## 폴더 내보내기 / 불러오기

- **export**(`exportFolderToFile`, storage.ts:883): 대상 폴더 + 재귀 하위 폴더(`collectSubfolders`) + 소속 세션 수집 → 세션 이미지·부가영역을 base64 로 복원 → `folderHierarchy`·`sessionFolderMap` 포함 `FolderExportData` 를 `folder_{name}.json` 으로 저장. Sidebar 컨텍스트 메뉴 "폴더 내보내기"(Sidebar.tsx:956).
- **import**(`importFromFile` → `App.handleImport`, App.tsx:613): 파일이 폴더 타입이면 `importFolderData`(useFolderManagement.ts:347)로 **모든 폴더 ID 를 새로 발급**(기존→신 ID 매핑), 하위 폴더 `parentId` 재배선, 세션 매핑을 새 ID 로 갱신, 선택된 폴더가 있으면 그 아래에, 없으면 현재 폴더/루트에 배치. 세션 중복 ID 는 새로 발급.
- 구버전 폴더 파일 보정: `sessionFolderMap` 없으면 `session.folderId` 또는 루트로 귀속(storage.ts:806).

## 폴더 삭제 되돌리기 (Ctrl+Z)

- 삭제 전 `App.onDeleteFolder`(App.tsx:1092)가 `folders`/`sessions`/`sessionFolderMap`/폴더명을 `deletedFolderBackup` 에 스냅.
- 하단에 **Undo 토스트** 표시, **10초 후 백업 폐기**(App.tsx:1110).
- `Ctrl+Z`/`Cmd+Z`(App.tsx:176) → `restoreFolderData`(폴더+매핑 복원, useFolderManagement.ts:414) + 세션 배열 복원 + `persistSessions`.

## 세션-폴더 매핑 정합성

- `pruneSessionFolderMapToSessions`(storage.ts:24): 세션 저장 시 존재 세션만 매핑 유지(디스크).
- `alignSessionFolderMapWithSessions`(useFolderManagement.ts:430): 메모리 매핑도 존재 세션만 유지. App 이 `sessions` 변경마다 호출하되 **초기 빈 배열일 땐 스킵**(`hasHadSessionsRef`, App.tsx:153) — 로드 전 매핑이 지워지는 것 방지.

## 회귀 증상별 원인

| 증상 | 원인 |
|------|------|
| 폴더를 자기 하위로 드롭 시 트리 깨짐 | 사이클 → `moveFolderToFolder` 부모체인 검사로 차단(useFolderManagement.ts:290) |
| import 한 폴더가 기존 폴더와 ID 충돌 | ID 재사용 → `importFolderData` 가 전 폴더 ID 재발급 + 매핑 재배선(useFolderManagement.ts:347) |
| 앱 로드 직후 세션-폴더 매핑이 사라짐 | 세션 로드 전 빈 배열로 align 실행 → `hasHadSessionsRef` 가드(App.tsx:153) |
| 폴더 삭제가 실수인데 복구 불가 | 백업/Undo 없음 → `deletedFolderBackup`+Ctrl+Z(App.tsx:176), 단 10초 내에만 |
| 드래그가 클릭과 충돌 | 임계값 없이 즉시 드래그 → `DRAG_THRESHOLD=5px`(Sidebar.tsx:363), `isDragging` 시 클릭 무시 |
| 폴더 더블클릭으로 내부 진입이 안 됨 | 현재 UX는 내부 진입이 아니라 `>` 토글 펼침 방식. 폴더 선택은 도움말/생성 대상 지정 용도 |
| 세션이 의도치 않게 루트로 튐 | 매핑 undefined/null 을 루트로 해석 → import 시 `session.folderId`/루트로 정규화(storage.ts:806) |
| 폴더만 삭제했는데 내용도 사라짐 | `deleteContents` 오전달 → false 면 상위 승격, true 면 전체 삭제(useFolderManagement.ts:202) |
| 큰 폴더 목록에서 폴더 선택 시 렉 | 전체 리렌더 → `FolderListItem`/`SessionListItem` memo(Sidebar.tsx:75·195) |
