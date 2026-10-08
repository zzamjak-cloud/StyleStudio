// ss-mcp(MCP 서버, mcp/) 빌드 — 앱 소스(src/)의 프롬프트·분석·모델 정의를 그대로 번들한다. Bun 필요.
//
// 사용:
//   node scripts/build-mcp.mjs
//       → src-tauri/binaries/ss-mcp.mjs  (앱에 번들되는 JS, 약 1MB. 사용자 PC 의 Node 18+ 로 실행)
//   node scripts/build-mcp.mjs --standalone [--target bun-darwin-arm64] [--out <경로>]
//       → Node 가 없는 PC 용 단일 실행 파일 (런타임 포함 100MB+). 앱에 넣지 않고 릴리스 자산으로만 올린다.
//
// 앱 크기를 지키려고 런타임은 번들하지 않는다 → wiki/infra/mcp.md "배포 방식"
import { execFileSync } from 'node:child_process';
import { mkdirSync, chmodSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const standalone = args.includes('--standalone');
const target = option('--target');
const isWindowsTarget = target ? target.includes('windows') : process.platform === 'win32';
const defaultOut = standalone
  ? join('src-tauri', 'target', 'ss-mcp-standalone', isWindowsTarget ? 'ss-mcp.exe' : 'ss-mcp')
  : join('src-tauri', 'binaries', 'ss-mcp.mjs');
// --out 은 절대 경로(CI 의 $RUNNER_TEMP)도 받는다 — join 이 아니라 resolve 로 합친다
const out = resolve(root, option('--out') ?? defaultOut);

mkdirSync(dirname(out), { recursive: true });
const bunArgs = [
  'build',
  'mcp/src/index.ts',
  '--minify',
  // 앱 logger 는 Vite 의 import.meta.env.DEV 를 읽는다 — 번들 시점에 고정한다
  '--define',
  'import.meta.env.DEV=false',
  '--outfile',
  out,
];
if (standalone) {
  bunArgs.push('--compile');
  if (target) bunArgs.push('--target', target);
} else {
  // Node 18+ 에서 실행되는 ESM 번들 (.mjs)
  bunArgs.push('--target', 'node', '--format', 'esm');
}

try {
  execFileSync('bun', bunArgs, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
} catch {
  console.error('❌ ss-mcp 빌드 실패. Bun 이 설치돼 있는지 확인하세요 (https://bun.sh).');
  process.exit(1);
}
if (standalone && !isWindowsTarget) chmodSync(out, 0o755);
console.log(`✅ ${out}`);
