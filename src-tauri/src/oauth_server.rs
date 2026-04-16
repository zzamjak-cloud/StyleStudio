// OAuth 콜백 서버 모듈
// 로컬 HTTP 서버를 실행하여 Google OAuth 리다이렉트를 자동으로 처리

use std::sync::Arc;
use std::thread;
use tauri::{AppHandle, Emitter};
use tiny_http::{Response, Server};
use url::Url;

const REDIRECT_PORT: u16 = 9528; // StyleStudio용 포트

// OAuth 콜백 결과를 프론트엔드로 전달하는 이벤트 페이로드
#[derive(Clone, serde::Serialize)]
pub struct OAuthCallbackPayload {
    pub code: String,
    pub state: Option<String>,
}

#[derive(Clone, serde::Serialize)]
pub struct OAuthErrorPayload {
    pub error: String,
    pub error_description: Option<String>,
}

// OAuth 콜백 서버 시작
#[tauri::command]
pub async fn start_oauth_server(app: AppHandle) -> Result<(), String> {
    let app_handle = Arc::new(app);

    thread::spawn(move || {
        let addr = format!("127.0.0.1:{}", REDIRECT_PORT);
        let server = match Server::http(&addr) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("[OAuth Server] 서버 시작 실패: {}", e);
                let _ = app_handle.emit("oauth-error", OAuthErrorPayload {
                    error: "server_start_failed".to_string(),
                    error_description: Some(format!("포트 {} 사용 불가: {}", REDIRECT_PORT, e)),
                });
                return;
            }
        };

        println!("[OAuth Server] 콜백 서버 시작: http://{}", addr);

        // 단일 요청만 처리 (OAuth 콜백)
        if let Some(request) = server.incoming_requests().next() {
            let url_str = format!("http://localhost{}", request.url());

            match Url::parse(&url_str) {
                Ok(url) => {
                    let params: std::collections::HashMap<_, _> = url.query_pairs().collect();

                    // 에러 체크
                    if let Some(error) = params.get("error") {
                        let error_desc = params.get("error_description").map(|s| s.to_string());
                        let _ = app_handle.emit("oauth-error", OAuthErrorPayload {
                            error: error.to_string(),
                            error_description: error_desc,
                        });

                        let response = Response::from_string(error_html("인증 실패", &error))
                            .with_header(
                                tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"text/html; charset=utf-8"[..]).unwrap()
                            );
                        let _ = request.respond(response);
                        return;
                    }

                    // 인증 코드 추출
                    if let Some(code) = params.get("code") {
                        let state = params.get("state").map(|s| s.to_string());

                        println!("[OAuth Server] 인증 코드 수신 완료");

                        // 프론트엔드로 코드 전달
                        let _ = app_handle.emit("oauth-callback", OAuthCallbackPayload {
                            code: code.to_string(),
                            state,
                        });

                        // 성공 페이지 응답
                        let response = Response::from_string(success_html())
                            .with_header(
                                tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"text/html; charset=utf-8"[..]).unwrap()
                            );
                        let _ = request.respond(response);
                    } else {
                        let response = Response::from_string(error_html("인증 코드 없음", "code 파라미터가 없습니다"))
                            .with_header(
                                tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"text/html; charset=utf-8"[..]).unwrap()
                            );
                        let _ = request.respond(response);
                    }
                }
                Err(e) => {
                    eprintln!("[OAuth Server] URL 파싱 실패: {}", e);
                    let response = Response::from_string(error_html("URL 파싱 실패", &e.to_string()))
                        .with_header(
                            tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"text/html; charset=utf-8"[..]).unwrap()
                        );
                    let _ = request.respond(response);
                }
            }
        }

        println!("[OAuth Server] 콜백 서버 종료");
    });

    Ok(())
}

// 성공 HTML 페이지
fn success_html() -> String {
    r#"<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>로그인 성공</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        }
        .container {
            background: white;
            padding: 3rem;
            border-radius: 1rem;
            box-shadow: 0 10px 40px rgba(0,0,0,0.2);
            text-align: center;
            max-width: 400px;
        }
        .icon {
            font-size: 4rem;
            margin-bottom: 1rem;
        }
        h1 {
            color: #1a1a2e;
            margin: 0 0 0.5rem;
        }
        p {
            color: #666;
            margin: 0;
        }
        .hint {
            margin-top: 1.5rem;
            padding: 1rem;
            background: #f5f5f5;
            border-radius: 0.5rem;
            font-size: 0.9rem;
            color: #888;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="icon">✅</div>
        <h1>로그인 성공!</h1>
        <p>앱으로 돌아가세요.</p>
        <div class="hint">이 창은 닫아도 됩니다.</div>
    </div>
    <script>
        // 3초 후 자동으로 창 닫기 시도
        setTimeout(() => window.close(), 3000);
    </script>
</body>
</html>"#.to_string()
}

// 에러 HTML 페이지
fn error_html(title: &str, message: &str) -> String {
    format!(r#"<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>로그인 실패</title>
    <style>
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #ff6b6b 0%, #ee5a24 100%);
        }}
        .container {{
            background: white;
            padding: 3rem;
            border-radius: 1rem;
            box-shadow: 0 10px 40px rgba(0,0,0,0.2);
            text-align: center;
            max-width: 400px;
        }}
        .icon {{
            font-size: 4rem;
            margin-bottom: 1rem;
        }}
        h1 {{
            color: #c0392b;
            margin: 0 0 0.5rem;
        }}
        p {{
            color: #666;
            margin: 0;
            word-break: break-all;
        }}
    </style>
</head>
<body>
    <div class="container">
        <div class="icon">❌</div>
        <h1>{}</h1>
        <p>{}</p>
    </div>
</body>
</html>"#, title, message)
}
