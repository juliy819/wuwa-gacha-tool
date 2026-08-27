use std::fs::File;
use std::io::{Cursor, Read, Write};
use std::path::Path;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::assets::AssetCatalog;
use crate::AppState;

const RESOURCE_MANIFEST_URL: &str = "https://github.com/juliy819/wuwa-gacha-tool-resources/releases/latest/download/resource-manifest.json";
const MAX_MANIFEST_BYTES: u64 = 64 * 1024;
const MAX_ARCHIVE_BYTES: u64 = 256 * 1024 * 1024;
const MAX_EXTRACTED_BYTES: u64 = 512 * 1024 * 1024;
const MAX_CATALOG_BYTES: u64 = 2 * 1024 * 1024;
const MAX_ICON_BYTES: u64 = 2 * 1024 * 1024;
const MAX_PORTRAIT_BYTES: u64 = 8 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES: usize = 4_096;

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
struct ResourceManifest {
    schema: u32,
    archive_url: String,
    archive_sha256: String,
    archive_size: u64,
}

pub(crate) async fn refresh(state: &AppState) -> Result<(), String> {
    let _guard = state.resource_pack_refresh.lock().await;
    refresh_inner(&state.http, &state.asset_cache_dir).await
}

async fn refresh_inner(client: &reqwest::Client, asset_dir: &Path) -> Result<(), String> {
    let manifest_bytes =
        fetch_github_bytes(client, RESOURCE_MANIFEST_URL, MAX_MANIFEST_BYTES).await?;
    let manifest: ResourceManifest = serde_json::from_slice(&manifest_bytes)
        .map_err(|error| format!("资源包清单无效: {error}"))?;
    validate_manifest(&manifest)?;

    if load_installed_manifest(asset_dir).as_ref() == Some(&manifest)
        && load_catalog(asset_dir)?.is_some()
    {
        log::debug!(target: "app::resource_pack", "event=already_current sha256={}", manifest.archive_sha256);
        return Ok(());
    }

    let archive = fetch_github_bytes(client, &manifest.archive_url, manifest.archive_size).await?;
    if archive.len() as u64 != manifest.archive_size {
        return Err(format!(
            "资源包大小校验失败: expected={}, actual={}",
            manifest.archive_size,
            archive.len()
        ));
    }
    if sha256_hex(&archive) != manifest.archive_sha256.to_ascii_lowercase() {
        return Err("资源包 SHA-256 校验失败".to_string());
    }

    install_archive(asset_dir, &manifest, &archive)?;
    log::info!(
        target: "app::resource_pack",
        "event=installed sha256={} bytes={}",
        manifest.archive_sha256,
        manifest.archive_size
    );
    Ok(())
}

pub(crate) fn load_catalog(asset_dir: &Path) -> Result<Option<AssetCatalog>, String> {
    let path = asset_dir.join("resource-pack").join("catalog.json");
    let bytes = match std::fs::read(&path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("读取本地资源包目录失败: {error}")),
    };
    if bytes.is_empty() || bytes.len() as u64 > MAX_CATALOG_BYTES {
        return Err("本地资源包目录大小异常".to_string());
    }
    let catalog: AssetCatalog = serde_json::from_slice(&bytes)
        .map_err(|error| format!("解析本地资源包目录失败: {error}"))?;
    validate_catalog_shape(&catalog)?;
    Ok(Some(catalog))
}

fn install_archive(
    asset_dir: &Path,
    manifest: &ResourceManifest,
    archive: &[u8],
) -> Result<(), String> {
    std::fs::create_dir_all(asset_dir).map_err(|error| format!("创建素材目录失败: {error}"))?;
    let staging = asset_dir.join("resource-pack.installing");
    if staging.exists() {
        std::fs::remove_dir_all(&staging)
            .map_err(|error| format!("清理资源包临时目录失败: {error}"))?;
    }
    std::fs::create_dir_all(&staging)
        .map_err(|error| format!("创建资源包临时目录失败: {error}"))?;

    let result = (|| {
        extract_archive(archive, &staging)?;
        let catalog_path = staging.join("catalog.json");
        let catalog_bytes = std::fs::read(&catalog_path)
            .map_err(|error| format!("资源包缺少 catalog.json: {error}"))?;
        if catalog_bytes.is_empty() || catalog_bytes.len() as u64 > MAX_CATALOG_BYTES {
            return Err("资源包 catalog.json 大小异常".to_string());
        }
        let catalog: AssetCatalog = serde_json::from_slice(&catalog_bytes)
            .map_err(|error| format!("资源包 catalog.json 无效: {error}"))?;
        validate_staged_pack(&catalog, &staging)?;

        let icons_dir = asset_dir.join("icons");
        std::fs::create_dir_all(&icons_dir)
            .map_err(|error| format!("创建统一图片目录失败: {error}"))?;
        for resource_id in catalog.icons.keys() {
            let bytes = std::fs::read(staging.join("icons").join(format!("{resource_id}.webp")))
                .map_err(|error| format!("读取资源包图片 {resource_id} 失败: {error}"))?;
            atomic_write_replace(&icons_dir.join(format!("{resource_id}.webp")), &bytes)?;
        }
        cleanup_legacy_icons(&icons_dir, catalog.icons.keys().copied())?;
        let portraits_dir = asset_dir.join("portraits");
        std::fs::create_dir_all(&portraits_dir)
            .map_err(|error| format!("创建角色立绘目录失败: {error}"))?;
        for resource_id in catalog.portraits.keys() {
            let bytes = std::fs::read(
                staging
                    .join("portraits")
                    .join(format!("{resource_id}.webp")),
            )
            .map_err(|error| format!("读取资源包立绘 {resource_id} 失败: {error}"))?;
            atomic_write_replace(&portraits_dir.join(format!("{resource_id}.webp")), &bytes)?;
        }

        let metadata_dir = asset_dir.join("resource-pack");
        std::fs::create_dir_all(&metadata_dir)
            .map_err(|error| format!("创建资源包状态目录失败: {error}"))?;
        atomic_write_replace(&metadata_dir.join("catalog.json"), &catalog_bytes)?;
        let manifest_bytes =
            serde_json::to_vec_pretty(manifest).map_err(|error| error.to_string())?;
        atomic_write_replace(&metadata_dir.join("manifest.json"), &manifest_bytes)
    })();

    let _ = std::fs::remove_dir_all(&staging);
    result
}

fn cleanup_legacy_icons(
    icons_dir: &Path,
    resource_ids: impl IntoIterator<Item = i64>,
) -> Result<(), String> {
    let ids: std::collections::HashSet<String> = resource_ids
        .into_iter()
        .map(|id| format!("{id}-"))
        .collect();
    let entries =
        std::fs::read_dir(icons_dir).map_err(|error| format!("读取旧版素材目录失败: {error}"))?;
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.ends_with(".webp") {
            continue;
        }
        let Some((prefix, hash)) = name
            .strip_suffix(".webp")
            .and_then(|value| value.split_once('-'))
        else {
            continue;
        };
        if ids.contains(&format!("{prefix}-"))
            && !hash.is_empty()
            && hash.chars().all(|character| character.is_ascii_hexdigit())
        {
            std::fs::remove_file(&path)
                .map_err(|error| format!("清理旧版素材 {} 失败: {error}", path.display()))?;
        }
    }
    Ok(())
}

fn extract_archive(archive: &[u8], output_dir: &Path) -> Result<(), String> {
    let mut zip = zip::ZipArchive::new(Cursor::new(archive))
        .map_err(|error| format!("资源包压缩文件无效: {error}"))?;
    if zip.len() == 0 || zip.len() > MAX_ARCHIVE_ENTRIES {
        return Err("资源包文件数量异常".to_string());
    }

    let mut total_size = 0_u64;
    for index in 0..zip.len() {
        let mut entry = zip
            .by_index(index)
            .map_err(|error| format!("读取资源包条目失败: {error}"))?;
        let enclosed = entry
            .enclosed_name()
            .ok_or_else(|| "资源包包含不安全路径".to_string())?
            .to_path_buf();
        let relative = enclosed.strip_prefix("resource-pack").unwrap_or(&enclosed);
        let relative_text = relative.to_string_lossy().replace('\\', "/");
        if relative_text.is_empty() || entry.is_dir() {
            continue;
        }
        let is_catalog = relative_text == "catalog.json";
        let is_icon = is_valid_icon_path(&relative_text);
        let is_portrait = is_valid_portrait_path(&relative_text);
        if !is_catalog && !is_icon && !is_portrait {
            return Err(format!("资源包包含未知文件: {relative_text}"));
        }
        let limit = if is_catalog {
            MAX_CATALOG_BYTES
        } else if is_portrait {
            MAX_PORTRAIT_BYTES
        } else {
            MAX_ICON_BYTES
        };
        if entry.size() == 0 || entry.size() > limit {
            return Err(format!("资源包文件大小异常: {relative_text}"));
        }
        total_size = total_size.saturating_add(entry.size());
        if total_size > MAX_EXTRACTED_BYTES {
            return Err("资源包解压后超过大小限制".to_string());
        }
        let output = output_dir.join(relative);
        if let Some(parent) = output.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("创建资源包目录失败: {error}"))?;
        }
        let mut file =
            File::create(&output).map_err(|error| format!("创建资源包文件失败: {error}"))?;
        let copied = std::io::copy(&mut entry.by_ref().take(limit + 1), &mut file)
            .map_err(|error| format!("解压资源包文件失败: {error}"))?;
        if copied == 0 || copied > limit {
            return Err(format!("资源包文件解压大小异常: {relative_text}"));
        }
    }
    Ok(())
}

fn validate_staged_pack(catalog: &AssetCatalog, dir: &Path) -> Result<(), String> {
    validate_catalog_shape(catalog)?;
    for resource_id in catalog.icons.keys() {
        let path = dir.join("icons").join(format!("{resource_id}.webp"));
        let bytes = std::fs::read(&path)
            .map_err(|_| format!("资源包缺少 catalog 声明的图片 {resource_id}"))?;
        if bytes.len() as u64 > MAX_ICON_BYTES || !is_webp(&bytes) {
            return Err(format!("资源包图片 {resource_id} 无效"));
        }
    }
    for resource_id in catalog.portraits.keys() {
        let path = dir.join("portraits").join(format!("{resource_id}.webp"));
        let bytes = std::fs::read(&path)
            .map_err(|_| format!("资源包缺少 catalog 声明的立绘 {resource_id}"))?;
        if bytes.len() as u64 > MAX_PORTRAIT_BYTES || !is_webp(&bytes) {
            return Err(format!("资源包立绘 {resource_id} 无效"));
        }
    }
    Ok(())
}

fn validate_catalog_shape(catalog: &AssetCatalog) -> Result<(), String> {
    if catalog.version.trim().is_empty() || catalog.resources.is_empty() || catalog.icons.is_empty()
    {
        return Err("资源包目录内容为空".to_string());
    }
    if !catalog.resources.iter().all(|resource| {
        resource.resource_id > 0
            && (3..=5).contains(&resource.quality_level)
            && matches!(resource.resource_type.as_str(), "role" | "weapon")
            && !resource.name.trim().is_empty()
    }) {
        return Err("资源包物品目录包含无效数据".to_string());
    }
    if !catalog
        .icons
        .iter()
        .all(|(id, path)| *id > 0 && path == &format!("{id}.webp"))
    {
        return Err("资源包图片路径无效".to_string());
    }
    if !catalog
        .portraits
        .iter()
        .all(|(id, path)| *id > 0 && path == &format!("{id}.webp"))
    {
        return Err("资源包立绘路径无效".to_string());
    }
    Ok(())
}

fn validate_manifest(manifest: &ResourceManifest) -> Result<(), String> {
    if manifest.schema != 1
        || manifest.archive_size == 0
        || manifest.archive_size > MAX_ARCHIVE_BYTES
        || !is_sha256(&manifest.archive_sha256)
    {
        return Err("资源包清单校验信息无效".to_string());
    }
    let parsed =
        url::Url::parse(&manifest.archive_url).map_err(|_| "资源包下载地址无效".to_string())?;
    let path = parsed.path();
    if parsed.scheme() != "https"
        || parsed.host_str() != Some("github.com")
        || !path.starts_with("/juliy819/wuwa-gacha-tool-resources/releases/download/resources-")
        || !path.ends_with("/resource-pack.zip")
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err("资源包下载地址不在允许范围内".to_string());
    }
    Ok(())
}

async fn fetch_github_bytes(
    client: &reqwest::Client,
    url: &str,
    max_size: u64,
) -> Result<Vec<u8>, String> {
    let mut errors = Vec::new();
    for (source, candidate) in github_download_sources(url) {
        match fetch_bytes_once(client, &candidate, max_size).await {
            Ok(bytes) => {
                log::info!(target: "app::resource_pack", "event=download_succeeded source={source} bytes={}", bytes.len());
                return Ok(bytes);
            }
            Err(error) => errors.push(format!("{source}: {error}")),
        }
    }
    Err(format!("资源包下载失败: {}", errors.join("; ")))
}

async fn fetch_bytes_once(
    client: &reqwest::Client,
    url: &str,
    max_size: u64,
) -> Result<Vec<u8>, String> {
    let mut response =
        tokio::time::timeout(std::time::Duration::from_secs(5), client.get(url).send())
            .await
            .map_err(|_| "连接超时".to_string())?
            .map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }
    if response
        .content_length()
        .is_some_and(|length| length > max_size)
    {
        return Err("响应超过大小限制".to_string());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|error| error.to_string())? {
        if bytes.len().saturating_add(chunk.len()) as u64 > max_size {
            return Err("响应超过大小限制".to_string());
        }
        bytes.extend_from_slice(&chunk);
    }
    if bytes.is_empty() {
        return Err("响应为空".to_string());
    }
    Ok(bytes)
}

fn github_download_sources(url: &str) -> Vec<(&'static str, String)> {
    if !url.starts_with("https://github.com/") {
        return vec![("原始地址", url.to_string())];
    }
    vec![
        ("ghproxy.net", format!("https://ghproxy.net/{url}")),
        ("GitHub 官方", url.to_string()),
        (
            "cors.isteed.cc",
            format!(
                "https://cors.isteed.cc/{}",
                url.trim_start_matches("https://")
            ),
        ),
        ("hk.gh-proxy.org", format!("https://hk.gh-proxy.org/{url}")),
        (
            "cdn.gh-proxy.org",
            format!("https://cdn.gh-proxy.org/{url}"),
        ),
        (
            "edgeone.gh-proxy.org",
            format!("https://edgeone.gh-proxy.org/{url}"),
        ),
    ]
}

fn load_installed_manifest(asset_dir: &Path) -> Option<ResourceManifest> {
    let bytes = std::fs::read(asset_dir.join("resource-pack").join("manifest.json")).ok()?;
    serde_json::from_slice(&bytes).ok()
}

fn atomic_write_replace(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "目标路径无父目录".to_string())?;
    std::fs::create_dir_all(parent).map_err(|error| format!("创建目标目录失败: {error}"))?;
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "目标文件名无效".to_string())?;
    let temp = parent.join(format!(".{name}.{}.tmp", std::process::id()));
    let backup = parent.join(format!(".{name}.{}.old", std::process::id()));
    let _ = std::fs::remove_file(&temp);
    let _ = std::fs::remove_file(&backup);
    let mut file = File::create(&temp).map_err(|error| format!("创建临时文件失败: {error}"))?;
    file.write_all(bytes)
        .map_err(|error| format!("写入临时文件失败: {error}"))?;
    file.flush()
        .map_err(|error| format!("提交临时文件失败: {error}"))?;

    if !path.exists() {
        return std::fs::rename(&temp, path).map_err(|error| format!("提交文件失败: {error}"));
    }
    std::fs::rename(path, &backup).map_err(|error| format!("备份旧文件失败: {error}"))?;
    if let Err(error) = std::fs::rename(&temp, path) {
        let _ = std::fs::rename(&backup, path);
        let _ = std::fs::remove_file(&temp);
        return Err(format!("提交新文件失败: {error}"));
    }
    let _ = std::fs::remove_file(&backup);
    Ok(())
}

fn is_valid_icon_path(path: &str) -> bool {
    let Some(name) = path.strip_prefix("icons/") else {
        return false;
    };
    let Some(id) = name.strip_suffix(".webp") else {
        return false;
    };
    !id.is_empty() && id.bytes().all(|byte| byte.is_ascii_digit())
}

fn is_valid_portrait_path(path: &str) -> bool {
    let Some(name) = path.strip_prefix("portraits/") else {
        return false;
    };
    !name.contains('/')
        && name.strip_suffix(".webp").is_some_and(|id| {
            !id.is_empty() && id.chars().all(|character| character.is_ascii_digit())
        })
}

fn is_sha256(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn sha256_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn is_webp(bytes: &[u8]) -> bool {
    bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP"
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::assets::GachaResource;
    use std::path::PathBuf;

    fn test_dir(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "wuwa-resource-pack-{name}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    fn webp(marker: u8) -> Vec<u8> {
        let mut bytes = b"RIFFxxxxWEBP".to_vec();
        bytes.push(marker);
        bytes
    }

    fn catalog(icon_id: i64) -> AssetCatalog {
        AssetCatalog {
            version: "test".to_string(),
            icons: [(icon_id, format!("{icon_id}.webp"))].into(),
            portraits: std::collections::HashMap::new(),
            resources: vec![GachaResource {
                resource_id: icon_id,
                name: "测试资源".to_string(),
                quality_level: 5,
                resource_type: "role".to_string(),
            }],
        }
    }

    fn archive(
        catalog: &AssetCatalog,
        icon_id: i64,
        icon: Option<&[u8]>,
        portrait: Option<&[u8]>,
    ) -> Vec<u8> {
        let mut output = Cursor::new(Vec::new());
        {
            let mut zip = zip::ZipWriter::new(&mut output);
            let options = zip::write::SimpleFileOptions::default();
            zip.start_file("resource-pack/catalog.json", options)
                .unwrap();
            zip.write_all(&serde_json::to_vec(catalog).unwrap())
                .unwrap();
            if let Some(icon) = icon {
                zip.start_file(format!("resource-pack/icons/{icon_id}.webp"), options)
                    .unwrap();
                zip.write_all(icon).unwrap();
            }
            if let Some(portrait) = portrait {
                zip.start_file(format!("resource-pack/portraits/{icon_id}.webp"), options)
                    .unwrap();
                zip.write_all(portrait).unwrap();
            }
            zip.finish().unwrap();
        }
        output.into_inner()
    }

    fn manifest_for(archive: &[u8]) -> ResourceManifest {
        ResourceManifest {
            schema: 1,
            archive_url: "https://github.com/juliy819/wuwa-gacha-tool-resources/releases/download/resources-1/resource-pack.zip".to_string(),
            archive_sha256: sha256_hex(archive),
            archive_size: archive.len() as u64,
        }
    }

    #[test]
    fn installs_icons_into_the_single_shared_directory() {
        let root = test_dir("install");
        let icon = webp(1);
        let portrait = webp(2);
        let mut catalog = catalog(1104);
        catalog.portraits.insert(1104, "1104.webp".to_string());
        let archive = archive(&catalog, 1104, Some(&icon), Some(&portrait));
        install_archive(&root, &manifest_for(&archive), &archive).unwrap();

        assert_eq!(std::fs::read(root.join("icons/1104.webp")).unwrap(), icon);
        assert_eq!(
            std::fs::read(root.join("portraits/1104.webp")).unwrap(),
            portrait
        );
        assert!(root.join("resource-pack/catalog.json").is_file());
        assert!(!root.join("resource-pack/icons/1104.webp").exists());
        assert!(!root.join("resource-pack.installing").exists());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn cleans_legacy_hashed_icons_after_pack_install() {
        let root = test_dir("legacy-cleanup");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("1104.webp"), webp(1)).unwrap();
        std::fs::write(root.join("1104-abcdef0123456789.webp"), webp(1)).unwrap();
        std::fs::write(root.join("9999-abcdef0123456789.webp"), webp(1)).unwrap();

        cleanup_legacy_icons(&root, [1104]).unwrap();

        assert!(root.join("1104.webp").exists());
        assert!(!root.join("1104-abcdef0123456789.webp").exists());
        assert!(root.join("9999-abcdef0123456789.webp").exists());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn invalid_new_pack_keeps_existing_catalog_and_icon() {
        let root = test_dir("preserve");
        std::fs::create_dir_all(root.join("resource-pack")).unwrap();
        std::fs::create_dir_all(root.join("icons")).unwrap();
        let old_catalog = serde_json::to_vec(&catalog(1104)).unwrap();
        let old_icon = webp(1);
        std::fs::write(root.join("resource-pack/catalog.json"), &old_catalog).unwrap();
        std::fs::write(root.join("icons/1104.webp"), &old_icon).unwrap();

        let invalid = archive(&catalog(1203), 1203, None, None);
        assert!(install_archive(&root, &manifest_for(&invalid), &invalid).is_err());
        assert_eq!(
            std::fs::read(root.join("resource-pack/catalog.json")).unwrap(),
            old_catalog
        );
        assert_eq!(
            std::fs::read(root.join("icons/1104.webp")).unwrap(),
            old_icon
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_unsafe_manifest_urls_and_icon_paths() {
        let mut manifest = manifest_for(b"archive");
        manifest.archive_url = "https://example.com/resource-pack.zip".to_string();
        assert!(validate_manifest(&manifest).is_err());
        assert!(is_valid_icon_path("icons/1104.webp"));
        assert!(!is_valid_icon_path("icons/../1104.webp"));
        assert!(!is_valid_icon_path("other/1104.webp"));
        assert!(is_valid_portrait_path("portraits/1104.webp"));
        assert!(!is_valid_portrait_path("portraits/../1104.webp"));
    }

    #[tokio::test]
    #[ignore = "requires the public GitHub Release"]
    async fn installs_the_public_release_end_to_end() {
        let root = test_dir("online");
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .unwrap();
        refresh_inner(&client, &root).await.unwrap();
        let catalog = load_catalog(&root).unwrap().unwrap();
        assert!(catalog.resources.len() >= 100);
        assert!(catalog.icons.len() >= 100);
        assert_eq!(
            std::fs::read_dir(root.join("icons")).unwrap().count(),
            catalog.icons.len()
        );

        // 远程更新失败不会参与本地读取，已安装 catalog 和统一目录仍然可用。
        let offline = reqwest::Client::builder()
            .proxy(reqwest::Proxy::all("http://127.0.0.1:9").unwrap())
            .timeout(std::time::Duration::from_secs(1))
            .build()
            .unwrap();
        assert!(
            fetch_github_bytes(&offline, RESOURCE_MANIFEST_URL, MAX_MANIFEST_BYTES)
                .await
                .is_err()
        );
        assert!(load_catalog(&root).unwrap().is_some());
        assert_eq!(
            std::fs::read_dir(root.join("icons")).unwrap().count(),
            catalog.icons.len()
        );
        std::fs::remove_dir_all(root).unwrap();
    }
}
