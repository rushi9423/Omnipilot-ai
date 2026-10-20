use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;
use crate::models::status::{BackendStatusResponse, HealthState};
use crate::services::ai_service::AiService;

#[tauri::command]
pub async fn get_backend_status(
    ai_service: State<'_, AiService>,
) -> Result<BackendStatusResponse, String> {
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    let ai_info = ai_service.get_status();

    Ok(BackendStatusResponse {
        app_name: "OmniPilot AI".to_string(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        status: HealthState::Healthy,
        is_tauri: true,
        os: std::env::consts::OS.to_string(),
        ai: ai_info,
        timestamp_ms: now_ms,
    })
}
