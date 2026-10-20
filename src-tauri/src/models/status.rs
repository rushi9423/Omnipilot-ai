use serde::{Deserialize, Serialize};
use super::ai::AiStatusInfo;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HealthState {
    Healthy,
    Degraded,
    Unavailable,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BackendStatusResponse {
    pub app_name: String,
    pub app_version: String,
    pub status: HealthState,
    pub is_tauri: bool,
    pub os: String,
    pub ai: AiStatusInfo,
    pub timestamp_ms: u64,
}
