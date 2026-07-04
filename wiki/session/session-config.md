# 세션 타입 설정 (sessionConfig.ts · paths.ts)

`sessionConfig.ts` 는 12종 `SessionType` 각각의 **표시/설명/색상/그리드 안내 문구**를 한 곳에 모은 룩업 테이블(`SESSION_CONFIG`)이다. UI 라벨·아이콘 이모지·그리드 버튼 색상 클래스·그리드 레이아웃별 설명·프롬프트 placeholder 를 담는다. 코드 흐름을 바꾸는 기능 플래그는 아니며 **순전히 프레젠테이션 설정**이다(타입별 동작 분기는 `App.tsx`·각 패널이 `type` 값으로 직접 처리). `paths.ts` 는 이와 별개로 **생성 결과 이미지의 파일 시스템 저장 경로**(`~/Downloads/AI_Gen/`)를 관리한다.

## 관련 파일

- `src/lib/config/sessionConfig.ts` — `SESSION_CONFIG` 테이블 + 접근 헬퍼 6종
- `src/lib/config/paths.ts` — 생성물 저장 루트 경로 계산·폴더명 sanitize
- `src/components/common/NewSessionModal.tsx` — `SESSION_CONFIG[type].label` 로 자동 세션명 생성(NewSessionModal.tsx:18)

## 데이터 모델 (SessionConfig)

```
SessionConfig = {
  label: string          // 한글 라벨 (예: '채팅','캐릭터')
  icon: string           // 이모지
  description: string
  colors: {
    selected: string     // 그리드 버튼 선택 시 Tailwind 클래스
    unselected: string
    background: string   // 그리드 섹션 배경 그라디언트
    border: string
  }
  grids: Record<PixelArtGridLayout, string>  // 1x1|2x2|3x3|4x4|6x6|8x8 별 설명 문구
  promptPlaceholder: string
  gridLabel: string      // 예: '💬 채팅 그리드'
}

SESSION_CONFIG: Record<SessionType, SessionConfig>   // sessionConfig.ts:43, 12개 항목 전부 정의
PixelArtGridLayout = '1x1' | '2x2' | '3x3' | '4x4' | '6x6' | '8x8'
```

## 타입별 라벨·색상 요약

| SessionType | label | icon | 색상 계열 |
|-------------|-------|------|----------|
| `BASIC` | 채팅 | 💬 | indigo |
| `CHARACTER` | 캐릭터 | 👤 | blue |
| `BACKGROUND` | 배경 | ⛰️ | green |
| `ICON` | 아이콘 | 🎨 | amber |
| `STYLE` | 스타일 | ✨ | purple |
| `UI` | UI 디자인 | 📱 | pink |
| `LOGO` | 로고 | 🔤 | red |
| `ILLUSTRATION` | 일러스트 | 🎨 | violet |
| `PIXELART_CHARACTER` | 픽셀아트 캐릭터 | 🎮 | cyan |
| `PIXELART_BACKGROUND` | 픽셀아트 배경 | 🏞️ | cyan |
| `PIXELART_ICON` | 픽셀아트 아이콘 | 💎 | cyan |
| `CONCEPT` | 컨셉 | 🎨 | purple |

> Sidebar/NewSessionModal 의 아이콘은 `SESSION_CONFIG.icon`(이모지)이 아니라 lucide 아이콘을 별도 `getSessionTypeInfo`(Sidebar.tsx:13)로 매핑한다. 두 소스가 분리돼 있으니 타입 추가 시 **양쪽 모두** 갱신 필요.

## 접근 헬퍼 (sessionConfig.ts)

- `getGridButtonStyle(type, isSelected)` — 선택/미선택 색상 클래스(sessionConfig.ts:312)
- `getGridDescription(type, grid)` — 그리드별 설명(sessionConfig.ts:320)
- `getPromptPlaceholder(type, grid?)` — placeholder. **UI/LOGO/PIXELART_\* 는 그리드별 설명을 덧붙임**(sessionConfig.ts:331)
- `getGridLabel(type)` — 그리드 섹션 라벨(sessionConfig.ts:342)
- `getGridSectionStyle(type)` — 배경+보더 클래스(sessionConfig.ts:349)

## paths.ts — 생성물 저장 경로

세션 JSON 저장소(`settings.json`)와 무관한, **AI 생성 이미지 결과물**의 다운로드 폴더 경로 계산.

- `AI_GEN_ROOT_SEGMENT='AI_Gen'`, `SESSIONS_SEGMENT='Sessions'`(paths.ts:5·7).
- `getAiGenRoot()` → `~/Downloads/AI_Gen/`(없으면 mkdir, paths.ts:10).
- `getSessionsRoot()` → `~/Downloads/AI_Gen/Sessions/`(paths.ts:20).
- `getSessionImageFolder(sessionName)` → `~/Downloads/AI_Gen/{sanitized name}/`(paths.ts:33).
- `sanitizeFolderName(name)` → `\/:*?"<>|` 를 `_` 로 치환, 빈 값이면 `'untitled'`(paths.ts:44). Windows/macOS 공통 금지문자 대응.
- v0.4.4 부터 세션의 `autoSavePath` 필드는 deprecated — 저장 경로가 세션명 기반으로 자동 결정된다(session.ts:20).

## 회귀 증상별 원인

| 증상 | 원인 |
|------|------|
| 새 타입 추가 후 Sidebar 아이콘이 기본(팔레트)로 나옴 | `getSessionTypeInfo`(Sidebar.tsx:13) 미갱신 — `SESSION_CONFIG` 와 별도 매핑 |
| 새 타입의 그리드 설명/색상 누락 런타임 오류 | `SESSION_CONFIG` 는 `Record<SessionType,...>` 이라 타입 추가 시 컴파일 에러로 강제됨 — 항목 추가 필요 |
| UI/LOGO/픽셀 세션 placeholder 에 그리드 설명 안 붙음 | `getPromptPlaceholder` 에 `grid` 인자 미전달(sessionConfig.ts:331 분기) |
| 생성 이미지 저장 시 폴더명 오류(금지문자) | `sanitizeFolderName` 미적용 경로 사용(paths.ts:44) |
