use std::collections::HashMap;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use serde::{Deserialize, Serialize};

use crate::AppState;

const NANOKA_BASE: &str = "https://static.nanoka.cc";
const MANIFEST_CACHE_KEY: &str = "manifest";
const CATALOG_CACHE_PREFIX: &str = "catalog:";
const MANIFEST_TTL_MS: i64 = 6 * 60 * 60 * 1000;
const MAX_ICON_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug, Deserialize, Serialize)]
struct Manifest {
    ww: Option<WuwaManifest>,
}

#[derive(Debug, Deserialize, Serialize)]
struct WuwaManifest {
    latest: Option<String>,
}

#[derive(Debug, Deserialize)]
struct NanokaResource {
    #[serde(default)]
    icon: String,
    #[serde(default)]
    rank: i32,
    #[serde(default)]
    zh: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct GachaResource {
    pub resource_id: i64,
    pub name: String,
    pub quality_level: i32,
    pub resource_type: String,
}

#[derive(Debug, Deserialize, Serialize)]
pub(crate) struct AssetCatalog {
    pub(crate) version: String,
    pub(crate) icons: HashMap<i64, String>,
    #[serde(default)]
    pub(crate) portraits: HashMap<i64, String>,
    #[serde(default)]
    pub(crate) resources: Vec<GachaResource>,
}

pub async fn get_gacha_resources(state: &AppState) -> Result<Vec<GachaResource>, String> {
    let mut catalog = load_catalog(state).await?;
    catalog.resources.sort_by(|a, b| {
        b.quality_level
            .cmp(&a.quality_level)
            .then_with(|| a.resource_type.cmp(&b.resource_type))
            .then_with(|| a.name.cmp(&b.name))
    });
    Ok(catalog.resources)
}

pub async fn get_resource_icon(state: &AppState, resource_id: i64) -> Result<String, String> {
    let started = Instant::now();
    let result = get_resource_icon_inner(state, resource_id).await;
    if let Err(error) = &result {
        log::warn!(
            target: "app::assets",
            "event=icon_load_failed resource_id={resource_id} elapsed_ms={} error={}",
            started.elapsed().as_millis(),
            crate::logging::sanitize_message(error)
        );
    }
    result
}

async fn get_resource_icon_inner(state: &AppState, resource_id: i64) -> Result<String, String> {
    if resource_id <= 0 {
        return Err("无效的资源 ID".to_string());
    }

    let icon_cache_dir = state.asset_cache_dir.join("icons");
    let cache_path = icon_cache_dir.join(format!("{resource_id}.webp"));

    // 资源包与 nanoka 单图下载统一写入这个目录，运行时无需关心图片来源。
    if let Some(bytes) = read_local_icon(&icon_cache_dir, resource_id)? {
        log::debug!(
            target: "app::assets",
            "event=icon_cache_hit resource_id={resource_id} bytes={}",
            bytes.len()
        );
        return Ok(to_data_url(&bytes));
    }

    log::info!(target: "app::assets", "event=icon_cache_miss resource_id={resource_id}");

    // 本地缺失时才向 nanoka.cc 拉取 catalog 定位图标并下载新资源。
    let catalog = load_nanoka_catalog(state).await?;
    let icon_path = catalog
        .icons
        .get(&resource_id)
        .ok_or_else(|| format!("nanoka 数据中未找到资源 {resource_id}"))?;
    let url = icon_url(icon_path)?;

    let response = state
        .http
        .get(&url)
        .send()
        .await
        .map_err(|error| format!("下载素材失败: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("下载素材失败: HTTP {}", response.status()));
    }
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    if !content_type.starts_with("image/webp") {
        return Err(format!("素材响应类型异常: {content_type}"));
    }
    if response
        .content_length()
        .is_some_and(|length| length as usize > MAX_ICON_BYTES)
    {
        return Err("素材文件超过大小限制".to_string());
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("读取素材失败: {error}"))?;
    if bytes.is_empty() || bytes.len() > MAX_ICON_BYTES || !is_webp(&bytes) {
        return Err("素材文件为空或超过大小限制".to_string());
    }

    std::fs::create_dir_all(&icon_cache_dir)
        .map_err(|error| format!("创建素材缓存目录失败: {error}"))?;
    let temp_path = icon_cache_dir.join(format!("{resource_id}.tmp"));
    std::fs::write(&temp_path, &bytes).map_err(|error| format!("写入素材缓存失败: {error}"))?;
    if let Err(error) = std::fs::rename(&temp_path, &cache_path) {
        let _ = std::fs::remove_file(&temp_path);
        if !cache_path.is_file() {
            return Err(format!("提交素材缓存失败: {error}"));
        }
    }

    log::info!(
        target: "app::assets",
        "event=icon_downloaded resource_id={resource_id} bytes={}",
        bytes.len()
    );

    Ok(to_data_url(&bytes))
}

async fn load_catalog(state: &AppState) -> Result<AssetCatalog, String> {
    match crate::resource_pack::load_catalog(&state.asset_cache_dir) {
        Ok(Some(catalog)) => {
            log::debug!(target: "app::assets", "event=resource_pack_catalog_hit version={}", catalog.version);
            return Ok(catalog);
        }
        Ok(None) => {}
        Err(error) => {
            log::warn!(target: "app::assets", "event=resource_pack_catalog_invalid fallback=nanoka error={}", crate::logging::sanitize_message(&error));
        }
    }
    load_nanoka_catalog(state).await
}

async fn load_nanoka_catalog(state: &AppState) -> Result<AssetCatalog, String> {
    let _refresh_guard = state.asset_catalog_refresh.lock().await;
    let now = now_ms()?;
    let cached_manifest = {
        let db = state.db.lock().map_err(|error| error.to_string())?;
        db.get_nanoka_cache(MANIFEST_CACHE_KEY)?
    };

    let cached_manifest_is_fresh = cached_manifest
        .as_ref()
        .is_some_and(|entry| now.saturating_sub(entry.updated_at) < MANIFEST_TTL_MS);
    let manifest = if cached_manifest_is_fresh {
        log::debug!(target: "app::assets", "event=manifest_cache_hit freshness=fresh");
        parse_manifest(cached_manifest.as_ref().unwrap())?
    } else {
        match fetch_json::<Manifest>(&state.http, &format!("{NANOKA_BASE}/manifest.json")).await {
            Ok(remote) => {
                let json = serde_json::to_string(&remote).map_err(|error| error.to_string())?;
                let db = state.db.lock().map_err(|error| error.to_string())?;
                db.set_nanoka_cache(MANIFEST_CACHE_KEY, &json, now)?;
                log::info!(target: "app::assets", "event=manifest_refreshed");
                remote
            }
            Err(error) => match cached_manifest.as_ref() {
                Some(cached) => {
                    log::warn!(
                        target: "app::assets",
                        "event=manifest_refresh_failed fallback=stale_cache error={}",
                        crate::logging::sanitize_message(&error)
                    );
                    parse_manifest(cached)?
                }
                None => return Err(error),
            },
        }
    };

    let version = manifest
        .ww
        .and_then(|ww| ww.latest)
        .filter(|version| is_safe_version(version))
        .ok_or_else(|| "nanoka manifest 中缺少有效的鸣潮版本".to_string())?;
    let cache_key = format!("{CATALOG_CACHE_PREFIX}{version}");
    if let Some(cached) = {
        let db = state.db.lock().map_err(|error| error.to_string())?;
        db.get_nanoka_cache(&cache_key)?
    } {
        let catalog: AssetCatalog = serde_json::from_str(&cached.json)
            .map_err(|error| format!("解析素材目录缓存失败: {error}"))?;
        if !catalog.resources.is_empty() {
            log::debug!(
                target: "app::assets",
                "event=catalog_cache_hit version={} resources={} icons={}",
                version,
                catalog.resources.len(),
                catalog.icons.len()
            );
            return Ok(catalog);
        }
    }

    match fetch_catalog(&state.http, &version).await {
        Ok(catalog) => {
            let json = serde_json::to_string(&catalog).map_err(|error| error.to_string())?;
            let db = state.db.lock().map_err(|error| error.to_string())?;
            db.set_nanoka_cache(&cache_key, &json, now)?;
            log::info!(
                target: "app::assets",
                "event=catalog_refreshed version={} resources={} icons={}",
                version,
                catalog.resources.len(),
                catalog.icons.len()
            );
            Ok(catalog)
        }
        Err(error) => {
            let fallback = {
                let db = state
                    .db
                    .lock()
                    .map_err(|lock_error| lock_error.to_string())?;
                db.get_latest_nanoka_cache(CATALOG_CACHE_PREFIX)?
            };
            match fallback {
                Some(cached) => {
                    log::warn!(
                        target: "app::assets",
                        "event=catalog_refresh_failed version={} fallback=latest_cache error={}",
                        version,
                        crate::logging::sanitize_message(&error)
                    );
                    serde_json::from_str(&cached.json).map_err(|parse_error| {
                        format!("{error}; 解析旧素材目录失败: {parse_error}")
                    })
                }
                None => Err(error),
            }
        }
    }
}

async fn fetch_catalog(client: &reqwest::Client, version: &str) -> Result<AssetCatalog, String> {
    let character_url = format!("{NANOKA_BASE}/ww/{version}/character.json");
    let weapon_url = format!("{NANOKA_BASE}/ww/{version}/weapon.json");
    let (characters, weapons) = tokio::try_join!(
        fetch_json::<HashMap<String, NanokaResource>>(client, &character_url),
        fetch_json::<HashMap<String, NanokaResource>>(client, &weapon_url),
    )?;

    let mut icons = HashMap::with_capacity(characters.len() + weapons.len());
    let mut resources = Vec::with_capacity(characters.len() + weapons.len());
    for (resource_type, entries) in [("role", characters), ("weapon", weapons)] {
        for (id, resource) in entries {
            if let Ok(resource_id) = id.parse::<i64>() {
                if !resource.icon.is_empty() {
                    icons.insert(resource_id, resource.icon.clone());
                }
                if (3..=5).contains(&resource.rank) && !resource.zh.is_empty() {
                    resources.push(GachaResource {
                        resource_id,
                        name: resource.zh,
                        quality_level: resource.rank,
                        resource_type: resource_type.to_string(),
                    });
                }
            }
        }
    }
    if icons.is_empty() {
        return Err("nanoka 素材目录为空".to_string());
    }

    Ok(AssetCatalog {
        version: version.to_string(),
        icons,
        portraits: HashMap::new(),
        resources,
    })
}

async fn fetch_json<T: serde::de::DeserializeOwned>(
    client: &reqwest::Client,
    url: &str,
) -> Result<T, String> {
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|error| format!("请求 nanoka 数据失败: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("请求 nanoka 数据失败: HTTP {}", response.status()));
    }
    response
        .json::<T>()
        .await
        .map_err(|error| format!("解析 nanoka 数据失败: {error}"))
}

fn parse_manifest(cached: &crate::db::CachedJson) -> Result<Manifest, String> {
    serde_json::from_str(&cached.json).map_err(|error| format!("解析 manifest 缓存失败: {error}"))
}

fn icon_url(icon_path: &str) -> Result<String, String> {
    if icon_path.contains("..") {
        return Err("素材路径无效".to_string());
    }
    let path = icon_path
        .strip_prefix("/Game/Aki/UI")
        .ok_or_else(|| "素材路径不在允许的目录中".to_string())?;
    let path = path.split('.').next().unwrap_or_default();
    if path.is_empty() || !path.starts_with('/') {
        return Err("素材路径无效".to_string());
    }
    Ok(format!("{NANOKA_BASE}/assets/ww{path}.webp"))
}

fn is_safe_version(version: &str) -> bool {
    // 允许 `+`：nanoka 的鸣潮版本号形如 `3.6.1+8296177`（含构建号）。
    // `+` 在 URL 路径里是合法字符，也不会构成 `..` 或 `/`，不影响 SSRF 防护。
    !version.is_empty()
        && version
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_' | b'+'))
}

fn read_local_icon(dir: &std::path::Path, resource_id: i64) -> Result<Option<Vec<u8>>, String> {
    let canonical = dir.join(format!("{resource_id}.webp"));
    match std::fs::read(&canonical) {
        Ok(bytes) if is_webp(&bytes) && bytes.len() <= MAX_ICON_BYTES => return Ok(Some(bytes)),
        Ok(_) => {
            let _ = std::fs::remove_file(&canonical);
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(format!("读取本地素材失败: {error}")),
    }

    // 兼容旧版本的 `<ID>-<路径哈希>.webp`，命中后迁移到统一文件名并清理重复项。
    let prefix = format!("{resource_id}-");
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("读取素材缓存目录失败: {error}")),
    };
    let mut latest: Option<(SystemTime, Vec<u8>)> = None;
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if !name.starts_with(&prefix) || !name.ends_with(".webp") {
            continue;
        }
        let mtime = entry
            .metadata()
            .and_then(|metadata| metadata.modified())
            .unwrap_or(UNIX_EPOCH);
        let is_newer = match &latest {
            None => true,
            Some((existing, _)) => mtime > *existing,
        };
        if is_newer {
            if let Ok(bytes) = std::fs::read(entry.path()) {
                latest = Some((mtime, bytes));
            }
        }
    }
    let Some((_, bytes)) = latest else {
        return Ok(None);
    };
    if !is_webp(&bytes) || bytes.len() > MAX_ICON_BYTES {
        return Err(format!("旧版素材 {resource_id} 格式异常"));
    }
    std::fs::write(&canonical, &bytes).map_err(|error| format!("迁移旧版素材失败: {error}"))?;
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with(&prefix) && name.ends_with(".webp") {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }
    Ok(Some(bytes))
}

fn is_webp(bytes: &[u8]) -> bool {
    bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP"
}

fn to_data_url(bytes: &[u8]) -> String {
    format!("data:image/webp;base64,{}", BASE64.encode(bytes))
}

fn now_ms() -> Result<i64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_dir(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "wuwa-assets-{name}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    #[test]
    fn converts_allowed_unreal_icon_path() {
        let url = icon_url(
            "/Game/Aki/UI/UIResources/Common/Image/IconRoleHead256/T_IconRoleHead256_14_UI.T_IconRoleHead256_14_UI",
        )
        .unwrap();

        assert_eq!(
            url,
            "https://static.nanoka.cc/assets/ww/UIResources/Common/Image/IconRoleHead256/T_IconRoleHead256_14_UI.webp"
        );
    }

    #[test]
    fn rejects_paths_outside_the_asset_root() {
        assert!(icon_url("https://example.com/image.webp").is_err());
        assert!(icon_url("/Game/Aki/UI/../secret").is_err());
    }

    #[test]
    fn migrates_legacy_icons_to_the_canonical_id_filename() {
        let dir = test_dir("legacy");
        std::fs::create_dir_all(&dir).unwrap();
        let bytes = b"RIFFxxxxWEBPlegacy";
        std::fs::write(dir.join("1104-abcdef.webp"), bytes).unwrap();

        assert_eq!(read_local_icon(&dir, 1104).unwrap().unwrap(), bytes);
        assert_eq!(std::fs::read(dir.join("1104.webp")).unwrap(), bytes);
        assert!(!dir.join("1104-abcdef.webp").exists());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn accepts_nanoka_version_with_build_suffix() {
        assert!(is_safe_version("3.6.1+8296177"));
        assert!(is_safe_version("3.5"));
        assert!(!is_safe_version(""));
        assert!(!is_safe_version("3.6/../etc"));
        assert!(!is_safe_version("3.6 alpha"));
    }
}
