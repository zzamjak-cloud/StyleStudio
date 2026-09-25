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
  - `openrouter_api_key` (통합 키 — 저장 시 레거시 `gemini_api_key`/`openai_api_key` 삭제)
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
| 타일맵 시트(생성) | `tilemap-sheet-{sheetId}` — **세션 접두어 없음** | useTilemapProcessing.ts `processNewSheet` |
| 타일맵 시트(import 후 저장) | `{sessionId}-tilemap-sheet-{sheetId}` | storage.ts:288 |
- **import 직후 메모리 세션도 키로 바꾼다**: `App.handleImport`(세션·폴더·스냅샷 세 경로)가 `migrateSessionExtras`로 변환한 세션을 메모리에 넣는다(`migrateImportedSession`, 실패 시 base64 유지). 재시작 후 로드 상태(부가 영역 = 키, lazy 디코딩)와 같아 전 타입에 안전하고, 타일맵 시트처럼 부가 이미지가 즉시 키 기반으로 동작한다.
- 타일맵 시트 키는 두 형식이 섞여 있어 **접두어로 찾지 말고 `tilemapData.sheets[].imageKey` 참조로 수집**한다(`collectSessionStorageKeys`, storage.ts:514). 생성 키에 접두어를 붙이지 않은 이유: 훅이 sessionId를 모르고(패널 prop 추가 필요), 삭제가 어차피 접두어 기반으로 동작하지 않기 때문(아래 `deleteSessionImages` 참조).

- **키/base64 판별**: `str.startsWith('data:')` 이면 base64(원본), 아니면 키(storage.ts:120 `isImageKey`).

## 저장 파이프라인 (`saveSessions`)

`saveSessions`(storage.ts:563) → `migrateSessionsForStorage`(storage.ts:522):

1. 참조 이미지: `imageKeys` 가 이미 있거나 전부 키면 스킵, 아니면 `saveImage` 로 파일화 → `imageKeys`/`referenceImages` 를 키 배열로 교체.
   - **데이터 손실 방지**: `imageKeys` 는 있는데 `referenceImages` 가 빈 배열이면(로드 실패 흔적) 키로 복원해 저장(storage.ts:533).
2. `migrateSessionExtras`(storage.ts:149): 히스토리/채팅/컨셉/일러스트/**타일맵 시트**의 base64 를 `persistImageField`/`persistOpaqueBlobField` 로 파일화, 객체엔 키만.
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
- `deleteSessionImages`(imageStorage.ts:184): `images/` 디렉토리에서 `{sessionId}-` 로 시작하는 파일 일괄 삭제. **dead code(호출부 없음)** — 세션 삭제는 이미지 파일을 즉시 지우지 않는다. 함부로 `handleDeleteSession`에 연결하면 안 된다: 폴더 삭제 Ctrl+Z(App.tsx `deletedFolderBackup`, 메모리 보관)가 세션 객체만 복원하므로 이미지가 사라진 세션이 되살아난다. 또 타일맵 시트 키(`tilemap-sheet-*`)는 접두어가 없어 이 함수로는 못 지운다. 삭제된 세션의 파일은 아래 **고아 파일 정리**가 다음 앱 시작 때 회수한다.
- `deleteImage`(imageStorage.ts:207): 단일 키 파일 삭제(히스토리/채팅/컨셉 삭제·타일맵 시트 교체 시 orphan 정리). 원래부터 동작한다 — `remove`·`rename`은 `fs:allow-download-write*`에 포함된 `write-all` 세트로, `stat`·`read_dir`은 `fs:allow-download-meta`의 `read-meta` 세트로 명령이 허용되고, 경로는 전역 `fs:scope`(`$APPDATA/**` 등)가 명령 스코프와 병합돼(tauri-plugin-fs `commands.rs` `resolve_path`) 통과한다. 권한을 좁히려면 download-write 세트와 전역 scope를 함께 재설계해야 한다(별도 과제).

## 고아 파일 정리 (`imageOrphanCleanup.ts`)

앱 시작 시 어떤 세션도 참조하지 않는 `AppData/images/*.txt`만 **휴지통 `images/.trash/`로 옮기고**, 휴지통에서 14일(`TRASH_RETENTION_MS`)이 지난 파일만 영구 삭제한다. `~/Downloads/AI_Gen` 자동 저장 파일은 대상 아님.

- **트리거**: `useSessionManagement.initializeApp` 이 로드·백필을 **모두 성공한 뒤** `scheduleOrphanImageCleanup(finalSessions)` 호출(초기화 예외 시 catch로 빠져 예약 안 됨). 로드본이 비었으면 즉시 건너뜀.
- **스냅샷 먼저, 이동은 20초 뒤**: 호출 즉시 `settings.json`의 `sessions` 원본을 읽어 로드본과 세션 ID 구성이 같은지 확인(다르면 건너뜀)하고, 지연 후 디렉토리를 훑는다. 지연 중 사용자가 폴더를 지워도(세션은 Ctrl+Z 백업에만 남음) 시작 시점 스냅샷이 참조 집합이라 그 이미지는 보존된다.
- **참조 집합**(`collectReferencedImageKeys`): `collectSessionStorageKeys`(알려진 필드) ∪ 세션 객체 안 **모든 문자열의 깊은 순회**(정규화: `images/`·`.txt` 제거). 알려진 필드 밖의 새 이미지 영역도 자동 보호.
- **이동 조건(AND, `planOrphanImageDeletion` 순수 함수)**: 참조 집합에 없음 · 존재 세션의 `{id}-` 접두어가 아님 · 수정 후 24h 경과(`MIN_ORPHAN_AGE_MS`, 시각 불명이면 보존 — 파일은 썼지만 세션 저장 디바운스 전인 타일맵 시트 등 보호) · 그리고 (비접두 `tilemap-sheet-*` 이거나, `{13자리숫자[base36]}-{0|gen-|chat-|chatsig-|concept-|conceptref|illuchar-|illubg-|tilemap-sheet-*}` 형식인데 그 세션이 없음). 그 외 형식은 **보존**.
- **이동 직전 재확인(TOCTOU)**: 각 파일을 옮기기 직전 `stat`으로 mtime을 다시 읽어 계획 시점과 다르거나 24h 이내면 건너뜀(`shouldMoveAfterRecheck`).
- **휴지통**: 파일명은 `trashed-{이동시각 ms}-{원래 파일명}`(`toTrashFileName`, rename은 mtime을 유지하므로 이동 시각을 이름에 기록 — 접두어는 원래 키의 세션 ID 시각과 혼동 방지). 퍼지(`planTrashPurge`)는 이 이름의 시각 기준 14일 경과분만 — 형식 불명·미래 시각은 보존. 복구는 이름 앞 `trashed-{13자리}-`를 떼고 `images/`로 되돌리면 된다. `.trash`는 디렉토리라 `listImageFiles`(isFile 필터) 대상에서 빠진다.
- **전체 보류 가드**: 세션 목록이 비었거나, 디스크에 참조 파일이 하나도 없는데 삭제 후보만 있으면(판별 이상) 아무것도 지우지 않는다.
- **dev·prod**: 두 빌드는 identifier(`com.woody.stylestudio-tauri`)가 같아 **`settings.json`과 `images/`를 모두 공유**한다(세션 목록도 하나). 분리된 건 origin별 IndexedDB뿐. 그래도 두 빌드를 동시에 띄우면 서로의 메모리(Ctrl+Z 백업)를 모르므로 **dev 빌드는 dry-run**(판정 결과만 `logger.debug`), 실제 이동·퍼지는 prod에서만. dev에서 `VITE_ORPHAN_CLEANUP_LIVE=1`이면 실제로 수행(prod 첫 실행 전 검증용).
- **IndexedDB는 정리하지 않는다**: origin별로 분리돼 한쪽에서 다른 쪽을 볼 수 없고, 참조되는 항목은 `loadSessions`가 파일로 승격하며, 신규 기록은 파일 쓰기 실패 폴백뿐이라 남겨 두는 쪽이 안전.
- 이동 개수·용량·퍼지 개수는 `logger.info`(logger 구현상 dev에서만 출력). 권한: 명령은 기존 `write-all`(`rename`·`remove`·`mkdir`)·`read-meta`(`stat`·`read_dir`) 세트로 충분. 단 unix에선 scope glob이 `require_literal_leading_dot`이라 `$APPDATA/**`가 `.trash`를 매칭하지 않으므로 전역 `fs:scope`에 `$APPDATA/images/.trash`·`$APPDATA/images/.trash/*`를 명시했다.
- 검증: `dev/image-orphan-check.html` → `src/lib/imageOrphanSelfCheck.ts`(실파일 미접촉).

## 세션 내보내기/불러오기 (파일)

- **세션 export**(`exportSessionToFile`, storage.ts:698): 저장 다이얼로그(`{name}.stylestudio.json`) → `imageKeys` 를 `loadImages` 로 base64 복원 + `restoreSessionExtras`(히스토리/채팅/컨셉/일러스트/타일맵 시트 키→base64) → `JSON.stringify(session, null, 2)` 파일 쓰기. **자기완결 파일**(다른 PC 에서도 이미지 포함).
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
| import 한 타일맵 세션이 회색 박스(시트 미발견) | export 가 `tilemapData.sheets[].imageKey` 를 복원하지 않아 키만 나갔다(수정 전 파일) → 원본 PC에서 재export. 복원/저장은 `restoreSessionExtras`·`migrateSessionExtras` 의 tilemapData 절 |
| 세션을 지웠는데 `AppData/images` 용량이 안 줄어듦 | 즉시 삭제는 없다(Ctrl+Z 보호). prod 앱을 다시 시작하면 20초 뒤 고아 정리 — 단 수정 후 24h 미만 파일·해석 불가 형식은 보존 |
| 이미지 키 형식 불일치로 로드 실패 | `images/` 접두/`.txt` 접미 혼재 → `normalizeImageKey`(imageStorage.ts:23) |
