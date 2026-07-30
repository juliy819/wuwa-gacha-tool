use regex::Regex;
use std::fs;
use std::path::Path;

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
            let url = cap[1].to_string();
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
            latest_url = Some(cap.get(0).unwrap().as_str().to_string());
        }
    }

    latest_url
}

/// 从游戏目录构建日志文件路径
pub fn get_log_path(game_dir: &str) -> String {
    let normalized = game_dir.trim_end_matches('\\').trim_end_matches('/');
    format!("{}\\Client\\Saved\\Logs\\Client.log", normalized)
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
                if b % 2 == 1 { b ^ 0xA5 } else { b ^ 0xEF }
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
}
