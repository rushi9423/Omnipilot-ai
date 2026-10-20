use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AiProviderType {
    OpenAi,
    Gemini,
    Ollama,
    Anthropic,
    Custom,
    None,
}

impl std::fmt::Display for AiProviderType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::OpenAi => write!(f, "OpenAI"),
            Self::Gemini => write!(f, "Gemini"),
            Self::Ollama => write!(f, "Ollama"),
            Self::Anthropic => write!(f, "Anthropic"),
            Self::Custom => write!(f, "Custom"),
            Self::None => write!(f, "None"),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AiReadinessState {
    Unconfigured,
    Configured,
    Checking,
    Ready,
    Error,
    Unavailable,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiStatusInfo {
    pub state: AiReadinessState,
    pub provider: AiProviderType,
    pub model: Option<String>,
    pub message: String,
    pub key_configured: bool,
    pub endpoint: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub openai_configured: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gemini_configured: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ollama_configured: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub openai_model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gemini_model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ollama_model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ollama_endpoint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ValidationResult {
    pub valid: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamAiAnswerRequest {
    pub request_id: String,
    pub prompt: String,
    pub model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamChatRequest {
    pub request_id: String,
    pub messages: Vec<ChatMessage>,
    pub model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", content = "payload")]
pub enum StreamEvent {
    #[serde(rename = "chunk")]
    Chunk(String),
    #[serde(rename = "done")]
    Done,
    #[serde(rename = "error")]
    Error(String),
    #[serde(rename = "cancelled")]
    Cancelled,
}
