//! MCP 등록 Tauri command
//!
//! 로직은 `mcp_setup`(설정 파일)·`mcp_runtime`(Node 탐지·실행 파일 다운로드)에 있다.
//! 여기서는 Tauri 경로 API 로 번들 스크립트·설치 위치·앱 데이터 경로를 정하고,
//! 지금 PC 에서 서버를 어떻게 띄울지(`ServerLaunch`)를 결정한다.
//!
//! 실행 방법 우선순위
//! 1) Node 20.16+ 가 있으면 `node <설치된 ss-mcp.mjs>` — 앱에는 약 3.4MB 스크립트만 번들한다
//! 2) 없으면 내려받은 단일 실행 파일 `ss-mcp(.exe)` (설정 화면의 다운로드 버튼)

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::{AppHandle, Manager, Runtime};

use crate::mcp_runtime::{self, NodeRuntime};
use crate::mcp_setup::{self, ClientStatus, ServerLaunch, WriteOutcome, SERVER_BIN};

/// 앱에 번들되는 서버 스크립트 이름
const SERVER_SCRIPT: &str = "ss-mcp.mjs";

/// 사본 설치·다운로드는 앱 시작 갱신 스레드·등록 버튼·조각 복사·다운로드가 동시에 부를 수 있다.
/// 한쪽이 복사 중인 덜 써진 파일을 다른 쪽이 "다름"으로 보고 교체하려다 실패하지 않도록 직렬화한다.
static INSTALL_LOCK: Mutex<()> = Mutex::new(());

fn install_locked(bundled: &Path, installed: &Path) -> Result<(), String> {
    let _guard = INSTALL_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    mcp_setup::install_server(bundled, installed)
}

/// 앱에 번들된 `ss-mcp.mjs` 원본 경로
///
/// 1) 앱 리소스 `binaries/` — 정식 설치본, 그리고 tauri-build 가 리소스를 `target/debug/binaries/` 로 복사하는 개발 빌드
/// 2) 실행 파일과 같은 폴더 — 수동으로 옆에 둔 경우의 폴백
fn bundled_script<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    if let Ok(resource_dir) = app.path().resource_dir() {
        let bundled = resource_dir.join("binaries").join(SERVER_SCRIPT);
        if bundled.is_file() {
            return Some(bundled);
        }
    }
    let exe = std::env::current_exe().ok()?;
    let sibling = exe.parent()?.join(SERVER_SCRIPT);
    sibling.is_file().then_some(sibling)
}

/// 에이전트 설정에 실제로 적히는 파일들이 놓이는 폴더 (앱 업데이트 잠금 회피용 사본 위치)
fn install_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map(|dir| dir.join("mcp"))
        .map_err(|e| format!("앱 로컬 데이터 경로를 찾을 수 없습니다: {}", e))
}

/// 서버가 읽을 앱 데이터 경로 (`settings.json`, `images/`)
fn data_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("앱 데이터 경로를 찾을 수 없습니다: {}", e))
}

fn app_version<R: Runtime>(app: &AppHandle<R>) -> String {
    app.package_info().version.to_string()
}

/// 현재 PC 의 런타임 판정 결과
struct RuntimePlan {
    node: Option<NodeRuntime>,
    bundled_script: Option<PathBuf>,
    installed_script: PathBuf,
    standalone: PathBuf,
    standalone_version: Option<String>,
}

impl RuntimePlan {
    fn detect<R: Runtime>(app: &AppHandle<R>) -> Result<Self, String> {
        let dir = install_dir(app)?;
        let standalone = dir.join(SERVER_BIN);
        let standalone_version = if standalone.is_file() {
            mcp_runtime::server_version(&standalone, &[])
        } else {
            None
        };
        Ok(Self {
            node: mcp_runtime::find_node(),
            bundled_script: bundled_script(app),
            installed_script: dir.join(SERVER_SCRIPT),
            standalone,
            standalone_version,
        })
    }

    /// 지금 등록하면 쓰일 실행 방법 (Node 우선)
    fn launch(&self, version: &str) -> Option<(ServerLaunch, &'static str)> {
        if let (Some(node), Some(_)) = (&self.node, &self.bundled_script) {
            return Some((
                ServerLaunch {
                    command: PathBuf::from(&node.path),
                    args: vec![self.installed_script.display().to_string()],
                },
                "node",
            ));
        }
        if self.standalone_version.as_deref() == Some(version) {
            return Some((ServerLaunch::binary(self.standalone.clone()), "standalone"));
        }
        None
    }

    /// 설치된 서버가 현재 앱과 같은 버전인지
    fn is_current(&self, mode: &str, version: &str) -> bool {
        match mode {
            "node" => self
                .bundled_script
                .as_ref()
                .is_some_and(|b| mcp_setup::is_installed_current(b, &self.installed_script)),
            "standalone" => self.standalone_version.as_deref() == Some(version),
            _ => false,
        }
    }

    /// Node 모드면 번들 스크립트를 설치 위치로 복사한다 (등록 직전)
    fn prepare(&self, mode: &str) -> Result<(), String> {
        if mode == "node" {
            let bundled = self.bundled_script.as_ref().ok_or_else(|| {
                "ss-mcp.mjs 가 앱에 포함돼 있지 않습니다. 앱을 다시 설치하거나, 개발 환경이면 `npm run mcp:build` 를 먼저 실행하세요."
                    .to_string()
            })?;
            install_locked(bundled, &self.installed_script)?;
        }
        Ok(())
    }
}

fn no_runtime_error() -> String {
    format!(
        "MCP 서버를 실행할 런타임이 없습니다. Node {}+ 를 설치하거나, 설정의 \"실행 파일 다운로드\" 를 눌러 주세요.",
        mcp_runtime::min_node_label()
    )
}

#[derive(serde::Serialize)]
pub struct McpRuntimeStatus {
    /// 'node' | 'standalone' | 'none'
    pub mode: String,
    pub node_path: Option<String>,
    pub node_version: Option<String>,
    /// 최소 Node 버전 표기 (예: "20.16")
    pub min_node_version: String,
    pub script_bundled: bool,
    pub standalone_installed: bool,
    pub standalone_version: Option<String>,
    /// 이 플랫폼에서 실행 파일 다운로드가 가능한지
    pub download_available: bool,
}

#[derive(serde::Serialize)]
pub struct McpSetupStatus {
    pub app_version: String,
    pub runtime: McpRuntimeStatus,
    /// 에이전트 설정에 등록되는 실행 명령 (런타임이 없으면 null)
    pub server_command: Option<String>,
    pub data_dir: String,
    pub clients: Vec<ClientStatus>,
}

fn build_status<R: Runtime>(app: &AppHandle<R>) -> Result<McpSetupStatus, String> {
    let version = app_version(app);
    let data = data_dir(app)?;
    let plan = RuntimePlan::detect(app)?;
    let launch = plan.launch(&version);
    let mode = launch.as_ref().map(|(_, m)| *m).unwrap_or("none");
    let current = plan.is_current(mode, &version);
    Ok(McpSetupStatus {
        app_version: version,
        runtime: McpRuntimeStatus {
            mode: mode.to_string(),
            node_path: plan.node.as_ref().map(|n| n.path.clone()),
            node_version: plan.node.as_ref().map(|n| n.version.clone()),
            min_node_version: mcp_runtime::min_node_label(),
            script_bundled: plan.bundled_script.is_some(),
            standalone_installed: plan.standalone.is_file(),
            standalone_version: plan.standalone_version.clone(),
            download_available: mcp_runtime::standalone_asset().is_some(),
        },
        server_command: launch.as_ref().map(|(l, _)| l.display()),
        data_dir: data.display().to_string(),
        // 등록된 항목은 실행 명령·데이터 경로가 같고 설치된 서버가 앱 버전과 같아야 "등록됨"
        clients: mcp_setup::client_statuses(launch.as_ref().map(|(l, _)| l), &data, current),
    })
}

/// 등록 화면에 필요한 상태 일괄 조회 (Node 탐지는 프로세스 실행이라 블로킹 스레드에서)
#[tauri::command]
pub async fn mcp_setup_status<R: Runtime>(app: AppHandle<R>) -> Result<McpSetupStatus, String> {
    tauri::async_runtime::spawn_blocking(move || build_status(&app))
        .await
        .map_err(|e| format!("MCP 상태 조회 실패: {}", e))?
}

#[tauri::command]
pub async fn mcp_register<R: Runtime>(app: AppHandle<R>, client_id: String) -> Result<WriteOutcome, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let version = app_version(&app);
        let data = data_dir(&app)?;
        let plan = RuntimePlan::detect(&app)?;
        let (launch, mode) = plan.launch(&version).ok_or_else(no_runtime_error)?;
        plan.prepare(mode)?;
        mcp_setup::register(&client_id, &launch, &data)
    })
    .await
    .map_err(|e| format!("MCP 등록 작업 실패: {}", e))?
}

#[tauri::command]
pub async fn mcp_unregister(client_id: String) -> Result<WriteOutcome, String> {
    tauri::async_runtime::spawn_blocking(move || mcp_setup::unregister(&client_id))
        .await
        .map_err(|e| format!("MCP 해제 작업 실패: {}", e))?
}

/// 수동 등록용 설정 조각. 서버 파일도 함께 준비해 조각이 바로 동작하게 한다.
#[tauri::command]
pub async fn mcp_config_snippet<R: Runtime>(app: AppHandle<R>, client_id: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let version = app_version(&app);
        let data = data_dir(&app)?;
        let plan = RuntimePlan::detect(&app)?;
        let (launch, mode) = plan.launch(&version).ok_or_else(no_runtime_error)?;
        plan.prepare(mode)?;
        mcp_setup::config_snippet(&client_id, &launch, &data)
    })
    .await
    .map_err(|e| format!("설정 조각 생성 실패: {}", e))?
}

/// Node 가 없는 PC 용: 현재 앱 버전의 단일 실행 파일을 GitHub 릴리스에서 내려받아 설치한다.
#[tauri::command]
pub async fn mcp_download_server<R: Runtime>(app: AppHandle<R>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let version = app_version(&app);
        let dest = install_dir(&app)?.join(SERVER_BIN);
        let _guard = INSTALL_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        mcp_runtime::download_standalone(&version, &dest)?;
        Ok(dest.display().to_string())
    })
    .await
    .map_err(|e| format!("실행 파일 다운로드 작업 실패: {}", e))?
}

/// 앱 시작 시: 등록돼 있으면 설치 스크립트를 새 버전으로 맞춘다 (앱 업데이트 반영).
/// 단일 실행 파일은 100MB 급이라 자동으로 받지 않는다 — 설정 화면이 "갱신 필요"로 안내한다.
///
/// 개발 빌드는 건너뛴다 — 정식 앱과 식별자가 같아 설치 위치를 공유하므로, `tauri dev` 를 켤 때마다
/// 정식 사본이 개발 빌드로 바뀌어 버린다. 개발 중 갱신은 설정의 "갱신" 버튼으로 한다.
pub fn refresh_installed_server<R: Runtime>(app: &AppHandle<R>) {
    if cfg!(debug_assertions) {
        return;
    }
    let (Some(bundled), Ok(dir)) = (bundled_script(app), install_dir(app)) else {
        return;
    };
    std::thread::spawn(move || {
        let installed = dir.join(SERVER_SCRIPT);
        if !installed.is_file() || !mcp_setup::any_registered() || mcp_setup::is_installed_current(&bundled, &installed) {
            return;
        }
        if let Err(e) = install_locked(&bundled, &installed) {
            eprintln!("[MCP] ss-mcp.mjs 사본 갱신 실패: {}", e);
        }
    });
}
