# StyleStudio - AI 이미지 생성 워크스테이션

AI를 활용한 게임 아트 제작을 위한 데스크톱 애플리케이션 (v0.4.0)

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
npm run tauri dev
```

## 빌드 가이드

### 로컬 빌드
1. `tauri.conf.json`의 `createUpdaterArtifacts`를 `false`로 변경
2. `npm run tauri build` 실행

### 릴리스 빌드 (태그 푸시)
1. `tauri.conf.json`의 `createUpdaterArtifacts`가 `true`인지 확인
2. 버전 태그 푸시 (예: `git tag v0.4.0 && git push origin v0.4.0`)
3. GitHub Actions가 macOS (Universal) / Windows 빌드 및 릴리스 자동 생성
4. 롤링 릴리스(`latest`)를 통해 인앱 자동 업데이트 제공