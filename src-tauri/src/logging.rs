use std::path::Path;
use std::sync::OnceLock;

use log::LevelFilter;
use regex::Regex;
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_log::{RotationStrategy, Target, TargetKind, TimezoneStrategy};

const MAX_LOG_FILE_BYTES: u128 = 5 * 1024 * 1024;
const RETAINED_LOG_FILES: usize = 5;
const MAX_LOG_MESSAGE_CHARS: usize = 2_000;

pub fn plugin<R: Runtime>() -> tauri::plugin::TauriPlugin<R> {
    let level = if cfg!(debug_assertions) {
        LevelFilter::Debug
    } else {
        LevelFilter::Info
    };

    tauri_plugin_log::Builder::new()
        .level(level)
        .level_for("hyper", LevelFilter::Warn)
        .level_for("reqwest", LevelFilter::Warn)
        .level_for("rustls", LevelFilter::Warn)
        .level_for("tauri", LevelFilter::Warn)
        .level_for("tauri_plugin_updater", LevelFilter::Warn)
        .timezone_strategy(TimezoneStrategy::UseLocal)
        .max_file_size(MAX_LOG_FILE_BYTES)
        .rotation_strategy(RotationStrategy::KeepSome(RETAINED_LOG_FILES))
        .targets([
            Target::new(TargetKind::Stdout),
            Target::new(TargetKind::LogDir {
                file_name: Some("wuwa-gacha-tool".into()),
            }),
        ])
        .build()
}

pub fn install_panic_hook() {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |panic_info| {
        let payload = panic_info
            .payload()
            .downcast_ref::<&str>()
            .copied()
            .or_else(|| {
                panic_info
                    .payload()
                    .downcast_ref::<String>()
                    .map(String::as_str)
            })
            .unwrap_or("non-string panic payload");
        let location = panic_info
            .location()
            .map(|value| format!("{}:{}:{}", value.file(), value.line(), value.column()))
            .unwrap_or_else(|| "unknown".to_string());
        log::error!(
            target: "app::panic",
            "event=panic location={location} message={}",
            sanitize_message(payload)
        );
        previous(panic_info);
    }));
}

pub fn sanitize_message(value: &str) -> String {
    static URL: OnceLock<Regex> = OnceLock::new();
    static SECRET: OnceLock<Regex> = OnceLock::new();
    let url = URL.get_or_init(|| Regex::new(r#"https?://[^\s\"'<>]+"#).expect("valid URL regex"));
    let secret = SECRET.get_or_init(|| {
        Regex::new(
            r#"(?i)(authkey|record_id|token|access_token|authorization)(?:%3[dD]|[\s\"']*[:=][\s\"']*)[^&,\s\"'}]+"#,
        )
        .expect("valid secret regex")
    });

    let without_urls = url.replace_all(value, "[redacted-url]");
    let without_secrets = secret.replace_all(&without_urls, "$1=[redacted]");
    without_secrets
        .chars()
        .take(MAX_LOG_MESSAGE_CHARS)
        .collect()
}

#[tauri::command]
pub fn open_log_directory(app: AppHandle) -> Result<String, String> {
    let log_dir = app
        .path()
        .app_log_dir()
        .map_err(|error| format!("无法定位日志目录: {error}"))?;
    std::fs::create_dir_all(&log_dir).map_err(|error| {
        log::error!(target: "app::logging", "event=create_log_dir_failed error={error}");
        format!("无法创建日志目录: {error}")
    })?;

    open_directory(&log_dir).map_err(|error| {
        log::error!(target: "app::logging", "event=open_log_dir_failed error={error}");
        format!("无法打开日志目录: {error}")
    })?;

    log::info!(target: "app::logging", "event=open_log_dir");
    Ok(log_dir.to_string_lossy().into_owned())
}

fn open_directory(path: &Path) -> std::io::Result<()> {
    #[cfg(target_os = "windows")]
    let mut command = std::process::Command::new("explorer");
    #[cfg(target_os = "macos")]
    let mut command = std::process::Command::new("open");
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = std::process::Command::new("xdg-open");

    command.arg(path).spawn().map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn log_retention_has_a_bounded_disk_budget() {
        assert_eq!(MAX_LOG_FILE_BYTES, 5 * 1024 * 1024);
        assert_eq!(RETAINED_LOG_FILES, 5);
    }

    #[test]
    fn sensitive_values_and_urls_are_redacted() {
        let message = "request https://example.com/path?record_id=secret&lang=zh failed token=abc";
        let sanitized = sanitize_message(message);

        assert!(!sanitized.contains("secret"));
        assert!(!sanitized.contains("token=abc"));
        assert!(!sanitized.contains("example.com"));
        assert!(sanitized.contains("[redacted-url]"));
    }

    #[test]
    fn oversized_messages_are_bounded() {
        assert_eq!(sanitize_message(&"x".repeat(3_000)).chars().count(), 2_000);
    }
}
