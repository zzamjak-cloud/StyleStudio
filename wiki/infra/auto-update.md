# 인앱 자동 업데이트

Tauri `updater` 플러그인 기반의 **인앱 자동 업데이트**. 앱 시작 3초 후 GitHub 릴리스의 `latest.json` 을 조회해 새 버전이 있으면 모달을 띄우고, 사용자가 승인하면 다운로드→설치→재시작한다. 서명키(minisign)로 아티팩트 무결성을 검증한다. 버전은 `package.json`·`tauri.conf.json`·`Cargo.toml` 3곳이 동일해야 하며 `bump-version.sh` 로 동기화한다.

## 관련 파일
- `src/hooks/useAutoUpdate.ts` — 업데이트 상태 머신(`check`/`downloadAndInstall`/`relaunch`). 훅
- `src/components/common/UpdateModal.tsx` — 상태별 모달 UI. `UpdateModal`(memo)
- `src/App.tsx:168` — `useAutoUpdate()` 호출, `src/App.tsx:1512` — `<UpdateModal>` 렌더
- `src-tauri/tauri.conf.json:46-55` — `plugins.updater`(pubkey·endpoints·installMode)
- `src-tauri/src/lib.rs:11-12` — `updater`·`process` 플러그인 등록
- `scripts/bump-version.sh` — 3파일 버전 + CHANGELOG 동기화
- `.github/workflows/release.yml` — 빌드·서명·`latest.json` 배포

## 데이터 모델

```ts
UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error'

UpdateState = { status: UpdateStatus, update: Update | null, progress: number, error: string | null }
```

`Update` 는 `@tauri-apps/plugin-updater` 타입(`version`, `body`(릴리스 노트), `downloadAndInstall()`).

## 업데이트 흐름 (useAutoUpdate.ts)

1. **마운트 3초 뒤** `checkForUpdate()` 자동 실행 (`useAutoUpdate.ts:122-128`)
2. `check()` → 새 버전 있으면 `status: 'available'` + `update` 저장 (`:38-46`)
3. `downloadAndInstall()` → 진행 이벤트 3종 처리 (`:78-96`)
   - `Started`: `contentLength` 획득
   - `Progress`: `downloaded` 누적 → `progress`(%) 갱신
   - `Finished`: `status: 'ready'`, `progress: 100`
4. 완료 후 `relaunch()`(process 플러그인)로 앱 재시작 (`:100`)
5. `dismissUpdate()` → `idle` 로 리셋 (`:112-119`)

### 개발 환경 graceful 무시
`check()` 실패 메시지에 `Could not fetch`/`network error` 가 있으면(업데이트 서버 미설정) 조용히 `idle` 로 되돌린다 — 그 외 에러만 `status: 'error'` (`useAutoUpdate.ts:53-64`).

## 모달 UI (UpdateModal.tsx)

`status` 가 `idle`/`checking` 이면 렌더 안 함(`UpdateModal.tsx:24-26`). 상태별:

| status | 표시 | 버튼 |
|--------|------|------|
| `available` | 새 버전·릴리스 노트(`update.body`) | 나중에 / 지금 업데이트 |
| `downloading` | 프로그레스 바(`progress%`) | 없음(진행 중) |
| `ready` | "재시작합니다" | 없음 |
| `error` | 에러 메시지 | 나중에(닫기) |

닫기(X)·"나중에" 는 `available`/`error` 에서만 노출 — 다운로드 중엔 취소 불가 (`UpdateModal.tsx:59, 124`).

## 업데이터 서버 설정 (tauri.conf.json)

```jsonc
"updater": {
  "pubkey": "<minisign public key>",           // 서명 검증 공개키
  "endpoints": [
    "https://github.com/zzamjak-cloud/StyleStudio/releases/download/latest/latest.json"
  ],
  "windows": { "installMode": "passive" }
}
```

- **`latest`** 라는 고정 릴리스 태그에 항상 최신 `latest.json` 을 올리는 구조(`release.yml` 이 버전 릴리스에서 `latest.json` 을 받아 `latest` 릴리스로 재배포).
- `createUpdaterArtifacts: true`(`tauri.conf.json:34`) — 빌드 시 서명된 업데이터 아티팩트 생성. 로컬 빌드는 `tauri.local.conf.json` 이 이를 `false` 로 덮음.

## 버전 동기화 (bump-version.sh)

```bash
./scripts/bump-version.sh 0.5.0
```

수행(모두 semver 검증·작업트리 clean 확인 후):
0. **원격에 없는 로컬 태그 점검** — 있으면 경고만 하고 계속 진행한다(아래 "태그 푸시" 참고)
1. `package.json` 버전 (`bump-version.sh:56-61`)
2. `src-tauri/tauri.conf.json` 버전 (`:65-70`)
3. `src-tauri/Cargo.toml` 버전(sed) (`:74`)
4. `CHANGELOG.md` `[Unreleased]` → `[NEW] - 날짜` 변환 (`:82-92`)
5. 커밋 + `v{version}` 태그 생성 (`:96-98`)

`Cargo.lock` 의 자기 패키지 버전도 함께 맞춘다 — 안 맞추면 다음 `cargo build` 가 lock 을 고쳐 작업 트리가 더러워진다.

### 태그 푸시 (⛔ `--tags` 금지)

```bash
git push origin main && git push origin v0.9.0   # 새 태그만 명시
```

**`git push origin main --tags` 를 쓰지 않는다.** `release.yml` 은 `v*` 태그 push 에 반응하므로, 원격에 없는 **구버전 로컬 태그까지 함께 밀리면 그 태그마다 릴리스 빌드가 트리거된다.**

- 잔여 로컬 태그는 **중단된 범프**가 남긴다. `bump-version.sh` 는 커밋과 태그를 먼저 만들고 푸시는 사람이 하므로, 배포를 접으면 태그만 로컬에 남는다.
- 실제 사례: `v0.4.22`·`v0.4.23`(배포되지 않은 개발 중 버전)이 로컬에 남아 v0.7.1·v0.9.0 배포 때 두 번 함께 밀렸다. 두 번 다 워크플로가 `Create GitHub Release` 단계에서 10초 내 실패해 릴리스·`latest.json` 은 건드리지 않았지만, 실패 알림이 남는다. **2026-09-10 에 두 태그를 로컬·원격에서 모두 삭제**했고, 스크립트가 `[0/5]` 단계에서 잔여 태그를 경고하도록 고쳤다.
- 실수로 밀었다면: `git push origin :refs/tags/<태그>` 로 원격에서만 지운다(로컬 태그가 남아 있어 복구 가능). 배포할 일이 없는 태그면 `git tag -d <태그>` 로 로컬도 지운다.
- 로컬·원격 태그 차이 확인:
  ```bash
  comm -23 <(git tag | sort) \
    <(git ls-remote --tags origin | sed -n 's#.*refs/tags/\([^^]*\)$#\1#p' | sort -u)
  ```

## 회귀 증상별 원인

| 증상 | 원인 |
|------|------|
| 업데이트 확인 자체가 안 됨 | 마운트 3초 타이머 전 언마운트, 또는 endpoints 도달 불가 |
| dev 에서 매번 에러 모달 | `Could not fetch` 필터 조건 벗어난 에러(`useAutoUpdate.ts:53`) |
| 서명 검증 실패로 설치 안 됨 | `pubkey` ↔ CI 서명키(`TAURI_SIGNING_PRIVATE_KEY`) 불일치 |
| 다운로드는 되나 재시작 안 됨 | `process` 플러그인 미등록/권한 없음(`relaunch`) |
| 최신 버전인데 계속 알림 | `latest.json` 의 version ≤ 현재 버전이어야 무알림 — 3파일 버전 불일치 |
| 릴리스 노트 안 보임 | `update.body` 비어있음(릴리스 본문/`latest.json` notes 누락) |
| bump 후 CHANGELOG 이 안 바뀜 | `bump-version.sh` 의 `[Unreleased]` 치환 정규식이 LF 전제 — CHANGELOG.md 가 CRLF 이면 조용히 미매치(v0.4.22 에서 실제 발생, 수동 보완). 스크립트 수정 전까지 bump 후 CHANGELOG 반영 여부를 눈으로 확인할 것 |
| 로컬 빌드가 업데이트 못 받음 | `tauri.local.conf.json` `createUpdaterArtifacts: false` |
| 배포하지도 않은 구버전 태그로 릴리스 빌드가 돎 | `git push --tags` 로 잔여 로컬 태그가 함께 밀렸다 → 새 태그만 명시해 푸시한다(위 "태그 푸시") |
| bump 실행 시 `[0/5]` 에서 잔여 태그 경고 | 중단된 범프가 남긴 태그다. 배포 예정이 없으면 `git tag -d <태그>` 로 지운다 |
