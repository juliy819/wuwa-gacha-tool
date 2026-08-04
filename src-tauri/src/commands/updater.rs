use std::io::Write;
use std::path::PathBuf;
use std::time::Duration;

use tauri::{AppHandle, Emitter};

fn isteed_url(url: &str) -> String {
    format!(
        "https://cors.isteed.cc/{}",
        url.trim_start_matches("https://")
            .trim_start_matches("http://")
    )
}

fn prefixed_url(prefix: &str, url: &str) -> String {
    format!("{prefix}/{url}")
}

fn hk_proxy_url(url: &str) -> String {
    prefixed_url("https://hk.gh-proxy.org", url)
}

fn cdn_proxy_url(url: &str) -> String {
    prefixed_url("https://cdn.gh-proxy.org", url)
}

fn ghproxy_net_url(url: &str) -> String {
    prefixed_url("https://ghproxy.net", url)
}

fn edgeone_url(url: &str) -> String {
    prefixed_url("https://edgeone.gh-proxy.org", url)
}

fn official_url(url: &str) -> String {
    url.to_string()
}

const UPDATE_PROXIES: &[(&str, fn(&str) -> String)] = &[
    ("cors.isteed.cc", isteed_url),
    ("hk.gh-proxy.org", hk_proxy_url),
    ("cdn.gh-proxy.org", cdn_proxy_url),
    ("ghproxy.net", ghproxy_net_url),
    ("edgeone.gh-proxy.org", edgeone_url),
    ("GitHub 官方", official_url),
];

#[derive(serde::Serialize, Clone)]
struct ProgressPayload {
    proxy: String,
    percent: u8,
}

/// 下载安装包并启动安装程序
/// 返回 Ok(()) 表示下载完成且已触发启动；错误通过字符串返回
#[tauri::command]
pub async fn download_and_install_update(
    app: AppHandle,
    official_url: String,
    version: String,
) -> Result<(), String> {
    log::info!(
        target: "app::updater",
        "event=download_started version={} sources={}",
        version,
        UPDATE_PROXIES.len()
    );
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| format!("初始化 HTTP 客户端失败: {e}"))?;

    let mut errors: Vec<String> = Vec::new();
    let mut downloaded_path: Option<PathBuf> = None;

    for (proxy_name, build_url) in UPDATE_PROXIES {
        let url = build_url(&official_url);
        match try_download_once(&client, &app, &url, proxy_name, &version).await {
            Ok(path) => {
                log::info!(
                    target: "app::updater",
                    "event=source_succeeded source={proxy_name}"
                );
                downloaded_path = Some(path);
                break;
            }
            Err(e) => {
                log::warn!(
                    target: "app::updater",
                    "event=source_failed source={proxy_name} error={e}"
                );
                errors.push(format!("{proxy_name}: {e}"));
            }
        }
    }

    let Some(local_path) = downloaded_path else {
        log::error!(target: "app::updater", "event=download_failed all_sources=true");
        return Err(format!("所有下载渠道均失败\n{}", errors.join("\n")));
    };

    // 通知前端下载完成
    let _ = app.emit(
        "update-download-done",
        serde_json::json!({
            "path": local_path.to_string_lossy()
        }),
    );

    // 短暂等待前端渲染完成态
    tokio::time::sleep(std::time::Duration::from_millis(500)).await;

    // 启动安装程序（NSIS 会请求 UAC，用户确认后完成安装并启动新版本）
    open_installer(&local_path).map_err(|e| {
        log::error!(target: "app::updater", "event=installer_launch_failed error={e}");
        format!("启动安装程序失败: {e}")
    })?;
    log::info!(target: "app::updater", "event=installer_launched version={version}");

    // 退出当前应用，避免文件占用导致安装失败
    app.exit(0);

    Ok(())
}

async fn try_download_once(
    client: &reqwest::Client,
    app: &AppHandle,
    url: &str,
    proxy_name: &str,
    version: &str,
) -> Result<PathBuf, String> {
    // 立即通知前端正在尝试该代理
    let _ = app.emit(
        "update-download-progress",
        ProgressPayload {
            proxy: proxy_name.to_string(),
            percent: 0,
        },
    );

    // 发送请求（3s 超时，快速判断代理是否可用）
    let mut resp = tokio::time::timeout(Duration::from_secs(3), client.get(url).send())
        .await
        .map_err(|_| "请求超时（3s 未响应）".to_string())?
        .map_err(|e| format!("请求失败: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }

    let total_size = resp.content_length().unwrap_or(0);
    let filename = format!("wuwa-gacha-tool-{version}-setup{}", exe_ext());
    let temp_dir = std::env::temp_dir();
    let local_path = temp_dir.join(filename);

    if local_path.exists() {
        let _ = std::fs::remove_file(&local_path);
    }

    let mut file =
        std::fs::File::create(&local_path).map_err(|e| format!("创建临时文件失败: {e}"))?;

    let mut downloaded: u64 = 0;
    let mut last_percent: u8 = 0;

    // 首个数据块 3s 超时（防止代理建连后挂起）
    // 一旦开始接收数据，后续块用 30s 超时（容忍网络抖动）
    loop {
        let timeout_dur = if downloaded == 0 {
            Duration::from_secs(3)
        } else {
            Duration::from_secs(30)
        };

        let chunk_result = tokio::time::timeout(timeout_dur, resp.chunk()).await;

        match chunk_result {
            Ok(Ok(Some(chunk))) => {
                if downloaded == 0 {
                    // 第一个数据块到达，通知前端开始下载
                    let _ = app.emit(
                        "update-download-progress",
                        ProgressPayload {
                            proxy: proxy_name.to_string(),
                            percent: 1,
                        },
                    );
                }
                file.write_all(&chunk)
                    .map_err(|e| format!("写入临时文件失败: {e}"))?;
                downloaded += chunk.len() as u64;
                if total_size > 0 {
                    let percent = ((downloaded as f64 / total_size as f64) * 99.0) as u8;
                    if percent != last_percent {
                        last_percent = percent;
                        let _ = app.emit(
                            "update-download-progress",
                            ProgressPayload {
                                proxy: proxy_name.to_string(),
                                percent,
                            },
                        );
                    }
                }
            }
            Ok(Ok(None)) => break, // 流结束
            Ok(Err(e)) => {
                return Err(format!("下载出错: {e}"));
            }
            Err(_) => {
                return Err(if downloaded == 0 {
                    "首块超时（3s 无数据）".to_string()
                } else {
                    "数据传输超时（30s 无数据）".to_string()
                });
            }
        }
    }
    file.flush().ok();
    drop(file);

    // 校验文件大小（防止代理返回空内容或错误页面）
    let file_size = std::fs::metadata(&local_path).map(|m| m.len()).unwrap_or(0);
    if file_size < 1024 * 100 {
        // 小于 100KB 肯定不对（安装包通常几 MB）
        let _ = std::fs::remove_file(&local_path);
        return Err(format!(
            "下载文件过小（{} bytes），可能不是有效安装包",
            file_size
        ));
    }

    let _ = app.emit(
        "update-download-progress",
        ProgressPayload {
            proxy: proxy_name.to_string(),
            percent: 100,
        },
    );

    Ok(local_path)
}

fn exe_ext() -> &'static str {
    if cfg!(target_os = "windows") {
        ".exe"
    } else if cfg!(target_os = "macos") {
        ".dmg"
    } else {
        ".AppImage"
    }
}

fn open_installer(path: &std::path::Path) -> std::io::Result<()> {
    if cfg!(target_os = "windows") {
        use std::process::Command;
        // /S 静默安装，/R 安装完成后自动重启应用，/NS 不创建快捷方式（避免重复）
        Command::new(path)
            .args(["/S", "/R", "/NS"])
            .spawn()
            .map(|_| ())
    } else if cfg!(target_os = "macos") {
        use std::process::Command;
        Command::new("open").arg(path).spawn().map(|_| ())
    } else {
        use std::process::{Command, Stdio};
        // Linux: 先 chmod +x 再执行
        #[cfg(unix)]
        {
            let _ =
                std::fs::set_permissions(path, std::os::unix::fs::PermissionsExt::from_mode(0o755));
        }
        let pb = path.to_path_buf();
        Command::new("sh")
            .arg("-c")
            .arg(format!("{}", pb.display()))
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map(|_| ())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn update_proxy_order_and_urls_match_the_verified_fallbacks() {
        let upstream = "https://github.com/example/repo/releases/download/v1/app.exe";
        let names: Vec<_> = UPDATE_PROXIES.iter().map(|(name, _)| *name).collect();
        assert_eq!(
            names,
            vec![
                "cors.isteed.cc",
                "hk.gh-proxy.org",
                "cdn.gh-proxy.org",
                "ghproxy.net",
                "edgeone.gh-proxy.org",
                "GitHub 官方",
            ]
        );

        let urls: Vec<_> = UPDATE_PROXIES
            .iter()
            .map(|(_, build_url)| build_url(upstream))
            .collect();
        assert_eq!(
            urls,
            vec![
                "https://cors.isteed.cc/github.com/example/repo/releases/download/v1/app.exe",
                "https://hk.gh-proxy.org/https://github.com/example/repo/releases/download/v1/app.exe",
                "https://cdn.gh-proxy.org/https://github.com/example/repo/releases/download/v1/app.exe",
                "https://ghproxy.net/https://github.com/example/repo/releases/download/v1/app.exe",
                "https://edgeone.gh-proxy.org/https://github.com/example/repo/releases/download/v1/app.exe",
                "https://github.com/example/repo/releases/download/v1/app.exe",
            ]
        );
    }

    #[test]
    fn metadata_endpoints_match_the_verified_small_file_order() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../../tauri.conf.json")).unwrap();
        let endpoints: Vec<_> = config["plugins"]["updater"]["endpoints"]
            .as_array()
            .unwrap()
            .iter()
            .map(|value| value.as_str().unwrap())
            .collect();

        assert_eq!(
            endpoints,
            vec![
                "https://cors.isteed.cc/github.com/juliy819/wuwa-gacha-tool/releases/latest/download/latest.json",
                "https://ghproxy.net/https://github.com/juliy819/wuwa-gacha-tool/releases/latest/download/latest.json",
                "https://hk.gh-proxy.org/https://github.com/juliy819/wuwa-gacha-tool/releases/latest/download/latest.json",
                "https://cdn.gh-proxy.org/https://github.com/juliy819/wuwa-gacha-tool/releases/latest/download/latest.json",
                "https://edgeone.gh-proxy.org/https://github.com/juliy819/wuwa-gacha-tool/releases/latest/download/latest.json",
                "https://github.com/juliy819/wuwa-gacha-tool/releases/latest/download/latest.json",
            ]
        );
    }
}
