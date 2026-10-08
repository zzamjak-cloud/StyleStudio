//! MCP 클라이언트 등록
//!
//! `ss-mcp` 서버를 AI 클라이언트(Claude Code, Codex, Claude 데스크톱)의 설정 파일에
//! 등록·해제한다. Tauri 타입에 의존하지 않는 순수 로직이라 단위 테스트로 고정한다.
//!
//! **남의 앱 설정 파일을 수정하는 코드다.** 다음을 지킨다.
//! - 쓰기 전 `<파일>.ssbak` 으로 직전 상태를 백업한다
//! - 같은 이름 항목이 있으면 갱신한다 (중복 생성하지 않는다)
//! - 우리 항목 외의 내용은 건드리지 않는다
//!   (JSON 은 `serde_json` preserve_order, TOML 은 `toml_edit` 으로 주석·서식 보존)
//!
//! 실행 파일 배치
//! - 앱에 번들된 원본을 그대로 등록하지 않고 앱 로컬 데이터 폴더에 **사본**을 두고 등록한다.
//!   에이전트가 띄운 `ss-mcp` 는 세션 내내 상주해 실행 파일을 잠그므로, 원본을 등록하면
//!   앱 업데이트(설치 파일 덮어쓰기)가 잠긴 파일에서 멈춘다.
//! - 사본 교체는 "실행 중인 파일은 덮어쓸 수 없지만 이름은 바꿀 수 있다"는 Windows 규칙을
//!   이용한다: 기존 사본을 `.old-*` 로 옮기고 새 사본을 쓴다. 이미 떠 있는 세션은 옮겨진
//!   파일로 계속 동작하고, 다음 세션부터 새 사본을 쓴다.

use std::path::{Path, PathBuf};

/// 등록되는 MCP 서버 이름
pub const SERVER_NAME: &str = "stylestudio";
/// 앱 데이터 디렉토리를 서버에 알려주는 환경변수 (`mcp/src/store.rs` 와 같은 이름)
pub const DATA_DIR_ENV: &str = "STYLESTUDIO_DATA_DIR";

#[cfg(target_os = "windows")]
pub const SERVER_BIN: &str = "ss-mcp.exe";
#[cfg(not(target_os = "windows"))]
pub const SERVER_BIN: &str = "ss-mcp";

/// 에이전트가 서버를 띄우는 방법 — 설정 파일의 `command` + `args`.
///
/// - Node 모드: `command` = node 절대 경로, `args` = [설치된 `ss-mcp.mjs` 경로]
/// - 단일 실행 파일 모드: `command` = 내려받은 `ss-mcp(.exe)`, `args` = []
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServerLaunch {
    pub command: PathBuf,
    pub args: Vec<String>,
}

impl ServerLaunch {
    pub fn binary(command: PathBuf) -> Self {
        Self { command, args: Vec::new() }
    }

    pub fn display(&self) -> String {
        std::iter::once(self.command.display().to_string())
            .chain(self.args.iter().cloned())
            .collect::<Vec<_>>()
            .join(" ")
    }
}

/// 설정 파일 형식
#[derive(Clone, Copy, PartialEq, Eq, Debug, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ConfigFormat {
    /// `{"mcpServers": {"<이름>": {command, args, env}}}`
    Json,
    /// `[mcp_servers.<이름>]` + `[mcp_servers.<이름>.env]`
    Toml,
}

pub struct McpClient {
    pub id: &'static str,
    pub label: &'static str,
    /// 같은 설정 파일을 공유하는 앱들 (UI 안내용)
    pub covers: &'static str,
    pub format: ConfigFormat,
}

/// 지원 목록. 새 클라이언트는 여기에 한 줄 추가하고 [`config_path`] 에 경로만 더하면 된다.
///
/// CLI 와 데스크톱 앱은 같은 사용자 설정 파일을 읽으므로 한 번 등록하면 둘 다 쓸 수 있다.
pub const CLIENTS: &[McpClient] = &[
    McpClient {
        id: "claude-code",
        label: "Claude Code",
        covers: "CLI · 데스크톱 앱 Code 탭",
        format: ConfigFormat::Json,
    },
    McpClient {
        id: "codex",
        label: "Codex",
        covers: "CLI · 데스크톱 앱",
        format: ConfigFormat::Toml,
    },
    McpClient {
        id: "claude-desktop",
        label: "Claude 데스크톱",
        covers: "채팅 앱",
        format: ConfigFormat::Json,
    },
];

fn find_client(id: &str) -> Result<&'static McpClient, String> {
    CLIENTS
        .iter()
        .find(|c| c.id == id)
        .ok_or_else(|| format!("알 수 없는 MCP 클라이언트: {}", id))
}

/// 클라이언트 설정 파일 경로
pub fn config_path(id: &str) -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    match id {
        "claude-code" => Some(home.join(".claude.json")),
        // Codex CLI 와 Codex 데스크톱 앱이 공유한다. CODEX_HOME 으로 옮긴 경우를 존중한다.
        "codex" => {
            let codex_home = std::env::var_os("CODEX_HOME")
                .filter(|v| !v.is_empty())
                .map(PathBuf::from)
                .unwrap_or_else(|| home.join(".codex"));
            Some(codex_home.join("config.toml"))
        }
        "claude-desktop" => {
            #[cfg(target_os = "macos")]
            {
                Some(
                    home.join("Library")
                        .join("Application Support")
                        .join("Claude")
                        .join("claude_desktop_config.json"),
                )
            }
            #[cfg(not(target_os = "macos"))]
            {
                Some(dirs::config_dir()?.join("Claude").join("claude_desktop_config.json"))
            }
        }
        _ => None,
    }
}

// ───────────────────────── 실행 파일 배치 ─────────────────────────

/// 두 파일 내용이 같은지
fn same_contents(a: &Path, b: &Path) -> bool {
    match (std::fs::metadata(a), std::fs::metadata(b)) {
        (Ok(ma), Ok(mb)) if ma.len() == mb.len() => {
            matches!((std::fs::read(a), std::fs::read(b)), (Ok(x), Ok(y)) if x == y)
        }
        _ => false,
    }
}

/// 설치된 사본이 번들 원본과 같은지 (없으면 false)
pub fn is_installed_current(bundled: &Path, installed: &Path) -> bool {
    installed.is_file() && same_contents(bundled, installed)
}

/// 이전 교체에서 남은 `.old-*` 파일을 지운다. 아직 실행 중이면 잠겨 있어 실패하는데 정상이다.
fn cleanup_old_copies(installed: &Path) {
    let (Some(dir), Some(name)) = (installed.parent(), installed.file_name()) else {
        return;
    };
    let prefix = format!("{}.old-", name.to_string_lossy());
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            if entry.file_name().to_string_lossy().starts_with(&prefix) {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }
}

/// 번들 원본을 설치 위치로 복사한다. 이미 같으면 아무것도 하지 않는다.
pub fn install_server(bundled: &Path, installed: &Path) -> Result<(), String> {
    if !bundled.is_file() {
        return Err(format!("ss-mcp 실행 파일을 찾을 수 없습니다: {}", bundled.display()));
    }
    if let Some(parent) = installed.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("설치 폴더를 만들 수 없습니다 ({}): {}", parent.display(), e))?;
    }
    cleanup_old_copies(installed);
    if is_installed_current(bundled, installed) {
        return Ok(());
    }

    let mut moved_aside: Option<PathBuf> = None;
    if installed.exists() {
        // 실행 중이면 덮어쓰기는 막히지만 이름 바꾸기는 된다 (Windows)
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or_default();
        let mut moved_name = installed.file_name().unwrap_or_default().to_os_string();
        moved_name.push(format!(".old-{}", stamp));
        let moved = installed.with_file_name(moved_name);
        if std::fs::rename(installed, &moved).is_ok() {
            moved_aside = Some(moved);
        } else {
            std::fs::remove_file(installed).map_err(|e| {
                format!(
                    "기존 ss-mcp 를 교체할 수 없습니다 ({}): {}. AI 에이전트를 모두 종료한 뒤 다시 시도하세요.",
                    installed.display(),
                    e
                )
            })?;
        }
    }

    if let Err(e) = std::fs::copy(bundled, installed) {
        // 복사가 실패하면 등록된 경로가 빈 채로 남지 않도록 옮겨 둔 기존 사본을 되돌린다
        let _ = std::fs::remove_file(installed);
        if let Some(moved) = &moved_aside {
            let _ = std::fs::rename(moved, installed);
        }
        return Err(format!("ss-mcp 복사 실패 ({}): {}", installed.display(), e));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(installed, std::fs::Permissions::from_mode(0o755));
    }
    cleanup_old_copies(installed);
    Ok(())
}

// ───────────────────────── 상태 조회 ─────────────────────────

#[derive(Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RegistrationState {
    /// 우리 항목이 없다
    NotRegistered,
    /// 등록돼 있고 실행 경로·데이터 경로가 현재 앱과 일치한다
    Registered,
    /// 등록돼 있으나 경로가 다르거나 설치된 서버가 앱 버전과 다르다 — 갱신 필요
    Outdated,
}

#[derive(Debug, serde::Serialize)]
pub struct ClientStatus {
    pub id: String,
    pub label: String,
    pub covers: String,
    pub format: ConfigFormat,
    pub config_path: String,
    pub config_exists: bool,
    pub state: RegistrationState,
    pub registered_command: Option<String>,
}

struct Entry {
    command: String,
    args: Vec<String>,
    data_dir: Option<String>,
}

fn read_entry(format: ConfigFormat, path: &Path) -> Result<Option<Entry>, String> {
    if !path.is_file() {
        return Ok(None);
    }
    let text = std::fs::read_to_string(path).map_err(|e| format!("{} 읽기 실패: {}", path.display(), e))?;
    let (command, args, data_dir) = match format {
        ConfigFormat::Json => {
            let root: serde_json::Value =
                serde_json::from_str(&text).map_err(|e| format!("{} 파싱 실패: {}", path.display(), e))?;
            let Some(entry) = root.get("mcpServers").and_then(|m| m.get(SERVER_NAME)) else {
                return Ok(None);
            };
            (
                entry.get("command").and_then(|c| c.as_str()).map(str::to_string),
                entry
                    .get("args")
                    .and_then(|a| a.as_array())
                    .map(|a| a.iter().filter_map(|v| v.as_str().map(str::to_string)).collect())
                    .unwrap_or_default(),
                entry
                    .get("env")
                    .and_then(|e| e.get(DATA_DIR_ENV))
                    .and_then(|d| d.as_str())
                    .map(str::to_string),
            )
        }
        ConfigFormat::Toml => {
            let doc: toml_edit::DocumentMut =
                text.parse().map_err(|e| format!("{} 파싱 실패: {}", path.display(), e))?;
            let Some(entry) = doc.get("mcp_servers").and_then(|m| m.get(SERVER_NAME)) else {
                return Ok(None);
            };
            (
                entry.get("command").and_then(|c| c.as_str()).map(str::to_string),
                entry
                    .get("args")
                    .and_then(|a| a.as_array())
                    .map(|a| a.iter().filter_map(|v| v.as_str().map(str::to_string)).collect())
                    .unwrap_or_default(),
                entry
                    .get("env")
                    .and_then(|e| e.get(DATA_DIR_ENV))
                    .and_then(|d| d.as_str())
                    .map(str::to_string),
            )
        }
    };
    Ok(Some(Entry {
        command: command.unwrap_or_default(),
        args,
        data_dir,
    }))
}

/// 전체 클라이언트 등록 상태.
/// `expected` 는 지금 등록하면 쓰일 실행 방법(런타임이 없으면 None — 등록된 항목은 전부 갱신 대상).
/// `server_current` 가 false 면(설치된 서버가 앱 버전과 다름) 등록된 항목은 전부 갱신 대상이다.
pub fn client_statuses(expected: Option<&ServerLaunch>, data_dir: &Path, server_current: bool) -> Vec<ClientStatus> {
    CLIENTS
        .iter()
        .map(|client| {
            let path = config_path(client.id);
            let entry = path
                .as_ref()
                .and_then(|p| read_entry(client.format, p).ok().flatten());
            let (state, command) = match entry {
                None => (RegistrationState::NotRegistered, None),
                Some(entry) => {
                    let matches = expected.is_some_and(|launch| {
                        Path::new(&entry.command) == launch.command && entry.args == launch.args
                    }) && Path::new(&entry.command).is_file()
                        && entry.data_dir.as_deref().map(Path::new) == Some(data_dir)
                        && server_current;
                    let state = if matches {
                        RegistrationState::Registered
                    } else {
                        RegistrationState::Outdated
                    };
                    (state, Some(entry.command))
                }
            };
            ClientStatus {
                id: client.id.to_string(),
                label: client.label.to_string(),
                covers: client.covers.to_string(),
                format: client.format,
                config_path: path.as_ref().map(|p| p.display().to_string()).unwrap_or_default(),
                config_exists: path.as_ref().is_some_and(|p| p.is_file()),
                state,
                registered_command: command,
            }
        })
        .collect()
}

/// 어떤 클라이언트에든 등록돼 있는지 (앱 시작 시 사본 갱신 여부 판단용)
pub fn any_registered() -> bool {
    CLIENTS.iter().any(|client| {
        config_path(client.id)
            .and_then(|p| read_entry(client.format, &p).ok().flatten())
            .is_some()
    })
}

// ───────────────────────── 등록 / 해제 ─────────────────────────

#[derive(Debug, serde::Serialize)]
pub struct WriteOutcome {
    pub config_path: String,
    /// 백업 파일 경로 (기존 설정이 있었을 때만)
    pub backup_path: Option<String>,
}

pub fn register(client_id: &str, launch: &ServerLaunch, data_dir: &Path) -> Result<WriteOutcome, String> {
    if !launch.command.is_file() {
        return Err(format!("서버 실행 파일을 찾을 수 없습니다: {}", launch.command.display()));
    }
    let client = find_client(client_id)?;
    let path = config_path(client_id).ok_or_else(|| "홈 디렉토리를 찾을 수 없습니다".to_string())?;
    register_at(&path, client.format, launch, data_dir)
}

/// 경로를 직접 받는 등록 (테스트·비표준 위치용)
pub fn register_at(
    path: &Path,
    format: ConfigFormat,
    launch: &ServerLaunch,
    data_dir: &Path,
) -> Result<WriteOutcome, String> {
    modify_config(path, |original| {
        Ok(Some(match format {
            ConfigFormat::Json => json_with_entry(original, launch, data_dir, path)?,
            ConfigFormat::Toml => toml_with_entry(original, launch, data_dir, path)?,
        }))
    })
}

/// 등록을 해제한다. 항목이 없으면 조용히 성공한다.
pub fn unregister(client_id: &str) -> Result<WriteOutcome, String> {
    let client = find_client(client_id)?;
    let path = config_path(client_id).ok_or_else(|| "홈 디렉토리를 찾을 수 없습니다".to_string())?;
    unregister_at(&path, client.format)
}

pub fn unregister_at(path: &Path, format: ConfigFormat) -> Result<WriteOutcome, String> {
    modify_config(path, |original| {
        let Some(original) = original else { return Ok(None) };
        match format {
            ConfigFormat::Json => {
                let mut root: serde_json::Value =
                    serde_json::from_str(original).map_err(|e| format!("{} 파싱 실패: {}", path.display(), e))?;
                let removed = root
                    .get_mut("mcpServers")
                    .and_then(|m| m.as_object_mut())
                    .and_then(|servers| servers.remove(SERVER_NAME));
                // 우리 항목이 없으면 파일을 다시 쓰지 않는다 (서식 변화·백업 덮어쓰기 방지)
                match removed {
                    Some(_) => Ok(Some(format!("{}\n", to_json_text(&root)?))),
                    None => Ok(None),
                }
            }
            ConfigFormat::Toml => {
                let mut doc: toml_edit::DocumentMut =
                    original.parse().map_err(|e| format!("{} 파싱 실패: {}", path.display(), e))?;
                let removed = doc
                    .get_mut("mcp_servers")
                    .and_then(|m| m.as_table_like_mut())
                    .and_then(|servers| servers.remove(SERVER_NAME));
                Ok(removed.map(|_| doc.to_string()))
            }
        }
    })
}

fn to_json_text(value: &serde_json::Value) -> Result<String, String> {
    serde_json::to_string_pretty(value).map_err(|e| format!("JSON 직렬화 실패: {}", e))
}

fn read_existing(path: &Path) -> Result<Option<String>, String> {
    if path.is_file() {
        std::fs::read_to_string(path)
            .map(Some)
            .map_err(|e| format!("{} 읽기 실패: {}", path.display(), e))
    } else {
        Ok(None)
    }
}

fn backup_path(path: &Path) -> PathBuf {
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(".ssbak");
    path.with_file_name(name)
}

/// 백업을 남기고 설정 파일을 원자적으로 교체한다.
///
/// - 백업은 `fs::copy` 로 만들어 원본 권한(예: 0600)을 그대로 물려받는다 — 설정 파일에는
///   다른 MCP 서버의 토큰이 들어 있는 경우가 많다. 변경할 때마다 덮어써 "직전 상태 1단계"를 보장한다.
/// - 같은 폴더의 임시 파일에 쓰고 rename 으로 바꿔, 쓰는 도중 다른 앱(Claude Code 는 `~/.claude.json`
///   을 수시로 다시 쓴다)이 잘린 파일을 읽거나 중단 시 파일이 잘린 채 남지 않게 한다.
/// - 읽은 뒤 그 앱이 파일을 바꿨으면 그 변경을 덮어쓰지 않도록 거부한다(호출부가 다시 읽고 재시도).
fn write_with_backup(path: &Path, original: Option<&str>, updated: &str) -> Result<WriteOutcome, String> {
    use std::io::Write;

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("{} 생성 실패: {}", parent.display(), e))?;
    }
    if read_existing(path)?.as_deref() != original {
        return Err(CONCURRENT_CHANGE.to_string());
    }
    let backup = match original {
        Some(_) => {
            let backup = backup_path(path);
            std::fs::copy(path, &backup).map_err(|e| format!("백업 실패 ({}): {}", backup.display(), e))?;
            Some(backup.display().to_string())
        }
        None => None,
    };

    let mut tmp_name = path.file_name().unwrap_or_default().to_os_string();
    tmp_name.push(".sstmp");
    let tmp = path.with_file_name(tmp_name);
    let write_tmp = || -> std::io::Result<()> {
        let mut file = std::fs::File::create(&tmp)?;
        file.write_all(updated.as_bytes())?;
        file.sync_all()?;
        if let Ok(meta) = std::fs::metadata(path) {
            // 원본 권한 유지 (새 파일은 umask 기본값으로 만들어지므로)
            let _ = std::fs::set_permissions(&tmp, meta.permissions());
        }
        Ok(())
    };
    if let Err(e) = write_tmp() {
        let _ = std::fs::remove_file(&tmp);
        return Err(format!("{} 쓰기 실패: {}", tmp.display(), e));
    }
    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("{} 교체 실패: {}", path.display(), e)
    })?;
    Ok(WriteOutcome {
        config_path: path.display().to_string(),
        backup_path: backup,
    })
}

/// 읽은 뒤 다른 앱이 설정 파일을 바꿨을 때의 오류 문구 (재시도 판별용)
const CONCURRENT_CHANGE: &str = "설정 파일이 처리 중에 다른 앱에 의해 변경됐습니다";

/// 읽기 → 수정 → 쓰기를 동시 변경 감지 시 몇 번 재시도한다.
fn modify_config(path: &Path, edit: impl Fn(Option<&str>) -> Result<Option<String>, String>) -> Result<WriteOutcome, String> {
    for _ in 0..3 {
        let original = read_existing(path)?;
        let Some(updated) = edit(original.as_deref())? else {
            // 바꿀 것이 없으면 파일을 다시 쓰지 않는다
            return Ok(WriteOutcome {
                config_path: path.display().to_string(),
                backup_path: None,
            });
        };
        match write_with_backup(path, original.as_deref(), &updated) {
            Err(e) if e == CONCURRENT_CHANGE => {
                std::thread::sleep(std::time::Duration::from_millis(200));
                continue;
            }
            other => return other,
        }
    }
    Err(format!("{}. 해당 앱을 종료한 뒤 다시 시도하세요.", CONCURRENT_CHANGE))
}

fn json_with_entry(original: Option<&str>, launch: &ServerLaunch, data_dir: &Path, path: &Path) -> Result<String, String> {
    let mut root: serde_json::Value = match original {
        Some(text) if !text.trim().is_empty() => {
            serde_json::from_str(text).map_err(|e| format!("{} 파싱 실패: {}", path.display(), e))?
        }
        _ => serde_json::json!({}),
    };
    let Some(object) = root.as_object_mut() else {
        return Err(format!("{} 최상위가 객체가 아닙니다", path.display()));
    };
    let servers = object
        .entry("mcpServers")
        .or_insert_with(|| serde_json::json!({}))
        .as_object_mut()
        .ok_or_else(|| format!("{} 의 mcpServers 가 객체가 아닙니다", path.display()))?;
    // 기존 항목이 있으면 우리가 관리하는 값(command·args·env 의 데이터 경로)만 고친다.
    // 사용자가 직접 넣은 다른 키(타임아웃, 추가 env 등)는 재등록·갱신 때도 보존한다.
    let entry = servers
        .entry(SERVER_NAME.to_string())
        .or_insert_with(|| serde_json::json!({}));
    if !entry.is_object() {
        *entry = serde_json::json!({});
    }
    let entry = entry.as_object_mut().expect("객체로 보정함");
    entry.insert("command".into(), launch.command.display().to_string().into());
    entry.insert("args".into(), serde_json::json!(launch.args));
    let env = entry.entry("env").or_insert_with(|| serde_json::json!({}));
    if !env.is_object() {
        *env = serde_json::json!({});
    }
    env.as_object_mut()
        .expect("객체로 보정함")
        .insert(DATA_DIR_ENV.into(), data_dir.display().to_string().into());
    Ok(format!("{}\n", to_json_text(&root)?))
}

fn toml_with_entry(original: Option<&str>, launch: &ServerLaunch, data_dir: &Path, path: &Path) -> Result<String, String> {
    let mut doc: toml_edit::DocumentMut = match original {
        Some(text) => text.parse().map_err(|e| format!("{} 파싱 실패: {}", path.display(), e))?,
        None => toml_edit::DocumentMut::new(),
    };
    if doc.get("mcp_servers").is_none() {
        doc["mcp_servers"] = toml_edit::Item::Table(toml_edit::Table::new());
    }
    let servers = doc["mcp_servers"]
        .as_table_mut()
        .ok_or_else(|| "mcp_servers 가 테이블이 아닙니다".to_string())?;
    // 최상위 [mcp_servers] 헤더는 출력하지 않고 [mcp_servers.stylestudio] 만 남긴다
    servers.set_implicit(true);

    // 기존 항목이 있으면 우리가 관리하는 값만 고치고 사용자가 넣은 다른 키는 보존한다
    if !servers.get(SERVER_NAME).is_some_and(|item| item.is_table()) {
        servers[SERVER_NAME] = toml_edit::Item::Table(toml_edit::Table::new());
    }
    let entry = servers[SERVER_NAME].as_table_mut().expect("테이블로 보정함");
    entry["command"] = toml_edit::value(launch.command.display().to_string());
    entry["args"] = toml_edit::Item::Value(launch.args.iter().map(String::as_str).collect::<toml_edit::Array>().into());
    if !entry.get("env").is_some_and(|item| item.is_table()) {
        entry["env"] = toml_edit::Item::Table(toml_edit::Table::new());
    }
    entry["env"][DATA_DIR_ENV] = toml_edit::value(data_dir.display().to_string());
    Ok(doc.to_string())
}

/// 수동 등록용 설정 조각. 파일 쓰기가 막혔을 때 클립보드로 넘긴다.
///
/// 직접 문자열을 조립하지 않는다 — TOML 기본 문자열은 백슬래시를 이스케이프로 읽어
/// Windows 경로(`C:\Users\...`)의 `\U` 가 유니코드 이스케이프로 해석돼 파싱이 깨진다.
pub fn config_snippet(client_id: &str, launch: &ServerLaunch, data_dir: &Path) -> Result<String, String> {
    let client = find_client(client_id)?;
    match client.format {
        ConfigFormat::Json => json_with_entry(None, launch, data_dir, Path::new("snippet")),
        ConfigFormat::Toml => toml_with_entry(None, launch, data_dir, Path::new("snippet")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ss_mcpsetup_{}_{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn json_registration_preserves_unrelated_keys_and_order() {
        let dir = temp_dir("json");
        let cfg = dir.join("claude.json");
        std::fs::write(
            &cfg,
            r#"{"zeta":1,"mcpServers":{"blender":{"command":"/usr/bin/blender-mcp"}},"alpha":{"a":1}}"#,
        )
        .unwrap();
        let bin = dir.join(SERVER_BIN);
        std::fs::write(&bin, b"bin").unwrap();

        register_at(&cfg, ConfigFormat::Json, &ServerLaunch::binary(bin.clone()), &dir).unwrap();
        let text = std::fs::read_to_string(&cfg).unwrap();
        let v: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert_eq!(v["mcpServers"]["blender"]["command"], "/usr/bin/blender-mcp");
        assert_eq!(v["mcpServers"][SERVER_NAME]["command"], bin.display().to_string());
        assert_eq!(v["mcpServers"][SERVER_NAME]["env"][DATA_DIR_ENV], dir.display().to_string());
        assert!(
            text.find("\"zeta\"").unwrap() < text.find("\"alpha\"").unwrap(),
            "키 순서 보존 (preserve_order)"
        );

        // 재등록은 중복을 만들지 않는다
        register_at(&cfg, ConfigFormat::Json, &ServerLaunch::binary(bin.clone()), &dir).unwrap();
        let v: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&cfg).unwrap()).unwrap();
        assert_eq!(v["mcpServers"].as_object().unwrap().len(), 2);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn toml_registration_keeps_comments_and_unregister_removes_only_ours() {
        let dir = temp_dir("toml");
        let cfg = dir.join("config.toml");
        let original = "# 사용자 주석\nmodel = \"gpt-5\"\n\n[mcp_servers.other]\ncommand = \"x\"\n";
        std::fs::write(&cfg, original).unwrap();
        let bin = dir.join(SERVER_BIN);

        let outcome = register_at(&cfg, ConfigFormat::Toml, &ServerLaunch::binary(bin.clone()), &dir).unwrap();
        assert_eq!(
            std::fs::read_to_string(outcome.backup_path.unwrap()).unwrap(),
            original,
            "백업은 변경 직전 상태"
        );
        let text = std::fs::read_to_string(&cfg).unwrap();
        assert!(text.contains("# 사용자 주석"));
        assert!(text.contains("[mcp_servers.other]"));
        assert!(text.contains(&format!("[mcp_servers.{}]", SERVER_NAME)));
        assert!(!text.contains("\n[mcp_servers]\n"), "빈 상위 헤더를 만들지 않는다");

        unregister_at(&cfg, ConfigFormat::Toml).unwrap();
        let text = std::fs::read_to_string(&cfg).unwrap();
        assert!(text.contains("[mcp_servers.other]"));
        assert!(!text.contains(SERVER_NAME));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn reregister_keeps_user_added_fields() {
        let dir = temp_dir("keep_fields");
        let bin = dir.join(SERVER_BIN);

        let json_cfg = dir.join("claude.json");
        std::fs::write(
            &json_cfg,
            r#"{"mcpServers":{"stylestudio":{"command":"old","timeout":9,"env":{"EXTRA":"1"}}}}"#,
        )
        .unwrap();
        register_at(&json_cfg, ConfigFormat::Json, &ServerLaunch::binary(bin.clone()), &dir).unwrap();
        let v: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&json_cfg).unwrap()).unwrap();
        assert_eq!(v["mcpServers"][SERVER_NAME]["command"], bin.display().to_string());
        assert_eq!(v["mcpServers"][SERVER_NAME]["timeout"], 9);
        assert_eq!(v["mcpServers"][SERVER_NAME]["env"]["EXTRA"], "1");
        assert!(!dir.join("claude.json.sstmp").exists(), "원자적 교체 후 임시 파일이 남지 않는다");

        let toml_cfg = dir.join("config.toml");
        std::fs::write(&toml_cfg, "[mcp_servers.stylestudio]\ncommand = 'old'\nstartup_timeout_sec = 30\n").unwrap();
        register_at(&toml_cfg, ConfigFormat::Toml, &ServerLaunch::binary(bin.clone()), &dir).unwrap();
        let doc: toml_edit::DocumentMut = std::fs::read_to_string(&toml_cfg).unwrap().parse().unwrap();
        assert_eq!(doc["mcp_servers"][SERVER_NAME]["startup_timeout_sec"].as_integer(), Some(30));
        assert_eq!(
            doc["mcp_servers"][SERVER_NAME]["env"][DATA_DIR_ENV].as_str(),
            Some(dir.display().to_string().as_str())
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn non_object_mcp_servers_is_an_error_not_silently_reset() {
        let dir = temp_dir("bad_servers");
        let cfg = dir.join("claude.json");
        std::fs::write(&cfg, r#"{"mcpServers":null}"#).unwrap();
        assert!(register_at(&cfg, ConfigFormat::Json, &ServerLaunch::binary(dir.join(SERVER_BIN)), &dir).is_err());
        assert_eq!(std::fs::read_to_string(&cfg).unwrap(), r#"{"mcpServers":null}"#);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn unregister_without_our_entry_leaves_file_untouched() {
        let dir = temp_dir("untouched");
        let cfg = dir.join("claude.json");
        let original = "{\n  \"a\": 1 }";
        std::fs::write(&cfg, original).unwrap();
        let outcome = unregister_at(&cfg, ConfigFormat::Json).unwrap();
        assert!(outcome.backup_path.is_none());
        assert_eq!(std::fs::read_to_string(&cfg).unwrap(), original);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn snippet_round_trips_windows_paths() {
        let bin = PathBuf::from(r"\Users\Loadcomplete\AppData\Local\ss-mcp.exe");
        let data = PathBuf::from(r"\Users\Loadcomplete\AppData\Roaming\com.woody.stylestudio-tauri");
        let toml = config_snippet("codex", &ServerLaunch::binary(bin.clone()), &data).unwrap();
        let doc = toml.parse::<toml_edit::DocumentMut>().expect("TOML 조각이 파싱돼야 한다");
        assert_eq!(
            doc["mcp_servers"][SERVER_NAME]["command"].as_str(),
            Some(bin.display().to_string().as_str())
        );
        assert_eq!(
            doc["mcp_servers"][SERVER_NAME]["env"][DATA_DIR_ENV].as_str(),
            Some(data.display().to_string().as_str())
        );
        let json = config_snippet("claude-code", &ServerLaunch::binary(bin.clone()), &data).unwrap();
        serde_json::from_str::<serde_json::Value>(&json).expect("JSON 조각이 파싱돼야 한다");
    }

    #[test]
    fn install_copies_once_and_replaces_when_bundle_changes() {
        let dir = temp_dir("install");
        let bundled = dir.join("bundle").join(SERVER_BIN);
        std::fs::create_dir_all(bundled.parent().unwrap()).unwrap();
        std::fs::write(&bundled, b"v1").unwrap();
        let installed = dir.join("mcp").join(SERVER_BIN);

        install_server(&bundled, &installed).unwrap();
        assert!(is_installed_current(&bundled, &installed));

        std::fs::write(&bundled, b"v2-longer").unwrap();
        assert!(!is_installed_current(&bundled, &installed), "번들이 바뀌면 갱신 대상");
        install_server(&bundled, &installed).unwrap();
        assert_eq!(std::fs::read(&installed).unwrap(), b"v2-longer");

        // 교체 후 남은 .old-* 는 정리된다 (잠겨 있지 않으므로)
        let leftovers = std::fs::read_dir(installed.parent().unwrap())
            .unwrap()
            .filter(|e| e.as_ref().unwrap().file_name().to_string_lossy().contains(".old-"))
            .count();
        assert_eq!(leftovers, 0);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn node_launch_writes_command_and_script_args() {
        let dir = temp_dir("node_launch");
        let launch = ServerLaunch {
            command: PathBuf::from(r"C:\Program Files\nodejs\node.exe"),
            args: vec![r"C:\Users\a\AppData\Local\x\mcp\ss-mcp.mjs".to_string()],
        };
        let json_cfg = dir.join("claude.json");
        register_at(&json_cfg, ConfigFormat::Json, &launch, &dir).unwrap();
        let entry = read_entry(ConfigFormat::Json, &json_cfg).unwrap().unwrap();
        assert_eq!(Path::new(&entry.command), launch.command);
        assert_eq!(entry.args, launch.args);

        let toml_cfg = dir.join("config.toml");
        register_at(&toml_cfg, ConfigFormat::Toml, &launch, &dir).unwrap();
        let entry = read_entry(ConfigFormat::Toml, &toml_cfg).unwrap().unwrap();
        assert_eq!(entry.args, launch.args, "TOML 백슬래시 경로도 그대로 돌아와야 한다");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn every_client_has_a_config_path() {
        for client in CLIENTS {
            assert!(config_path(client.id).is_some(), "{} 경로 없음", client.id);
        }
    }
}
