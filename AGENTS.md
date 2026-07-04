# AGENTS.md — StyleStudio

AI 게임 아트 제작 데스크톱 앱 (React 19 + TypeScript + Tauri v2 + Zustand + Vite).

## 위키 우선 (필수)

**코드 작업 전 반드시 `wiki/` 를 먼저 참조한다.** 소스를 직접 탐색하기 전에 위키로 구조를 파악하면 패킷/시간을 크게 절약할 수 있다.

1. **`wiki/README.md` 를 먼저 연다.** 최상단 "빠른 진입 (증상 → 파일)" 표에서 작업/증상에 맞는 위키 파일을 찾는다.
2. 해당 카테고리 위키(`wiki/<category>/*.md`)를 읽어 관련 파일·데이터 모델·핵심 흐름·회귀 함정을 파악한다.
3. 위키의 `파일경로:라인번호` 좌표로 실제 소스에 바로 진입한다.
4. `wiki/README.md` 하단 "알려진 함정" 은 작업 전 반드시 확인 (dead code, 미전달 파라미터, 타입 중복 등).

> 위키에 없는 영역을 새로 파악했거나, 위키 내용이 코드와 어긋나면 해당 위키 파일과 `README.md` 인덱스를 갱신한다.

### 카테고리 맵
`session`(세션 코어) · `folders`(폴더) · `analysis`(참조 분석) · `generator`+`prompts`(이미지 생성) · `chat`(대화형) · `concept`(컨셉 아트) · `illustration`(다중 캐릭터) · `pixelart` · `documents`(참조 문서) · `infra`(Tauri) · `auth`(OAuth) · `api`(에러/번역) · `ui`(공통 컴포넌트)

## 언어 규칙

- 코드 주석·설명·응답·커밋 메시지: **한국어**
- 변수명·함수명 등 식별자: 영어

## 버전 관리

- 버전은 3파일(`package.json`, `src-tauri/tauri.conf.json`, `Cargo.toml`) + `CHANGELOG.md` 동시 갱신. `scripts/bump-version.sh` 사용. → `wiki/infra/auto-update.md`
