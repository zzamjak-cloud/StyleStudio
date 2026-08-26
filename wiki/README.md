# StyleStudio Wiki

AI 게임 아트 제작 데스크톱 앱(React 19 + Tauri v2)의 AI 탐색용 위키 인덱스. 작업 전 해당 파일을 먼저 읽으면 소스 탐색 없이 구조 파악 가능.

---

## 작업 원칙

- StyleStudio 기능 추가·개선·회귀 대응은 **wiki를 시작점**으로 한다. 관련 카테고리 문서를 먼저 읽고, 현재 코드가 문서와 다르면 코드 확인 후 문서를 함께 바로 갱신한다.
- 기능 변경이 끝나면 변경된 동작·UI·회귀 포인트를 해당 wiki 문서에 즉시 반영한다. 중간 진행 로그 파일은 만들지 않고, 영속화할 지식은 wiki에 남긴다.

---

## 빠른 진입 (증상 → 파일)

| 증상 / 작업 | 위키 파일 |
|------------|---------|
| 신규 세션 진입 시 흰 화면 / 세션 전환 렉 | `session/overview.md` |
| 자동 저장·디바운스·앱 종료 시 변경 유실 | `session/overview.md` |
| 세션 12종 타입·패널 라우팅·lazy 로딩 | `session/overview.md` |
| import 세션 이미지 손상 / settings.json 비대 | `session/storage.md` |
| dev·prod 전환 후 이미지 사라짐 / 이미지 키 정합 | `session/storage.md` |
| 세션/폴더 내보내기·불러오기 파일 포맷 | `session/storage.md` |
| 사이드바 전체 폴더·세션 스냅샷 저장/전달 | `session/storage.md` |
| 세션 타입 추가 시 라벨·색상·아이콘 누락 | `session/session-config.md` |
| 생성물 저장 경로(~/Downloads/AI_Gen) 문제 | `session/session-config.md` |
| 폴더 드래그앤드롭·순서변경·이동 오동작 | `folders/overview.md` |
| 폴더 삭제 되돌리기(Ctrl+Z) / 세션-폴더 매핑 소실 | `folders/overview.md` |
| 분석 후 패널이 안 뜨거나 흰 화면 | `analysis/overview.md` |
| 캐릭터/UI/로고 카드가 안 보이거나 잘못 나옴 | `analysis/overview.md` |
| 세션 재진입 시 분석 결과가 사라짐 | `analysis/overview.md` |
| 통합 프롬프트만 보이고 세부 분석 카드가 안 보임 | `analysis/overview.md` |
| 카드 편집이 저장 안 되거나 통합 프롬프트 미갱신 | `analysis/analysis-cards.md` |
| 필드 편집 버튼 비활성 / textarea 안 커짐 | `analysis/analysis-cards.md` |
| "JSON 파싱 불가" / "응답 잘림" / 안전필터 차단 | `analysis/analysis-prompt.md` |
| 강화 모드가 일반/전용 프롬프트로 잘못 감 | `analysis/analysis-prompt.md` |
| 모델 바꿨더니 비율/해상도가 리셋됨 | `generator/overview.md` |
| 한글 프롬프트가 번역 안 되고 그대로 전송됨 | `generator/overview.md` → `api/overview.md` |
| 모델 드롭다운 / gpt-image-2(덕테이프) / 나노바나나 2 라이트가 안 보임 | `generator/settings.md` |
| Reference Strength를 올려도 효과 없음 | `generator/settings.md` |
| 2K/4K 눌러도 안 바뀜(비용 확인 모달) | `generator/settings.md` |
| 카메라 앵글/렌즈가 안 보임 | `generator/settings.md` |
| 핀 눌러도 즐겨찾기 고정 안 됨 / 삭제 버튼 없음 | `generator/history.md` |
| 히스토리 복원했는데 재생성 안 됨 | `generator/history.md` |
| 히스토리 삭제해도 폴더에 파일이 남음 | `generator/history.md` |
| 참조 11장 이상인데 일부만 반영됨(최대 10장 전송) | `generator/image-generation-api.md` |
| Gemini 500 에러 반복(페이로드 과대) | `generator/image-generation-api.md` |
| OpenAI "안전 시스템 차단" 오류 | `generator/image-generation-api.md` |
| Ctrl+V가 텍스트만 붙고 이미지가 안 붙음 | `generator/image-generation-api.md` |
| 캐릭터가 참조와 다르게 생성됨 | `prompts/overview.md` |
| 생성 이미지 재편집 시 Gemini 400 / 이어지는 편집이 직전 이미지 반영 못 함 | `chat/overview.md` |
| 대화 요약 후에도 토큰/저장용량 안 줄어듦 | `chat/overview.md` |
| OpenAI Key 없이 gpt-image-2 선택, 극단 비율(1:3) 오류 | `chat/overview.md` |
| 결과 이미지에 어노테이션 컬러 라인/마커가 그대로 남음 | `chat/annotation.md` |
| 부분 편집 영역이 엉뚱한 곳에 적용 / 편집 버튼 안 보임 | `chat/annotation.md` |
| 어노테이션 캔버스에서 이미지가 잘림 / 확대·축소 안 됨 | `chat/annotation.md` |
| 컨셉 3K 선택 시 크기 오류 / 게임 플레이 방식 생성에 반영 안 됨 | `concept/overview.md` |
| 컨셉 히스토리 복원·커스텀 장르 유실·orphan 미정리 | `concept/overview.md` |
| 일러스트 드롭했는데 이미지 안 들어감 / 여러 카드 동시 하이라이트 | `illustration/overview.md` |
| 투명 PNG가 검게 생성 / 생성 버튼 계속 비활성 | `illustration/overview.md` |
| 저장된 구도 스케치 라벨이 구워져 이동 불가 / 재진입 시 펜 선 사라짐 | `illustration/concept-sketch.md` |
| 스케치 분석 결과가 생성에 반영 안 됨 / 라벨 위 그려짐 | `illustration/concept-sketch.md` |
| 픽셀아트 생성물에 격자선이 그려짐 | `pixelart/overview.md` → `prompts/overview.md` |
| 스프라이트 시트 프레임 수/해상도가 이상함 | `pixelart/overview.md` |
| 픽셀 업스케일(pixelArtUpscaler) 동작 안 함 | `pixelart/overview.md` |
| 그리드(1x1~8x8) 선택 UI가 안 보임 | `pixelart/overview.md` |
| 타일이 서로 이어지지 않음/seam 경고 | `tilemap/overview.md` |
| 선택 재생성·교체가 동작 안 함 | `tilemap/overview.md` |
| 내보낸 시트에 교체 타일이 반영 안 됨 | `tilemap/overview.md` |
| UI 세션에서 참조 문서 첨부가 안 보임 | `documents/overview.md` |
| 참조 문서 드롭 영역이 커 보이거나 한 줄로 안 보임 | `documents/overview.md` |
| PDF/Excel 파싱 결과가 프롬프트에 안 반영됨 | `documents/overview.md` |
| 긴 문서 내용이 잘리거나 요약이 원문 그대로임 | `documents/overview.md` |
| Google Sheets/웹페이지 첨부가 빈 내용 | `documents/overview.md` |
| dev 서버 포트 충돌 / Gemini·OAuth가 권한·CSP에 막힘 / 결과 폴더 열기 실패 | `infra/overview.md` |
| 앱 버전이 여러 곳에서 불일치 / 콘솔 창이 뜸 | `infra/overview.md` |
| 업데이트 확인 안 됨 / 서명 검증 실패 / 최신인데 계속 알림 | `infra/auto-update.md` |
| 로컬 빌드가 업데이트를 못 받음 / 다운로드 후 재시작 안 됨 | `infra/auto-update.md` |
| 재시작 시 창 위치 복원 안 됨 / 복원된 창이 화면 밖 | `infra/window.md` |
| 파일 드롭이 한 컴포넌트에만 감 / 리스너 중복 / prod에 debug 로그 노출 | `infra/window.md` |
| 로그인 콜백이 앱에 안 돌아옴 / 포트 9528 충돌 | `auth/overview.md` |
| "loadcomplete.com 사용자만" 거부 / "Invalid state parameter" | `auth/overview.md` |
| 재시작 후 매번 재로그인 요구 / 로그인 5분 후 자동 실패 | `auth/overview.md` |
| API 에러가 영문 raw로 노출 / 429·할당량 메시지 안 뜸 | `api/overview.md` |
| 번역이 원문 그대로 나옴 / 배치 번역 순서 어긋남 / API 키 없이 호출 | `api/overview.md` |
| 확인창이 안 뜨거나 무한 대기 / Enter·ESC 무반응 | `ui/overview.md` |
| 설정 저장 버튼 눌러도 안 닫힘 / 이미지가 placeholder에서 안 넘어감 | `ui/overview.md` |
| 리사이즈가 안 멈춤 / 진행 토스트 안 보임 / 에러 대신 흰 화면 | `ui/overview.md` |

---

## 카테고리별 파일 목록

### session/ — 세션 코어
| 파일 | 내용 |
|------|------|
| `overview.md` | 세션 모델·타입 12종, 생성/전환/삭제 흐름, 이중 디바운스 자동저장, 앱 셸·패널 라우팅·lazy 로딩 |
| `storage.md` | settings.json 영속화, 이미지 파일저장소(imageStorage) 분리·복원, 저장/로드 파이프라인, 세션 export/import |
| `session-config.md` | SESSION_CONFIG 타입별 프레젠테이션 설정, 접근 헬퍼, paths.ts 생성물 저장 경로 |

### folders/ — 폴더 관리
| 파일 | 내용 |
|------|------|
| `overview.md` | 폴더 계층·session_folder_map 권위, 마우스 기반 드래그앤드롭, 폴더 export/import, Ctrl+Z 삭제 복원 |

### analysis/ — 참조 이미지 분석
| 파일 | 내용 |
|------|------|
| `overview.md` | 참조 분석 전체 흐름(업로드→Gemini→ImageAnalysisResult→카드→편집), 세션 타입별 프롬프트·카드 차이 |
| `analysis-cards.md` | 카드 컴포넌트(공통 AnalysisCard/useFieldEditor), 섹션별 편집 필드, Negative/Unified 예외 |
| `analysis-prompt.md` | analysisPrompt.ts 10종 구조, useGeminiAnalyzer 호출·JSON 파싱·검증, analysisComparator 해시 비교 |

### generator/ — 이미지 생성기
| 파일 | 내용 |
|------|------|
| `overview.md` | 생성 패널 구조·생성 흐름(handleGenerate)·저장 |
| `settings.md` | 모델/비율/해상도/품질/카메라/그리드/고급 설정 전체 |
| `history.md` | 생성 히스토리·즐겨찾기(핀)·복원·자동 저장 경로 |
| `image-generation-api.md` | Gemini/OpenAI 생성 훅·모델 정의·이미지 업로드/붙여넣기/다운스케일 |

### prompts/ — 프롬프트 조립
| 파일 | 내용 |
|------|------|
| `overview.md` | promptBuilder·세션별 프롬프트(sessionPrompts)·추론 prefix(thinkingPrefix) |

### chat/ — 채팅(대화형 생성)
| 파일 | 내용 |
|------|------|
| `overview.md` | 대화형 이미지 생성·멀티턴·요약·모델 분기(Gemini/OpenAI) |
| `annotation.md` | 색상별 부분 편집(ImageAnnotator)·좌표 직렬화·마스크 export |

### concept/ — 컨셉 아트
| 파일 | 내용 |
|------|------|
| `overview.md` | 장르/스타일 프리셋 기반 모바일 게임 컨셉 아트·자동 프롬프트·히스토리 |

### illustration/ — 다중 캐릭터 씬
| 파일 | 내용 |
|------|------|
| `overview.md` | 다중 캐릭터 씬(캐릭터별 참조+배경 조합)·통합 드래그앤드롭 |
| `concept-sketch.md` | 구도 스케치(ConceptSketchPanel)·AI 스케치 분석·라벨 보존 |

### pixelart/ — 픽셀아트
| 파일 | 내용 |
|------|------|
| `overview.md` | 픽셀 세션 3종·그리드 레이아웃(1x1~8x8)·스프라이트 시트·업스케일 파이프라인 |

### tilemap/ — 타일맵
| 파일 | 내용 |
|------|------|
| `overview.md` | 손맵 변형 타일 세트(4x4/8x8, 1:1·1K 고정)·seam 점수·교체 재생성·유니티 내보내기 |

### documents/ — 참조 문서
| 파일 | 내용 |
|------|------|
| `overview.md` | UI 세션 참조 문서 관리(DocumentManager)·PDF/Excel 파싱(fileParser)·프롬프트 주입 |

### infra/ — 인프라(Tauri)
| 파일 | 내용 |
|------|------|
| `overview.md` | Tauri 셸 구조·플러그인·권한·빌드/실행·기술 스택 |
| `auto-update.md` | 인앱 자동 업데이트·업데이터 설정·버전 동기화(3파일+CHANGELOG) |
| `window.md` | 창 상태 저장/복원·드래그앤드롭 버스(windowDragDropBus)·로거 |

### auth/ — 인증
| 파일 | 내용 |
|------|------|
| `overview.md` | Google OAuth(loopback+PKCE)·oauth_server.rs·토큰 수명·도메인 제한 |

### api/ — API 공통
| 파일 | 내용 |
|------|------|
| `overview.md` | API 에러 처리(apiErrorHandler)·한↔영 번역(useGeminiTranslator)·API 키/저장 경로 |

### ui/ — 공통 UI
| 파일 | 내용 |
|------|------|
| `overview.md` | SettingsModal·ConfirmDialog·ErrorBoundary·LazyImage·Resizer·ProgressIndicator·EmptyState |

---

## 주요 파일 좌표 (코드 직접 참조)

| 역할 | 경로 |
|------|------|
| 앱 셸·패널 라우팅·저장 디바운스·폴더 Undo | `src/App.tsx` |
| 영속화 계층(settings.json I/O·export/import) | `src/lib/storage.ts` |
| 이미지 실데이터 저장소(AppData 파일·IndexedDB 폴백) | `src/lib/imageStorage.ts` |
| 세션 상태·CRUD·앱 초기화 훅 | `src/hooks/useSessionManagement.ts` |
| 폴더 상태·이동·import·복원 훅 | `src/hooks/useFolderManagement.ts` |
| 세션/폴더 트리 UI·드래그앤드롭·rename | `src/components/common/Sidebar.tsx` |
| 세션 타입별 설정 | `src/lib/config/sessionConfig.ts` |
| Gemini 분석 API·프롬프트 선택 | `src/hooks/api/useGeminiAnalyzer.ts` |
| 분석 결과 패널·카드 렌더 | `src/components/analysis/AnalysisPanel.tsx` |
| 생성 오케스트레이션(handleGenerate) | `src/components/generator/ImageGeneratorPanel.tsx` |
| 세션별 프롬프트 진입점 | `src/lib/prompts/sessionPrompts.ts` |
| 분석→통합 프롬프트 조립 | `src/lib/promptBuilder.ts` |
| Gemini 이미지 생성 훅(참조 최대 10장) | `src/hooks/api/useGeminiImageGenerator.ts` |
| OpenAI 이미지 생성 훅 | `src/hooks/api/useOpenAIImageGenerator.ts` |
| 이미지 모델 카탈로그 | `src/hooks/api/imageModels.ts` |
| 채팅 멀티턴 구성(buildContents) | `src/hooks/useChatImageGeneration.ts` |
| 어노테이션 마스크 export | `src/lib/utils/annotationExport.ts` |
| 컨셉 자동 프롬프트·크기 매핑 | `src/hooks/useConceptGeneration.ts` |
| 일러스트 위치 기반 드롭 판정 | `src/components/illustration/IllustrationSetupPanel.tsx` |
| 구도 스케치(라벨 제외 export) | `src/components/illustration/conceptSketch/ConceptSketchPanel.tsx` |
| 픽셀 그리드 정보(getPixelArtGridInfo) | `src/types/pixelart.ts` |
| 타일맵 후처리 훅(저장·분할·seam·교체) | `src/hooks/useTilemapProcessing.ts` |
| 타일맵 분할·seam 검증·유니티 내보내기 | `src/lib/tilemap/` (`tileSlicer.ts`·`seamValidator.ts`·`tilemapExporter.ts`) |
| 참조 문서 파싱 디스패처(parseFile) | `src/lib/utils/fileParser.ts` |
| 참조 문서 관리(processFiles) | `src/components/generator/DocumentManager.tsx` |
| Tauri 플러그인·OAuth invoke | `src-tauri/src/lib.rs` |
| 로컬 OAuth 콜백 서버(127.0.0.1:9528) | `src-tauri/src/oauth_server.rs` |
| Google 로그인(PKCE) | `src/lib/services/authService.ts` |
| 자동 업데이트(다운로드·재시작) | `src/hooks/useAutoUpdate.ts` |
| 한↔영 번역 | `src/hooks/api/useGeminiTranslator.ts` |
| API 에러 처리 | `src/lib/apiErrorHandler.ts` |
| 버전 동기화 스크립트 | `scripts/bump-version.sh` |
| Tauri 설정(updater·deep-link·권한) | `src-tauri/tauri.conf.json` |

---

## 알려진 함정 (에이전트 발견)

- **`Header.tsx` 는 미사용** — App 은 Sidebar 헤더의 설정 버튼을 쓴다.
- **저장 디바운스는 상수(`SESSION_LIMITS.AUTO_SAVE_INTERVAL`)가 아니라** `sessionHelpers`의 500ms + App의 1000ms 타이머 조합이 실제 동작.
- **세션 소속 권위는 `Session.folderId`가 아니라 `session_folder_map`** 이며, 아이콘 매핑이 `SESSION_CONFIG`(이모지)와 `getSessionTypeInfo`(lucide) 두 곳으로 분리 — 타입 추가 시 양쪽 갱신 필요.
- **`referenceStrength`(참조 영향력)는 UI에만 존재**, Gemini/OpenAI API에 실제 전달 안 됨(공식 미지원).
- **참조 이미지는 업로드 14장까지 가능하나 API 전송은 양쪽 provider 모두 최대 10장.**
- **스프라이트 시트는 canvas 분할/합성 코드가 없다** — 프롬프트 지시만으로 모델이 단일 이미지에 격자 배치.
- **`pixelArtUpscaler.ts` 함수는 dead code** — 레포 어디서도 호출 안 됨.
- **`PixelArtGridLayout` 타입 중복 정의** — `types/pixelart.ts`, `sessionConfig.ts`.
- **히스토리의 `imageBase64`와 디스크 자동 저장 파일(`~/Downloads/AI_Gen/`)은 독립** — 히스토리 삭제가 파일을 지우지 않음.
- **`useWindowState()` 는 정의만 있고 호출부 없음** — 창은 `tauri.conf.json`의 `maximized:true`로만 시작.
- **Gemini API 키는 `.env`가 아니라 SettingsModal 입력→store 영속.** `.env`의 `VITE_GOOGLE_*`는 OAuth 전용.
