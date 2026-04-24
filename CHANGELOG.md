# Changelog

이 프로젝트의 모든 주요 변경 사항을 기록합니다.
형식은 [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/)를 기반으로 합니다.

## [Unreleased]

## [0.4.9] - 2026-04-25

### Added
- 컨셉 세션에 우측 상단 저장 폴더 열기 버튼 추가 (채팅 세션과 동일 위치/스타일)
- `LazyImage` 공용 컴포넌트 — IndexedDB 키를 받으면 마운트 시 비동기로 base64 디코딩
- `imageDownscale` 유틸 — 사용자 업로드 이미지를 maxDim 1280·JPEG 0.85로 자동 축소

### Changed (Performance)
- 채팅 세션 이미지 비율 버튼을 1라인 5개 컴팩트 레이아웃으로 통일 (컨셉 세션과 일관)
- 사용자 업로드/붙여넣기/채팅 첨부 이미지를 입력 즉시 다운스케일 — IndexedDB·메모리·디코딩 비용 일괄 절감
- 세션 부가 영역(generationHistory/chatData.messages.images/conceptData.history/conceptData.referenceImage) 로드를 lazy화 — 앱 시작 시 모든 이미지를 동기 디코딩하던 구조 제거. 실제 보이는 시점에만 LazyImage가 IndexedDB에서 비동기 디코딩
- pdfjs-dist를 동적 import으로 전환 — PDF 첨부 전까지 번들 로드 미룸 (앱 시작 번들 크기 ↓)
- 사이드바 폴더 아이템을 별도 `FolderListItem` 메모 컴포넌트로 분리. 다른 폴더 선택 시 비활성 항목 리렌더 차단
- 분석 카드 6종(StyleCard/CharacterCard/CompositionCard/UICard/LogoCard/NegativePromptCard) `React.memo` 래핑
- 모달 4종(SettingsModal/SaveSessionModal/NewSessionModal/UpdateModal) `React.memo` 래핑
- `useChatSession`의 `messages`/`attachedDocuments`/`settings` 파생값을 `useMemo`로 안정화

### Fixed (Storage Hygiene)
- 이미지 생성 히스토리·컨셉 히스토리·채팅 메시지 삭제 시 IndexedDB의 해당 이미지 키도 함께 제거 — orphan 누적 차단
- export(`exportSessionToFile`/`exportFolderToFile`) 시 부가 영역의 IndexedDB 키를 base64로 복원해 직렬화 — 다른 PC에서 import 호환성 유지

## [0.4.8] - 2026-04-25

### Changed (Performance)
- 세션 저장(`persistSessions`)을 500ms 디바운스 + 백그라운드 직렬 큐로 통합 — 짧은 시간에 다수 변경(히스토리 추가/문서 첨부/세션 순서 변경 등)이 몰릴 때 거대한 settings.json 직렬화가 매번 발생하던 문제 해소. 호출자는 즉시 resolve 반환받아 UI 반응성 보장
- 페이지 종료/리프레시 시 보류 중인 세션 저장을 즉시 비우는 `flushPendingSessions` 추가 및 `App.tsx`에서 `beforeunload` 리스너 등록
- 무거운 세션 패널 4개(`ImageGeneratorPanel`/`IllustrationSetupPanel`/`ChatPanel`/`ConceptPanel`)를 `React.lazy` 코드 분할 — 앱 시작 번들 크기 감소, 첫 진입 패널 외에는 사용 시점에만 로드
- 사이드바 세션 아이템을 별도 `SessionListItem` 메모 컴포넌트로 분리. 다른 세션 선택 시 비활성 항목들은 리렌더 차단
- `Sidebar`의 핸들러 8종(`handleMouseDown`/`handleFolderClick`/`handleSessionDoubleClick` 등)을 `useCallback`으로 안정화

## [0.4.7] - 2026-04-24

### Changed (Performance)
- 이미지 생성 패널의 자식 컴포넌트(`GeneratorSettings`/`GeneratorPreview`/`GeneratorHistory`)를 `React.memo`로 래핑하고, 상위의 setter·핸들러를 `useCallback`으로 안정화 — 그리드·카메라·비율·크기 메뉴 클릭 시 체감 렉 감소
- `GeneratorHistory`의 `.slice().sort()`를 `useMemo`로 이전해 매 렌더 재정렬 제거
- `App.tsx`의 `currentSession` 복원 이펙트에 세션 id 가드 추가 — autoSave로 세션 객체 참조만 바뀌는 경우 Base64 이미지 배열 재복사를 건너뜀
- 채팅(`ChatPanel`·`ChatMessage`)과 컨셉 히스토리(`ConceptHistory`)를 `React.memo`로 래핑
- 분석·채팅·컨셉·이미지 생성 히스토리·일러스트 캐릭터/배경 썸네일의 `<img>` 태그에 `loading="lazy"` 및 `decoding="async"` 추가 — 세션 전환 시 Base64 이미지 디코딩을 메인 스레드 밖으로 이동시켜 분석 화면이 포함된 모든 세션 타입의 진입 지연 완화

## [0.4.6] - 2026-04-24

### Added
- 릴리즈 빌드에서도 DevTools(`Cmd+Opt+I`, 우클릭 → 요소 검사)를 사용할 수 있도록 `tauri` 크레이트에 `devtools` feature 활성화 — 특정 PC에서만 재현되는 이슈(예: 이미지 생성 화면 진입 시 흰 화면)의 콘솔 로그 수집 목적

## [0.4.5] - 2026-04-23

### Added
- 채팅 세션 상단에 저장 폴더 버튼/경로 표시 추가 (`~/Downloads/AI_Gen/`)
- 채팅 첨부 문서 상태 배지(`대화 참조중`) 및 세션 전환 후 첨부 문서 유지

### Changed
- 채팅 이미지 자동 저장 경로를 세션 하위 폴더에서 `~/Downloads/AI_Gen/` 루트로 고정
- 채팅 문서 컨텍스트를 원문 전체 대신 AI 요약 중심으로 전달하도록 최적화
- 이미지 생성 화면의 "저장 폴더 열기" 동작을 항상 `~/Downloads/AI_Gen/` 루트 오픈으로 통일

### Fixed
- PDF 드래그 첨부 시 문서가 중복 등록되던 문제 수정
- 채팅/문서 관련 드래그 이벤트 리스너 정리 중 발생하던 `listeners[eventId].handlerId` 오류 완화
- Tauri opener 권한 스코프 설정 보강으로 `AI_Gen` 폴더 열기 실패 문제 수정
- 채팅 이미지 자동 저장 누락 조건 보완 및 파일명 충돌 방지

## [0.4.3] - 2026-04-22

### Added
- 클립보드 이미지 붙여넣기(Ctrl+V) 지원 — 분석 패널(AnalysisPanel), 생성 참조 업로더(ImageUpload), 컨셉 참조 패널(ConceptLeftPanel)의 이미지 추가 지점에 공통 적용 (`src/hooks/useImagePaste.ts` 신규)

### Fixed
- 분석 이미지를 제거하고 동일 개수의 새 이미지를 넣었을 때 "신규 이미지가 없습니다" 팝업이 잘못 뜨던 버그 — 배열 길이 비교 대신 이미지 내용 비교로 수정
- 이미지 분석이 이루어지지 않은 상태(빈 analysis 포함)에서 "이미지 생성" 버튼 클릭 시 화면이 넘어가던 문제 — `handleGenerateImage`에 이미지/분석 상태 가드 추가

### Changed
- "이미지 생성" 버튼 가드 메시지 분리 — 이미지 미등록/분석 미완료 상황별 안내 팝업 적용

## [0.4.2] - 2026-04-22

### Fixed
- 채팅 세션에서 이미지 비율(1:1/16:9/9:16/4:3/3:4) 선택이 실제 생성에 반영되지 않고 1:1로 고정되던 문제 — UI 설정이 `chatData.settings`로 동기화되지 않아 API 요청에 누락되었음
- 이미지 크기 기본값(1K)이 세팅되지 않고, 선택한 크기가 생성 요청에 전달되지 않던 문제 — `imageConfig.imageSize` 필드 누락
- 그리드 레이아웃(2x2/3x3/4x4) 선택이 생성에 전혀 반영되지 않던 문제 — 프롬프트 prefix로 결합하도록 수정
- 스타일 프리셋이 생성 이미지에 반영되지 않던 문제 — 프롬프트 prefix로 결합 및 `ART_STYLE_PRESETS` 한글 키로 통일

### Changed
- 채팅 세션 이미지 크기 옵션을 Gemini API 호환 값(1K/2K/4K)으로 교정 (기존 `3K`는 API 미지원)
- 채팅 세션 모델 옵션 라벨을 실제 모델 ID(`gemini-3-pro-image-preview`, `gemini-3.1-flash-image-preview`)와 매핑
- 채팅 세션 AI 설정을 세션 데이터(`chatData.settings`)에 영속화하여 세션별로 유지

## [0.4.1] - 2026-04-16

### Added
- 장르/스타일 드롭다운에 "+ 직접 추가" 기능 (팝업 입력, localStorage 영속, x 버튼 삭제)
- CHANGELOG.md 기반 릴리즈 노트 자동화 (GitHub Actions 연동)
- 버전 범프 스크립트 (`scripts/bump-version.sh`)

### Changed
- 컨셉 히스토리 패널 이미지 전용 표시 (텍스트 정보 제거, 비율 유지)
- 우측 패널 레이아웃 재구성 (프롬프트 → 생성 버튼 → 모델/설정 순서)
- 이미지 비율 버튼 5개 1줄, 그리드 버튼 4개 1줄 (컴팩트 UI)
- 히스토리 항목 간격 10px, 패널 높이 기준 이미지 크기 결정
- "생성 설정" 타이틀 제거

### Fixed
- 컨셉 세션 선택 시 다른 세션으로 포커스가 되돌아가는 버그 수정
- 세션 전환 시 렉 최적화 (불필요한 React 재렌더링 제거, 언마운트 시 디스크 저장만 수행)

## [0.4.0] - 2025-04-16

### Added
- 전용 레포로 마이그레이션 (StyleStudio 독립 프로젝트)
- 게임 컨셉 아트 세션 (장르/스타일 프리셋 기반 모바일 게임 컨셉 생성)
- 일러스트 세션 (다중 캐릭터 + 배경 조합)
- 기본 채팅 세션 (Gemini 기반 대화형 이미지 생성)
- UI 디자인 세션 (참조 문서 기반 인터페이스 화면 생성)
- 로고 세션 (게임 타이틀 로고 생성)
- 픽셀아트 세션 (캐릭터, 배경, 아이콘)
- 스타일/캐릭터/배경/아이콘 분석 및 생성 세션
- 계층적 폴더 관리 (드래그 앤 드롭, 내보내기/불러오기)
- 인앱 자동 업데이트 (Tauri updater)
- Google OAuth 인증
- 세션 자동 저장 및 내보내기/불러오기
- 생성 히스토리 관리
- 이미지 비율/해상도/그리드 레이아웃 설정
