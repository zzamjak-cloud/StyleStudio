# 세션 영속화 (storage.ts · imageStorage.ts)

StyleStudio 는 Tauri `plugin-store` 의 **`settings.json`** 하나에 세션 배열·폴더·매핑·API 키·창 상태를 key-value 로 저장한다(`storage.ts`). 다만 세션 안의 **대용량 base64 이미지·thought_signature 문자열은 별도 저장소로 분리**해 `settings.json` 본체 크기를 압축한다: 실제 데이터는 `imageStorage.ts` 가 **AppData 파일 저장소**(`images/{key}.txt`)에 쓰고, 세션 객체에는 **키 문자열만** 남긴다(레거시는 IndexedDB `StyleStudioImages`). 저장 시 `migrateSessionsForStorage` 가 base64→키로 마이그레이션하고, 로드 시 참조 이미지는 즉시 복원, 히스토리/채팅/컨셉 이미지는 lazy(보일 때 디코딩)로 남긴다. 세션/폴더/전체 스냅샷 파일 내보내기(export)는 키를 다시 base64 로 복원해 자기완결 JSON 으로 만든다.

## 관련 파일

- `src/lib/storage.ts` — `settings.json` I/O 전체. 세션·폴더·매핑·API 키·창 상태·내보내기/불러오기
- `src/lib/imageStorage.ts` — base64 실데이터 저장소. AppData 파일(`images/{key}.txt`) 우선, IndexedDB 폴백/승격
- `src/lib/config/paths.ts` — 생성 결과물 저장 경로(`~/Downloads/AI_Gen/`) — 세션 JSON 저장소와 무관(→ `session/session-config.md`)

## 저장 위치 · 스토어 키

- 스토어 인스턴스: `Store.load('settings.json')` (storage.ts:19 `getStore`). Tauri AppConfig 디렉토리 하위.
- key 목록:
  - `sessions` — `Session[]` (storage.ts:570)
  - `folders` — `Folder[]` (storage.ts:1166)
  - `session_folder_map` — `Record<sessionId, folderId|null>` (storage.ts:1196)
  - `gemini_api_key` / `openai_api_key` (storage.ts:47·75)
  - `window_state` — `{x,y,width,height,maximized}` (storage.ts:1154)
  - `default_session_save_path` (storage.ts:1247)
- 이미지 파일 저장소: `BaseDirectory.AppData` / `images/` 디렉토리, 파일명 `{key}.txt`(내용은 base64 data URL 문자열). 상수 `DB_NAME='StyleStudioImages'`, `STORE_NAME='images'`, `IMAGE_FS_DIR='images'`, `IMAGE_FS_EXT='.txt'`(imageStorage.ts:13~17).

## 이미지 저장소 키 네임스페이스

`storage.ts` 가 세션의 각 이미지 영역을 고유 키로 저장(충돌 방지):

| 영역 | 키 패턴 | 코드 |
|------|--------|------|
| 참조 이미지 | `{sessionId}-{index}` | imageStorage.ts:73 `saveImage` |
| 생성 히스토리 | `{sessionId}-gen-{entryId}` | storage.ts:198 |
| 채팅 이미지 | `{sessionId}-chat-{msgId}-{idx}` | storage.ts:215 |
| 채팅 thought_signature | `{sessionId}-chatsig-{msgId}-{idx}` | storage.ts:226 (`CHAT_SIGNATURE_KEY_MARKER='-chatsig-'`) |
| 컨셉 히스토리 | `{sessionId}-concept-{entryId}` | storage.ts:255 |
| 컨셉 참조 | `{sessionId}-conceptref` | storage.ts:267 |
| 일러스트 캐릭터 | `{sessionId}-illuchar-{charId}-{idx}` | storage.ts:290 |
| 일러스트 배경 | `{sessionId}-illubg-{idx}` | storage.ts:309 |

- **키/base64 판별**: `str.startsWith('data:')` 이면 base64(원본), 아니면 키(storage.ts:120 `isImageKey`).

## 저장 파이프라인 (`saveSessions`)

`saveSessions`(storage.ts:563) → `migrateSessionsForStorage`(storage.ts:522):

1. 참조 이미지: `imageKeys` 가 이미 있거나 전부 키면 스킵, 아니면 `saveImage` 로 파일화 → `imageKeys`/`referenceImages` 를 키 배열로 교체.
   - **데이터 손실 방지**: `imageKeys` 는 있는데 `referenceImages` 가 빈 배열이면(로드 실패 흔적) 키로 복원해 저장(storage.ts:533).
2. `migrateSessionExtras`(storage.ts:188): 히스토리/채팅/컨셉/일러스트의 base64 를 `persistImageField`/`persistOpaqueBlobField` 로 파일화, 객체엔 키만.
3. `pruneSessionFolderMapToSessions`(storage.ts:24): 존재 세션 ID 만 `session_folder_map` 에 남김(고아 제거).
4. `store.set('sessions', ...)` + `store.save()`.

- **백필**(`backfillStoredSessionsIfNeeded`, storage.ts:583): 앱 시작 시 1회, 저장된 레거시 세션을 즉시 마이그레이션(변경 있을 때만 재저장). `useSessionManagement.initializeApp`(useSessionManagement.ts:81)에서 호출.

## 로드 파이프라인 (`loadSessions`)

`loadSessions`(storage.ts:610):

1. 모든 세션의 저장소 키 수집(`collectSessionStorageKeys`, storage.ts:490) → `loadImage` 로 훑어 **레거시 IndexedDB → 파일 저장소 자동 승격**(dev/prod 교차 사용 대비).
2. 참조 이미지만 즉시 복원(`loadImages`). **복원 실패 시 키 배열을 유지**해 이후 저장에서 빈 배열로 덮어써지는 손실 방지(storage.ts:649·672).
3. 히스토리/채팅/컨셉 이미지는 **복원하지 않고 키 그대로 메모리에** 둠 → 실제 표시 시점에 `LazyImage` 가 IndexedDB/파일에서 디코딩(앱 시작 가속, storage.ts:684 주석).

## imageStorage 저장/로드 상세

- `saveImageWithKey`(imageStorage.ts:87): AppData 파일 쓰기 시도 → 권한/경로 실패 시 **IndexedDB 폴백**.
- `loadImage`(imageStorage.ts:112): 정규화 키로 파일 후보 여러 개 조회 → 없으면 IndexedDB 조회 후 **파일 저장소로 승격**(`saveImageWithKey`) → 그래도 없으면 `null`. `normalizeImageKey`(imageStorage.ts:23)가 `images/` 접두·`.txt` 접미를 벗겨 키 형식 흔들림 흡수.
- `deleteSessionImages`(imageStorage.ts:184): `images/` 디렉토리에서 `{sessionId}-` 로 시작하는 파일 일괄 삭제.
- `deleteImage`(imageStorage.ts:207): 단일 키 파일 삭제(히스토리 항목 삭제 시 orphan 정리).

## 세션 내보내기/불러오기 (파일)

- **세션 export**(`exportSessionToFile`, storage.ts:698): 저장 다이얼로그(`{name}.stylestudio.json`) → `imageKeys` 를 `loadImages` 로 base64 복원 + `restoreSessionExtras`(히스토리/채팅/컨셉 키→base64) → `JSON.stringify(session, null, 2)` 파일 쓰기. **자기완결 파일**(다른 PC 에서도 이미지 포함).
- **전체 스냅샷 export**(`exportWorkspaceSnapshotToFile`, storage.ts:1035): 사이드바 헤더의 `SaveAll` 버튼(`Sidebar.tsx:854`) → 모든 `folders`·`sessions`·`session_folder_map` 을 `exportType:'workspaceSnapshot'` JSON 으로 저장. 세션 참조 이미지·히스토리·채팅·컨셉 부가 영역도 base64 로 복원한다.
- **불러오기**(`importFromFile`, storage.ts:768): 다중 파일 선택. 첫 파일이 `exportType:'workspaceSnapshot'` 이면 전체 스냅샷, `exportVersion`+`folder`+`subfolders` 필드면 **폴더 파일**로 판정(→ `folders/overview.md`), 아니면 세션 파일. 각 파일을 `JSON.parse` 해 `Session` 으로. `importSessionFromFile`(storage.ts:763)은 세션만 반환하는 래퍼.
- 중복 ID·손상 이미지 검증은 호출측(`useSessionManagement.handleImportSession` / `App.handleImport`)에서 수행 — 중복 시 새 ID 발급, 폴더/스냅샷 import 는 새 ID 기준으로 `session_folder_map` 을 먼저 재작성한다. `data:` 로 시작 안 하는데 `imageCount>0` 이면 "손상" 경고.

## 회귀 증상별 원인

| 증상 | 원인 |
|------|------|
| import 한 세션에 이미지가 안 보임("손상") | export 한 파일에 키만 있고 base64 없음(구버전/원본 IndexedDB 부재) → 원본 PC 최신 버전으로 재export |
| 로드 시 참조 이미지가 빈 배열로 저장돼 영구 손실 | 복원 실패를 빈 배열로 덮어씀 → `loadSessions` 가 실패 시 키 유지(storage.ts:649·672), 저장 시에도 키 복원(storage.ts:533) |
| dev/prod 전환 후 이미지 사라짐 | IndexedDB 는 origin 별 분리 → `loadSessions` 시작에 `loadImage` 로 파일 저장소 승격(storage.ts:623) |
| `settings.json` 이 수백 MB 로 비대 | base64 가 본체에 그대로 저장됨 → `migrateSessionsForStorage`/`migrateSessionExtras` 로 파일 분리, 백필로 레거시 정리 |
| thought_signature 로 채팅 저장 비대 | 대용량 불투명 문자열 → `persistOpaqueBlobField` 로 `-chatsig-` 키 분리(storage.ts:135) |
| 세션 삭제 후에도 `session_folder_map` 에 잔존 | 고아 매핑 → `pruneSessionFolderMapToSessions`(storage.ts:24) 저장 시 자동 정리 |
| 이미지 키 형식 불일치로 로드 실패 | `images/` 접두/`.txt` 접미 혼재 → `normalizeImageKey`(imageStorage.ts:23) |
