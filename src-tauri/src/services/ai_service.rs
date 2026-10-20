use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, RwLock};
use serde::{Deserialize, Serialize};
use crate::models::ai::{
    AiProviderType, AiReadinessState, AiStatusInfo, ChatMessage, StreamAiAnswerRequest,
    StreamChatRequest, StreamEvent, ValidationResult,
};
use crate::services::credential_service::{
    validate_provider_api_key_format, CredentialStorage, KeyringCredentialStore,
};
use crate::services::gemini_service::{GeminiClient, DEFAULT_GEMINI_MODEL};
use crate::services::ollama_service::{
    OllamaClient, DEFAULT_OLLAMA_ENDPOINT, DEFAULT_OLLAMA_MODEL,
};
use crate::services::openai_service::{OpenAiClient, DEFAULT_OPENAI_MODEL};

/// Returns true if a Gemini model ID is retired or obsolete.
pub fn is_gemini_model_obsolete(model: &str) -> bool {
    let trimmed = model.trim();
    trimmed.is_empty()
        || trimmed == "gemini-2.0-flash"
        || trimmed == "gemini-2.0-flash-lite"
        || trimmed == "gemini-1.5-flash"
        || trimmed == "gemini-1.5-pro"
        || trimmed.starts_with("gemini-1.5")
        || trimmed.starts_with("gemini-2.0")
}

/// Normalizes a Gemini model ID, safely migrating obsolete models to DEFAULT_GEMINI_MODEL (`gemini-3.8-flash`).
pub fn normalize_gemini_model(model: &str) -> String {
    let trimmed = model.trim();
    if is_gemini_model_obsolete(trimmed) {
        DEFAULT_GEMINI_MODEL.to_string()
    } else {
        trimmed.to_string()
    }
}

fn default_ollama_model() -> String {
    DEFAULT_OLLAMA_MODEL.to_string()
}

fn default_ollama_endpoint() -> String {
    DEFAULT_OLLAMA_ENDPOINT.to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PersistedAiConfig {
    pub active_provider: AiProviderType,
    pub gemini_model: String,
    pub openai_model: String,
    #[serde(default = "default_ollama_model")]
    pub ollama_model: String,
    #[serde(default = "default_ollama_endpoint")]
    pub ollama_endpoint: String,
}

impl Default for PersistedAiConfig {
    fn default() -> Self {
        Self {
            active_provider: AiProviderType::Ollama,
            gemini_model: DEFAULT_GEMINI_MODEL.to_string(),
            openai_model: DEFAULT_OPENAI_MODEL.to_string(),
            ollama_model: DEFAULT_OLLAMA_MODEL.to_string(),
            ollama_endpoint: DEFAULT_OLLAMA_ENDPOINT.to_string(),
        }
    }
}

impl PersistedAiConfig {
    pub fn load_from_file(path: &Path) -> Option<Self> {
        let content = std::fs::read_to_string(path).ok()?;
        let mut config: Self = serde_json::from_str(&content).ok()?;
        let mut should_resave = false;

        // Legacy config migration: if config was written before Ollama integration, default to Ollama
        if !content.contains("ollamaModel") {
            config.active_provider = AiProviderType::Ollama;
            should_resave = true;
        }

        if is_gemini_model_obsolete(&config.gemini_model) {
            config.gemini_model = DEFAULT_GEMINI_MODEL.to_string();
            should_resave = true;
        }

        if config.ollama_model.trim().is_empty() {
            config.ollama_model = DEFAULT_OLLAMA_MODEL.to_string();
            should_resave = true;
        }

        if config.ollama_endpoint.trim().is_empty() {
            config.ollama_endpoint = DEFAULT_OLLAMA_ENDPOINT.to_string();
            should_resave = true;
        }

        if should_resave {
            let _ = config.save_to_file(path);
        }

        Some(config)
    }

    pub fn save_to_file(&self, path: &Path) -> Result<(), String> {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let json = serde_json::to_string_pretty(self)
            .map_err(|e| format!("Serialization error: {}", e))?;
        std::fs::write(path, json)
            .map_err(|e| format!("Failed to write config file to {:?}: {}", path, e))
    }
}

pub fn get_default_config_path() -> Option<PathBuf> {
    if let Ok(appdata) = std::env::var("APPDATA") {
        let dir = PathBuf::from(appdata).join("OmniPilotAI");
        Some(dir.join("settings.json"))
    } else {
        None
    }
}

pub struct AiServiceState {
    pub provider: AiProviderType,
    pub openai_model: String,
    pub gemini_model: String,
    pub ollama_model: String,
    pub ollama_endpoint: String,
    pub endpoint: Option<String>,
    pub state: AiReadinessState,
    pub diagnostic_message: String,
}

impl Default for AiServiceState {
    fn default() -> Self {
        Self {
            provider: AiProviderType::Ollama,
            openai_model: DEFAULT_OPENAI_MODEL.to_string(),
            gemini_model: DEFAULT_GEMINI_MODEL.to_string(),
            ollama_model: DEFAULT_OLLAMA_MODEL.to_string(),
            ollama_endpoint: DEFAULT_OLLAMA_ENDPOINT.to_string(),
            endpoint: Some(DEFAULT_OLLAMA_ENDPOINT.to_string()),
            state: AiReadinessState::Configured,
            diagnostic_message: format!(
                "Local Ollama provider selected ({}). Model: '{}'. No API key required.",
                DEFAULT_OLLAMA_ENDPOINT, DEFAULT_OLLAMA_MODEL
            ),
        }
    }
}

pub struct AiService {
    credential_store: Arc<dyn CredentialStorage>,
    openai_client: Arc<OpenAiClient>,
    gemini_client: Arc<GeminiClient>,
    ollama_client: Arc<OllamaClient>,
    active_streams: Arc<RwLock<HashMap<String, Arc<AtomicBool>>>>,
    state: RwLock<AiServiceState>,
    config_path: Option<PathBuf>,
}

impl Default for AiService {
    fn default() -> Self {
        Self::new()
    }
}

impl AiService {
    pub fn new() -> Self {
        let store = Arc::new(KeyringCredentialStore::new());
        let openai_client = Arc::new(OpenAiClient::new());
        let gemini_client = Arc::new(GeminiClient::new());
        let ollama_client = Arc::new(OllamaClient::new());
        let config_path = get_default_config_path();
        Self::new_with_store_config_and_ollama(store, openai_client, gemini_client, ollama_client, config_path)
    }

    pub fn new_with_store(
        store: Arc<dyn CredentialStorage>,
        openai_client: Arc<OpenAiClient>,
        gemini_client: Arc<GeminiClient>,
    ) -> Self {
        let ollama_client = Arc::new(OllamaClient::new());
        Self::new_with_store_config_and_ollama(store, openai_client, gemini_client, ollama_client, None)
    }

    pub fn new_with_store_and_ollama(
        store: Arc<dyn CredentialStorage>,
        openai_client: Arc<OpenAiClient>,
        gemini_client: Arc<GeminiClient>,
        ollama_client: Arc<OllamaClient>,
    ) -> Self {
        Self::new_with_store_config_and_ollama(store, openai_client, gemini_client, ollama_client, None)
    }

    pub fn new_with_store_and_config(
        store: Arc<dyn CredentialStorage>,
        openai_client: Arc<OpenAiClient>,
        gemini_client: Arc<GeminiClient>,
        config_path: Option<PathBuf>,
    ) -> Self {
        let ollama_client = Arc::new(OllamaClient::new());
        Self::new_with_store_config_and_ollama(store, openai_client, gemini_client, ollama_client, config_path)
    }

    pub fn new_with_store_config_and_ollama(
        store: Arc<dyn CredentialStorage>,
        openai_client: Arc<OpenAiClient>,
        gemini_client: Arc<GeminiClient>,
        ollama_client: Arc<OllamaClient>,
        config_path: Option<PathBuf>,
    ) -> Self {
        let persisted = config_path.as_deref().and_then(PersistedAiConfig::load_from_file);

        let (initial_provider, gemini_model, openai_model, ollama_model, ollama_endpoint) = match persisted {
            Some(cfg) => (
                cfg.active_provider,
                normalize_gemini_model(&cfg.gemini_model),
                cfg.openai_model,
                if cfg.ollama_model.trim().is_empty() {
                    DEFAULT_OLLAMA_MODEL.to_string()
                } else {
                    cfg.ollama_model
                },
                if cfg.ollama_endpoint.trim().is_empty() {
                    DEFAULT_OLLAMA_ENDPOINT.to_string()
                } else {
                    cfg.ollama_endpoint
                },
            ),
            None => (
                AiProviderType::Ollama,
                DEFAULT_GEMINI_MODEL.to_string(),
                DEFAULT_OPENAI_MODEL.to_string(),
                DEFAULT_OLLAMA_MODEL.to_string(),
                DEFAULT_OLLAMA_ENDPOINT.to_string(),
            ),
        };

        if let Some(ref path) = config_path {
            if !path.exists() {
                let init_cfg = PersistedAiConfig {
                    active_provider: initial_provider,
                    gemini_model: gemini_model.clone(),
                    openai_model: openai_model.clone(),
                    ollama_model: ollama_model.clone(),
                    ollama_endpoint: ollama_endpoint.clone(),
                };
                let _ = init_cfg.save_to_file(path);
            }
        }

        let openai_configured = store.has_key_for_provider("openai").unwrap_or(false);
        let gemini_configured = store.has_key_for_provider("gemini").unwrap_or(false);

        let (state, diagnostic_message) = match initial_provider {
            AiProviderType::Ollama => (
                AiReadinessState::Configured,
                format!(
                    "Local Ollama provider selected ({}). Model: '{}'. No API key required.",
                    ollama_endpoint, ollama_model
                ),
            ),
            AiProviderType::Gemini if gemini_configured => (
                AiReadinessState::Configured,
                "Gemini credential securely stored in Windows Credential Manager. Ready for verified queries.".to_string(),
            ),
            AiProviderType::OpenAi if openai_configured => (
                AiReadinessState::Configured,
                "OpenAI credential securely stored in Windows Credential Manager. Ready for verified queries.".to_string(),
            ),
            _ => (
                AiReadinessState::Unconfigured,
                format!(
                    "{} provider selected. API key required. Please configure your {} API key in Settings.",
                    initial_provider, initial_provider
                ),
            ),
        };

        let initial_endpoint = match initial_provider {
            AiProviderType::Ollama => Some(ollama_endpoint.clone()),
            _ => None,
        };

        let initial_state = AiServiceState {
            provider: initial_provider,
            openai_model,
            gemini_model,
            ollama_model,
            ollama_endpoint,
            endpoint: initial_endpoint,
            state,
            diagnostic_message,
        };

        Self {
            credential_store: store,
            openai_client,
            gemini_client,
            ollama_client,
            active_streams: Arc::new(RwLock::new(HashMap::new())),
            state: RwLock::new(initial_state),
            config_path,
        }
    }

    fn persist_config(&self, lock: &AiServiceState) {
        if let Some(ref path) = self.config_path {
            let cfg = PersistedAiConfig {
                active_provider: lock.provider,
                gemini_model: lock.gemini_model.clone(),
                openai_model: lock.openai_model.clone(),
                ollama_model: lock.ollama_model.clone(),
                ollama_endpoint: lock.ollama_endpoint.clone(),
            };
            let _ = cfg.save_to_file(path);
        }
    }

    fn create_status_info(&self, lock: &AiServiceState) -> AiStatusInfo {
        let openai_configured = self.credential_store.has_key_for_provider("openai").unwrap_or(false);
        let gemini_configured = self.credential_store.has_key_for_provider("gemini").unwrap_or(false);

        let active_key_configured = match lock.provider {
            AiProviderType::Ollama => true,
            AiProviderType::OpenAi => openai_configured,
            AiProviderType::Gemini => gemini_configured,
            _ => false,
        };

        let active_model = match lock.provider {
            AiProviderType::Ollama => lock.ollama_model.clone(),
            AiProviderType::Gemini => lock.gemini_model.clone(),
            _ => lock.openai_model.clone(),
        };

        let active_endpoint = match lock.provider {
            AiProviderType::Ollama => Some(lock.ollama_endpoint.clone()),
            _ => lock.endpoint.clone(),
        };

        AiStatusInfo {
            state: lock.state,
            provider: lock.provider,
            model: Some(active_model),
            message: lock.diagnostic_message.clone(),
            key_configured: active_key_configured,
            endpoint: active_endpoint,
            openai_configured: Some(openai_configured),
            gemini_configured: Some(gemini_configured),
            ollama_configured: Some(true),
            openai_model: Some(lock.openai_model.clone()),
            gemini_model: Some(lock.gemini_model.clone()),
            ollama_model: Some(lock.ollama_model.clone()),
            ollama_endpoint: Some(lock.ollama_endpoint.clone()),
        }
    }

    pub fn get_status(&self) -> AiStatusInfo {
        let mut lock = self.state.write().unwrap();

        // Adjust state if active key was removed externally (for providers requiring an API key)
        if lock.provider != AiProviderType::Ollama {
            let key_exists = match lock.provider {
                AiProviderType::OpenAi => self.credential_store.has_key_for_provider("openai").unwrap_or(false),
                AiProviderType::Gemini => self.credential_store.has_key_for_provider("gemini").unwrap_or(false),
                _ => false,
            };

            if !key_exists && lock.state != AiReadinessState::Unconfigured {
                lock.state = AiReadinessState::Unconfigured;
                lock.diagnostic_message = format!(
                    "No {} API key stored in Windows Credential Manager.",
                    lock.provider
                );
            }
        }

        self.create_status_info(&lock)
    }

    pub fn set_provider(&self, provider: AiProviderType) -> Result<AiStatusInfo, String> {
        let openai_configured = self.credential_store.has_key_for_provider("openai").unwrap_or(false);
        let gemini_configured = self.credential_store.has_key_for_provider("gemini").unwrap_or(false);

        let mut lock = self.state.write().unwrap();
        lock.provider = provider;

        match provider {
            AiProviderType::Ollama => {
                lock.state = AiReadinessState::Configured;
                lock.diagnostic_message = format!(
                    "Local Ollama provider selected ({}). Model: '{}'. No API key required.",
                    lock.ollama_endpoint, lock.ollama_model
                );
                lock.endpoint = Some(lock.ollama_endpoint.clone());
            }
            AiProviderType::Gemini => {
                if gemini_configured {
                    lock.state = AiReadinessState::Configured;
                    lock.diagnostic_message = "Gemini provider selected. Credential loaded securely from Windows Credential Manager.".to_string();
                } else {
                    lock.state = AiReadinessState::Unconfigured;
                    lock.diagnostic_message = "Gemini provider selected. API key required. Please configure your Gemini API key in Settings.".to_string();
                }
                lock.endpoint = None;
            }
            AiProviderType::OpenAi => {
                if openai_configured {
                    lock.state = AiReadinessState::Configured;
                    lock.diagnostic_message = "OpenAI provider selected. Credential loaded securely from Windows Credential Manager.".to_string();
                } else {
                    lock.state = AiReadinessState::Unconfigured;
                    lock.diagnostic_message = "OpenAI provider selected. API key required. Please configure your OpenAI API key in Settings.".to_string();
                }
                lock.endpoint = None;
            }
            _ => {
                lock.state = AiReadinessState::Unconfigured;
                lock.diagnostic_message = format!("{} provider selected.", provider);
                lock.endpoint = None;
            }
        }

        self.persist_config(&lock);
        Ok(self.create_status_info(&lock))
    }

    pub fn save_provider_api_key(
        &self,
        provider: AiProviderType,
        key: &str,
    ) -> Result<AiStatusInfo, String> {
        let provider_str = match provider {
            AiProviderType::Gemini => "gemini",
            AiProviderType::OpenAi => "openai",
            _ => return Err("API keys are not required for this provider.".to_string()),
        };

        validate_provider_api_key_format(provider_str, key)?;
        self.credential_store.set_key_for_provider(provider_str, key)?;

        let mut lock = self.state.write().unwrap();
        if lock.provider == provider {
            lock.state = AiReadinessState::Configured;
            lock.diagnostic_message = format!(
                "{} API key saved to Windows Credential Manager. Stored securely and ready for use.",
                provider
            );
        }

        Ok(self.create_status_info(&lock))
    }

    pub fn delete_provider_api_key(
        &self,
        provider: AiProviderType,
    ) -> Result<AiStatusInfo, String> {
        let provider_str = match provider {
            AiProviderType::Gemini => "gemini",
            AiProviderType::OpenAi => "openai",
            _ => return Err("No API key configured for this provider to delete.".to_string()),
        };

        self.credential_store.delete_key_for_provider(provider_str)?;

        let mut lock = self.state.write().unwrap();
        if lock.provider == provider {
            lock.state = AiReadinessState::Unconfigured;
            lock.diagnostic_message = format!(
                "{} API credential removed from Windows Credential Manager.",
                provider
            );
        }

        Ok(self.create_status_info(&lock))
    }

    /// Backwards-compatible save method acting on current active provider
    pub fn save_api_key(&self, key: &str) -> Result<AiStatusInfo, String> {
        let provider = { self.state.read().unwrap().provider };
        self.save_provider_api_key(provider, key)
    }

    /// Backwards-compatible delete method acting on current active provider
    pub fn delete_api_key(&self) -> Result<AiStatusInfo, String> {
        let provider = { self.state.read().unwrap().provider };
        self.delete_provider_api_key(provider)
    }

    pub fn set_model(&self, model: &str) -> Result<AiStatusInfo, String> {
        let provider = { self.state.read().unwrap().provider };
        self.set_provider_model(provider, model)
    }

    pub fn set_provider_model(
        &self,
        provider: AiProviderType,
        model: &str,
    ) -> Result<AiStatusInfo, String> {
        let trimmed = model.trim();
        if trimmed.is_empty() {
            return Err("Model identifier cannot be empty.".to_string());
        }

        let mut lock = self.state.write().unwrap();
        match provider {
            AiProviderType::Ollama => {
                lock.ollama_model = trimmed.to_string();
            }
            AiProviderType::Gemini => {
                lock.gemini_model = normalize_gemini_model(trimmed);
            }
            _ => {
                lock.openai_model = trimmed.to_string();
            }
        }
        self.persist_config(&lock);
        Ok(self.create_status_info(&lock))
    }

    pub fn set_endpoint(&self, endpoint: &str) -> Result<AiStatusInfo, String> {
        let provider = { self.state.read().unwrap().provider };
        self.set_provider_endpoint(provider, endpoint)
    }

    pub fn set_provider_endpoint(
        &self,
        provider: AiProviderType,
        endpoint: &str,
    ) -> Result<AiStatusInfo, String> {
        let trimmed = endpoint.trim();
        if trimmed.is_empty() {
            return Err("Endpoint URL cannot be empty.".to_string());
        }
        if !trimmed.starts_with("http://") && !trimmed.starts_with("https://") {
            return Err("Endpoint URL must begin with http:// or https://".to_string());
        }

        let normalized = OllamaClient::normalize_endpoint(trimmed);

        let mut lock = self.state.write().unwrap();
        if provider == AiProviderType::Ollama {
            lock.ollama_endpoint = normalized.clone();
            if lock.provider == AiProviderType::Ollama {
                lock.endpoint = Some(normalized.clone());
            }
        } else {
            lock.endpoint = Some(normalized.clone());
        }
        self.persist_config(&lock);
        Ok(self.create_status_info(&lock))
    }

    pub async fn verify_connection(&self) -> Result<AiStatusInfo, String> {
        let provider = { self.state.read().unwrap().provider };
        self.verify_provider_connection(Some(provider)).await
    }

    pub async fn verify_provider_connection(
        &self,
        provider_opt: Option<AiProviderType>,
    ) -> Result<AiStatusInfo, String> {
        let provider = provider_opt.unwrap_or_else(|| self.state.read().unwrap().provider);

        if provider == AiProviderType::Ollama {
            let (endpoint, model) = {
                let lock = self.state.read().unwrap();
                (lock.ollama_endpoint.clone(), lock.ollama_model.clone())
            };

            let verify_result = self.ollama_client.verify_connection(&endpoint, &model).await;

            match verify_result {
                Ok(msg) => {
                    let mut lock = self.state.write().unwrap();
                    if lock.provider == AiProviderType::Ollama {
                        lock.state = AiReadinessState::Ready;
                        lock.diagnostic_message = msg;
                    }
                    Ok(self.create_status_info(&lock))
                }
                Err(err_msg) => {
                    let mut lock = self.state.write().unwrap();
                    if lock.provider == AiProviderType::Ollama {
                        lock.state = AiReadinessState::Unavailable;
                        lock.diagnostic_message = err_msg.clone();
                    }
                    Err(err_msg)
                }
            }
        } else {
            let provider_str = match provider {
                AiProviderType::Gemini => "gemini",
                _ => "openai",
            };

            let key = match self.credential_store.get_key_for_provider(provider_str)? {
                Some(k) if !k.trim().is_empty() => k,
                _ => {
                    let mut lock = self.state.write().unwrap();
                    if lock.provider == provider {
                        lock.state = AiReadinessState::Unconfigured;
                        lock.diagnostic_message = format!("No {} API key found in Windows Credential Manager.", provider);
                    }
                    return Err(format!("No {} API key configured to verify.", provider));
                }
            };

            let verify_result = match provider {
                AiProviderType::Gemini => self.gemini_client.verify_api_key(&key).await,
                _ => self.openai_client.verify_api_key(&key).await,
            };

            match verify_result {
                Ok(msg) => {
                    let mut lock = self.state.write().unwrap();
                    if lock.provider == provider {
                        lock.state = AiReadinessState::Ready;
                        lock.diagnostic_message = msg;
                    }
                    Ok(self.create_status_info(&lock))
                }
                Err(err_msg) => {
                    let mut lock = self.state.write().unwrap();
                    if lock.provider == provider {
                        if err_msg.contains("authentication failed") || err_msg.contains("Invalid API key") {
                            lock.state = AiReadinessState::Error;
                        } else if err_msg.contains("Network") || err_msg.contains("connect") {
                            lock.state = AiReadinessState::Unavailable;
                        } else {
                            lock.state = AiReadinessState::Error;
                        }
                        lock.diagnostic_message = err_msg.clone();
                    }
                    Err(err_msg)
                }
            }
        }
    }

    pub fn cancel_stream(&self, request_id: &str) -> bool {
        let lock = self.active_streams.read().unwrap();
        if let Some(token) = lock.get(request_id) {
            token.store(true, Ordering::Relaxed);
            true
        } else {
            false
        }
    }

    pub async fn stream_answer_internal<F>(
        &self,
        request: StreamAiAnswerRequest,
        sender: F,
    ) -> Result<(), String>
    where
        F: FnMut(StreamEvent) -> Result<(), String> + Send + 'static,
    {
        let messages = vec![
            ChatMessage {
                role: "system".to_string(),
                content: "You are OmniPilot AI, a high-efficiency developer assistant. Provide clear, direct, and accurate technical solutions with clean code blocks when helpful.".to_string(),
            },
            ChatMessage {
                role: "user".to_string(),
                content: request.prompt,
            },
        ];

        let chat_request = StreamChatRequest {
            request_id: request.request_id,
            messages,
            model: request.model,
        };

        self.stream_chat_internal(chat_request, sender).await
    }

    pub async fn stream_chat_internal<F>(
        &self,
        request: StreamChatRequest,
        mut sender: F,
    ) -> Result<(), String>
    where
        F: FnMut(StreamEvent) -> Result<(), String> + Send + 'static,
    {
        let req_id = request.request_id.clone();

        // 1. Check duplicate request ID
        {
            let mut streams = self.active_streams.write().unwrap();
            if streams.contains_key(&req_id) {
                let err = format!("A stream with request ID '{}' is already in progress.", req_id);
                let _ = sender(StreamEvent::Error(err.clone()));
                return Err(err);
            }
            streams.insert(req_id.clone(), Arc::new(AtomicBool::new(false)));
        }

        // Get cancel token
        let cancel_token = {
            let streams = self.active_streams.read().unwrap();
            streams.get(&req_id).cloned().unwrap_or_else(|| Arc::new(AtomicBool::new(false)))
        };

        // Determine active provider, default model, and default endpoint
        let (active_provider, default_model, default_endpoint) = {
            let lock = self.state.read().unwrap();
            let def_model = match lock.provider {
                AiProviderType::Ollama => lock.ollama_model.clone(),
                AiProviderType::Gemini => lock.gemini_model.clone(),
                _ => lock.openai_model.clone(),
            };
            let def_endpoint = match lock.provider {
                AiProviderType::Ollama => lock.ollama_endpoint.clone(),
                _ => lock.endpoint.clone().unwrap_or_default(),
            };
            (lock.provider, def_model, def_endpoint)
        };

        // Determine active model
        let active_model = match request.model {
            Some(m) if !m.trim().is_empty() => {
                if active_provider == AiProviderType::Gemini {
                    normalize_gemini_model(&m)
                } else {
                    m.trim().to_string()
                }
            }
            _ => {
                if active_provider == AiProviderType::Gemini {
                    normalize_gemini_model(&default_model)
                } else {
                    default_model
                }
            }
        };

        // Stream response based on active provider
        let result = if active_provider == AiProviderType::Ollama {
            // Local Ollama does NOT require an API key
            self.ollama_client
                .stream_chat_completion(
                    &default_endpoint,
                    &active_model,
                    &request.messages,
                    cancel_token,
                    sender,
                )
                .await
        } else {
            let provider_str = match active_provider {
                AiProviderType::Gemini => "gemini",
                _ => "openai",
            };

            // Fetch API key from secure credential store
            let key = match self.credential_store.get_key_for_provider(provider_str) {
                Ok(Some(k)) if !k.trim().is_empty() => k,
                Ok(_) => {
                    self.active_streams.write().unwrap().remove(&req_id);
                    let err = format!(
                        "No {} API key configured. Please add your key in Settings.",
                        active_provider
                    );
                    let _ = sender(StreamEvent::Error(err.clone()));
                    return Err(err);
                }
                Err(e) => {
                    self.active_streams.write().unwrap().remove(&req_id);
                    let err = format!("Failed to access Windows Credential Manager: {}", e);
                    let _ = sender(StreamEvent::Error(err.clone()));
                    return Err(err);
                }
            };

            match active_provider {
                AiProviderType::Gemini => {
                    self.gemini_client
                        .stream_chat_completion(
                            &key,
                            &active_model,
                            &request.messages,
                            cancel_token,
                            sender,
                        )
                        .await
                }
                _ => {
                    self.openai_client
                        .stream_chat_completion(
                            &key,
                            &active_model,
                            &request.messages,
                            cancel_token,
                            sender,
                        )
                        .await
                }
            }
        };

        // Cleanup stream from active registry
        self.active_streams.write().unwrap().remove(&req_id);

        match &result {
            Ok(_) => {
                let mut lock = self.state.write().unwrap();
                lock.state = AiReadinessState::Ready;
                lock.diagnostic_message = format!("{} streaming operational and verified.", active_provider);
            }
            Err(err_msg) => {
                let mut lock = self.state.write().unwrap();
                if err_msg.contains("authentication failed") || err_msg.contains("Invalid API key") {
                    lock.state = AiReadinessState::Error;
                } else if err_msg.contains("quota")
                    || err_msg.contains("credit balance")
                    || err_msg.contains("RESOURCE_EXHAUSTED")
                    || err_msg.contains("spend limit")
                    || err_msg.contains("usage limit")
                {
                    lock.state = AiReadinessState::Error;
                } else if err_msg.contains("Network") || err_msg.contains("connect") || err_msg.contains("refused") {
                    lock.state = AiReadinessState::Unavailable;
                }
                lock.diagnostic_message = err_msg.clone();
            }
        }

        result
    }

    pub fn validate_provider_config(
        &self,
        provider: AiProviderType,
        model: Option<&str>,
        endpoint: Option<&str>,
    ) -> ValidationResult {
        match provider {
            AiProviderType::None => ValidationResult {
                valid: true,
                message: "Local preview mode: no external provider required.".to_string(),
            },
            AiProviderType::Ollama => {
                let model_name = model.unwrap_or(DEFAULT_OLLAMA_MODEL);
                if model_name.trim().is_empty() {
                    return ValidationResult {
                        valid: false,
                        message: "Ollama model identifier cannot be empty.".to_string(),
                    };
                }
                let ep = endpoint.unwrap_or(DEFAULT_OLLAMA_ENDPOINT);
                if !ep.starts_with("http://") && !ep.starts_with("https://") {
                    return ValidationResult {
                        valid: false,
                        message: "Ollama base URL must begin with http:// or https://".to_string(),
                    };
                }
                ValidationResult {
                    valid: true,
                    message: format!("Valid Ollama configuration structure for model '{}' at '{}'.", model_name, ep),
                }
            }
            AiProviderType::OpenAi => {
                let model_name = model.unwrap_or(DEFAULT_OPENAI_MODEL);
                if model_name.trim().is_empty() {
                    return ValidationResult {
                        valid: false,
                        message: "OpenAI model identifier cannot be empty.".to_string(),
                    };
                }
                ValidationResult {
                    valid: true,
                    message: format!("Valid OpenAI configuration structure for model '{}'.", model_name),
                }
            }
            AiProviderType::Gemini => {
                let raw_model = model.unwrap_or(DEFAULT_GEMINI_MODEL);
                let model_name = normalize_gemini_model(raw_model);
                if model_name.trim().is_empty() {
                    return ValidationResult {
                        valid: false,
                        message: "Gemini model identifier cannot be empty.".to_string(),
                    };
                }
                ValidationResult {
                    valid: true,
                    message: format!("Valid Gemini configuration structure for model '{}'.", model_name),
                }
            }
            AiProviderType::Anthropic => {
                let model_name = model.unwrap_or("claude-3-5-sonnet-20241022");
                if model_name.trim().is_empty() {
                    return ValidationResult {
                        valid: false,
                        message: "Anthropic model identifier cannot be empty.".to_string(),
                    };
                }
                ValidationResult {
                    valid: true,
                    message: format!("Valid Anthropic configuration structure for model '{}'.", model_name),
                }
            }
            AiProviderType::Custom => {
                match endpoint {
                    Some(url) if url.starts_with("http://") || url.starts_with("https://") => {
                        ValidationResult {
                            valid: true,
                            message: "Valid custom endpoint URL structure.".to_string(),
                        }
                    }
                    Some(_) => ValidationResult {
                        valid: false,
                        message: "Custom endpoint must begin with http:// or https://".to_string(),
                    },
                    None => ValidationResult {
                        valid: false,
                        message: "Custom endpoint URL is required for custom provider.".to_string(),
                    },
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::credential_service::MockCredentialStore;

    #[test]
    fn test_initial_state_defaults_to_ollama() {
        let store = Arc::new(MockCredentialStore::new());
        let openai_client = Arc::new(OpenAiClient::new());
        let gemini_client = Arc::new(GeminiClient::new());
        let service = AiService::new_with_store(store, openai_client, gemini_client);
        let status = service.get_status();
        assert_eq!(status.provider, AiProviderType::Ollama);
        assert_eq!(status.model, Some(DEFAULT_OLLAMA_MODEL.to_string()));
        assert_eq!(status.endpoint, Some(DEFAULT_OLLAMA_ENDPOINT.to_string()));
        assert_eq!(status.state, AiReadinessState::Configured);
        assert_eq!(status.key_configured, true);
        assert_eq!(status.ollama_configured, Some(true));
        assert!(status.message.contains("Ollama provider selected"));
    }

    #[test]
    fn test_ollama_endpoint_and_model_configuration() {
        let store = Arc::new(MockCredentialStore::new());
        let openai_client = Arc::new(OpenAiClient::new());
        let gemini_client = Arc::new(GeminiClient::new());
        let service = AiService::new_with_store(store, openai_client, gemini_client);

        // Model preference
        let status_model = service.set_model("codellama:7b").unwrap();
        assert_eq!(status_model.model, Some("codellama:7b".to_string()));
        assert_eq!(status_model.ollama_model, Some("codellama:7b".to_string()));

        // Endpoint preference
        let status_ep = service.set_endpoint("http://192.168.1.100:11434/").unwrap();
        assert_eq!(status_ep.endpoint, Some("http://192.168.1.100:11434".to_string()));
        assert_eq!(status_ep.ollama_endpoint, Some("http://192.168.1.100:11434".to_string()));

        // Invalid endpoint rejection
        let invalid = service.set_endpoint("ftp://localhost:11434");
        assert!(invalid.is_err());
    }

    #[test]
    fn test_save_and_delete_api_key_flow() {
        let store = Arc::new(MockCredentialStore::new());
        let openai_client = Arc::new(OpenAiClient::new());
        let gemini_client = Arc::new(GeminiClient::new());
        let service = AiService::new_with_store(store, openai_client, gemini_client);

        // Switch to OpenAI first for testing OpenAI flow
        service.set_provider(AiProviderType::OpenAi).unwrap();

        // Save valid OpenAI key
        let status = service.save_api_key("sk-proj-test123456789").unwrap();
        assert_eq!(status.key_configured, true);
        assert_eq!(status.state, AiReadinessState::Configured);

        // Model preference
        let status_model = service.set_model("gpt-4o").unwrap();
        assert_eq!(status_model.model, Some("gpt-4o".to_string()));

        // Delete key
        let status_del = service.delete_api_key().unwrap();
        assert_eq!(status_del.key_configured, false);
        assert_eq!(status_del.state, AiReadinessState::Unconfigured);
    }

    #[test]
    fn test_multi_provider_switching_and_credential_isolation() {
        let store = Arc::new(MockCredentialStore::new());
        let openai_client = Arc::new(OpenAiClient::new());
        let gemini_client = Arc::new(GeminiClient::new());
        let service = AiService::new_with_store(store, openai_client, gemini_client);

        // Save OpenAI key
        service.save_provider_api_key(AiProviderType::OpenAi, "sk-proj-openai-key-12345").unwrap();

        // Save Gemini key
        service.save_provider_api_key(AiProviderType::Gemini, "AIzaSyGeminiKey1234567890abcdef").unwrap();

        // Switch to Gemini
        let gemini_status = service.set_provider(AiProviderType::Gemini).unwrap();
        assert_eq!(gemini_status.provider, AiProviderType::Gemini);
        assert_eq!(gemini_status.key_configured, true);
        assert_eq!(gemini_status.openai_configured, Some(true));
        assert_eq!(gemini_status.gemini_configured, Some(true));
        assert_eq!(gemini_status.model, Some(DEFAULT_GEMINI_MODEL.to_string()));

        // Switch to Ollama -> key_configured is true without requiring key
        let ollama_status = service.set_provider(AiProviderType::Ollama).unwrap();
        assert_eq!(ollama_status.provider, AiProviderType::Ollama);
        assert_eq!(ollama_status.key_configured, true);
        assert_eq!(ollama_status.openai_configured, Some(true));
        assert_eq!(ollama_status.gemini_configured, Some(true));
        assert_eq!(ollama_status.model, Some(DEFAULT_OLLAMA_MODEL.to_string()));

        // Switch to OpenAI
        let openai_status = service.set_provider(AiProviderType::OpenAi).unwrap();
        assert_eq!(openai_status.provider, AiProviderType::OpenAi);
        assert_eq!(openai_status.model, Some(DEFAULT_OPENAI_MODEL.to_string()));

        // Delete OpenAI key -> Gemini key remains configured!
        let deleted_openai = service.delete_provider_api_key(AiProviderType::OpenAi).unwrap();
        assert_eq!(deleted_openai.openai_configured, Some(false));
        assert_eq!(deleted_openai.gemini_configured, Some(true));
    }

    #[test]
    fn test_gemini_obsolete_model_migration() {
        assert_eq!(normalize_gemini_model("gemini-2.0-flash"), DEFAULT_GEMINI_MODEL);
        assert_eq!(normalize_gemini_model("gemini-2.0-flash-lite"), DEFAULT_GEMINI_MODEL);
        assert_eq!(normalize_gemini_model("gemini-1.5-flash"), DEFAULT_GEMINI_MODEL);
        assert_eq!(normalize_gemini_model("gemini-1.5-pro"), DEFAULT_GEMINI_MODEL);
        assert_eq!(normalize_gemini_model(""), DEFAULT_GEMINI_MODEL);
        assert_eq!(normalize_gemini_model("   "), DEFAULT_GEMINI_MODEL);
        // Valid modern models preserved
        assert_eq!(normalize_gemini_model("gemini-3.8-flash"), "gemini-3.8-flash");
        assert_eq!(normalize_gemini_model("gemini-2.5-pro"), "gemini-2.5-pro");

        let store = Arc::new(MockCredentialStore::new());
        let openai_client = Arc::new(OpenAiClient::new());
        let gemini_client = Arc::new(GeminiClient::new());
        let service = AiService::new_with_store(store, openai_client, gemini_client);

        // Setting an obsolete model automatically migrates to gemini-3.8-flash
        service.set_provider(AiProviderType::Gemini).unwrap();
        let status = service.set_model("gemini-2.0-flash").unwrap();
        assert_eq!(status.model, Some(DEFAULT_GEMINI_MODEL.to_string()));
        assert_eq!(status.gemini_model, Some(DEFAULT_GEMINI_MODEL.to_string()));

        let status2 = service.set_provider_model(AiProviderType::Gemini, "gemini-1.5-pro").unwrap();
        assert_eq!(status2.gemini_model, Some(DEFAULT_GEMINI_MODEL.to_string()));
    }

    #[test]
    fn test_persisted_config_migration_on_load() {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let temp_dir = std::env::temp_dir().join(format!("omnipilot_test_{}", nanos));
        let _ = std::fs::create_dir_all(&temp_dir);
        let config_path = temp_dir.join("settings.json");

        // Write obsolete config without ollamaModel
        let old_json = r#"{
            "activeProvider": "gemini",
            "geminiModel": "gemini-2.0-flash",
            "openaiModel": "gpt-4o-mini"
        }"#;
        std::fs::write(&config_path, old_json).unwrap();

        // Load config -> should migrate activeProvider to ollama, geminiModel to gemini-3.8-flash, and populate ollamaModel & ollamaEndpoint
        let loaded = PersistedAiConfig::load_from_file(&config_path).expect("failed to load");
        assert_eq!(loaded.active_provider, AiProviderType::Ollama);
        assert_eq!(loaded.gemini_model, DEFAULT_GEMINI_MODEL);
        assert_eq!(loaded.ollama_model, DEFAULT_OLLAMA_MODEL);
        assert_eq!(loaded.ollama_endpoint, DEFAULT_OLLAMA_ENDPOINT);

        // Verify it was re-saved with migrated settings
        let reloaded = PersistedAiConfig::load_from_file(&config_path).expect("failed to reload");
        assert_eq!(reloaded.active_provider, AiProviderType::Ollama);
        assert_eq!(reloaded.gemini_model, DEFAULT_GEMINI_MODEL);

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_persisted_config_preserves_valid_settings() {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos() + 1;
        let temp_dir = std::env::temp_dir().join(format!("omnipilot_test_{}", nanos));
        let _ = std::fs::create_dir_all(&temp_dir);
        let config_path = temp_dir.join("settings.json");

        let custom_json = r#"{
            "activeProvider": "ollama",
            "geminiModel": "gemini-2.5-pro",
            "openaiModel": "gpt-4o",
            "ollamaModel": "qwen2.5-coder:3b",
            "ollamaEndpoint": "http://127.0.0.1:11434"
        }"#;
        std::fs::write(&config_path, custom_json).unwrap();

        let loaded = PersistedAiConfig::load_from_file(&config_path).expect("failed to load");
        assert_eq!(loaded.active_provider, AiProviderType::Ollama);
        assert_eq!(loaded.gemini_model, "gemini-2.5-pro");
        assert_eq!(loaded.openai_model, "gpt-4o");
        assert_eq!(loaded.ollama_model, "qwen2.5-coder:3b");
        assert_eq!(loaded.ollama_endpoint, "http://127.0.0.1:11434");

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_cancel_stream_flag() {
        let store = Arc::new(MockCredentialStore::with_key("sk-proj-test123456789"));
        let openai_client = Arc::new(OpenAiClient::new());
        let gemini_client = Arc::new(GeminiClient::new());
        let service = AiService::new_with_store(store, openai_client, gemini_client);

        let req_id = "test-req-123";
        service.active_streams.write().unwrap().insert(
            req_id.to_string(),
            Arc::new(AtomicBool::new(false)),
        );

        let cancelled = service.cancel_stream(req_id);
        assert!(cancelled);

        let lock = service.active_streams.read().unwrap();
        let token = lock.get(req_id).unwrap();
        assert!(token.load(Ordering::Relaxed));
    }
}

