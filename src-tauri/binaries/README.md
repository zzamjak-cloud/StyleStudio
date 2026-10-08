# 번들 바이너리

`tauri.conf.json` 의 `bundle.resources: ["binaries/*"]` 로 앱에 그대로 포함된다.

| 파일 | 만드는 방법 |
|------|------------|
| `ss-mcp.mjs` | `npm run mcp:build` — Node 18+ 로 실행되는 JS 번들 (약 1MB). 런타임을 포함한 단일 실행 파일은 앱에 넣지 않고 릴리스 자산으로만 올린다 (`release.yml`) |

빌드 산출물은 커밋하지 않는다(`.gitignore`). 이 README 는 glob 이 빈 매치로 빌드를
깨뜨리지 않도록 폴더를 유지하는 역할도 한다. → `wiki/infra/mcp.md`
