// Prevents additional console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

pub mod commands;
pub mod models;
pub mod services;

use commands::ai::{
    cancel_stream, delete_api_key, delete_provider_api_key, get_ai_readiness, save_api_key,
    save_provider_api_key, set_ai_endpoint, set_ai_model, set_ai_provider,
    set_provider_ai_endpoint, set_provider_ai_model, stream_ai_answer,
    stream_chat_completion, validate_ai_provider_config, verify_ai_provider_connection,
};
use commands::health::get_backend_status;
use services::ai_service::AiService;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let ai_service = AiService::new();

    tauri::Builder::default()
        .manage(ai_service)
        .invoke_handler(tauri::generate_handler![
            get_backend_status,
            get_ai_readiness,
            set_ai_provider,
            validate_ai_provider_config,
            save_api_key,
            save_provider_api_key,
            delete_api_key,
            delete_provider_api_key,
            set_ai_model,
            set_provider_ai_model,
            set_ai_endpoint,
            set_provider_ai_endpoint,
            verify_ai_provider_connection,
            cancel_stream,
            stream_ai_answer,
            stream_chat_completion,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
