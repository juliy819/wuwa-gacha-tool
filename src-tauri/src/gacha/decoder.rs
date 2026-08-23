use regex::Regex;
use std::fs;
use std::path::Path;
use url::Url;

const GACHA_HOST: &str = "aki-gm-resources.aki-game.com";
const GACHA_PATH: &str = "/aki/gacha/index.html";

/// 解码 Client.log 文件
///
/// 游戏的 Client.log 是二进制文件，前 3 字节为 BOM 头，需跳过。
/// 解密算法：对每个字节，如果 byte % 2 == 1，则 XOR 0xA5；否则 XOR 0xEF
/// 与 geturl.ps1 的实现完全一致
pub fn decode_client_log(file_path: &str) -> Result<String, String> {
    let path = Path::new(file_path);
    if !path.exists() {
        return Err(format!("文件不存在: {}", file_path));
    }

    let bytes = fs::read(path).map_err(|e| format!("读取文件失败: {}", e))?;

    if bytes.len() < 3 {
        return Err("文件过小，无法解码".to_string());
    }

    // 跳过前 3 字节 BOM 头，与 ps1 脚本一致
    let decoded: Vec<u8> = bytes
        .iter()
        .skip(3)
        .map(|&b| {
            let b = b & 0xFF;
            if b % 2 == 1 {
                b ^ 0xA5
            } else {
                b ^ 0xEF
            }
        })
        .collect();

    // 使用 lossy 转换，忽略可能残留的无效 UTF-8 字节
    Ok(String::from_utf8_lossy(&decoded).into_owned())
}

/// 从解码后的日志中提取抽卡 URL
pub fn extract_gacha_url(decoded_log: &str) -> Option<String> {
    // 匹配 OpenWebView 行中的 URL（与 ps1 脚本一致）
    let line_re = Regex::new(r#"OpenWebView.*?sdkJson.*?"url":"([^"]+)""#).unwrap();
    let ts_re = Regex::new(r"\[(\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2}:\d{3})\]").unwrap();

    let mut latest_url: Option<String> = None;
    let mut latest_time: Option<String> = None;

    for line in decoded_log.lines() {
        if !line.contains("OpenWebView") || !line.contains("sdkJson") {
            continue;
        }

        // 提取时间戳（格式固定，直接用字符串比较即可）
        let time = ts_re.captures(line).map(|cap| cap[1].to_string());

        // 提取 URL
        if let Some(cap) = line_re.captures(line) {
            let url = normalize_logged_url(&cap[1]);
            if !is_gacha_record_url(&url) {
                continue;
            }
            if latest_time.is_none() || time.as_deref() > latest_time.as_deref() {
                latest_time = time;
                latest_url = Some(url);
            }
        }
    }

    // 回退：如果上面的精确匹配没找到，用宽松正则
    if latest_url.is_none() {
        let re = Regex::new(r#"https[^\s"']*/aki/gacha/index.html#/record[^\s"']*"#).unwrap();
        for cap in re.captures_iter(decoded_log) {
            let url = normalize_logged_url(cap.get(0).unwrap().as_str());
            if is_gacha_record_url(&url) {
                latest_url = Some(url);
            }
        }
    }

    latest_url
}

fn is_gacha_record_url(raw_url: &str) -> bool {
    let Ok(url) = Url::parse(raw_url) else {
        return false;
    };

    url.scheme() == "https"
        && url.host_str() == Some(GACHA_HOST)
        && url.path() == GACHA_PATH
        && url
            .fragment()
            .is_some_and(|fragment| fragment == "/record" || fragment.starts_with("/record?"))
}

/// 根据用户输入定位 Client.log。支持游戏根目录以及误填的 Client、Saved、Logs 子目录。
pub fn get_log_path(game_dir: &str) -> String {
    resolve_log_path(game_dir).1.to_string_lossy().into_owned()
}

fn normalize_logged_url(raw_url: &str) -> String {
    raw_url.replace("\\u0026", "&")
}

/// 返回自动修正后的游戏根目录和日志路径。
pub fn resolve_log_path(game_dir: &str) -> (String, std::path::PathBuf) {
    let input = Path::new(game_dir.trim());
    let mut candidates = Vec::new();
    if input
        .file_name()
        .is_some_and(|name| name.eq_ignore_ascii_case("Client.log"))
    {
        candidates.push((
            input
                .parent()
                .and_then(Path::parent)
                .and_then(Path::parent)
                .and_then(Path::parent),
            input.to_path_buf(),
        ));
    }
    candidates.push((Some(input), input.join("Client/Saved/Logs/Client.log")));
    candidates.push((input.parent(), input.join("Saved/Logs/Client.log")));
    candidates.push((
        input.parent().and_then(Path::parent),
        input.join("Logs/Client.log"),
    ));
    candidates.push((
        input.parent().and_then(Path::parent).and_then(Path::parent),
        input.join("Client.log"),
    ));

    for (root, log_path) in candidates {
        if log_path.is_file() {
            let normalized_root = root.unwrap_or(input).to_string_lossy().into_owned();
            return (normalized_root, log_path);
        }
    }

    let normalized = input.to_string_lossy().into_owned();
    (
        normalized.clone(),
        input.join("Client/Saved/Logs/Client.log"),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_decode_algorithm() {
        let test_bytes = vec![0xEFu8, 0xBB, 0xBF, 0x00, 0x01, 0x02, 0x03];
        let decoded: Vec<u8> = test_bytes
            .iter()
            .skip(3)
            .map(|&b| {
                let b = b & 0xFF;
                if b % 2 == 1 {
                    b ^ 0xA5
                } else {
                    b ^ 0xEF
                }
            })
            .collect();
        assert_eq!(decoded.len(), 4);
    }

    #[test]
    fn test_extract_url() {
        let log = r#"some log data
[2026.07.30-12.00.00:000] LogWebView: OpenWebView: sdkJson: {"url":"https://aki-gm-resources.aki-game.com/aki/gacha/index.html#/record?svr_id=test&player_id=123"}
more data"#;
        let url = extract_gacha_url(log);
        assert!(url.is_some());
        assert!(url.unwrap().contains("aki/gacha/index.html"));
    }

    #[test]
    fn restores_ampersands_escaped_in_sdk_json() {
        let log = r#"[2026.07.30-12.00.00:000] LogWebView: OpenWebView: sdkJson: {"url":"https://aki-gm-resources.aki-game.com/aki/gacha/index.html#/record?svr_id=test\u0026player_id=123\u0026record_id=token"}"#;

        assert_eq!(
            extract_gacha_url(log).as_deref(),
            Some("https://aki-gm-resources.aki-game.com/aki/gacha/index.html#/record?svr_id=test&player_id=123&record_id=token")
        );
    }

    #[test]
    fn resolves_game_root_from_common_log_subdirectories() {
        let base = std::env::temp_dir().join(format!("wuwa-log-path-{}", std::process::id()));
        let root = base.join("Wuthering Waves Game");
        let logs = root.join("Client/Saved/Logs");
        fs::create_dir_all(&logs).unwrap();
        let log_path = logs.join("Client.log");
        fs::write(&log_path, b"test").unwrap();

        for input in [
            &root,
            &root.join("Client"),
            &root.join("Client/Saved"),
            &logs,
            &log_path,
        ] {
            let (resolved_root, resolved_log) = resolve_log_path(input.to_string_lossy().as_ref());
            assert_eq!(Path::new(&resolved_root), root);
            assert_eq!(resolved_log, log_path);
        }

        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn ignores_newer_announcement_url_from_same_host() {
        let log = r#"[2026.08.16-11.00.00:000] LogWebView: OpenWebView: sdkJson: {"url":"https://aki-gm-resources.aki-game.com/aki/gacha/index.html#/record?svr_id=test&player_id=123&record_id=token"}
[2026.08.16-12.00.00:000] LogWebView: OpenWebView: sdkJson: {"url":"https://aki-gm-resources.aki-game.com/aki/announcement/index.html?server_id=test&role_id=123&login_info=encoded"}"#;

        assert_eq!(
            extract_gacha_url(log).as_deref(),
            Some("https://aki-gm-resources.aki-game.com/aki/gacha/index.html#/record?svr_id=test&player_id=123&record_id=token")
        );
    }

    #[test]
    fn rejects_announcement_url_when_no_gacha_record_was_opened() {
        let log = r#"[2026.08.16-12.00.00:000] LogWebView: OpenWebView: sdkJson: {"url":"https://aki-gm-resources.aki-game.com/aki/announcement/index.html?server_id=test&role_id=123&login_info=encoded"}"#;

        assert_eq!(extract_gacha_url(log), None);
    }

    #[test]
    fn rejects_lookalike_host_and_non_record_gacha_page() {
        let log = r#"[2026.08.16-12.00.00:000] LogWebView: OpenWebView: sdkJson: {"url":"https://aki-gm-resources.aki-game.com.example.com/aki/gacha/index.html#/record?player_id=123&record_id=token"}
[2026.08.16-12.01.00:000] LogWebView: OpenWebView: sdkJson: {"url":"https://aki-gm-resources.aki-game.com/aki/gacha/index.html?player_id=123&record_id=token"}"#;

        assert_eq!(extract_gacha_url(log), None);
    }
}
