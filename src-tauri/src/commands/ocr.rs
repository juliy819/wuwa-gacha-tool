use std::fs::File;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

// CREATE_NO_WINDOW flag for Windows to hide the console window of child processes.
// See: https://learn.microsoft.com/en-us/windows/win32/procthread/process-creation-flags
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, State};

use super::gacha::{insert_mock_gacha_inner, InsertMockGachaRequest};
use crate::AppState;

const STANDARD_FIVE_STAR_CHAR_IDS: &[i64] = &[1104, 1203, 1301, 1405, 1503];
const STANDARD_FIVE_STAR_WEAPON_IDS: &[i64] = &[
    21010015, 21020015, 21030015, 21040015, 21050015, 21010045, 21020045, 21030045, 21040045,
    21050045,
];
const OCR_MANIFEST_URL: &str = "https://github.com/juliy819/wuwa-gacha-tool-ocr-runtime/releases/latest/download/ocr-component.json";
const MAX_COMPONENT_BYTES: u64 = 500 * 1024 * 1024;
const GITHUB_PROXIES: &[&str] = &[
    "https://cors.isteed.cc/",
    "https://hk.gh-proxy.org/",
    "https://cdn.gh-proxy.org/",
    "https://ghproxy.net/",
    "https://edgeone.gh-proxy.org/",
];

fn has_consecutive_standard_characters(rows: &[InsertMockGachaRequest]) -> bool {
    rows.windows(2).any(|pair| {
        STANDARD_FIVE_STAR_CHAR_IDS.contains(&pair[0].resource_id)
            && STANDARD_FIVE_STAR_CHAR_IDS.contains(&pair[1].resource_id)
    })
}

fn has_standard_weapon_in_featured_pool(rows: &[InsertMockGachaRequest]) -> bool {
    rows.iter().any(|row| {
        row.card_pool_type == "2" && STANDARD_FIVE_STAR_WEAPON_IDS.contains(&row.resource_id)
    })
}

#[derive(Debug, Deserialize)]
struct OcrComponentManifest {
    schema: u32,
    version: String,
    platforms: std::collections::HashMap<String, OcrComponentArtifact>,
}

#[derive(Debug, Deserialize)]
struct OcrComponentArtifact {
    url: String,
    sha256: String,
    size: u64,
}

#[derive(Debug, Deserialize, Serialize)]
struct InstalledComponent {
    version: String,
}

#[derive(Debug, Serialize)]
pub struct OcrComponentStatus {
    supported: bool,
    installed: bool,
    healthy: bool,
    platform: String,
    version: Option<String>,
    install_dir: String,
    reason: Option<String>,
    latest_version: Option<String>,
    update_available: bool,
}

#[derive(Debug, Serialize)]
pub struct OcrComponentUpdate {
    current_version: Option<String>,
    latest_version: Option<String>,
    update_available: bool,
    reason: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
struct OcrDownloadProgress {
    phase: String,
    downloaded: u64,
    total: Option<u64>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct OcrRecognitionProgress {
    completed_images: usize,
    total_images: usize,
    recognized_rows: usize,
    source: String,
    current_image_processed: Option<usize>,
    current_image_total: Option<usize>,
    strategy: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct OcrScreenshotRequest {
    paths: Vec<String>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct OcrAlternative {
    resource_id: i64,
    name: String,
    inliers: i32,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct OcrCandidateRow {
    key: String,
    source: String,
    strategy: String,
    y: i32,
    resource_id: i64,
    resource_type: String,
    name: String,
    pulls: i32,
    ocr_confidence: f64,
    icon_inliers: i32,
    icon_margin: i32,
    high_confidence: bool,
    #[serde(default)]
    recognized_date: Option<String>,
    alternatives: Vec<OcrAlternative>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct OcrImageSummary {
    source: String,
    strategy: String,
    rows: usize,
    high_confidence_rows: usize,
    #[serde(default)]
    date_rows: usize,
    #[serde(default)]
    reference_date: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct OcrScreenshotResult {
    rows: Vec<OcrCandidateRow>,
    images: Vec<OcrImageSummary>,
}

#[derive(Debug, Deserialize)]
pub struct OcrImportRequest {
    rows: Vec<InsertMockGachaRequest>,
    #[serde(default)]
    allow_date_overlap: bool,
}

#[derive(Debug, Serialize)]
pub struct OcrImportResult {
    five_star_count: usize,
    inserted_record_count: usize,
    date_overlap_count: usize,
    date_overlap_range: Option<(String, String)>,
}

fn rollback_ocr_rows(state: &AppState, five_star_ids: &[i64]) -> Result<(), String> {
    let db = state.db.lock().map_err(|error| error.to_string())?;
    let mut errors = Vec::new();
    for id in five_star_ids.iter().rev() {
        if let Err(error) = db.delete_mock_record(*id) {
            errors.push(error);
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("；"))
    }
}

fn component_platform() -> Option<&'static str> {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("windows", "x86_64") => Some("windows-x86_64"),
        ("linux", "x86_64") => Some("linux-x86_64"),
        _ => None,
    }
}

fn components_dir(state: &AppState) -> PathBuf {
    std::env::var_os("WUWA_OCR_COMPONENT_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| state.app_data_dir.join("components").join("ocr"))
}

fn current_component(state: &AppState) -> Result<(InstalledComponent, PathBuf), String> {
    let root = components_dir(state);
    let current = root.join("current.json");
    let installed: InstalledComponent = serde_json::from_slice(
        &std::fs::read(&current).map_err(|_| "OCR 组件尚未安装".to_string())?,
    )
    .map_err(|error| format!("OCR 组件状态损坏: {error}"))?;
    if installed.version.contains(['/', '\\']) || installed.version.contains("..") {
        return Err("OCR 组件版本信息无效".to_string());
    }
    Ok((installed, root))
}

fn component_executable(root: &Path, version: &str) -> PathBuf {
    let name = if cfg!(windows) {
        "wuwa-ocr.exe"
    } else {
        "wuwa-ocr"
    };
    root.join("versions").join(version).join(name)
}

fn run_self_check(executable: &Path) -> Result<(), String> {
    if !executable.is_file() {
        return Err("OCR 组件可执行文件不存在".to_string());
    }
    let mut command = Command::new(executable);
    command.arg("--self-check");
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    let output = command
        .output()
        .map_err(|error| format!("无法启动 OCR 组件: {error}"))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(format!(
            "OCR 组件自检失败: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ))
    }
}

fn proxy_urls(url: &str) -> Vec<String> {
    if !url.starts_with("https://github.com/") {
        return vec![url.to_string()];
    }
    GITHUB_PROXIES
        .iter()
        .map(|prefix| format!("{prefix}{url}"))
        .chain(std::iter::once(url.to_string()))
        .collect()
}

async fn fetch_bytes(
    url: &str,
    max_size: u64,
    app: Option<&AppHandle>,
    phase: &str,
) -> Result<Vec<u8>, String> {
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(15))
        .timeout(std::time::Duration::from_secs(600))
        .build()
        .map_err(|error| error.to_string())?;
    let mut errors = Vec::new();
    for candidate in proxy_urls(url) {
        match client.get(&candidate).send().await {
            Ok(response) if response.status().is_success() => {
                if response
                    .content_length()
                    .is_some_and(|size| size > max_size)
                {
                    errors.push(format!("{candidate}: 文件过大"));
                    continue;
                }
                let total = response.content_length();
                let mut downloaded = 0_u64;
                let mut bytes = Vec::new();
                let mut stream = response.bytes_stream();
                while let Some(chunk) = stream.next().await {
                    let chunk = match chunk {
                        Ok(chunk) => chunk,
                        Err(error) => {
                            errors.push(format!("{candidate}: {error}"));
                            bytes.clear();
                            break;
                        }
                    };
                    downloaded = downloaded.saturating_add(chunk.len() as u64);
                    if downloaded > max_size {
                        errors.push(format!("{candidate}: 文件过大"));
                        bytes.clear();
                        break;
                    }
                    bytes.extend_from_slice(&chunk);
                    if let Some(app) = app {
                        let _ = app.emit(
                            "ocr-download-progress",
                            OcrDownloadProgress {
                                phase: phase.to_string(),
                                downloaded,
                                total,
                            },
                        );
                    }
                }
                if !bytes.is_empty() || total == Some(0) {
                    return Ok(bytes);
                }
            }
            Ok(response) => errors.push(format!("{candidate}: HTTP {}", response.status())),
            Err(error) => errors.push(format!("{candidate}: {error}")),
        }
    }
    Err(format!("所有下载源均失败: {}", errors.join("；")))
}

async fn fetch_manifest(app: Option<&AppHandle>) -> Result<OcrComponentManifest, String> {
    let url =
        std::env::var("WUWA_OCR_MANIFEST_URL").unwrap_or_else(|_| OCR_MANIFEST_URL.to_string());
    let manifest: OcrComponentManifest =
        serde_json::from_slice(&fetch_bytes(&url, 1024 * 1024, app, "manifest").await?)
            .map_err(|error| format!("OCR 组件清单无效: {error}"))?;
    if manifest.schema != 1 || manifest.version.is_empty() {
        return Err("不支持的 OCR 组件清单".to_string());
    }
    Ok(manifest)
}

fn numeric_version_parts(version: &str) -> Vec<u64> {
    version
        .split(|character: char| !character.is_ascii_digit())
        .filter(|part| !part.is_empty())
        .filter_map(|part| part.parse().ok())
        .collect()
}

fn is_remote_version_newer(current: &str, remote: &str) -> bool {
    if current == remote {
        return false;
    }
    let mut current_parts = numeric_version_parts(current);
    let mut remote_parts = numeric_version_parts(remote);
    if current_parts.is_empty() || remote_parts.is_empty() {
        return false;
    }
    let length = current_parts.len().max(remote_parts.len());
    current_parts.resize(length, 0);
    remote_parts.resize(length, 0);
    remote_parts > current_parts
}

#[tauri::command]
pub async fn get_ocr_component_status(
    state: State<'_, AppState>,
) -> Result<OcrComponentStatus, String> {
    let platform = component_platform().unwrap_or("unsupported").to_string();
    let root = components_dir(&state);
    if component_platform().is_none() {
        return Ok(OcrComponentStatus {
            supported: false,
            installed: false,
            healthy: false,
            platform,
            version: None,
            install_dir: root.display().to_string(),
            reason: Some("当前系统或处理器架构暂不支持本地 OCR".to_string()),
            latest_version: None,
            update_available: false,
        });
    }
    match current_component(&state) {
        Ok((installed, root)) => {
            let executable = component_executable(&root, &installed.version);
            let healthy = executable.is_file();
            Ok(OcrComponentStatus {
                supported: true,
                installed: true,
                healthy,
                platform,
                version: Some(installed.version),
                install_dir: root.display().to_string(),
                reason: (!healthy).then(|| "OCR 组件可执行文件不存在".to_string()),
                latest_version: None,
                update_available: false,
            })
        }
        Err(reason) => Ok(OcrComponentStatus {
            supported: true,
            installed: false,
            healthy: false,
            platform,
            version: None,
            install_dir: root.display().to_string(),
            reason: Some(reason),
            latest_version: None,
            update_available: false,
        }),
    }
}

#[tauri::command]
pub async fn check_ocr_component_update(
    state: State<'_, AppState>,
) -> Result<OcrComponentUpdate, String> {
    let current_version = current_component(&state)
        .ok()
        .map(|(component, _)| component.version);
    match fetch_manifest(None).await {
        Ok(manifest) => Ok(OcrComponentUpdate {
            update_available: current_version
                .as_deref()
                .is_some_and(|current| is_remote_version_newer(current, &manifest.version)),
            current_version,
            latest_version: Some(manifest.version),
            reason: None,
        }),
        Err(error) => Ok(OcrComponentUpdate {
            current_version,
            latest_version: None,
            update_available: false,
            reason: Some(error),
        }),
    }
}

#[tauri::command]
pub async fn install_ocr_component(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<OcrComponentStatus, String> {
    let platform = component_platform().ok_or_else(|| "当前环境不支持本地 OCR".to_string())?;
    let manifest = fetch_manifest(Some(&app)).await?;
    let artifact = manifest
        .platforms
        .get(platform)
        .ok_or_else(|| format!("组件未提供 {platform} 版本"))?;
    let artifact_url =
        url::Url::parse(&artifact.url).map_err(|error| format!("OCR 组件地址无效: {error}"))?;
    if artifact_url.scheme() != "https" || artifact_url.host_str() != Some("github.com") {
        return Err("OCR 组件地址不是受支持的 GitHub HTTPS 地址".to_string());
    }
    if artifact.size == 0 || artifact.size > MAX_COMPONENT_BYTES || artifact.sha256.len() != 64 {
        return Err("OCR 组件清单中的文件信息无效".to_string());
    }
    let archive = fetch_bytes(
        artifact_url.as_str(),
        MAX_COMPONENT_BYTES,
        Some(&app),
        "component",
    )
    .await?;
    if archive.len() as u64 != artifact.size {
        return Err("OCR 组件下载大小与清单不一致".to_string());
    }
    let actual = format!("{:x}", Sha256::digest(&archive));
    if !actual.eq_ignore_ascii_case(&artifact.sha256) {
        return Err("OCR 组件 SHA-256 校验失败".to_string());
    }
    let root = components_dir(&state);
    let version_dir = root.join("versions").join(&manifest.version);
    let staging = root.join(format!(".installing-{}", manifest.version));
    if staging.exists() {
        std::fs::remove_dir_all(&staging).map_err(|error| error.to_string())?;
    }
    std::fs::create_dir_all(&staging).map_err(|error| error.to_string())?;
    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(archive))
        .map_err(|error| format!("OCR 组件压缩包无效: {error}"))?;
    if zip.len() > 10_000 {
        return Err("OCR 组件压缩包文件数量异常".to_string());
    }
    let mut extracted = 0_u64;
    for index in 0..zip.len() {
        let mut entry = zip.by_index(index).map_err(|error| error.to_string())?;
        let path = Path::new(entry.name());
        if path.is_absolute()
            || path.components().any(|part| {
                matches!(
                    part,
                    Component::ParentDir | Component::Prefix(_) | Component::RootDir
                )
            })
        {
            return Err("OCR 组件压缩包包含不安全路径".to_string());
        }
        let output = staging.join(path);
        if entry.is_dir() {
            std::fs::create_dir_all(&output).map_err(|error| error.to_string())?;
            continue;
        }
        extracted = extracted.saturating_add(entry.size());
        if extracted > 1024 * 1024 * 1024 {
            return Err("OCR 组件解压体积异常".to_string());
        }
        if let Some(parent) = output.parent() {
            std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let mut file = File::create(output).map_err(|error| error.to_string())?;
        std::io::copy(&mut entry, &mut file).map_err(|error| error.to_string())?;
    }
    let staged_executable = staging.join(if cfg!(windows) {
        "wuwa-ocr.exe"
    } else {
        "wuwa-ocr"
    });
    run_self_check(&staged_executable)?;
    if version_dir.exists() {
        std::fs::remove_dir_all(&version_dir).map_err(|error| error.to_string())?;
    }
    std::fs::create_dir_all(version_dir.parent().unwrap_or(&root))
        .map_err(|error| error.to_string())?;
    std::fs::rename(&staging, &version_dir)
        .map_err(|error| format!("启用 OCR 组件失败: {error}"))?;
    let active_version = manifest.version.clone();
    let current_tmp = root.join("current.json.tmp");
    File::create(&current_tmp)
        .and_then(|mut file| {
            file.write_all(
                &serde_json::to_vec(&InstalledComponent {
                    version: manifest.version,
                })
                .unwrap(),
            )
        })
        .map_err(|error| error.to_string())?;
    std::fs::rename(current_tmp, root.join("current.json")).map_err(|error| error.to_string())?;
    if let Ok(entries) = std::fs::read_dir(root.join("versions")) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.file_name().and_then(|name| name.to_str()) != Some(active_version.as_str()) {
                if let Err(error) = std::fs::remove_dir_all(&path) {
                    log::warn!(target: "app::ocr", "event=old_component_cleanup_failed path={} error={error}", path.display());
                }
            }
        }
    }
    get_ocr_component_status(state).await
}

#[tauri::command]
pub async fn remove_ocr_component(
    state: State<'_, AppState>,
) -> Result<OcrComponentStatus, String> {
    let root = components_dir(&state);
    if root.exists() {
        std::fs::remove_dir_all(&root).map_err(|error| format!("删除 OCR 组件失败: {error}"))?;
    }
    get_ocr_component_status(state).await
}

#[tauri::command]
pub async fn recognize_gacha_screenshots(
    app: AppHandle,
    state: State<'_, AppState>,
    request: OcrScreenshotRequest,
) -> Result<OcrScreenshotResult, String> {
    if request.paths.is_empty() {
        return Err("请至少选择一张截图".to_string());
    }
    if request.paths.len() > 20 {
        return Err("一次最多识别 20 张截图".to_string());
    }
    for raw_path in &request.paths {
        let path = Path::new(raw_path);
        if !path.is_file() {
            return Err(format!("截图不存在: {}", path.display()));
        }
        let extension = path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        if !matches!(extension.as_str(), "png" | "jpg" | "jpeg" | "webp") {
            return Err(format!("不支持的截图格式: {}", path.display()));
        }
    }

    let (installed, root) = current_component(&state)?;
    let executable = component_executable(&root, &installed.version);
    if !executable.is_file() {
        return Err("OCR 组件可执行文件不存在，请修复组件".to_string());
    }
    let resource_catalog = crate::resource_pack::load_catalog(&state.asset_cache_dir)?
        .ok_or_else(|| "本地资源包尚未安装，请联网重启应用后再进行截图识别".to_string())?;
    if resource_catalog.portraits.is_empty() {
        log::warn!(
            target: "app::ocr",
            "event=resource_pack_has_no_portraits version={}",
            resource_catalog.version
        );
    }
    let resource_pack_dir = state.asset_cache_dir.clone();
    // Sidecar startup loads ONNX Runtime and the full local template catalog
    // before it can emit its first per-image progress event. Tell the UI what
    // this initial, unavoidable phase is instead of leaving an empty bar.
    let _ = app.emit(
        "ocr-recognition-progress",
        OcrRecognitionProgress {
            completed_images: 0,
            total_images: request.paths.len(),
            recognized_rows: 0,
            source: Path::new(&request.paths[0])
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or_default()
                .to_string(),
            current_image_processed: None,
            current_image_total: None,
            strategy: Some("starting".to_string()),
        },
    );
    let request_path = std::env::temp_dir().join(format!(
        "wuwa-ocr-{}.json",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| error.to_string())?
            .as_nanos()
    ));
    let payload = serde_json::json!({
        "paths": request.paths,
    });
    std::fs::write(
        &request_path,
        serde_json::to_vec(&payload).map_err(|error| error.to_string())?,
    )
    .map_err(|error| format!("创建 OCR 请求失败: {error}"))?;

    let output = tokio::task::spawn_blocking(move || {
        let mut command = Command::new(&executable);
        command
            .arg("--request")
            .arg(&request_path)
            .env("WUWA_OCR_RESOURCE_PACK", &resource_pack_dir)
            .current_dir(executable.parent().unwrap_or(&root))
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        #[cfg(windows)]
        command.creation_flags(CREATE_NO_WINDOW);
        let mut child = command
            .spawn()
            .map_err(|error| format!("无法启动 OCR 组件: {error}"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "OCR 组件未提供标准输出".to_string())?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "OCR 组件未提供错误输出".to_string())?;
        let stderr_thread = std::thread::spawn(move || {
            let mut bytes = Vec::new();
            let _ = BufReader::new(stderr).read_to_end(&mut bytes);
            bytes
        });
        let mut stdout_text = String::new();
        for line in BufReader::new(stdout).lines() {
            let line = line.map_err(|error| format!("读取 OCR 输出失败: {error}"))?;
            if let Some(json) = line.strip_prefix("WUWA_OCR_PROGRESS=") {
                if let Ok(progress) = serde_json::from_str::<OcrRecognitionProgress>(json) {
                    let _ = app.emit("ocr-recognition-progress", progress);
                }
            }
            stdout_text.push_str(&line);
            stdout_text.push('\n');
        }
        let status = child
            .wait()
            .map_err(|error| format!("OCR 任务异常结束: {error}"))?;
        let stderr = stderr_thread.join().unwrap_or_default();
        Ok::<_, String>((status, stdout_text, stderr, request_path))
    })
    .await
    .map_err(|error| format!("OCR 任务异常结束: {error}"))??;
    let (status, stdout, stderr, request_path) = output;
    let _ = std::fs::remove_file(request_path);
    if !status.success() {
        return Err(format!(
            "OCR 识别失败: {}",
            String::from_utf8_lossy(&stderr).trim()
        ));
    }
    let json = stdout
        .lines()
        .rev()
        .find_map(|line| line.strip_prefix("WUWA_OCR_RESULT="))
        .ok_or_else(|| "OCR 引擎未返回结构化结果".to_string())?;
    let result: OcrScreenshotResult =
        serde_json::from_str(json).map_err(|error| format!("解析 OCR 结果失败: {error}"))?;
    log::info!(
        target: "app::ocr",
        "event=recognition_completed images={} rows={} component_version={}",
        result.images.len(),
        result.rows.len(),
        installed.version,
    );
    Ok(result)
}

#[tauri::command]
pub async fn import_ocr_gacha_rows(
    state: State<'_, AppState>,
    request: OcrImportRequest,
) -> Result<OcrImportResult, String> {
    if request.rows.is_empty() {
        return Err("没有可导入的五星记录".to_string());
    }
    if request.rows.len() > 200 {
        return Err("一次最多导入 200 条五星记录".to_string());
    }
    let earliest = request
        .rows
        .iter()
        .map(|row| row.time.as_str())
        .min()
        .unwrap_or_default();
    let latest = request
        .rows
        .iter()
        .map(|row| row.time.as_str())
        .max()
        .unwrap_or_default();
    let existing = {
        let db = state.db.lock().map_err(|error| error.to_string())?;
        db.get_all_records(Some(&request.rows[0].player_id))?
    };
    let overlaps: Vec<_> = existing
        .into_iter()
        .filter(|record| {
            record.card_pool_type == request.rows[0].card_pool_type
                && record.time.as_str() >= earliest
                && record.time.as_str() <= latest
        })
        .collect();
    if !overlaps.is_empty() && !request.allow_date_overlap {
        let overlap_earliest = overlaps
            .iter()
            .map(|record| record.time.as_str())
            .min()
            .unwrap_or(earliest);
        let overlap_latest = overlaps
            .iter()
            .map(|record| record.time.as_str())
            .max()
            .unwrap_or(latest);
        return Err(format!(
            "目标卡池已有 {} 条记录与导入日期重叠（{} 至 {}），请确认后重试",
            overlaps.len(),
            overlap_earliest.get(..10).unwrap_or(overlap_earliest),
            overlap_latest.get(..10).unwrap_or(overlap_latest)
        ));
    }
    let overlap_count = overlaps.len();
    let overlap_range = if overlap_count == 0 {
        None
    } else {
        Some((
            overlaps
                .iter()
                .map(|record| record.time.clone())
                .min()
                .unwrap_or_default(),
            overlaps
                .iter()
                .map(|record| record.time.clone())
                .max()
                .unwrap_or_default(),
        ))
    };

    let expected_type = match request.rows[0].card_pool_type.as_str() {
        "1" | "3" | "5" | "6" | "7" | "8" | "10" | "12" => "role",
        "2" | "4" | "9" | "11" | "13" => "weapon",
        _ => return Err("不支持的卡池类型".to_string()),
    };
    if request
        .rows
        .iter()
        .any(|row| row.card_pool_type != request.rows[0].card_pool_type)
    {
        return Err("同一批记录必须导入同一个卡池".to_string());
    }
    if request
        .rows
        .iter()
        .any(|row| row.player_id.trim() != request.rows[0].player_id.trim())
    {
        return Err("同一批记录必须导入同一个 UID".to_string());
    }
    if request.rows[0].card_pool_type == "1" && has_consecutive_standard_characters(&request.rows) {
        return Err("角色活动池中出现相邻两个常驻五星，请检查角色和记录顺序".to_string());
    }
    if has_standard_weapon_in_featured_pool(&request.rows) {
        return Err("武器活动池中出现常驻五星武器，请检查卡池和资源".to_string());
    }
    let resources = crate::assets::get_gacha_resources(&state).await?;
    for row in &request.rows {
        let resource = resources
            .iter()
            .find(|resource| resource.resource_id == row.resource_id && resource.quality_level == 5)
            .ok_or_else(|| {
                format!(
                    "五星资源 {} 不在当前素材目录中，请刷新素材后重试",
                    row.resource_id
                )
            })?;
        if resource.resource_type != expected_type {
            return Err(format!(
                "“{}”是五星{}，不能导入当前选择的{}池",
                resource.name,
                if resource.resource_type == "role" {
                    "角色"
                } else {
                    "武器"
                },
                if expected_type == "role" {
                    "角色"
                } else {
                    "武器"
                }
            ));
        }
        if matches!(row.card_pool_type.as_str(), "3" | "5" | "6" | "7")
            && !STANDARD_FIVE_STAR_CHAR_IDS.contains(&resource.resource_id)
        {
            return Err(format!(
                "“{}”不是常驻五星角色，不能导入当前选择的卡池",
                resource.name
            ));
        }
        if row.card_pool_type == "4"
            && !STANDARD_FIVE_STAR_WEAPON_IDS.contains(&resource.resource_id)
        {
            return Err(format!(
                "“{}”不是常驻五星武器，不能导入武器常驻唤取",
                resource.name
            ));
        }
    }

    let mut inserted_five_star_ids = Vec::with_capacity(request.rows.len());
    let mut inserted_record_count = 0;
    for row in request.rows {
        match insert_mock_gacha_inner(&state, row).await {
            Ok(records) => {
                let id = records
                    .iter()
                    .find(|record| record.quality_level == 5)
                    .and_then(|record| record.id);
                let Some(id) = id else {
                    return match rollback_ocr_rows(&state, &inserted_five_star_ids) {
                        Ok(()) => Err("OCR 导入未返回五星记录 ID，已回滚本次所有写入".to_string()),
                        Err(error) => {
                            Err(format!("OCR 导入未返回五星记录 ID，且回滚不完整：{error}"))
                        }
                    };
                };
                inserted_record_count += records.len();
                inserted_five_star_ids.push(id);
            }
            Err(error) => {
                return match rollback_ocr_rows(&state, &inserted_five_star_ids) {
                    Ok(()) => Err(format!("导入失败，已回滚本次所有写入：{error}")),
                    Err(rollback_error) => {
                        Err(format!("导入失败且回滚不完整：{error}；{rollback_error}"))
                    }
                };
            }
        }
    }

    Ok(OcrImportResult {
        five_star_count: inserted_five_star_ids.len(),
        inserted_record_count,
        date_overlap_count: overlap_count,
        date_overlap_range: overlap_range,
    })
}

#[cfg(test)]
mod tests {
    use std::io::Write;

    use sha2::{Digest, Sha256};

    use super::{
        component_platform, fetch_bytes, fetch_manifest, has_consecutive_standard_characters,
        has_standard_weapon_in_featured_pool, is_remote_version_newer, proxy_urls, run_self_check,
        OcrScreenshotResult, MAX_COMPONENT_BYTES,
    };
    use crate::commands::gacha::InsertMockGachaRequest;

    #[test]
    fn component_download_sources_match_the_verified_updater_order() {
        let url = "https://github.com/example/repo/releases/download/v1/file.zip";
        assert_eq!(
            proxy_urls(url),
            vec![
                format!("https://cors.isteed.cc/{url}"),
                format!("https://hk.gh-proxy.org/{url}"),
                format!("https://cdn.gh-proxy.org/{url}"),
                format!("https://ghproxy.net/{url}"),
                format!("https://edgeone.gh-proxy.org/{url}"),
                url.to_string(),
            ]
        );
    }

    #[test]
    fn only_reports_strictly_newer_component_versions() {
        assert!(is_remote_version_newer(
            "2026.08.24.1624",
            "2026.08.25.0405"
        ));
        assert!(!is_remote_version_newer(
            "2026.08.25.0405",
            "2026.08.24.1624"
        ));
        assert!(!is_remote_version_newer(
            "2026.08.25.0405",
            "2026.08.25.0405"
        ));
        assert!(is_remote_version_newer("ocr-runtime-9", "ocr-runtime-10"));
    }

    #[test]
    fn parses_resource_type_on_row_without_requiring_it_on_alternatives() {
        let payload = r#"{
            "rows": [{
                "key": "0-0-100", "source": "sample.png", "strategy": "wide-list-v1",
                "y": 100, "resource_id": 1104, "resource_type": "role", "name": "凌阳",
                "pulls": 12, "ocr_confidence": 0.99, "icon_inliers": 20,
                "icon_margin": 10, "high_confidence": true, "recognized_date": "2025-08-20",
                "alternatives": [{"resource_id": 1203, "name": "安可", "inliers": 10}]
            }],
            "images": [{
                "source": "sample.png", "strategy": "wide-list-v1", "rows": 1,
                "high_confidence_rows": 1, "date_rows": 1, "reference_date": "2026-03-04"
            }]
        }"#;

        let result: OcrScreenshotResult = serde_json::from_str(payload).unwrap();
        assert_eq!(result.rows.len(), 1);
        assert_eq!(result.rows[0].resource_type, "role");
        assert_eq!(result.rows[0].recognized_date.as_deref(), Some("2025-08-20"));
        assert_eq!(result.rows[0].alternatives.len(), 1);
        assert_eq!(result.images[0].date_rows, 1);
    }

    fn mock_row(resource_id: i64) -> InsertMockGachaRequest {
        InsertMockGachaRequest {
            player_id: "10001".to_string(),
            card_pool_type: "1".to_string(),
            resource_id,
            pulls: 10,
            time: "2026-08-25 12:00:00".to_string(),
        }
    }

    #[test]
    fn detects_consecutive_standard_characters_in_featured_sequence() {
        assert!(has_consecutive_standard_characters(&[
            mock_row(1104),
            mock_row(1203),
        ]));
        assert!(!has_consecutive_standard_characters(&[
            mock_row(1104),
            mock_row(1507),
            mock_row(1203),
        ]));
    }

    #[test]
    fn detects_standard_weapon_in_featured_weapon_pool() {
        let mut standard = mock_row(21010015);
        standard.card_pool_type = "2".to_string();
        let mut featured = mock_row(21040036);
        featured.card_pool_type = "2".to_string();
        assert!(has_standard_weapon_in_featured_pool(&[standard]));
        assert!(!has_standard_weapon_in_featured_pool(&[featured]));
    }

    #[tokio::test]
    #[ignore = "downloads and executes the published OCR component"]
    async fn published_component_download_verification_and_self_check() {
        let platform = component_platform().expect("test platform must be supported");
        let manifest = fetch_manifest(None).await.expect("manifest download");
        let artifact = manifest.platforms.get(platform).expect("platform artifact");
        let archive = fetch_bytes(&artifact.url, MAX_COMPONENT_BYTES, None, "component")
            .await
            .expect("component download");
        assert_eq!(archive.len() as u64, artifact.size);
        assert_eq!(format!("{:x}", Sha256::digest(&archive)), artifact.sha256);

        let root =
            std::env::temp_dir().join(format!("wuwa-ocr-release-test-{}", std::process::id()));
        if root.exists() {
            std::fs::remove_dir_all(&root).expect("remove previous test directory");
        }
        std::fs::create_dir_all(&root).expect("create test directory");
        let mut zip = zip::ZipArchive::new(std::io::Cursor::new(archive)).expect("valid zip");
        for index in 0..zip.len() {
            let mut entry = zip.by_index(index).expect("zip entry");
            let relative = entry.enclosed_name().expect("safe zip path");
            let output = root.join(relative);
            if entry.is_dir() {
                std::fs::create_dir_all(&output).expect("create zip directory");
            } else {
                std::fs::create_dir_all(output.parent().expect("entry parent"))
                    .expect("create entry parent");
                let mut file = std::fs::File::create(output).expect("create entry");
                std::io::copy(&mut entry, &mut file).expect("extract entry");
                file.flush().expect("flush entry");
            }
        }
        let executable = root.join(if cfg!(windows) {
            "wuwa-ocr.exe"
        } else {
            "wuwa-ocr"
        });
        run_self_check(&executable).expect("published component self-check");
        std::fs::remove_dir_all(root).expect("remove test directory");
    }
}
