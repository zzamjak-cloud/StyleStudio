//! MCP 서버 실행 런타임 — 앱 크기를 지키기 위해 JS 런타임을 번들하지 않는다.
//!
//! - 기본: 앱에 번들된 `ss-mcp.mjs`(약 3.4MB)를 사용자 PC 의 **Node 20.16+** 로 실행한다.
//!   Codex CLI 는 npm 으로 설치하므로 대부분의 에이전트 사용자 PC 에 Node 가 있다.
//! - Node 가 없으면: GitHub 릴리스의 **단일 실행 파일**(런타임 포함)을 한 번 내려받는다.
//!   SHA-256 을 확인하고, `--version` 이 현재 앱 버전과 같은지 실행해 본 뒤에만 설치한다.
//!
//! → wiki/infra/mcp.md "배포 방식"

use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use sha2::{Digest, Sha256};

/// 지원 최소 Node 버전 — 번들에 든 pdfjs-dist 5.x 의 engines(`>=20.16 || >=22.3`) 기준
/// (MCP SDK·전역 fetch·AbortSignal.timeout 은 18 이면 되지만 PDF 문서 파싱이 20.16 을 요구한다)
pub const MIN_NODE_VERSION: (u32, u32) = (20, 16);

/// 화면·오류 문구용 표기
pub fn min_node_label() -> String {
    format!("{}.{}", MIN_NODE_VERSION.0, MIN_NODE_VERSION.1)
}

const RELEASE_BASE: &str = "https://github.com/zzamjak-cloud/StyleStudio/releases/download";

#[derive(Debug, Clone, serde::Serialize)]
pub struct NodeRuntime {
    pub path: String,
    pub version: String,
}

/// 자식 프로세스를 콘솔 창 없이 실행하고 제한 시간 안에 stdout 을 받는다.
fn run_capture(program: &Path, args: &[&str], timeout: Duration) -> Option<String> {
    let mut command = Command::new(program);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW — GUI 앱에서 콘솔 창이 깜빡이지 않게
        command.creation_flags(0x0800_0000);
    }
    let mut child = command.spawn().ok()?;
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                if !status.success() {
                    return None;
                }
                let mut out = String::new();
                child.stdout.take()?.read_to_string(&mut out).ok()?;
                return Some(out.trim().to_string());
            }
            Ok(None) if started.elapsed() < timeout => std::thread::sleep(Duration::from_millis(30)),
            _ => {
                let _ = child.kill();
                return None;
            }
        }
    }
}

/// `v22.20.0` → (22, 20)
fn node_version(version: &str) -> Option<(u32, u32)> {
    let mut parts = version.trim().trim_start_matches('v').split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next().and_then(|m| m.parse().ok()).unwrap_or(0);
    Some((major, minor))
}

#[cfg(target_os = "windows")]
const NODE_BIN: &str = "node.exe";
#[cfg(not(target_os = "windows"))]
const NODE_BIN: &str = "node";

/// Node 후보 경로 — PATH, (macOS/Linux) 로그인 셸 PATH, 흔한 설치 위치.
///
/// Finder·Dock 으로 띄운 macOS 앱의 PATH 에는 Homebrew·nvm 경로가 없어서 PATH 만 보면
/// Node 가 있는데도 없다고 판정한다(quick-folder 에서 겪은 문제). 그래서 로그인 셸에서 다시 찾는다.
fn node_candidates() -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();
    if let Some(path) = std::env::var_os("PATH") {
        out.extend(std::env::split_paths(&path).map(|dir| dir.join(NODE_BIN)));
    }
    #[cfg(not(target_os = "windows"))]
    {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
        if let Some(found) = run_capture(Path::new(&shell), &["-ilc", "command -v node"], Duration::from_secs(4)) {
            if let Some(line) = found.lines().last() {
                out.push(PathBuf::from(line.trim()));
            }
        }
        for dir in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"] {
            out.push(Path::new(dir).join("node"));
        }
        if let Some(home) = dirs::home_dir() {
            out.push(home.join(".volta/bin/node"));
            // nvm: 가장 높은 버전부터
            if let Ok(entries) = std::fs::read_dir(home.join(".nvm/versions/node")) {
                let mut versions: Vec<PathBuf> = entries.flatten().map(|e| e.path().join("bin/node")).collect();
                versions.sort();
                versions.reverse();
                out.extend(versions);
            }
        }
    }
    #[cfg(target_os = "windows")]
    {
        if let Some(pf) = std::env::var_os("ProgramFiles") {
            out.push(PathBuf::from(pf).join("nodejs").join(NODE_BIN));
        }
        if let Some(local) = dirs::data_local_dir() {
            out.push(local.join("Programs").join("nodejs").join(NODE_BIN));
        }
    }
    // 같은 경로 중복 제거 (순서 유지)
    let mut seen = std::collections::HashSet::new();
    out.retain(|p| seen.insert(p.clone()));
    out
}

/// 사용 가능한 Node 20.16+ 를 찾는다.
pub fn find_node() -> Option<NodeRuntime> {
    for candidate in node_candidates() {
        if !candidate.is_file() {
            continue;
        }
        let Some(version) = run_capture(&candidate, &["--version"], Duration::from_secs(4)) else {
            continue;
        };
        if node_version(&version).is_some_and(|v| v >= MIN_NODE_VERSION) {
            // 심볼릭 링크(Homebrew 등)는 실제 경로로 — 등록 경로가 셸 설정에 의존하지 않게
            let path = std::fs::canonicalize(&candidate).unwrap_or(candidate);
            return Some(NodeRuntime {
                path: strip_verbatim(&path).display().to_string(),
                version,
            });
        }
    }
    None
}

/// Windows canonicalize 가 붙이는 `\\?\` 접두사 제거 (에이전트 설정에 그대로 쓰면 일부 클라이언트가 못 읽는다)
fn strip_verbatim(path: &Path) -> PathBuf {
    let text = path.display().to_string();
    PathBuf::from(text.strip_prefix(r"\\?\").unwrap_or(&text))
}

/// 이 플랫폼용 단일 실행 파일 릴리스 자산 이름 (없으면 다운로드 미지원)
pub fn standalone_asset() -> Option<&'static str> {
    if cfg!(target_os = "windows") && cfg!(target_arch = "x86_64") {
        Some("ss-mcp-windows-x64.exe.gz")
    } else if cfg!(target_os = "macos") {
        Some("ss-mcp-macos-universal.gz")
    } else {
        None
    }
}

/// 실행 파일(또는 `node 스크립트`)의 `--version` 출력
pub fn server_version(command: &Path, args: &[String]) -> Option<String> {
    let mut all: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    all.push("--version");
    run_capture(command, &all, Duration::from_secs(10))
}

fn http_get(url: &str) -> Result<ureq::Response, String> {
    ureq::get(url)
        .timeout(Duration::from_secs(600))
        .call()
        .map_err(|e| match e {
            ureq::Error::Status(404, _) => format!(
                "이 버전의 MCP 실행 파일이 릴리스에 없습니다 ({}). 앱을 최신 버전으로 업데이트하거나 Node 20.16 이상을 설치하세요.",
                url
            ),
            other => format!("다운로드 실패 ({}): {}", url, other),
        })
}

/// 단일 실행 파일을 GitHub 릴리스(`v<앱 버전>`)에서 내려받아 `dest` 에 설치한다.
pub fn download_standalone(app_version: &str, dest: &Path) -> Result<(), String> {
    let asset = standalone_asset().ok_or_else(|| "이 플랫폼은 실행 파일 다운로드를 지원하지 않습니다. Node 20.16 이상을 설치하세요.".to_string())?;
    download_from(&format!("{}/v{}/{}", RELEASE_BASE, app_version, asset), asset, app_version, dest)
}

/// `base` 의 `.gz`·`.gz.sha256` 을 받아 설치한다. 해시·버전 확인을 통과해야만 설치한다. (테스트는 로컬 서버로 호출)
fn download_from(base: &str, asset: &str, app_version: &str, dest: &Path) -> Result<(), String> {

    // 1) 기대 해시 (`<hex>  <파일명>` 형식, sha256sum 출력)
    let mut checksum = String::new();
    http_get(&format!("{}.sha256", base))?
        .into_reader()
        .take(4096)
        .read_to_string(&mut checksum)
        .map_err(|e| format!("해시 파일 읽기 실패: {}", e))?;
    let expected = checksum
        .split_whitespace()
        .next()
        .filter(|h| h.len() == 64)
        .ok_or_else(|| "해시 파일 형식이 올바르지 않습니다".to_string())?
        .to_lowercase();

    // 2) 압축 파일을 받으면서 해시 계산
    let dir = dest.parent().ok_or_else(|| "설치 경로가 올바르지 않습니다".to_string())?;
    std::fs::create_dir_all(dir).map_err(|e| format!("{} 생성 실패: {}", dir.display(), e))?;
    let gz_path = dir.join(format!("{}.part", asset));
    {
        let mut reader = http_get(&base)?.into_reader();
        let mut file = std::fs::File::create(&gz_path).map_err(|e| format!("임시 파일 생성 실패: {}", e))?;
        let mut hasher = Sha256::new();
        let mut buf = vec![0u8; 1 << 16];
        loop {
            let n = reader.read(&mut buf).map_err(|e| format!("다운로드 중단: {}", e))?;
            if n == 0 {
                break;
            }
            hasher.update(&buf[..n]);
            file.write_all(&buf[..n]).map_err(|e| format!("임시 파일 쓰기 실패: {}", e))?;
        }
        let actual: String = hasher.finalize().iter().map(|b| format!("{:02x}", b)).collect();
        if actual != expected {
            let _ = std::fs::remove_file(&gz_path);
            return Err("다운로드한 파일의 해시가 일치하지 않습니다. 다시 시도하세요.".to_string());
        }
    }

    // 3) 압축 해제 → 실행 권한 → 버전 확인 → 설치(실행 중 사본 교체 규칙은 install_server 가 처리)
    let unpacked = dir.join(format!("{}.unpacked", asset));
    let result = (|| {
        let mut decoder = flate2::read::GzDecoder::new(
            std::fs::File::open(&gz_path).map_err(|e| format!("압축 파일 열기 실패: {}", e))?,
        );
        let mut out = std::fs::File::create(&unpacked).map_err(|e| format!("압축 해제 파일 생성 실패: {}", e))?;
        std::io::copy(&mut decoder, &mut out).map_err(|e| format!("압축 해제 실패: {}", e))?;
        drop(out);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&unpacked, std::fs::Permissions::from_mode(0o755))
                .map_err(|e| format!("실행 권한 설정 실패: {}", e))?;
        }
        let version = server_version(&unpacked, &[]).ok_or_else(|| "내려받은 실행 파일이 실행되지 않습니다".to_string())?;
        if version != app_version {
            return Err(format!("실행 파일 버전({})이 앱 버전({})과 다릅니다", version, app_version));
        }
        crate::mcp_setup::install_server(&unpacked, dest)
    })();
    let _ = std::fs::remove_file(&gz_path);
    let _ = std::fs::remove_file(&unpacked);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_node_version() {
        assert_eq!(node_version("v22.20.0"), Some((22, 20)));
        assert_eq!(node_version("v18.0.0\n"), Some((18, 0)));
        assert_eq!(node_version("garbage"), None);
        // pdf.js 요구 버전 경계
        assert!(node_version("v20.16.0").unwrap() >= MIN_NODE_VERSION);
        assert!(node_version("v20.15.1").unwrap() < MIN_NODE_VERSION);
        assert!(node_version("v18.20.0").unwrap() < MIN_NODE_VERSION);
    }

    #[test]
    fn strips_windows_verbatim_prefix() {
        assert_eq!(strip_verbatim(Path::new(r"\\?\C:\Program Files\nodejs\node.exe")), PathBuf::from(r"C:\Program Files\nodejs\node.exe"));
        assert_eq!(strip_verbatim(Path::new("/usr/local/bin/node")), PathBuf::from("/usr/local/bin/node"));
    }

    /// 로컬 HTTP 서버로 릴리스 자산을 흉내 낸다 (tiny_http 는 OAuth 서버용으로 이미 의존성에 있다)
    fn serve(files: Vec<(&'static str, Vec<u8>)>) -> String {
        let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
        let addr = server.server_addr().to_ip().unwrap();
        std::thread::spawn(move || {
            for request in server.incoming_requests() {
                let body = files.iter().find(|(name, _)| request.url().ends_with(name)).map(|(_, b)| b.clone());
                let _ = match body {
                    Some(b) => request.respond(tiny_http::Response::from_data(b)),
                    None => request.respond(tiny_http::Response::empty(404)),
                };
            }
        });
        format!("http://{}", addr)
    }

    fn gzip(bytes: &[u8]) -> Vec<u8> {
        let mut enc = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
        enc.write_all(bytes).unwrap();
        enc.finish().unwrap()
    }

    fn sha_hex(bytes: &[u8]) -> String {
        Sha256::digest(bytes).iter().map(|b| format!("{:02x}", b)).collect()
    }

    fn temp_dest(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ss_dl_{}_{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir.join("mcp").join("ss-mcp-test")
    }

    #[test]
    fn rejects_download_with_wrong_hash_and_installs_nothing() {
        let gz = gzip(b"not really a binary");
        let base = serve(vec![
            ("a.gz", gz),
            ("a.gz.sha256", format!("{}  a.gz
", "0".repeat(64)).into_bytes()),
        ]);
        let dest = temp_dest("hash");
        let err = download_from(&format!("{}/a.gz", base), "a.gz", "0.0.0", &dest).unwrap_err();
        assert!(err.contains("해시"), "실제: {}", err);
        assert!(!dest.exists(), "검증 실패 시 아무것도 설치하지 않는다");
    }

    #[test]
    fn rejects_binary_that_does_not_report_the_app_version() {
        // 해시는 맞지만 실행 파일이 아니다 → 버전 확인에서 거부, 임시 파일도 남지 않는다
        let gz = gzip(b"still not a binary");
        let base = serve(vec![("b.gz.sha256", format!("{}  b.gz
", sha_hex(&gz)).into_bytes()), ("b.gz", gz)]);
        let dest = temp_dest("version");
        let err = download_from(&format!("{}/b.gz", base), "b.gz", "0.0.0", &dest).unwrap_err();
        assert!(err.contains("실행되지 않습니다"), "실제: {}", err);
        assert!(!dest.exists());
        let leftovers = std::fs::read_dir(dest.parent().unwrap()).unwrap().count();
        assert_eq!(leftovers, 0, ".part / .unpacked 임시 파일을 남기지 않는다");
    }

    #[test]
    fn missing_release_asset_explains_what_to_do() {
        let base = serve(vec![]);
        let err = download_from(&format!("{}/c.gz", base), "c.gz", "0.0.0", &temp_dest("404")).unwrap_err();
        assert!(err.contains("Node 20.16"), "실제: {}", err);
    }

    /// 실제 단일 실행 파일로 전 과정을 확인한다 (수동 실행: SS_MCP_STANDALONE=<exe 경로> cargo test -- --ignored)
    #[test]
    #[ignore]
    fn installs_real_standalone_binary() {
        let exe = std::env::var("SS_MCP_STANDALONE").expect("SS_MCP_STANDALONE 필요");
        let version = std::env::var("SS_MCP_VERSION").expect("SS_MCP_VERSION 필요");
        let gz = gzip(&std::fs::read(&exe).unwrap());
        let base = serve(vec![("r.gz.sha256", format!("{}  r.gz
", sha_hex(&gz)).into_bytes()), ("r.gz", gz)]);
        let dest = temp_dest("real").with_file_name(SERVER_TEST_BIN);
        download_from(&format!("{}/r.gz", base), "r.gz", &version, &dest).unwrap();
        assert_eq!(server_version(&dest, &[]).as_deref(), Some(version.as_str()));
    }

    #[cfg(target_os = "windows")]
    const SERVER_TEST_BIN: &str = "ss-mcp.exe";
    #[cfg(not(target_os = "windows"))]
    const SERVER_TEST_BIN: &str = "ss-mcp";

    #[test]
    fn finds_node_on_this_machine_when_available() {
        // 개발 PC 에는 Node 가 있다 — 없으면 건너뛴다 (CI 러너 차이)
        if let Some(node) = find_node() {
            assert!(Path::new(&node.path).is_file());
            assert!(node_version(&node.version).unwrap() >= MIN_NODE_VERSION);
        }
    }
}
