mod commands;
mod db;
mod gacha;

use std::sync::Mutex;

pub struct AppState {
    pub db: Mutex<db::Database>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app_data_dir = dirs::data_local_dir()
        .expect("Failed to get app data dir")
        .join("wuwa-gacha-tool");

    std::fs::create_dir_all(&app_data_dir).expect("Failed to create app data dir");

    let db_path = app_data_dir.join("gacha.db");
    let database = db::Database::new(&db_path).expect("Failed to initialize database");

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            db: Mutex::new(database),
        })
        .invoke_handler(tauri::generate_handler![
            commands::gacha::decode_log,
            commands::gacha::fetch_gacha_data,
            commands::gacha::fetch_gacha_data_by_url,
            commands::gacha::import_gacha_json,
            commands::gacha::get_all_records,
            commands::gacha::get_pools,
            commands::gacha::get_stats,
            commands::gacha::clear_records,
            commands::gacha::save_game_dir,
            commands::gacha::get_game_dir,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
