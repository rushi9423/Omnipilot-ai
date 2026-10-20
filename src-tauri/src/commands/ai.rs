use tauri::ipc::Channel;
use tauri::State;
use crate::models::ai::{
    AiProviderType, AiStatusInfo, StreamAiAnswerRequest, StreamChatRequest, StreamEvent,
    ValidationResult,
};
use crate::services::ai_service::AiService;

#[tauri::command]
pub async fn get_ai_readiness(
    ai_service: State<'_, AiService>,
) -> Result<AiStatusInfo, String> {
    Ok(ai_service.get_status())
}

#[tauri::command]
pub async fn set_ai_provider(
    provider: AiProviderType,
    ai_service: State<'_, AiService>,
) -> Result<AiStatusInfo, String> {
    ai_service.set_provider(provider)
}

#[tauri::command]
pub async fn validate_ai_provider_config(
    provider: AiProviderType,
    model: Option<String>,
    endpoint: Option<String>,
    ai_service: State<'_, AiService>,
) -> Result<ValidationResult, String> {
    Ok(ai_service.validate_provider_config(provider, model.as_deref(), endpoint.as_deref()))
}

#[tauri::command]
pub async fn save_api_key(
    key: String,
    ai_service: State<'_, AiService>,
) -> Result<AiStatusInfo, String> {
    ai_service.save_api_key(&key)
}

#[tauri::command]
pub async fn save_provider_api_key(
    provider: AiProviderType,
    key: String,
    ai_service: State<'_, AiService>,
) -> Result<AiStatusInfo, String> {
    ai_service.save_provider_api_key(provider, &key)
}

#[tauri::command]
pub async fn delete_api_key(
    ai_service: State<'_, AiService>,
) -> Result<AiStatusInfo, String> {
    ai_service.delete_api_key()
}

#[tauri::command]
pub async fn delete_provider_api_key(
    provider: AiProviderType,
    ai_service: State<'_, AiService>,
) -> Result<AiStatusInfo, String> {
    ai_service.delete_provider_api_key(provider)
}

#[tauri::command]
pub async fn set_ai_model(
    model: String,
    ai_service: State<'_, AiService>,
) -> Result<AiStatusInfo, String> {
    ai_service.set_model(&model)
}

#[tauri::command]
pub async fn set_provider_ai_model(
    provider: AiProviderType,
    model: String,
    ai_service: State<'_, AiService>,
) -> Result<AiStatusInfo, String> {
    ai_service.set_provider_model(provider, &model)
}

#[tauri::command]
pub async fn set_ai_endpoint(
    endpoint: String,
    ai_service: State<'_, AiService>,
) -> Result<AiStatusInfo, String> {
    ai_service.set_endpoint(&endpoint)
}

#[tauri::command]
pub async fn set_provider_ai_endpoint(
    provider: AiProviderType,
    endpoint: String,
    ai_service: State<'_, AiService>,
) -> Result<AiStatusInfo, String> {
    ai_service.set_provider_endpoint(provider, &endpoint)
}

#[tauri::command]
pub async fn verify_ai_provider_connection(
    provider: Option<AiProviderType>,
    ai_service: State<'_, AiService>,
) -> Result<AiStatusInfo, String> {
    ai_service.verify_provider_connection(provider).await
}

#[tauri::command]
pub async fn cancel_stream(
    request_id: String,
    ai_service: State<'_, AiService>,
) -> Result<bool, String> {
    Ok(ai_service.cancel_stream(&request_id))
}

#[tauri::command]
pub async fn stream_ai_answer(
    request: StreamAiAnswerRequest,
    on_event: Channel<StreamEvent>,
    ai_service: State<'_, AiService>,
) -> Result<(), String> {
    ai_service
        .stream_answer_internal(request, move |event| {
            on_event.send(event).map_err(|e| e.to_string())
        })
        .await
}

#[tauri::command]
pub async fn stream_chat_completion(
    request: StreamChatRequest,
    on_event: Channel<StreamEvent>,
    ai_service: State<'_, AiService>,
) -> Result<(), String> {
    ai_service
        .stream_chat_internal(request, move |event| {
            on_event.send(event).map_err(|e| e.to_string())
        })
        .await
}
