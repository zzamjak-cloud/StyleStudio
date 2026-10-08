import { invoke } from '@tauri-apps/api/core';

/**
 * AI 에이전트 MCP 연동 — Tauri command 경계.
 * 등록 로직은 `src-tauri/src/mcp_setup.rs`·`mcp_runtime.rs`, 서버 본체는 `mcp/`(ss-mcp).
 */

/** 지원 클라이언트 식별자 */
export type McpClientId = 'claude-code' | 'codex' | 'claude-desktop';

/** outdated: 등록돼 있으나 경로가 다르거나 설치된 서버가 앱 버전과 달라 갱신이 필요 */
export type McpRegistrationState = 'not_registered' | 'registered' | 'outdated';

export interface McpClientStatus {
  id: McpClientId;
  label: string;
  /** 같은 설정 파일을 공유하는 앱 안내 (예: "CLI · 데스크톱 앱") */
  covers: string;
  format: 'json' | 'toml';
  configPath: string;
  configExists: boolean;
  state: McpRegistrationState;
  registeredCommand: string | null;
}

/** 서버 실행 방법 — node: 사용자 PC 의 Node 로 번들 스크립트 실행 / standalone: 내려받은 실행 파일 / none: 실행 불가 */
export type McpRuntimeMode = 'node' | 'standalone' | 'none';

export interface McpRuntimeStatus {
  mode: McpRuntimeMode;
  nodePath: string | null;
  nodeVersion: string | null;
  /** 최소 Node 버전 표기 (예: "20.16") */
  minNodeVersion: string;
  scriptBundled: boolean;
  standaloneInstalled: boolean;
  standaloneVersion: string | null;
  /** 이 플랫폼에서 실행 파일 다운로드가 가능한지 */
  downloadAvailable: boolean;
}

export interface McpSetupStatus {
  appVersion: string;
  runtime: McpRuntimeStatus;
  /** 에이전트 설정에 등록되는 실행 명령 (런타임이 없으면 null) */
  serverCommand: string | null;
  dataDir: string;
  clients: McpClientStatus[];
}

export interface McpWriteOutcome {
  configPath: string;
  /** 변경 직전 상태를 담은 백업 파일 (기존 설정이 있었을 때만) */
  backupPath: string | null;
}

// Rust 는 snake_case 로 직렬화하므로 경계에서 camelCase 로 바꾼다
interface RawClientStatus {
  id: McpClientId;
  label: string;
  covers: string;
  format: 'json' | 'toml';
  config_path: string;
  config_exists: boolean;
  state: McpRegistrationState;
  registered_command: string | null;
}

interface RawSetupStatus {
  app_version: string;
  runtime: {
    mode: McpRuntimeMode;
    node_path: string | null;
    node_version: string | null;
    min_node_version: string;
    script_bundled: boolean;
    standalone_installed: boolean;
    standalone_version: string | null;
    download_available: boolean;
  };
  server_command: string | null;
  data_dir: string;
  clients: RawClientStatus[];
}

interface RawWriteOutcome {
  config_path: string;
  backup_path: string | null;
}

function toWriteOutcome(raw: RawWriteOutcome): McpWriteOutcome {
  return { configPath: raw.config_path, backupPath: raw.backup_path };
}

/** 등록 화면에 필요한 상태 일괄 조회 */
export async function getMcpSetupStatus(): Promise<McpSetupStatus> {
  const raw = await invoke<RawSetupStatus>('mcp_setup_status');
  const r = raw.runtime;
  return {
    appVersion: raw.app_version,
    runtime: {
      mode: r.mode,
      nodePath: r.node_path,
      nodeVersion: r.node_version,
      minNodeVersion: r.min_node_version,
      scriptBundled: r.script_bundled,
      standaloneInstalled: r.standalone_installed,
      standaloneVersion: r.standalone_version,
      downloadAvailable: r.download_available,
    },
    serverCommand: raw.server_command,
    dataDir: raw.data_dir,
    clients: raw.clients.map((c) => ({
      id: c.id,
      label: c.label,
      covers: c.covers,
      format: c.format,
      configPath: c.config_path,
      configExists: c.config_exists,
      state: c.state,
      registeredCommand: c.registered_command,
    })),
  };
}

/** 클라이언트 설정 파일에 등록 (이미 있으면 갱신) */
export async function registerMcpClient(clientId: McpClientId): Promise<McpWriteOutcome> {
  return toWriteOutcome(await invoke<RawWriteOutcome>('mcp_register', { clientId }));
}

/** 클라이언트 설정 파일에서 우리 항목만 제거 */
export async function unregisterMcpClient(clientId: McpClientId): Promise<McpWriteOutcome> {
  return toWriteOutcome(await invoke<RawWriteOutcome>('mcp_unregister', { clientId }));
}

/** 수동 등록용 설정 조각 (파일 쓰기가 막혔을 때 클립보드로 넘긴다) */
export function getMcpConfigSnippet(clientId: McpClientId): Promise<string> {
  return invoke<string>('mcp_config_snippet', { clientId });
}

/** Node 가 없는 PC 용: 현재 앱 버전의 서버 실행 파일(약 40MB 압축)을 내려받아 설치 → 설치 경로 */
export function downloadMcpServer(): Promise<string> {
  return invoke<string>('mcp_download_server');
}
