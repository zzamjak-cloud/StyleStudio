/**
 * stdout 보호 — MCP stdio 에서 stdout 은 JSON-RPC 전용이다.
 * 번들된 앱 코드가 console.log 를 쓰면 프로토콜이 깨지므로, 다른 모듈보다 먼저 로드해
 * log/info/debug 를 stderr 로 돌린다. (index.ts 의 첫 import 여야 한다)
 */
const toStderr = (...args: unknown[]) => console.error(...args);
console.log = toStderr;
console.info = toStderr;
console.debug = toStderr;
