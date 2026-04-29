# StyleStudio - AI 이미지 생성 워크스테이션

AI를 활용한 게임 아트 제작을 위한 데스크톱 애플리케이션 (v0.4.12)

## 주요 기능

### 세션 기반 워크플로우

참조 이미지를 업로드하면 AI가 스타일, 캐릭터, 구도를 분석하고, 분석 결과를 기반으로 일관된 이미지를 생성합니다.

### 세션 타입

| 타입 | 설명 | 주요 기능 |
|------|------|----------|
| **기본 (채팅)** | 대화형 이미지 생성 | Gemini 기반 채팅으로 이미지 생성 및 수정 |
| **스타일** | 특정 화풍 학습 | 참조 이미지의 아트 스타일 재현 |
| **캐릭터** | 캐릭터 외형 학습 | 일관성 있는 캐릭터 생성 |
| **배경** | 배경 스타일 학습 | 다양한 환경 배경 생성 |
| **아이콘** | 아이템/아이콘 스타일 학습 | 게임 오브젝트 생성 |
| **픽셀 캐릭터** | 픽셀아트 캐릭터 | 스프라이트 시트 생성 (그리드 레이아웃 지원) |
| **픽셀 배경** | 픽셀아트 배경 | 게임 씬 생성 |
| **픽셀 아이콘** | 픽셀아트 아이콘 | 게임 UI 요소 생성 |
| **UI 디자인** | UI/UX 디자인 | 참조 문서(PDF/Excel) 기반 인터페이스 화면 생성 |
| **로고** | 게임 타이틀 로고 | 브랜드 로고 생성 |
| **일러스트** | 다중 캐릭터 씬 | 캐릭터별 참조 이미지 + 배경 조합 |
| **컨셉** | 게임 컨셉 아트 | 장르/스타일 프리셋 기반 모바일 게임 컨셉 생성 |

### 폴더 관리

- 계층적 폴더 구조로 세션 정리
- 드래그 앤 드롭으로 세션/폴더 이동
- 폴더 단위 내보내기/불러오기
- 폴더 삭제 후 Ctrl+Z 되돌리기

### 이미지 생성 옵션

- 비율 설정 (1:1, 16:9, 9:16, 4:3, 3:4)
- 해상도 선택 (1K, 2K, 4K)
- 참조 이미지 영향력 조절
- 카메라 앵글/렌즈 프리셋
- 픽셀아트 그리드 레이아웃 (1x1 ~ 8x8)

### 기타

- Google OAuth 인증
- 세션 자동 저장
- 세션/폴더 내보내기 및 불러오기
- 인앱 자동 업데이트
- 생성 히스토리 관리 (즐겨찾기, 자동 저장 경로 설정)

## 기술 스택

- **프론트엔드**: React 19 + TypeScript 5.8 + Tailwind CSS 3
- **데스크톱**: Tauri v2
- **빌드**: Vite 7
- **상태 관리**: Zustand 5
- **AI API**: Google Gemini API
- **문서 처리**: pdfjs-dist, xlsx

## 개발 환경

### 권장 IDE

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

### 개발 서버

```bash
npm install
npm run tauri:dev
```

## 빌드 가이드

### 로컬 빌드
개발/테스트용 로컬 빌드는 자동 업데이트 서명 없이 빌드합니다.

```bash
npm run tauri:build:local
```

- 내부적으로 `src-tauri/tauri.local.conf.json`을 사용하여
  `createUpdaterArtifacts=false`로 빌드합니다.
- `TAURI_SIGNING_PRIVATE_KEY`가 없어도 빌드됩니다.

기본 릴리스 빌드(서명/업데이터 아티팩트 포함)는 아래 명령을 사용합니다.

```bash
npm run tauri:build
```

### 릴리스 빌드 (태그 푸시)
1. `package.json` / `src-tauri/tauri.conf.json` / `src-tauri/Cargo.toml` 버전을 동일하게 맞추고 `CHANGELOG.md`를 갱신합니다.
2. `src-tauri/tauri.conf.json`의 `bundle.createUpdaterArtifacts`가 `true`인지 확인합니다 (기본 릴리스 빌드용).
3. 커밋 후 버전 태그를 생성·푸시합니다. 예:
   ```bash
   git tag v0.4.12
   git push origin main
   git push origin v0.4.12
   ```
4. GitHub Actions가 macOS (Universal) / Windows 빌드 및 GitHub Releases 아티팩트를 생성합니다.
5. 인앱 자동 업데이트는 설정된 업데이터·서명 키(`TAURI_SIGNING_PRIVATE_KEY` 등)와 롤링 릴리스 채널에 따라 제공됩니다.

**태그와 워크플로 버전:** 태그 `push`로 돌리면 **그 태그 커밋에 들어 있는** `.github/workflows/release.yml`이 쓰입니다. `main`에서만 CI를 고치고 태그를 올리지 않으면 예전 YAML이 그대로 실행됩니다. 같은 버전으로 다시 빌드하려면 (1) **새 패치 태그**를 `main`에서 푸시하거나 (2) **Actions → Run workflow**에서 브랜치 **`main`**, 입력 태그 **`v…`** 로 수동 실행하세요.

**CI 서명 스크립트:** `scripts/ci/append_tauri_signing_env.py`는 릴리스 job에서 **저장소 기본 브랜치(보통 `main`)에서 가져옵니다.** 태그 시점에 그 파일이 없었어도, 앱 소스는 여전히 **지정한 태그 커밋**입니다.

**참고:** 서명 키 없이 로컬에서 설치 파일만 검증할 때는 `npm run tauri:build:local`을 사용하세요.