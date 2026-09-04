mod assets;
mod commands;
mod db;
mod gacha;
mod logging;
mod onedrive;
mod resource_pack;
mod sync;

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Instant;

use tauri::Manager;

pub struct AppState {
    pub db: Mutex<db::Database>,
    pub http: reqwest::Client,
    pub asset_cache_dir: PathBuf,
    pub asset_catalog_refresh: tokio::sync::Mutex<()>,
    pub resource_pack_refresh: tokio::sync::Mutex<()>,
    pub resource_pack_last_error: Mutex<Option<String>>,
    pub resource_pack_progress: Mutex<resource_pack::ResourcePackProgress>,
    pub app_data_dir: PathBuf,
    pub onedrive: tokio::sync::Mutex<onedrive::OneDriveState>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    logging::install_panic_hook();

    tauri::Builder::default()
        .plugin(logging::plugin())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            #[cfg(desktop)]
            {
                app.handle()
                    .plugin(tauri_plugin_updater::Builder::new().build())?;
                app.handle().plugin(tauri_plugin_process::init())?;
            }

            let app_data_dir = dirs::data_local_dir()
                .ok_or_else(|| "Failed to get app data dir".to_string())?
                .join("wuwa-gacha-tool");
            std::fs::create_dir_all(&app_data_dir)?;

            let legacy_path = app_data_dir.join("gacha.db");
            let db_path = app_data_dir.join("gacha-data.db");
            let state_path = app_data_dir.join("app-state.db");
            db::Database::migrate_legacy_files(&legacy_path, &db_path, &state_path)
                .map_err(|error| format!("Failed to migrate database: {error}"))?;
            let database_started = Instant::now();
            let database = db::Database::new_with_state(&db_path, &state_path)
                .map_err(|error| format!("Failed to initialize database: {error}"))?;
            log::info!(
                target: "app::performance",
                "event=database_initialized duration_ms={}",
                database_started.elapsed().as_millis()
            );
            let http = reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(20))
                .build()
                .map_err(|error| format!("Failed to initialize HTTP client: {error}"))?;

            app.manage(AppState {
                db: Mutex::new(database),
                http,
                asset_cache_dir: app_data_dir.join("assets"),
                asset_catalog_refresh: tokio::sync::Mutex::new(()),
                resource_pack_refresh: tokio::sync::Mutex::new(()),
                resource_pack_last_error: Mutex::new(None),
                resource_pack_progress: Mutex::new(resource_pack::ResourcePackProgress::default()),
                app_data_dir,
                onedrive: tokio::sync::Mutex::new(onedrive::OneDriveState::default()),
            });
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                // 资源包不是首屏依赖，延迟检查避免与数据库和 WebView 初始化争抢资源。
                tokio::time::sleep(std::time::Duration::from_secs(3)).await;
                let state = app_handle.state::<AppState>();
                if let Err(error) = resource_pack::refresh(&state).await {
                    log::warn!(
                        target: "app::resource_pack",
                        "event=background_refresh_failed fallback=local_or_nanoka error={}",
                        logging::sanitize_message(&error)
                    );
                }
            });
            log::info!(
                target: "app::lifecycle",
                "event=started version={} os={} arch={}",
                app.package_info().version,
                std::env::consts::OS,
                std::env::consts::ARCH
            );
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            logging::open_log_directory,
            logging::open_backup_directory,
            commands::cloud_gacha::open_cloud_gacha_window,
            commands::cloud_gacha::close_cloud_gacha_window,
            commands::sync::prepare_sync_payload,
            commands::sync::apply_cloud_sync_payload,
            commands::onedrive::get_onedrive_status,
            commands::onedrive::start_onedrive_login,
            commands::onedrive::poll_onedrive_login,
            commands::onedrive::cancel_onedrive_login,
            commands::onedrive::disconnect_onedrive,
            commands::onedrive::sync_onedrive_uid,
            commands::onedrive::sync_onedrive_database,
            commands::gacha::get_resource_icon,
            commands::gacha::get_resource_portrait,
            commands::gacha::get_gacha_resources,
            commands::gacha::insert_mock_gacha,
            commands::gacha::insert_mock_fillers,
            commands::gacha::complete_pool_boundary,
            commands::gacha::update_mock_gacha,
            commands::gacha::delete_mock_gacha,
            commands::ocr::recognize_gacha_screenshots,
            commands::ocr::get_ocr_component_status,
            commands::ocr::check_ocr_component_update,
            commands::ocr::install_ocr_component,
            commands::ocr::remove_ocr_component,
            commands::ocr::import_ocr_gacha_rows,
            commands::gacha::decode_log,
            commands::gacha::fetch_gacha_data,
            commands::gacha::fetch_gacha_data_by_url,
            commands::gacha::import_gacha_json,
            commands::gacha::preview_gacha_json_import,
            commands::gacha::get_all_records,
            commands::gacha::export_gacha_json,
            commands::gacha::get_pools,
            commands::gacha::get_record_summaries,
            commands::gacha::get_stats,
            commands::gacha::get_home_overview,
            commands::gacha::get_gacha_insights,
            commands::gacha::get_character_pull_insights,
            commands::gacha::get_resource_acquisition_insights,
            commands::gacha::get_pool_boundary_statuses,
            commands::gacha::set_pool_boundary_confirmed,
            commands::gacha::clear_records,
            commands::gacha::save_game_dir,
            commands::gacha::get_game_dir,
            commands::gacha::validate_game_dir,
            commands::updater::download_and_install_update,
            resource_pack::get_resource_pack_status,
            resource_pack::refresh_resource_pack,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
