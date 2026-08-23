# 서드파티 라이선스 고지 (Third-Party Notices)

StyleStudio는 아래 오픈소스 소프트웨어를 사용합니다.
각 저작물의 저작권은 해당 저작권자에게 있으며, 표기된 라이선스 조건에 따라 사용됩니다.

모든 직접 의존성은 MIT / Apache-2.0 / ISC 계열의 허용적 라이선스로,
본 프로그램의 GPL-3.0-or-later 배포와 호환됩니다.

## 프론트엔드 (npm)

### 런타임 의존성

| 패키지 | 라이선스 |
|--------|----------|
| @google/generative-ai | Apache-2.0 |
| @tauri-apps/api | MIT OR Apache-2.0 |
| @tauri-apps/plugin-deep-link | MIT OR Apache-2.0 |
| @tauri-apps/plugin-dialog | MIT OR Apache-2.0 |
| @tauri-apps/plugin-fs | MIT OR Apache-2.0 |
| @tauri-apps/plugin-http | MIT OR Apache-2.0 |
| @tauri-apps/plugin-opener | MIT OR Apache-2.0 |
| @tauri-apps/plugin-process | MIT OR Apache-2.0 |
| @tauri-apps/plugin-store | MIT OR Apache-2.0 |
| @tauri-apps/plugin-updater | MIT OR Apache-2.0 |
| class-variance-authority | Apache-2.0 |
| clsx | MIT |
| idb | ISC |
| konva | MIT |
| lucide-react | ISC |
| pdfjs-dist | Apache-2.0 |
| react | MIT |
| react-dom | MIT |
| react-konva | MIT |
| tailwind-merge | MIT |
| xlsx (SheetJS) | Apache-2.0 |
| zustand | MIT |

### 개발 의존성 (배포물에 포함되지 않음)

@tailwindcss/typography (MIT) · @tauri-apps/cli (MIT OR Apache-2.0) · @types/react (MIT) ·
@types/react-dom (MIT) · @vitejs/plugin-react (MIT) · autoprefixer (MIT) · postcss (MIT) ·
tailwindcss (MIT) · typescript (Apache-2.0) · vite (MIT)

## 백엔드 (Rust / crates.io)

| 크레이트 | 라이선스 |
|----------|----------|
| tauri | MIT OR Apache-2.0 |
| tauri-plugin-opener | MIT OR Apache-2.0 |
| tauri-plugin-store | MIT OR Apache-2.0 |
| tauri-plugin-dialog | MIT OR Apache-2.0 |
| tauri-plugin-fs | MIT OR Apache-2.0 |
| tauri-plugin-http | MIT OR Apache-2.0 |
| tauri-plugin-updater | MIT OR Apache-2.0 |
| tauri-plugin-process | MIT OR Apache-2.0 |
| tauri-plugin-deep-link | MIT OR Apache-2.0 |
| serde / serde_json | MIT OR Apache-2.0 |
| tiny_http | MIT OR Apache-2.0 |
| url | MIT OR Apache-2.0 |
| tokio | MIT |

전체 전이 의존성 목록은 `package-lock.json`과 `src-tauri/Cargo.lock`에서 확인할 수 있습니다.

## 외부 서비스

이 프로그램은 Google Gemini API를 호출합니다.
API를 통해 생성된 결과물의 권리 및 이용 조건은 Google의 서비스 약관을 따르며,
본 프로그램의 GPL-3.0 라이선스는 프로그램 소스 코드에만 적용됩니다.

## 갱신 방법

의존성을 추가·제거한 경우 이 문서도 함께 갱신합니다.

```bash
node -e 'const fs=require("fs");const p=JSON.parse(fs.readFileSync("package.json","utf8"));
for(const n of Object.keys({...p.dependencies,...p.devDependencies})){
  const d=JSON.parse(fs.readFileSync(`node_modules/${n}/package.json`,"utf8"));
  console.log(n, d.license);}'
```
