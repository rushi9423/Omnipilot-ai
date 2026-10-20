use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use crate::models::ai::{ChatMessage, StreamEvent};

pub const DEFAULT_GEMINI_MODEL: &str = "gemini-3.8-flash";
pub const GEMINI_API_BASE_URL: &str = "https://generativelanguage.googleapis.com/v1beta";
pub const GEMINI_API_KEY_HEADER: &str = "x-goog-api-key";
pub const MAX_GEMINI_RETRIES: u32 = 3;
pub const DEFAULT_BASE_BACKOFF_MS: u64 = 500;
pub const MAX_BACKOFF_MS: u64 = 4000;
pub const MAX_RETRY_AFTER_SECS: u64 = 10;

/// Returns true if an HTTP status code represents a transient error suitable for backoff retry.
pub fn is_transient_status(status_code: u16) -> bool {
    status_code == 503 || status_code == 429 || (500..=599).contains(&status_code)
}

/// Parses the standard HTTP `Retry-After` header in seconds, if present and valid.
pub fn parse_retry_after(headers: &HeaderMap) -> Option<Duration> {
    if let Some(val) = headers.get(reqwest::header::RETRY_AFTER) {
        if let Ok(s) = val.to_str() {
            if let Ok(secs) = s.trim().parse::<u64>() {
                return Some(Duration::from_secs(secs));
            }
        }
    }
    None
}

/// Calculates bounded exponential backoff delay with jitter.
/// If `retry_after` is provided, respects it bounded to `MAX_RETRY_AFTER_SECS`.
pub fn compute_backoff_delay(base: Duration, attempt: u32, retry_after: Option<Duration>) -> Duration {
    if let Some(ra) = retry_after {
        return ra.min(Duration::from_secs(MAX_RETRY_AFTER_SECS));
    }

    let exp = 1u64.checked_shl(attempt).unwrap_or(8).min(8);
    let base_ms = (base.as_millis() as u64 * exp).min(MAX_BACKOFF_MS);

    let jitter_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| (d.subsec_nanos() % 251) as u64)
        .unwrap_or(50);

    let jitter = if base.as_millis() < 50 {
        Duration::from_millis(jitter_ms % 5)
    } else {
        Duration::from_millis(jitter_ms)
    };

    Duration::from_millis(base_ms) + jitter
}

/// Sleeps for `delay` while checking `cancel_token` every 10ms.
/// Returns `true` if cancelled early, `false` if sleep completed normally.
pub async fn sleep_with_cancellation(delay: Duration, cancel_token: &AtomicBool) -> bool {
    if delay.is_zero() {
        return cancel_token.load(Ordering::Relaxed);
    }
    let step = Duration::from_millis(10);
    let mut elapsed = Duration::ZERO;
    while elapsed < delay {
        if cancel_token.load(Ordering::Relaxed) {
            return true;
        }
        let to_sleep = (delay - elapsed).min(step);
        tokio::time::sleep(to_sleep).await;
        elapsed += to_sleep;
    }
    cancel_token.load(Ordering::Relaxed)
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct GeminiPart {
    pub text: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct GeminiContent {
    pub role: String,
    pub parts: Vec<GeminiPart>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GeminiSystemInstruction {
    pub parts: Vec<GeminiPart>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GeminiGenerationConfig {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_output_tokens: Option<u32>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GeminiGenerateContentRequest {
    pub contents: Vec<GeminiContent>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub system_instruction: Option<GeminiSystemInstruction>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub generation_config: Option<GeminiGenerationConfig>,
}

#[derive(Debug, Deserialize)]
struct ResponsePart {
    text: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ResponseContent {
    parts: Option<Vec<ResponsePart>>,
    #[allow(dead_code)]
    role: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ResponseCandidate {
    content: Option<ResponseContent>,
    #[serde(rename = "finishReason")]
    #[allow(dead_code)]
    finish_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GeminiStreamChunk {
    candidates: Option<Vec<ResponseCandidate>>,
    #[allow(dead_code)]
    error: Option<GeminiErrorDetail>,
}

#[derive(Debug, Deserialize)]
pub struct GeminiErrorWrapper {
    pub error: Option<GeminiErrorDetail>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct GeminiErrorDetail {
    pub code: Option<u16>,
    pub message: Option<String>,
    pub status: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GeminiErrorKind {
    /// Invalid API key or unauthorized access
    AuthenticationFailed,
    /// Permission denied or country restrictions
    PermissionDenied,
    /// Quota or rate-limit exhaustion (RESOURCE_EXHAUSTED)
    RateLimitOrQuotaExceeded,
    /// Requested model not found or unavailable for API version
    ModelNotFound,
    /// Google server 5xx error
    ServerUnavailable,
    /// Network connection or timeout error
    NetworkError,
    /// Malformed SSE or response payload
    MalformedStream,
    /// Other unclassified status code
    Other(u16),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ClassifiedGeminiError {
    pub kind: GeminiErrorKind,
    pub status_code: u16,
    pub raw_status: Option<String>,
    pub user_message: String,
    pub action_hint: String,
}

pub struct GeminiClient {
    client: reqwest::Client,
    pub base_url: String,
    pub base_backoff: Duration,
    pub max_retries: u32,
}

impl Default for GeminiClient {
    fn default() -> Self {
        Self::new()
    }
}

impl GeminiClient {
    pub fn new() -> Self {
        Self::new_with_base_url(GEMINI_API_BASE_URL)
    }

    pub fn new_with_base_url(base_url: impl Into<String>) -> Self {
        Self::new_with_options(
            base_url,
            Duration::from_millis(DEFAULT_BASE_BACKOFF_MS),
            MAX_GEMINI_RETRIES,
        )
    }

    pub fn new_with_options(
        base_url: impl Into<String>,
        base_backoff: Duration,
        max_retries: u32,
    ) -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(60))
            .connect_timeout(Duration::from_secs(15))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());

        Self {
            client,
            base_url: base_url.into(),
            base_backoff,
            max_retries,
        }
    }

    /// Configures authentication headers for Google Gemini requests based on the credential type.
    ///
    /// - OAuth2 / Access tokens (`ya29...` or prefixed with `Bearer `): Authenticates using `Authorization: Bearer <token>`.
    /// - API keys (legacy `AIza...`, newer Google AI Studio `AQ....` authorization keys, and standard keys):
    ///   Authenticates using the official `x-goog-api-key: <key>` header as required by `generativelanguage.googleapis.com`.
    ///
    /// Ensures credentials have whitespace trimmed and marks headers as sensitive so debug formatters never expose secrets.
    pub fn apply_auth_headers(headers: &mut HeaderMap, api_key: &str) -> Result<(), String> {
        apply_gemini_auth_headers(headers, api_key)
    }

    /// Verifies the Gemini API key against the Google AI Studio /v1beta/models endpoint.
    /// Uses the correct authentication method for the provided credential type.
    /// Retries on transient 503/429/5xx responses with exponential backoff.
    pub async fn verify_api_key(&self, api_key: &str) -> Result<String, String> {
        let trimmed_key = api_key.trim();
        if trimmed_key.is_empty() {
            return Err("Gemini API key is empty.".to_string());
        }

        let models_url = format!("{}/models", self.base_url);

        for attempt in 0..=self.max_retries {
            let mut headers = HeaderMap::new();
            apply_gemini_auth_headers(&mut headers, trimmed_key)?;

            let response = match self
                .client
                .get(&models_url)
                .headers(headers)
                .send()
                .await
            {
                Ok(resp) => resp,
                Err(e) => {
                    if attempt < self.max_retries {
                        let delay = compute_backoff_delay(self.base_backoff, attempt, None);
                        tokio::time::sleep(delay).await;
                        continue;
                    }
                    return Err(sanitize_network_error(&e));
                }
            };

            let status = response.status();
            let status_code = status.as_u16();

            if status.is_success() {
                return Ok("Gemini API key authenticated successfully (access to Google AI Studio models confirmed).".to_string());
            }

            if is_transient_status(status_code) && attempt < self.max_retries {
                let retry_after = parse_retry_after(response.headers());
                let delay = compute_backoff_delay(self.base_backoff, attempt, retry_after);
                tokio::time::sleep(delay).await;
                continue;
            }

            let error_text = response.text().await.unwrap_or_default();
            let classified = sanitize_and_classify_gemini_error(status_code, &error_text);
            return Err(classified.user_message);
        }

        Err("Gemini API verification failed after retry attempts.".to_string())
    }

    /// Streams chat completions from Google Gemini API using Server-Sent Events (SSE).
    /// Sends `x-goog-api-key` in headers (or Bearer token if OAuth), maps messages to `contents` & `parts`, and monitors `cancel_token`.
    /// Automatically retries transient 503, 429, and 5xx responses using bounded exponential backoff with jitter.
    /// Retries only occur BEFORE response streaming has begun so partially delivered answers are never replayed.
    pub async fn stream_chat_completion<F>(
        &self,
        api_key: &str,
        model: &str,
        messages: &[ChatMessage],
        cancel_token: Arc<AtomicBool>,
        mut on_event: F,
    ) -> Result<(), String>
    where
        F: FnMut(StreamEvent) -> Result<(), String>,
    {
        let trimmed_key = api_key.trim();
        if trimmed_key.is_empty() {
            let err_msg = "No Gemini API key configured. Please add your key in Settings.".to_string();
            let _ = on_event(StreamEvent::Error(err_msg.clone()));
            return Err(err_msg);
        }

        let trimmed_model = model.trim();
        let active_model = if trimmed_model.is_empty()
            || trimmed_model == "gemini-2.0-flash"
            || trimmed_model == "gemini-2.0-flash-lite"
            || trimmed_model == "gemini-1.5-flash"
            || trimmed_model == "gemini-1.5-pro"
            || trimmed_model.starts_with("gemini-1.5")
            || trimmed_model.starts_with("gemini-2.0")
        {
            DEFAULT_GEMINI_MODEL
        } else {
            trimmed_model
        };

        let stream_url = format!(
            "{}/models/{}:streamGenerateContent?alt=sse",
            self.base_url, active_model
        );

        let (system_instruction, contents) = map_messages_to_gemini(messages);
        let request_body = GeminiGenerateContentRequest {
            contents,
            system_instruction,
            // For gemini-3.8-flash, official Google documentation recommends omitting
            // temperature (default 1.0) so internal reasoning loop is not disrupted.
            generation_config: None,
        };

        // Bounded exponential-backoff retries with jitter for transient responses.
        // Retries only occur before response streaming has begun.
        let mut response = None;

        for attempt in 0..=self.max_retries {
            if cancel_token.load(Ordering::Relaxed) {
                let _ = on_event(StreamEvent::Cancelled);
                return Ok(());
            }

            let mut headers = HeaderMap::new();
            headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
            if let Err(err_msg) = apply_gemini_auth_headers(&mut headers, trimmed_key) {
                let _ = on_event(StreamEvent::Error(err_msg.clone()));
                return Err(err_msg);
            }

            let resp = match self
                .client
                .post(&stream_url)
                .headers(headers)
                .json(&request_body)
                .send()
                .await
            {
                Ok(r) => r,
                Err(e) => {
                    if attempt < self.max_retries {
                        let delay = compute_backoff_delay(self.base_backoff, attempt, None);
                        if sleep_with_cancellation(delay, &cancel_token).await {
                            let _ = on_event(StreamEvent::Cancelled);
                            return Ok(());
                        }
                        continue;
                    }
                    let err_msg = sanitize_network_error(&e);
                    let _ = on_event(StreamEvent::Error(err_msg.clone()));
                    return Err(err_msg);
                }
            };

            let status = resp.status();
            let status_code = status.as_u16();

            if status.is_success() {
                response = Some(resp);
                break;
            }

            // Retry for transient HTTP 503, 429, and 5xx responses if attempts remain
            if is_transient_status(status_code) && attempt < self.max_retries {
                let retry_after = parse_retry_after(resp.headers());
                let delay = compute_backoff_delay(self.base_backoff, attempt, retry_after);
                if sleep_with_cancellation(delay, &cancel_token).await {
                    let _ = on_event(StreamEvent::Cancelled);
                    return Ok(());
                }
                continue;
            }

            // Non-transient error OR retries exhausted: parse and classify sanitized error
            let error_text = resp.text().await.unwrap_or_default();
            let classified = sanitize_and_classify_gemini_error(status_code, &error_text);
            let err_msg = classified.user_message.clone();
            let _ = on_event(StreamEvent::Error(err_msg.clone()));
            return Err(err_msg);
        }

        let mut stream = match response {
            Some(r) => r,
            None => {
                let err_msg = "Google Gemini request failed after retry attempts.".to_string();
                let _ = on_event(StreamEvent::Error(err_msg.clone()));
                return Err(err_msg);
            }
        };
        let mut buffer = String::new();

        while let Some(chunk) = stream.chunk().await.map_err(|e| {
            let msg = format!("Network streaming error: {}", sanitize_network_error(&e));
            let _ = on_event(StreamEvent::Error(msg.clone()));
            msg
        })? {
            if cancel_token.load(Ordering::Relaxed) {
                let _ = on_event(StreamEvent::Cancelled);
                return Ok(());
            }

            let text_chunk = String::from_utf8_lossy(&chunk);
            buffer.push_str(&text_chunk);

            while let Some(pos) = buffer.find('\n') {
                let line = buffer[..pos].trim().to_string();
                buffer.drain(..=pos);

                if line.is_empty() || line.starts_with(':') {
                    continue;
                }

                if let Some(data) = line.strip_prefix("data:") {
                    let data_trimmed = data.trim();
                    if data_trimmed.is_empty() {
                        continue;
                    }

                    if let Some(token) = parse_gemini_sse_chunk(data_trimmed) {
                        if !token.is_empty() {
                            let _ = on_event(StreamEvent::Chunk(token));
                        }
                    }
                }
            }
        }

        // Drain any remaining buffer
        let remaining = buffer.trim();
        if !remaining.is_empty() && remaining.starts_with("data:") {
            if let Some(data) = remaining.strip_prefix("data:") {
                let data_trimmed = data.trim();
                if let Some(token) = parse_gemini_sse_chunk(data_trimmed) {
                    if !token.is_empty() {
                        let _ = on_event(StreamEvent::Chunk(token));
                    }
                }
            }
        }

        let _ = on_event(StreamEvent::Done);
        Ok(())
    }
}

/// Maps chat conversation messages into Gemini's `contents` and `parts` format.
/// Messages with role "system" are converted into a `GeminiSystemInstruction`.
/// Messages with role "assistant" or "model" are mapped to role "model".
/// Messages with role "user" are mapped to role "user".
pub fn map_messages_to_gemini(
    messages: &[ChatMessage],
) -> (Option<GeminiSystemInstruction>, Vec<GeminiContent>) {
    let mut system_text = String::new();
    let mut contents = Vec::new();

    for msg in messages {
        let trimmed_content = msg.content.trim();
        if trimmed_content.is_empty() {
            continue;
        }

        let role_lower = msg.role.to_lowercase();
        if role_lower == "system" {
            if !system_text.is_empty() {
                system_text.push('\n');
            }
            system_text.push_str(trimmed_content);
        } else {
            let gemini_role = match role_lower.as_str() {
                "assistant" | "model" => "model",
                _ => "user",
            };

            contents.push(GeminiContent {
                role: gemini_role.to_string(),
                parts: vec![GeminiPart {
                    text: trimmed_content.to_string(),
                }],
            });
        }
    }

    let system_instruction = if !system_text.is_empty() {
        Some(GeminiSystemInstruction {
            parts: vec![GeminiPart { text: system_text }],
        })
    } else {
        None
    };

    // If contents is empty after filtering, default to a basic user prompt
    if contents.is_empty() {
        contents.push(GeminiContent {
            role: "user".to_string(),
            parts: vec![GeminiPart {
                text: "Hello".to_string(),
            }],
        });
    }

    (system_instruction, contents)
}

/// Parses an SSE JSON payload from Gemini's streamGenerateContent endpoint.
/// Extracts `candidates[0].content.parts[0].text`.
pub fn parse_gemini_sse_chunk(json_str: &str) -> Option<String> {
    match serde_json::from_str::<GeminiStreamChunk>(json_str) {
        Ok(chunk) => {
            if let Some(candidates) = chunk.candidates {
                if let Some(first_candidate) = candidates.into_iter().next() {
                    if let Some(content) = first_candidate.content {
                        if let Some(parts) = content.parts {
                            let mut full_text = String::new();
                            for part in parts {
                                if let Some(txt) = part.text {
                                    full_text.push_str(&txt);
                                }
                            }
                            if !full_text.is_empty() {
                                return Some(full_text);
                            }
                        }
                    }
                }
            }
            None
        }
        Err(_) => None,
    }
}

/// Configures authentication headers for Google Gemini requests based on the credential type.
///
/// - OAuth2 / Access tokens (`ya29...` or prefixed with `Bearer `): Authenticates using `Authorization: Bearer <token>`.
/// - API keys (legacy `AIza...`, newer Google AI Studio `AQ....` authorization keys, and standard keys):
///   Authenticates using the official `x-goog-api-key: <key>` header as required by `generativelanguage.googleapis.com`.
///
/// Trims accidental leading/trailing whitespace and marks header values as sensitive so secrets never leak in debug logs.
pub fn apply_gemini_auth_headers(headers: &mut HeaderMap, api_key: &str) -> Result<(), String> {
    let trimmed = api_key.trim();
    if trimmed.is_empty() {
        return Err("Gemini credential cannot be empty or contain only whitespace.".to_string());
    }

    if let Some(bearer_token) = trimmed.strip_prefix("Bearer ").or_else(|| trimmed.strip_prefix("bearer ")) {
        let clean = bearer_token.trim();
        let mut val = HeaderValue::from_str(&format!("Bearer {}", clean))
            .map_err(|_| "Invalid characters in Gemini bearer authentication header.".to_string())?;
        val.set_sensitive(true);
        headers.insert(AUTHORIZATION, val);
    } else if trimmed.starts_with("ya29.") {
        let mut val = HeaderValue::from_str(&format!("Bearer {}", trimmed))
            .map_err(|_| "Invalid characters in Gemini OAuth token header.".to_string())?;
        val.set_sensitive(true);
        headers.insert(AUTHORIZATION, val);
    } else {
        // Standard Google AI Studio API key and AQ. authorization key use x-goog-api-key
        let mut key_val = HeaderValue::from_str(trimmed)
            .map_err(|_| "Invalid characters in Gemini API key header.".to_string())?;
        key_val.set_sensitive(true);
        headers.insert(HeaderName::from_static("x-goog-api-key"), key_val);
    }

    Ok(())
}

/// Sanitizes error text so no Gemini API keys (`AQ....`, `AIzaSy...`), OAuth tokens (`ya29...`),
/// or OpenAI keys (`sk-...`) appear in error messages or logs.
pub fn sanitize_gemini_error_text(text: &str) -> String {
    let mut sanitized = text.to_string();
    if sanitized.contains("Bearer ") {
        sanitized = sanitized.replace("Bearer ", "Bearer [REDACTED]");
    }
    if sanitized.contains("bearer ") {
        sanitized = sanitized.replace("bearer ", "bearer [REDACTED]");
    }
    if sanitized.contains("x-goog-api-key: ") {
        sanitized = sanitized.replace("x-goog-api-key: ", "x-goog-api-key: [REDACTED]");
    }
    if sanitized.contains("key=") {
        sanitized = sanitized.replace("key=", "key=[REDACTED]");
    }

    let mut result = String::new();
    let mut chars = sanitized.chars().peekable();
    while let Some(c) = chars.next() {
        if c == 'A' {
            if chars.peek() == Some(&'I') {
                let mut prefix = String::from("AI");
                chars.next();
                if chars.peek() == Some(&'z') {
                    prefix.push(chars.next().unwrap());
                    if chars.peek() == Some(&'a') {
                        prefix.push(chars.next().unwrap());
                        while let Some(&next_ch) = chars.peek() {
                            if next_ch.is_ascii_alphanumeric() || next_ch == '-' || next_ch == '_' || next_ch == '.' {
                                chars.next();
                            } else {
                                break;
                            }
                        }
                        result.push_str("[REDACTED_GEMINI_KEY]");
                        continue;
                    }
                }
                result.push_str(&prefix);
                continue;
            } else if chars.peek() == Some(&'Q') {
                let mut prefix = String::from("AQ");
                chars.next();
                if chars.peek() == Some(&'.') {
                    prefix.push(chars.next().unwrap());
                    while let Some(&next_ch) = chars.peek() {
                        if next_ch.is_ascii_alphanumeric() || next_ch == '-' || next_ch == '_' || next_ch == '.' {
                            chars.next();
                        } else {
                            break;
                        }
                    }
                    result.push_str("[REDACTED_GEMINI_KEY]");
                    continue;
                }
                result.push_str(&prefix);
                continue;
            }
        } else if c == 'y' && chars.peek() == Some(&'a') {
            let mut prefix = String::from("ya");
            chars.next();
            if chars.peek() == Some(&'2') {
                prefix.push(chars.next().unwrap());
                if chars.peek() == Some(&'9') {
                    prefix.push(chars.next().unwrap());
                    if chars.peek() == Some(&'.') {
                        prefix.push(chars.next().unwrap());
                        while let Some(&next_ch) = chars.peek() {
                            if next_ch.is_ascii_alphanumeric() || next_ch == '-' || next_ch == '_' || next_ch == '.' {
                                chars.next();
                            } else {
                                break;
                            }
                        }
                        result.push_str("[REDACTED_GEMINI_TOKEN]");
                        continue;
                    }
                }
            }
            result.push_str(&prefix);
            continue;
        } else if c == 's' && chars.peek() == Some(&'k') {
            let mut prefix = String::from("sk");
            chars.next();
            if chars.peek() == Some(&'-') {
                prefix.push(chars.next().unwrap());
                while let Some(&next_ch) = chars.peek() {
                    if next_ch.is_ascii_alphanumeric() || next_ch == '-' || next_ch == '_' {
                        chars.next();
                    } else {
                        break;
                    }
                }
                result.push_str("[REDACTED_OPENAI_KEY]");
                continue;
            } else {
                result.push_str(&prefix);
                continue;
            }
        }
        result.push(c);
    }

    result
}

/// Sanitizes network errors for safe display.
pub fn sanitize_network_error(err: &reqwest::Error) -> String {
    if err.is_timeout() {
        "Request timed out while connecting to Google Gemini API. Please check your network connection and retry.".to_string()
    } else if err.is_connect() {
        "Unable to connect to Google Gemini API endpoint. Please check your internet connection or proxy settings.".to_string()
    } else {
        "Network communication failure while contacting Google Gemini API.".to_string()
    }
}

/// Classifies Gemini errors by HTTP status, structured status string, and error message.
pub fn sanitize_and_classify_gemini_error(
    status_code: u16,
    response_body: &str,
) -> ClassifiedGeminiError {
    let parsed_wrapper = serde_json::from_str::<GeminiErrorWrapper>(response_body).ok();
    let detail = parsed_wrapper.as_ref().and_then(|w| w.error.as_ref());

    let raw_status = detail.and_then(|d| d.status.clone());
    let raw_message = detail
        .and_then(|d| d.message.clone())
        .unwrap_or_else(|| response_body.to_string());

    let sanitized_msg = sanitize_gemini_error_text(&raw_message);
    let status_str = raw_status.as_deref().unwrap_or("").to_uppercase();
    let msg_lower = sanitized_msg.to_lowercase();

    // 1. Authentication failure
    if status_code == 400 && (status_str == "INVALID_ARGUMENT" && (msg_lower.contains("api key") || msg_lower.contains("api_key") || msg_lower.contains("apikey")))
        || status_str == "API_KEY_INVALID"
        || status_code == 401
        || msg_lower.contains("api key not valid")
        || msg_lower.contains("invalid api key")
        || msg_lower.contains("access_token_type_unsupported")
        || msg_lower.contains("unauthenticated")
    {
        return ClassifiedGeminiError {
            kind: GeminiErrorKind::AuthenticationFailed,
            status_code,
            raw_status,
            user_message: "Gemini authentication failed: Invalid API key or unauthorized. Please verify or update your Gemini API key in Settings.".to_string(),
            action_hint: "open_settings".to_string(),
        };
    }

    // 2. Permission denied / country restriction
    if status_code == 403 || status_str == "PERMISSION_DENIED" || msg_lower.contains("permission_denied") {
        return ClassifiedGeminiError {
            kind: GeminiErrorKind::PermissionDenied,
            status_code,
            raw_status,
            user_message: "Gemini request forbidden (HTTP 403 / PERMISSION_DENIED). Check country availability, billing account status, or API access in Google AI Studio.".to_string(),
            action_hint: "check_permissions".to_string(),
        };
    }

    // 3. Quota or rate-limit exhaustion
    if status_code == 429
        || status_str == "RESOURCE_EXHAUSTED"
        || msg_lower.contains("resource_exhausted")
        || msg_lower.contains("quota exceeded")
        || msg_lower.contains("rate limit")
    {
        let structured_msg = detail.and_then(|d| d.message.as_ref()).map(|m| sanitize_gemini_error_text(m));
        let user_message = if let Some(m) = structured_msg {
            let t = m.trim();
            if !t.is_empty() {
                format!(
                    "Gemini quota or rate limit exceeded (HTTP {} / {}): {}. Check your plan at aistudio.google.com.",
                    status_code,
                    if status_str.is_empty() { "RESOURCE_EXHAUSTED" } else { &status_str },
                    t
                )
            } else {
                "Gemini quota or rate limit exceeded (RESOURCE_EXHAUSTED). Your Google AI Studio project has depleted its request quota or reached rate limits. Check your plan at aistudio.google.com.".to_string()
            }
        } else {
            "Gemini quota or rate limit exceeded (RESOURCE_EXHAUSTED). Your Google AI Studio project has depleted its request quota or reached rate limits. Check your plan at aistudio.google.com.".to_string()
        };

        return ClassifiedGeminiError {
            kind: GeminiErrorKind::RateLimitOrQuotaExceeded,
            status_code,
            raw_status,
            user_message,
            action_hint: "check_quota".to_string(),
        };
    }

    // 4. Model not found
    if status_code == 404 || status_str == "NOT_FOUND" || msg_lower.contains("not found") {
        return ClassifiedGeminiError {
            kind: GeminiErrorKind::ModelNotFound,
            status_code,
            raw_status,
            user_message: format!(
                "Gemini model not found (HTTP 404): {}. Please verify the model identifier in Settings.",
                sanitized_msg
            ),
            action_hint: "open_settings".to_string(),
        };
    }

    // 5. Server unavailable / 5xx
    if (500..=599).contains(&status_code) {
        let structured_msg = detail.and_then(|d| d.message.as_ref()).map(|m| sanitize_gemini_error_text(m));
        let status_label = raw_status.as_deref().unwrap_or(if status_code == 503 { "UNAVAILABLE" } else { "SERVER_ERROR" });

        let user_message = if let Some(msg) = structured_msg {
            let t = msg.trim();
            if !t.is_empty() {
                format!("Google Gemini service unavailable (HTTP {} / {}): {}", status_code, status_label, t)
            } else {
                format!("Google Gemini servers are temporarily experiencing issues (HTTP {}). Please retry in a few moments.", status_code)
            }
        } else {
            format!("Google Gemini servers are temporarily experiencing issues (HTTP {}). Please retry in a few moments.", status_code)
        };

        return ClassifiedGeminiError {
            kind: GeminiErrorKind::ServerUnavailable,
            status_code,
            raw_status,
            user_message,
            action_hint: "retry_later".to_string(),
        };
    }

    // Default classification
    ClassifiedGeminiError {
        kind: GeminiErrorKind::Other(status_code),
        status_code,
        raw_status,
        user_message: format!("Gemini API error (HTTP {}): {}", status_code, sanitized_msg),
        action_hint: "general_error".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_map_messages_to_gemini() {
        let messages = vec![
            ChatMessage {
                role: "system".to_string(),
                content: "You are OmniPilot AI.".to_string(),
            },
            ChatMessage {
                role: "user".to_string(),
                content: "How does Tauri work?".to_string(),
            },
            ChatMessage {
                role: "assistant".to_string(),
                content: "Tauri is a lightweight desktop framework.".to_string(),
            },
            ChatMessage {
                role: "user".to_string(),
                content: "Explain IPC streaming.".to_string(),
            },
        ];

        let (sys_opt, contents) = map_messages_to_gemini(&messages);

        assert!(sys_opt.is_some());
        let sys = sys_opt.unwrap();
        assert_eq!(sys.parts.len(), 1);
        assert_eq!(sys.parts[0].text, "You are OmniPilot AI.");

        assert_eq!(contents.len(), 3);
        assert_eq!(contents[0].role, "user");
        assert_eq!(contents[0].parts[0].text, "How does Tauri work?");

        assert_eq!(contents[1].role, "model"); // "assistant" mapped to "model"
        assert_eq!(contents[1].parts[0].text, "Tauri is a lightweight desktop framework.");

        assert_eq!(contents[2].role, "user");
        assert_eq!(contents[2].parts[0].text, "Explain IPC streaming.");
    }

    #[test]
    fn test_parse_gemini_sse_chunk() {
        let sample_sse_json = r#"{
            "candidates": [
                {
                    "content": {
                        "parts": [
                            {
                                "text": "Hello from Gemini 2.0!"
                            }
                        ],
                        "role": "model"
                    },
                    "finishReason": "STOP",
                    "index": 0
                }
            ]
        }"#;

        let parsed = parse_gemini_sse_chunk(sample_sse_json);
        assert_eq!(parsed, Some("Hello from Gemini 2.0!".to_string()));
    }

    #[test]
    fn test_parse_gemini_sse_chunk_empty_parts() {
        let sample_sse_json = r#"{
            "candidates": [
                {
                    "content": {
                        "parts": [],
                        "role": "model"
                    },
                    "finishReason": "STOP"
                }
            ]
        }"#;

        let parsed = parse_gemini_sse_chunk(sample_sse_json);
        assert_eq!(parsed, None);
    }

    #[test]
    fn test_classify_gemini_auth_error_400() {
        let body = r#"{
            "error": {
                "code": 400,
                "message": "API key not valid. Please pass a valid API key.",
                "status": "INVALID_ARGUMENT",
                "details": [
                    {
                        "@type": "type.googleapis.com/google.rpc.ErrorInfo",
                        "reason": "API_KEY_INVALID"
                    }
                ]
            }
        }"#;

        let classified = sanitize_and_classify_gemini_error(400, body);
        assert_eq!(classified.kind, GeminiErrorKind::AuthenticationFailed);
        assert_eq!(classified.action_hint, "open_settings");
        assert!(classified.user_message.contains("Invalid API key"));
    }

    #[test]
    fn test_classify_gemini_quota_error_429() {
        let body = r#"{
            "error": {
                "code": 429,
                "message": "Resource has been exhausted (e.g. check quota).",
                "status": "RESOURCE_EXHAUSTED"
            }
        }"#;

        let classified = sanitize_and_classify_gemini_error(429, body);
        assert_eq!(classified.kind, GeminiErrorKind::RateLimitOrQuotaExceeded);
        assert_eq!(classified.action_hint, "check_quota");
        assert!(classified.user_message.contains("RESOURCE_EXHAUSTED"));
    }

    #[test]
    fn test_classify_gemini_model_not_found_404() {
        let body = r#"{
            "error": {
                "code": 404,
                "message": "models/gemini-nonexistent is not found for API version v1beta",
                "status": "NOT_FOUND"
            }
        }"#;

        let classified = sanitize_and_classify_gemini_error(404, body);
        assert_eq!(classified.kind, GeminiErrorKind::ModelNotFound);
        assert_eq!(classified.action_hint, "open_settings");
        assert!(classified.user_message.contains("HTTP 404"));
    }

    #[test]
    fn test_apply_gemini_auth_headers_aiza_key() {
        let mut headers = HeaderMap::new();
        let key = "AIzaSyB1234567890abcdefghijklmn";
        assert!(apply_gemini_auth_headers(&mut headers, key).is_ok());
        assert_eq!(headers.get("x-goog-api-key").unwrap(), "AIzaSyB1234567890abcdefghijklmn");
        assert!(headers.get("x-goog-api-key").unwrap().is_sensitive());
        assert!(headers.get(AUTHORIZATION).is_none());
    }

    #[test]
    fn test_apply_gemini_auth_headers_aq_key() {
        let mut headers = HeaderMap::new();
        let key = "AQ.AbMockKey1234567890abcdef.xyz_123-456";
        assert!(apply_gemini_auth_headers(&mut headers, key).is_ok());
        assert_eq!(headers.get("x-goog-api-key").unwrap(), "AQ.AbMockKey1234567890abcdef.xyz_123-456");
        assert!(headers.get("x-goog-api-key").unwrap().is_sensitive());
        assert!(headers.get(AUTHORIZATION).is_none());
    }

    #[test]
    fn test_apply_gemini_auth_headers_trims_whitespace() {
        let mut headers = HeaderMap::new();
        let key = "   AQ.AbMockKeyWithLeadingAndTrailingWhitespace.xyz_123-456   \n";
        assert!(apply_gemini_auth_headers(&mut headers, key).is_ok());
        assert_eq!(headers.get("x-goog-api-key").unwrap(), "AQ.AbMockKeyWithLeadingAndTrailingWhitespace.xyz_123-456");
        assert!(headers.get("x-goog-api-key").unwrap().is_sensitive());
    }

    #[test]
    fn test_apply_gemini_auth_headers_empty_and_whitespace_rejected() {
        let mut headers = HeaderMap::new();
        assert!(apply_gemini_auth_headers(&mut headers, "").is_err());
        assert!(apply_gemini_auth_headers(&mut headers, "   ").is_err());
        assert!(apply_gemini_auth_headers(&mut headers, "\t\n").is_err());
    }

    #[test]
    fn test_apply_gemini_auth_headers_bearer_and_oauth_tokens() {
        let mut headers_oauth = HeaderMap::new();
        assert!(apply_gemini_auth_headers(&mut headers_oauth, "ya29.mock-oauth-token-1234567890").is_ok());
        assert_eq!(headers_oauth.get(AUTHORIZATION).unwrap(), "Bearer ya29.mock-oauth-token-1234567890");
        assert!(headers_oauth.get(AUTHORIZATION).unwrap().is_sensitive());
        assert!(headers_oauth.get("x-goog-api-key").is_none());

        let mut headers_bearer = HeaderMap::new();
        assert!(apply_gemini_auth_headers(&mut headers_bearer, "Bearer custom-access-token-abc").is_ok());
        assert_eq!(headers_bearer.get(AUTHORIZATION).unwrap(), "Bearer custom-access-token-abc");
        assert!(headers_bearer.get(AUTHORIZATION).unwrap().is_sensitive());
        assert!(headers_bearer.get("x-goog-api-key").is_none());
    }

    #[test]
    fn test_classify_gemini_auth_error_401() {
        let body = r#"{
            "error": {
                "code": 401,
                "message": "Request had invalid authentication credentials. Expected OAuth 2 access token, login cookie or other valid authentication credential.",
                "status": "UNAUTHENTICATED"
            }
        }"#;

        let classified = sanitize_and_classify_gemini_error(401, body);
        assert_eq!(classified.kind, GeminiErrorKind::AuthenticationFailed);
        assert_eq!(classified.action_hint, "open_settings");
        assert!(classified.user_message.contains("Invalid API key or unauthorized"));
    }

    #[test]
    fn test_sanitize_gemini_error_text_redacts_credentials() {
        let text_with_key = "Failed request with AIzaSyB1234567890abcdefghijklmn, AQ.AbMockKey1234567890abcdef.xyz_123, ya29.a0AfH6SMTestToken12345, and sk-proj-1234567890abcdef.";
        let sanitized = sanitize_gemini_error_text(text_with_key);
        assert!(!sanitized.contains("AIzaSyB1234567890abcdefghijklmn"));
        assert!(!sanitized.contains("AQ.AbMockKey1234567890abcdef.xyz_123"));
        assert!(!sanitized.contains("ya29.a0AfH6SMTestToken12345"));
        assert!(!sanitized.contains("sk-proj-1234567890abcdef"));
        assert!(sanitized.contains("[REDACTED_GEMINI_KEY]"));
        assert!(sanitized.contains("[REDACTED_GEMINI_TOKEN]"));
        assert!(sanitized.contains("[REDACTED_OPENAI_KEY]"));
    }

    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::atomic::AtomicUsize;

    fn spawn_mock_server<F>(handler: F) -> (String, std::sync::mpsc::Sender<()>, Arc<AtomicUsize>)
    where
        F: Fn(usize, &str) -> (u16, Vec<(&'static str, String)>, Vec<u8>) + Send + Sync + 'static,
    {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind listener");
        let port = listener.local_addr().expect("port").port();
        let base_url = format!("http://127.0.0.1:{}", port);
        let handler = Arc::new(handler);
        let request_count = Arc::new(AtomicUsize::new(0));
        let count_clone = Arc::clone(&request_count);
        let (shutdown_tx, shutdown_rx) = std::sync::mpsc::channel();

        std::thread::spawn(move || {
            let _ = listener.set_nonblocking(true);
            loop {
                if shutdown_rx.try_recv().is_ok() {
                    break;
                }
                match listener.accept() {
                    Ok((mut stream, _)) => {
                        let current_count = count_clone.fetch_add(1, Ordering::SeqCst) + 1;
                        let mut buf = vec![0u8; 4096];
                        let mut received = Vec::new();
                        let _ = stream.set_read_timeout(Some(Duration::from_millis(500)));

                        let mut content_length = 0;
                        let mut header_end = None;

                        while let Ok(n) = stream.read(&mut buf) {
                            if n == 0 {
                                break;
                            }
                            received.extend_from_slice(&buf[..n]);

                            if header_end.is_none() {
                                if let Some(pos) = received.windows(4).position(|w| w == b"\r\n\r\n") {
                                    header_end = Some(pos);
                                    let headers_part = String::from_utf8_lossy(&received[..pos]);
                                    for line in headers_part.lines() {
                                        let line_lower = line.to_lowercase();
                                        if let Some(val) = line_lower.strip_prefix("content-length:") {
                                            if let Ok(cl) = val.trim().parse::<usize>() {
                                                content_length = cl;
                                            }
                                        }
                                    }
                                }
                            }

                            if let Some(pos) = header_end {
                                if received.len() >= pos + 4 + content_length {
                                    break;
                                }
                            }
                        }

                        let req_str = String::from_utf8_lossy(&received);
                        let (status_code, headers, body) = handler(current_count, &req_str);
                        let reason = match status_code {
                            200 => "OK",
                            429 => "Too Many Requests",
                            503 => "Service Unavailable",
                            _ => "Response",
                        };
                        let mut resp = format!("HTTP/1.1 {} {}\r\n", status_code, reason);
                        let mut has_cl = false;
                        for (k, v) in headers {
                            if k.eq_ignore_ascii_case("content-length") {
                                has_cl = true;
                            }
                            resp.push_str(&format!("{}: {}\r\n", k, v));
                        }
                        if !has_cl {
                            resp.push_str(&format!("Content-Length: {}\r\n", body.len()));
                        }
                        resp.push_str("Connection: close\r\n\r\n");
                        let _ = stream.write_all(resp.as_bytes());
                        let _ = stream.write_all(&body);
                        let _ = stream.flush();
                        let _ = stream.shutdown(std::net::Shutdown::Write);
                        let mut drain = [0u8; 128];
                        while let Ok(n) = stream.read(&mut drain) {
                            if n == 0 {
                                break;
                            }
                        }
                    }
                    Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        std::thread::sleep(Duration::from_millis(5));
                    }
                    Err(_) => break,
                }
            }
        });

        (base_url, shutdown_tx, request_count)
    }

    #[test]
    fn test_503_retry_success() {
        let (base_url, _shutdown, req_count) = spawn_mock_server(|count, _req| {
            if count == 1 {
                let err_body = r#"{"error":{"code":503,"status":"UNAVAILABLE","message":"High demand spike"}}"#.as_bytes().to_vec();
                (503, vec![("Content-Type", "application/json".to_string())], err_body)
            } else {
                let sse_body = "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"Recovered from 503 successfully!\"}]}}]}\n\n".as_bytes().to_vec();
                (200, vec![("Content-Type", "text/event-stream".to_string())], sse_body)
            }
        });

        let client = GeminiClient::new_with_options(base_url, Duration::from_millis(5), 3);
        let mut chunks = Vec::new();
        let cancel_token = Arc::new(AtomicBool::new(false));

        let res = tauri::async_runtime::block_on(client.stream_chat_completion(
            "AQ.MockValidKey123",
            DEFAULT_GEMINI_MODEL,
            &[ChatMessage { role: "user".into(), content: "Hello".into() }],
            cancel_token,
            |event| {
                if let StreamEvent::Chunk(c) = event {
                    chunks.push(c);
                }
                Ok(())
            },
        ));

        assert!(res.is_ok());
        assert_eq!(req_count.load(Ordering::SeqCst), 2);
        assert_eq!(chunks, vec!["Recovered from 503 successfully!"]);
    }

    #[test]
    fn test_repeated_503_exhaustion() {
        let (base_url, _shutdown, req_count) = spawn_mock_server(|_count, _req| {
            let err_body = r#"{"error":{"code":503,"status":"UNAVAILABLE","message":"This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later."}}"#.as_bytes().to_vec();
            (503, vec![("Content-Type", "application/json".to_string())], err_body)
        });

        let client = GeminiClient::new_with_options(base_url, Duration::from_millis(5), 3);
        let cancel_token = Arc::new(AtomicBool::new(false));

        let res = tauri::async_runtime::block_on(client.stream_chat_completion(
            "AQ.MockValidKey123",
            DEFAULT_GEMINI_MODEL,
            &[ChatMessage { role: "user".into(), content: "Hello".into() }],
            cancel_token,
            |_event| Ok(()),
        ));

        assert!(res.is_err());
        let err_msg = res.unwrap_err();
        assert!(err_msg.contains("HTTP 503 / UNAVAILABLE"));
        assert!(err_msg.contains("This model is currently experiencing high demand"));
        // 1 initial attempt + 3 retries = 4 total attempts
        assert_eq!(req_count.load(Ordering::SeqCst), 4);
    }

    #[test]
    fn test_429_handling_and_retry() {
        let (base_url, _shutdown, req_count) = spawn_mock_server(|count, _req| {
            if count == 1 {
                let err_body = r#"{"error":{"code":429,"status":"RESOURCE_EXHAUSTED","message":"Rate limit exceeded"}}"#.as_bytes().to_vec();
                (429, vec![("Content-Type", "application/json".to_string()), ("Retry-After", "0".to_string())], err_body)
            } else {
                let sse_body = "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"Recovered from 429 successfully!\"}]}}]}\n\n".as_bytes().to_vec();
                (200, vec![("Content-Type", "text/event-stream".to_string())], sse_body)
            }
        });

        let client = GeminiClient::new_with_options(base_url, Duration::from_millis(5), 3);
        let mut chunks = Vec::new();
        let cancel_token = Arc::new(AtomicBool::new(false));

        let res = tauri::async_runtime::block_on(client.stream_chat_completion(
            "AQ.MockValidKey123",
            DEFAULT_GEMINI_MODEL,
            &[ChatMessage { role: "user".into(), content: "Hello".into() }],
            cancel_token,
            |event| {
                if let StreamEvent::Chunk(c) = event {
                    chunks.push(c);
                }
                Ok(())
            },
        ));

        assert!(res.is_ok());
        assert!(req_count.load(Ordering::SeqCst) >= 2);
        assert_eq!(chunks, vec!["Recovered from 429 successfully!"]);
    }

    #[test]
    fn test_429_exhaustion_classification() {
        let (base_url, _shutdown, req_count) = spawn_mock_server(|_count, _req| {
            let err_body = r#"{"error":{"code":429,"status":"RESOURCE_EXHAUSTED","message":"Quota exhausted for today"}}"#.as_bytes().to_vec();
            (429, vec![("Content-Type", "application/json".to_string())], err_body)
        });

        let client = GeminiClient::new_with_options(base_url, Duration::from_millis(5), 3);
        let cancel_token = Arc::new(AtomicBool::new(false));

        let res = tauri::async_runtime::block_on(client.stream_chat_completion(
            "AQ.MockValidKey123",
            DEFAULT_GEMINI_MODEL,
            &[ChatMessage { role: "user".into(), content: "Hello".into() }],
            cancel_token,
            |_event| Ok(()),
        ));

        assert!(res.is_err());
        let err_msg = res.unwrap_err();
        assert!(err_msg.contains("RESOURCE_EXHAUSTED"));
        assert!(err_msg.contains("Quota exhausted for today"));
        assert_eq!(req_count.load(Ordering::SeqCst), 4);
    }

    #[test]
    fn test_cancellation_during_backoff() {
        let cancel_token = Arc::new(AtomicBool::new(false));
        let cancel_clone = Arc::clone(&cancel_token);

        let (base_url, _shutdown, req_count) = spawn_mock_server(move |count, _req| {
            if count == 1 {
                // Cancel right when the first failure happens
                cancel_clone.store(true, Ordering::Relaxed);
            }
            let err_body = r#"{"error":{"code":503,"status":"UNAVAILABLE","message":"Temporary outage"}}"#.as_bytes().to_vec();
            (503, vec![("Content-Type", "application/json".to_string())], err_body)
        });

        // Use a 200ms base backoff so cancellation during sleep is guaranteed to be exercised
        let client = GeminiClient::new_with_options(base_url, Duration::from_millis(200), 3);
        let mut events = Vec::new();

        let res = tauri::async_runtime::block_on(client.stream_chat_completion(
            "AQ.MockValidKey123",
            DEFAULT_GEMINI_MODEL,
            &[ChatMessage { role: "user".into(), content: "Hello".into() }],
            cancel_token,
            |event| {
                events.push(event);
                Ok(())
            },
        ));

        assert!(res.is_ok());
        assert!(events.iter().any(|e| matches!(e, StreamEvent::Cancelled)));
        // Retries stopped immediately when cancel token was detected during sleep
        assert_eq!(req_count.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn test_malformed_error_bodies() {
        // Case 1: HTML error body
        let html_body = "<html><body><h1>503 Service Unavailable</h1><p>Gateway error</p></body></html>";
        let classified_html = sanitize_and_classify_gemini_error(503, html_body);
        assert_eq!(classified_html.kind, GeminiErrorKind::ServerUnavailable);
        assert_eq!(classified_html.status_code, 503);
        assert!(classified_html.user_message.contains("Google Gemini servers are temporarily experiencing issues (HTTP 503)"));
        assert!(!classified_html.user_message.contains("<html"));

        // Case 2: Empty error body
        let empty_body = "";
        let classified_empty = sanitize_and_classify_gemini_error(503, empty_body);
        assert_eq!(classified_empty.status_code, 503);
        assert!(classified_empty.user_message.contains("Google Gemini servers are temporarily experiencing issues (HTTP 503)"));

        // Case 3: Incomplete JSON
        let bad_json = r#"{"error": {"#;
        let classified_bad_json = sanitize_and_classify_gemini_error(503, bad_json);
        assert_eq!(classified_bad_json.status_code, 503);
        assert!(classified_bad_json.user_message.contains("Google Gemini servers are temporarily experiencing issues (HTTP 503)"));

        // Case 4: JSON error with empty message
        let empty_msg_json = r#"{"error": {"code": 503, "message": "   "}}"#;
        let classified_empty_msg = sanitize_and_classify_gemini_error(503, empty_msg_json);
        assert_eq!(classified_empty_msg.status_code, 503);
        assert!(classified_empty_msg.user_message.contains("Google Gemini servers are temporarily experiencing issues (HTTP 503)"));
    }

    #[test]
    fn test_retries_stop_after_streaming_starts() {
        let (base_url, _shutdown, req_count) = spawn_mock_server(|_count, _req| {
            let sse_body = "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"First delivered chunk.\"}]}}]}\n\n".as_bytes().to_vec();
            (200, vec![("Content-Type", "text/event-stream".to_string())], sse_body)
        });

        let client = GeminiClient::new_with_options(base_url, Duration::from_millis(5), 3);
        let mut chunks = Vec::new();
        let cancel_token = Arc::new(AtomicBool::new(false));

        let res = tauri::async_runtime::block_on(client.stream_chat_completion(
            "AQ.MockValidKey123",
            DEFAULT_GEMINI_MODEL,
            &[ChatMessage { role: "user".into(), content: "Hello".into() }],
            cancel_token,
            |event| {
                if let StreamEvent::Chunk(c) = event {
                    chunks.push(c);
                }
                Ok(())
            },
        ));

        assert!(res.is_ok());
        assert_eq!(chunks, vec!["First delivered chunk."]);
        // Crucial verification: exactly 1 request made, never retried after streaming started
        assert_eq!(req_count.load(Ordering::SeqCst), 1);
    }

    #[test]
    #[ignore]
    fn test_live_gemini_request() {
        tauri::async_runtime::block_on(async {
            use crate::services::credential_service::{CredentialStorage, KeyringCredentialStore};
            let store = KeyringCredentialStore::new();
            if let Ok(Some(key)) = store.get_key_for_provider("gemini") {
                let client = GeminiClient::new();
                let cancel_token = Arc::new(AtomicBool::new(false));
                let mut events = Vec::new();
                let res = client.stream_chat_completion(
                    &key,
                    DEFAULT_GEMINI_MODEL,
                    &[ChatMessage { role: "user".into(), content: "Say 'Hello OmniPilot'".into() }],
                    cancel_token,
                    |event| {
                        events.push(event);
                        Ok(())
                    }
                ).await;
                println!("Live request result: {:?}", res);
                println!("Live events received: {:?}", events);
            }
        });
    }
}
