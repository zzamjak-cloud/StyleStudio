// Vite dev 포트를 붙잡고 있는 죽은 프로세스를 정리한다 (`predev`에서 자동 실행).
//
// ## 왜 필요한가
// `vite.config.ts`가 `strictPort: true`이고 `tauri.conf.json`의 `devUrl`이 1420 고정이라,
// 포트가 막혀 있으면 dev 서버가 **다른 포트로 비켜 가지 못하고 그냥 죽는다.**
//
// 문제는 실패가 실패를 부른다는 것이다. `tauri dev`의 `beforeDevCommand`(= `npm run dev`)가
// 포트 충돌로 죽으면 tauri는 중단되지만, 그 사이 떠 있던 vite는 **부모(`cmd /c vite`)만 죽고
// 자식 `node vite.js`가 살아남아** 포트를 계속 물고 있다. 그래서 실패할 때마다 고아가 하나씩
// 쌓이고, 사용자는 매번 PID를 직접 찾아 죽여야 했다.
//
// ## 안전장치
// 포트를 쥔 프로세스를 **무조건 죽이지 않는다.** 프로세스 이름이 node 계열일 때만 종료하고,
// 그 외(다른 앱이 1420을 쓰는 경우)는 경고만 남기고 통과시킨다 — 그때는 vite가 내는
// 원래 에러 메시지가 더 정확한 안내다. 이 스크립트는 어떤 경우에도 dev 실행을 막지 않는다
// (항상 exit 0). 포트 정리에 실패하는 것보다 dev가 아예 안 뜨는 게 나쁘다.
//
// 사용: `npm run dev`/`npm run tauri:dev` 시 자동. 수동으로는 `npm run dev:free-port`.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/** 포트가 풀릴 때까지 기다리는 최대 시간 (kill 후 소켓이 닫히기까지 약간 걸린다) */
const RELEASE_TIMEOUT_MS = 3000;
const POLL_INTERVAL_MS = 100;

/**
 * dev 포트를 알아낸다.
 *
 * `tauri.conf.json`의 `devUrl`이 기준이다 — vite와 tauri가 **같은 포트를 봐야** 하고,
 * 둘이 어긋나면 tauri가 빈 창을 띄운다. 여기서 vite 설정을 읽으면 그 불일치를 놓친다.
 */
function resolveDevPort() {
  try {
    const conf = JSON.parse(readFileSync(join(PROJECT_ROOT, 'src-tauri/tauri.conf.json'), 'utf8'));
    const port = Number(new URL(conf.build.devUrl).port);
    if (Number.isInteger(port) && port > 0) return port;
  } catch {
    // 설정을 못 읽어도 멈추지 않는다 — 관례값으로 진행한다
  }
  return 1420;
}

/** 명령을 실행하고 stdout을 돌려준다. 실패하면 빈 문자열 (도구가 없는 환경도 있다) */
function run(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
}

/**
 * 해당 포트를 LISTEN 중인 PID 목록.
 *
 * Windows에서 상태 문자열('LISTENING')로 거르지 않는다 — 로케일에 따라 번역돼 나오는 경우가
 * 있어서다. 대신 **원격 주소가 비어 있는지**(`0.0.0.0:0` / `[::]:0`)로 판별한다. 리스닝
 * 소켓만 갖는 성질이라 언어와 무관하다.
 */
function findListenerPids(port) {
  const pids = new Set();

  if (process.platform === 'win32') {
    /*
      `-p TCP`를 주면 안 된다 — 그 필터는 **IPv4만** 보여준다. vite는 host 옵션이 없으면
      IPv6 루프백(`[::1]`)에만 바인딩하는 경우가 있어서(실제로 그렇다), `-p TCP`로는
      포트를 쥔 프로세스를 못 찾고 스크립트가 조용히 아무것도 안 하게 된다.
      필터 없이 받아서 프로토콜 열로 직접 거른다 (TCP + TCPv6 둘 다 잡힌다).
      UDP 줄은 열이 4개뿐이라 아래 길이 검사에서 걸러진다.
    */
    const out = run('netstat', ['-ano']);
    for (const line of out.split(/\r?\n/)) {
      const cols = line.trim().split(/\s+/);
      if (cols.length < 5) continue;
      const [proto, local, foreign, , pid] = cols;
      if (!/^TCP/i.test(proto)) continue;
      if (!local.endsWith(`:${port}`)) continue;
      if (foreign !== '0.0.0.0:0' && foreign !== '[::]:0' && foreign !== '*:*') continue;
      const numeric = Number(pid);
      if (Number.isInteger(numeric) && numeric > 0) pids.add(numeric);
    }
    return [...pids];
  }

  const out = run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t']);
  for (const line of out.split(/\r?\n/)) {
    const numeric = Number(line.trim());
    if (Number.isInteger(numeric) && numeric > 0) pids.add(numeric);
  }
  return [...pids];
}

/** PID의 실행 파일 이름 (판별 실패 시 빈 문자열) */
function processName(pid) {
  if (process.platform === 'win32') {
    const out = run('tasklist', ['/FI', `PID eq ${pid}`, '/NH', '/FO', 'CSV']);
    const match = out.match(/^"([^"]+)"/m);
    return match ? match[1] : '';
  }
  return run('ps', ['-p', String(pid), '-o', 'comm=']).trim();
}

/** node 계열 프로세스인가 — 이것만 종료 대상으로 삼는다 */
function isNodeProcess(name) {
  return /^node(\.exe)?$/i.test(name.trim());
}

function killProcess(pid) {
  if (process.platform === 'win32') {
    // /T 로 자식(esbuild 등)까지 함께 정리한다.
    // 부모 `cmd /c vite`는 자식이 죽으면 스스로 종료하므로 따로 건드리지 않는다.
    run('taskkill', ['/PID', String(pid), '/T', '/F']);
    return;
  }
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    return;
  }
}

async function waitUntilFree(port) {
  const deadline = Date.now() + RELEASE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (findListenerPids(port).length === 0) return true;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  return findListenerPids(port).length === 0;
}

async function main() {
  const port = resolveDevPort();
  const pids = findListenerPids(port);
  if (pids.length === 0) return;

  const killed = [];
  for (const pid of pids) {
    const name = processName(pid);
    if (!isNodeProcess(name)) {
      console.warn(
        `⚠️  포트 ${port}를 ${name || '알 수 없는 프로세스'}(PID ${pid})가 쓰고 있습니다. ` +
          `node 프로세스가 아니라 종료하지 않습니다 — 직접 확인해주세요.`
      );
      continue;
    }
    killProcess(pid);
    killed.push(pid);
  }
  if (killed.length === 0) return;

  const freed = await waitUntilFree(port);
  if (freed) {
    console.log(`🧹 포트 ${port}를 붙잡고 있던 이전 dev 서버를 정리했습니다 (PID ${killed.join(', ')}).`);
  } else {
    console.warn(`⚠️  포트 ${port} 정리를 시도했지만 아직 열려 있습니다 (PID ${killed.join(', ')}).`);
  }
}

// 이 스크립트가 dev 실행을 막는 일은 없어야 한다 — 어떤 실패든 삼키고 통과시킨다
main().catch((error) => {
  console.warn('⚠️  dev 포트 정리 중 오류(무시하고 계속):', error?.message ?? error);
});
