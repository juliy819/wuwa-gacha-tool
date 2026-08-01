use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

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
struct AssetCatalog {
    version: String,
    icons: HashMap<i64, String>,
    #[serde(default)]
    resources: Vec<GachaResource>,
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
    if resource_id <= 0 {
        return Err("无效的资源 ID".to_string());
    }

    let icon_cache_dir = state.asset_cache_dir.join("icons");

    // 本地缓存优先：角色/武器 ID 与其图标一一对应且固定，已下载的素材直接返回，
    // 不依赖 nanoka.cc 是否可用（即使停运，已下载的图片仍可正常显示）。
    if let Some(bytes) = read_local_icon_by_id(&icon_cache_dir, resource_id)? {
        return Ok(to_data_url(&bytes));
    }

    // 本地缺失时才向 nanoka.cc 拉取 catalog 定位图标并下载新资源。
    let catalog = load_catalog(state).await?;
    let icon_path = catalog
        .icons
        .get(&resource_id)
        .ok_or_else(|| format!("nanoka 数据中未找到资源 {resource_id}"))?;
    let url = icon_url(icon_path)?;
    let cache_path = icon_cache_dir.join(icon_cache_name(resource_id, icon_path));

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
    if bytes.is_empty() || bytes.len() > MAX_ICON_BYTES {
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

    Ok(to_data_url(&bytes))
}

async fn load_catalog(state: &AppState) -> Result<AssetCatalog, String> {
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
        parse_manifest(cached_manifest.as_ref().unwrap())?
    } else {
        match fetch_json::<Manifest>(&state.http, &format!("{NANOKA_BASE}/manifest.json")).await {
            Ok(remote) => {
                let json = serde_json::to_string(&remote).map_err(|error| error.to_string())?;
                let db = state.db.lock().map_err(|error| error.to_string())?;
                db.set_nanoka_cache(MANIFEST_CACHE_KEY, &json, now)?;
                remote
            }
            Err(error) => match cached_manifest.as_ref() {
                Some(cached) => parse_manifest(cached)?,
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
            return Ok(catalog);
        }
    }

    match fetch_catalog(&state.http, &version).await {
        Ok(catalog) => {
            let json = serde_json::to_string(&catalog).map_err(|error| error.to_string())?;
            let db = state.db.lock().map_err(|error| error.to_string())?;
            db.set_nanoka_cache(&cache_key, &json, now)?;
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
                Some(cached) => serde_json::from_str(&cached.json)
                    .map_err(|parse_error| format!("{error}; 解析旧素材目录失败: {parse_error}")),
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

fn icon_cache_name(resource_id: i64, icon_path: &str) -> String {
    // FNV-1a keeps filenames stable across app and Rust upgrades. A changed
    // nanoka asset path naturally gets a new file without redownloading every
    // unchanged icon when the game data version advances.
    let hash = icon_path
        .bytes()
        .fold(0xcbf29ce484222325_u64, |hash, byte| {
            (hash ^ u64::from(byte)).wrapping_mul(0x100000001b3)
        });
    format!("{resource_id}-{hash:016x}.webp")
}

/// 按 `resource_id` 在本地缓存目录中查找已下载的素材。
/// 文件名形如 `{resource_id}-{hash}.webp`，取最新修改的一份。
/// 作为 `get_resource_icon` 的本地优先查询路径，使已下载素材的展示
/// 不依赖 nanoka.cc 在线。
fn read_local_icon_by_id(
    dir: &std::path::Path,
    resource_id: i64,
) -> Result<Option<Vec<u8>>, String> {
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
    Ok(latest.map(|(_, bytes)| bytes))
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
    fn cache_name_changes_only_when_the_resource_or_asset_path_changes() {
        let first = icon_cache_name(1104, "/Game/Aki/UI/Icon.Head");

        assert_eq!(first, icon_cache_name(1104, "/Game/Aki/UI/Icon.Head"));
        assert_ne!(first, icon_cache_name(1104, "/Game/Aki/UI/NewIcon.Head"));
        assert_ne!(first, icon_cache_name(1105, "/Game/Aki/UI/Icon.Head"));
        assert!(first.starts_with("1104-"));
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
