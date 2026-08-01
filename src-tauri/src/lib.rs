mod assets;
mod commands;
mod db;
mod gacha;

use std::sync::Mutex;
use std::path::PathBuf;

pub struct AppState {
    pub db: Mutex<db::Database>,
    pub http: reqwest::Client,
    pub asset_cache_dir: PathBuf,
    pub asset_catalog_refresh: tokio::sync::Mutex<()>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app_data_dir = dirs::data_local_dir()
        .expect("Failed to get app data dir")
        .join("wuwa-gacha-tool");

    std::fs::create_dir_all(&app_data_dir).expect("Failed to create app data dir");

    let db_path = app_data_dir.join("gacha.db");
    let database = db::Database::new(&db_path).expect("Failed to initialize database");
    let asset_cache_dir = app_data_dir.join("assets");
    let http = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .expect("Failed to initialize HTTP client");

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            #[cfg(desktop)]
            {
                app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
                app.handle().plugin(tauri_plugin_process::init())?;
            }
            Ok(())
        })
        .manage(AppState {
            db: Mutex::new(database),
            http,
            asset_cache_dir,
            asset_catalog_refresh: tokio::sync::Mutex::new(()),
        })
        .invoke_handler(tauri::generate_handler![
            commands::gacha::get_resource_icon,
            commands::gacha::get_gacha_resources,
            commands::gacha::insert_mock_gacha,
            commands::gacha::update_mock_gacha,
            commands::gacha::delete_mock_gacha,
            commands::gacha::decode_log,
            commands::gacha::fetch_gacha_data,
            commands::gacha::fetch_gacha_data_by_url,
            commands::gacha::import_gacha_json,
            commands::gacha::get_all_records,
            commands::gacha::export_gacha_json,
            commands::gacha::get_pools,
            commands::gacha::get_record_summaries,
            commands::gacha::get_stats,
            commands::gacha::clear_records,
            commands::gacha::save_game_dir,
            commands::gacha::get_game_dir,
            commands::gacha::validate_game_dir,
            commands::updater::download_and_install_update,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
