use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use crate::models::ai::{ChatMessage, StreamEvent};

pub const DEFAULT_OPENAI_MODEL: &str = "gpt-4o-mini";
pub const OPENAI_CHAT_URL: &str = "https://api.openai.com/v1/chat/completions";
pub const OPENAI_MODELS_URL: &str = "https://api.openai.com/v1/models";

#[derive(Debug, Serialize)]
struct ChatCompletionRequestBody<'a> {
    model: &'a str,
    messages: &'a [ChatMessage],
    stream: bool,
}

#[derive(Debug, Deserialize)]
struct ChatChunkChoiceDelta {
    content: Option<String>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct ChatChunkChoice {
    delta: Option<ChatChunkChoiceDelta>,
    finish_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ChatCompletionChunk {
    choices: Option<Vec<ChatChunkChoice>>,
}

#[derive(Debug, Deserialize)]
pub struct ApiErrorWrapper {
    pub error: Option<ApiErrorDetail>,
}

#[derive(Debug, Deserialize)]
pub struct ApiErrorDetail {
    pub message: Option<String>,
    #[serde(rename = "type")]
    pub error_type: Option<String>,
    pub code: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OpenAiErrorKind {
    /// True request/token rate limits (TPM/RPM throttling)
    RateLimitExceeded { retry_after_secs: Option<u64> },
    /// Quota exhausted (no prepaid credits or monthly quota depleted)
    InsufficientQuota,
    /// Prepaid credit balance is zero/exhausted
    CreditBalanceExhausted,
    /// Organization level usage limit exceeded
    OrganizationUsageLimitExceeded,
    /// Organization level spend limit reached
    OrganizationSpendLimitExceeded,
    /// Project level spend limit reached
    ProjectSpendLimitExceeded,
    /// Invalid API key or unauthorized
    AuthenticationFailed,
    /// Model or endpoint not found
    ModelNotFound,
    /// 5xx server issues
    ServerUnavailable,
    /// Network connection or timeout failure
    NetworkError,
    /// Other unclassified errors
    Other(u16),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ClassifiedProviderError {
    pub kind: OpenAiErrorKind,
    pub raw_code: Option<String>,
    pub raw_type: Option<String>,
    pub retry_after_secs: Option<u64>,
    pub user_message: String,
    pub action_hint: String,
}

pub struct OpenAiClient {
    client: reqwest::Client,
}

impl Default for OpenAiClient {
    fn default() -> Self {
        Self::new()
    }
}

impl OpenAiClient {
    pub fn new() -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(60))
            .connect_timeout(Duration::from_secs(15))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());

        Self { client }
    }

    /// Verifies the API key against the OpenAI /v1/models endpoint.
    /// Note: Authenticating against /v1/models verifies credential validity without deducting token credits,
    /// but chat completions require an active credit balance or quota on the OpenAI account.
    pub async fn verify_api_key(&self, api_key: &str) -> Result<String, String> {
        let trimmed_key = api_key.trim();
        if trimmed_key.is_empty() {
            return Err("API key is empty.".to_string());
        }

        let mut headers = HeaderMap::new();
        let auth_val = format!("Bearer {}", trimmed_key);
        let mut header_value = HeaderValue::from_str(&auth_val)
            .map_err(|_| "Invalid characters in API key header.".to_string())?;
        header_value.set_sensitive(true);
        headers.insert(AUTHORIZATION, header_value);

        let response = match self
            .client
            .get(OPENAI_MODELS_URL)
            .headers(headers)
            .send()
            .await
        {
            Ok(resp) => resp,
            Err(e) => {
                return Err(sanitize_network_error(&e));
            }
        };

        let status = response.status();
        if status.is_success() {
            Ok("OpenAI API key authenticated successfully (access to /v1/models confirmed). Note: Chat completions require active account credit balance or quota.".to_string())
        } else {
            let retry_after = response
                .headers()
                .get("retry-after")
                .and_then(|v| v.to_str().ok())
                .and_then(|s| parse_retry_after(Some(s)));

            let error_text = response.text().await.unwrap_or_default();
            let classified = sanitize_and_classify_openai_error(status.as_u16(), &error_text, retry_after);
            Err(classified.user_message)
        }
    }

    /// Streams chat completions from OpenAI using SSE.
    /// Checks `cancel_token` periodically to support user cancellation.
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
            let err_msg = "No OpenAI API key provided. Please configure your key in Settings.".to_string();
            let _ = on_event(StreamEvent::Error(err_msg.clone()));
            return Err(err_msg);
        }

        let mut headers = HeaderMap::new();
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
        let auth_val = format!("Bearer {}", trimmed_key);
        let mut header_value = HeaderValue::from_str(&auth_val)
            .map_err(|_| "Invalid characters in authorization header.".to_string())?;
        header_value.set_sensitive(true);
        headers.insert(AUTHORIZATION, header_value);

        let body = ChatCompletionRequestBody {
            model,
            messages,
            stream: true,
        };

        let response = match self
            .client
            .post(OPENAI_CHAT_URL)
            .headers(headers)
            .json(&body)
            .send()
            .await
        {
            Ok(resp) => resp,
            Err(e) => {
                let err_msg = sanitize_network_error(&e);
                let _ = on_event(StreamEvent::Error(err_msg.clone()));
                return Err(err_msg);
            }
        };

        let status = response.status();
        if !status.is_success() {
            let retry_after = response
                .headers()
                .get("retry-after")
                .and_then(|v| v.to_str().ok())
                .and_then(|s| parse_retry_after(Some(s)));

            let error_text = response.text().await.unwrap_or_default();
            let classified = sanitize_and_classify_openai_error(status.as_u16(), &error_text, retry_after);
            let err_msg = classified.user_message.clone();
            let _ = on_event(StreamEvent::Error(err_msg.clone()));
            return Err(err_msg);
        }

        let mut stream = response;
        let mut buffer = String::new();

        while let Some(chunk) = stream.chunk().await.map_err(|e| {
            let msg = format!("Network streaming error: {}", e);
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
                    if data_trimmed == "[DONE]" {
                        let _ = on_event(StreamEvent::Done);
                        return Ok(());
                    }

                    if let Some(token) = parse_sse_chunk(data_trimmed) {
                        if !token.is_empty() {
                            let _ = on_event(StreamEvent::Chunk(token));
                        }
                    }
                }
            }
        }

        // Final buffer drain check
        let remaining = buffer.trim();
        if !remaining.is_empty() && remaining.starts_with("data:") {
            if let Some(data) = remaining.strip_prefix("data:") {
                let data_trimmed = data.trim();
                if data_trimmed == "[DONE]" {
                    let _ = on_event(StreamEvent::Done);
                    return Ok(());
                }
                if let Some(token) = parse_sse_chunk(data_trimmed) {
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

/// Parses an SSE data payload from OpenAI chat completions chunk.
pub fn parse_sse_chunk(json_str: &str) -> Option<String> {
    if json_str == "[DONE]" {
        return None;
    }

    match serde_json::from_str::<ChatCompletionChunk>(json_str) {
        Ok(chunk) => {
            if let Some(choices) = chunk.choices {
                if let Some(first_choice) = choices.into_iter().next() {
                    if let Some(delta) = first_choice.delta {
                        return delta.content;
                    }
                }
            }
            None
        }
        Err(_) => None,
    }
}

/// Parses a Retry-After header value into seconds.
/// Supports integer seconds (e.g. "3") and floating point seconds (e.g. "1.5").
pub fn parse_retry_after(header_val: Option<&str>) -> Option<u64> {
    let s = header_val?.trim();
    if let Ok(secs) = s.parse::<u64>() {
        return Some(secs);
    }
    if let Ok(float_secs) = s.parse::<f64>() {
        return Some(float_secs.ceil() as u64);
    }
    None
}

/// Sanitizes error text so no API keys (`sk-...`) or Bearer authorization headers appear.
pub fn sanitize_error_text(text: &str) -> String {
    let mut sanitized = text.to_string();
    if sanitized.contains("Bearer ") {
        sanitized = sanitized.replace("Bearer ", "Bearer [REDACTED]");
    }

    // Redact any sk-... key occurrences
    let mut result = String::new();
    let mut chars = sanitized.chars().peekable();
    while let Some(c) = chars.next() {
        if c == 's' && chars.peek() == Some(&'k') {
            let mut prefix = String::from("s");
            prefix.push(chars.next().unwrap()); // 'k'
            if chars.peek() == Some(&'-') {
                prefix.push(chars.next().unwrap()); // '-'
                while let Some(&next_ch) = chars.peek() {
                    if next_ch.is_ascii_alphanumeric() || next_ch == '-' || next_ch == '_' {
                        chars.next();
                    } else {
                        break;
                    }
                }
                result.push_str("[REDACTED_KEY]");
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

/// Sanitizes network errors so no tokens, URLs with sensitive params, or keys are returned.
pub fn sanitize_network_error(err: &reqwest::Error) -> String {
    if err.is_timeout() {
        "Request timed out while connecting to OpenAI API. Please check your network connection and retry.".to_string()
    } else if err.is_connect() {
        "Unable to connect to OpenAI API endpoint. Please check your internet connection or proxy settings.".to_string()
    } else {
        "Network communication failure while contacting OpenAI API.".to_string()
    }
}

/// Backwards-compatible string helper that delegates to structured classifier.
pub fn sanitize_openai_error_response(status_code: u16, response_body: &str) -> String {
    sanitize_and_classify_openai_error(status_code, response_body, None).user_message
}

/// Classifies OpenAI errors by status code, structured `code`, `type`, and message,
/// extracting `Retry-After` where applicable and ensuring billing/quota errors are clearly
/// distinguished from temporary request rate limits.
pub fn sanitize_and_classify_openai_error(
    status_code: u16,
    response_body: &str,
    retry_after: Option<u64>,
) -> ClassifiedProviderError {
    let parsed_wrapper = serde_json::from_str::<ApiErrorWrapper>(response_body).ok();
    let detail = parsed_wrapper.as_ref().and_then(|w| w.error.as_ref());

    let raw_code = detail.and_then(|d| d.code.clone());
    let raw_type = detail.and_then(|d| d.error_type.clone());
    let raw_message = detail
        .and_then(|d| d.message.clone())
        .unwrap_or_else(|| response_body.to_string());

    let sanitized_msg = sanitize_error_text(&raw_message);

    let code_lower = raw_code.as_deref().unwrap_or("").to_lowercase();
    let type_lower = raw_type.as_deref().unwrap_or("").to_lowercase();
    let msg_lower = sanitized_msg.to_lowercase();

    match status_code {
        401 => ClassifiedProviderError {
            kind: OpenAiErrorKind::AuthenticationFailed,
            raw_code,
            raw_type,
            retry_after_secs: None,
            user_message: "OpenAI authentication failed: Invalid API key or unauthorized. Please verify or update your API key in Settings.".to_string(),
            action_hint: "open_settings".to_string(),
        },
        403 => ClassifiedProviderError {
            kind: OpenAiErrorKind::Other(403),
            raw_code,
            raw_type,
            retry_after_secs: None,
            user_message: "OpenAI request forbidden (HTTP 403). Check country restrictions or organization permissions for your API key.".to_string(),
            action_hint: "check_permissions".to_string(),
        },
        404 => ClassifiedProviderError {
            kind: OpenAiErrorKind::ModelNotFound,
            raw_code,
            raw_type,
            retry_after_secs: None,
            user_message: format!(
                "OpenAI model or endpoint not found (HTTP 404): {}. Please verify the model identifier in Settings.",
                sanitized_msg
            ),
            action_hint: "open_settings".to_string(),
        },
        500..=599 => ClassifiedProviderError {
            kind: OpenAiErrorKind::ServerUnavailable,
            raw_code,
            raw_type,
            retry_after_secs: None,
            user_message: format!(
                "OpenAI servers are temporarily experiencing issues (HTTP {}). Please retry in a few moments.",
                status_code
            ),
            action_hint: "retry_later".to_string(),
        },
        429 => {
            // 1. Quota Exhaustion (insufficient_quota)
            if code_lower == "insufficient_quota"
                || type_lower == "insufficient_quota"
                || msg_lower.contains("insufficient_quota")
                || msg_lower.contains("exceeded your current quota")
                || (msg_lower.contains("quota") && !msg_lower.contains("rate limit"))
            {
                ClassifiedProviderError {
                    kind: OpenAiErrorKind::InsufficientQuota,
                    raw_code,
                    raw_type,
                    retry_after_secs: None,
                    user_message: "OpenAI quota exceeded (insufficient_quota). Your OpenAI account does not have sufficient credit balance or quota. Waiting will not resolve this error; please check billing and add credits at platform.openai.com/billing.".to_string(),
                    action_hint: "check_billing".to_string(),
                }
            }
            // 2. Credit balance exhausted
            else if code_lower == "credit_balance_exhausted"
                || type_lower == "credit_balance_exhausted"
                || msg_lower.contains("credit_balance_exhausted")
                || msg_lower.contains("credit balance is exhausted")
                || msg_lower.contains("zero credit balance")
            {
                ClassifiedProviderError {
                    kind: OpenAiErrorKind::CreditBalanceExhausted,
                    raw_code,
                    raw_type,
                    retry_after_secs: None,
                    user_message: "OpenAI prepaid credit balance is exhausted (credit_balance_exhausted). Waiting will not resolve this error; please top up your account balance at platform.openai.com/billing.".to_string(),
                    action_hint: "check_billing".to_string(),
                }
            }
            // 3. Organization spend limit exceeded
            else if code_lower == "organization_spend_limit_exceeded"
                || type_lower == "organization_spend_limit_exceeded"
                || msg_lower.contains("organization_spend_limit_exceeded")
                || msg_lower.contains("organization spend limit")
            {
                ClassifiedProviderError {
                    kind: OpenAiErrorKind::OrganizationSpendLimitExceeded,
                    raw_code,
                    raw_type,
                    retry_after_secs: None,
                    user_message: "OpenAI organization spend limit exceeded (organization_spend_limit_exceeded). Waiting will not resolve this error; your organization monthly spend limit must be increased in OpenAI organization settings.".to_string(),
                    action_hint: "check_billing".to_string(),
                }
            }
            // 4. Organization usage limit exceeded
            else if code_lower == "organization_usage_limit_exceeded"
                || type_lower == "organization_usage_limit_exceeded"
                || msg_lower.contains("organization_usage_limit_exceeded")
                || msg_lower.contains("organization usage limit")
            {
                ClassifiedProviderError {
                    kind: OpenAiErrorKind::OrganizationUsageLimitExceeded,
                    raw_code,
                    raw_type,
                    retry_after_secs: None,
                    user_message: "OpenAI organization usage limit reached (organization_usage_limit_exceeded). Waiting will not resolve this error; please check organization usage limits in your OpenAI dashboard.".to_string(),
                    action_hint: "check_billing".to_string(),
                }
            }
            // 5. Project spend limit exceeded
            else if code_lower == "project_spend_limit_exceeded"
                || type_lower == "project_spend_limit_exceeded"
                || msg_lower.contains("project_spend_limit_exceeded")
                || msg_lower.contains("project spend limit")
            {
                ClassifiedProviderError {
                    kind: OpenAiErrorKind::ProjectSpendLimitExceeded,
                    raw_code,
                    raw_type,
                    retry_after_secs: None,
                    user_message: "OpenAI project spend limit reached (project_spend_limit_exceeded). Waiting will not resolve this error; please check project spend limits in your OpenAI dashboard.".to_string(),
                    action_hint: "check_billing".to_string(),
                }
            }
            // 6. Genuine Temporary Rate Limit (TPM/RPM throttling)
            else {
                let effective_delay = retry_after.or_else(|| {
                    if let Some(pos) = msg_lower.find("try again in ") {
                        let sub = &msg_lower[pos + 13..];
                        if let Some(space_pos) = sub.find(|c: char| c == ' ' || c == '.' || c == ',') {
                            let duration_str = &sub[..space_pos].trim();
                            if duration_str.ends_with('s') && !duration_str.ends_with("ms") {
                                duration_str[..duration_str.len() - 1].parse::<f64>().ok().map(|d| d.ceil() as u64)
                            } else {
                                None
                            }
                        } else {
                            None
                        }
                    } else {
                        None
                    }
                });

                let user_message = match effective_delay {
                    Some(secs) => format!(
                        "OpenAI rate limit reached (request/token throttling). Please wait {} second(s) before retrying (Retry-After: {}s).",
                        secs, secs
                    ),
                    None => "OpenAI rate limit reached (request/token throttling). Please wait a moment before sending another prompt.".to_string(),
                };

                ClassifiedProviderError {
                    kind: OpenAiErrorKind::RateLimitExceeded {
                        retry_after_secs: effective_delay,
                    },
                    raw_code,
                    raw_type,
                    retry_after_secs: effective_delay,
                    user_message,
                    action_hint: if effective_delay.is_some() {
                        "retry_after".to_string()
                    } else {
                        "wait_and_retry".to_string()
                    },
                }
            }
        }
        _ => ClassifiedProviderError {
            kind: OpenAiErrorKind::Other(status_code),
            raw_code,
            raw_type,
            retry_after_secs: None,
            user_message: format!("OpenAI API error (HTTP {}): {}", status_code, sanitized_msg),
            action_hint: "check_error".to_string(),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_sse_chunk_content() {
        let valid_sse = r#"{"id":"chatcmpl-123","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"Hello world"},"finish_reason":null}]}"#;
        assert_eq!(parse_sse_chunk(valid_sse), Some("Hello world".to_string()));
    }

    #[test]
    fn test_parse_sse_chunk_empty_delta() {
        let empty_delta = r#"{"id":"chatcmpl-123","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":null}]}"#;
        assert_eq!(parse_sse_chunk(empty_delta), None);
    }

    #[test]
    fn test_parse_sse_chunk_done() {
        assert_eq!(parse_sse_chunk("[DONE]"), None);
    }

    #[test]
    fn test_parse_retry_after() {
        assert_eq!(parse_retry_after(Some("5")), Some(5));
        assert_eq!(parse_retry_after(Some("1.8")), Some(2));
        assert_eq!(parse_retry_after(Some("invalid")), None);
        assert_eq!(parse_retry_after(None), None);
    }

    #[test]
    fn test_classify_insufficient_quota_code() {
        let json = r#"{"error":{"message":"You exceeded your current quota, please check your plan and billing details.","type":"insufficient_quota","param":null,"code":"insufficient_quota"}}"#;
        let classified = sanitize_and_classify_openai_error(429, json, None);
        assert_eq!(classified.kind, OpenAiErrorKind::InsufficientQuota);
        assert_eq!(classified.action_hint, "check_billing");
        assert!(classified.user_message.contains("insufficient_quota"));
        assert!(classified.user_message.contains("Waiting will not resolve this error"));
        assert!(!classified.user_message.contains("rate limit reached"));
    }

    #[test]
    fn test_classify_insufficient_quota_type() {
        let json = r#"{"error":{"message":"Quota exceeded","type":"insufficient_quota","param":null,"code":null}}"#;
        let classified = sanitize_and_classify_openai_error(429, json, None);
        assert_eq!(classified.kind, OpenAiErrorKind::InsufficientQuota);
        assert_eq!(classified.action_hint, "check_billing");
    }

    #[test]
    fn test_classify_credit_balance_exhausted() {
        let json = r#"{"error":{"message":"Your credit balance is exhausted","type":"invalid_request_error","param":null,"code":"credit_balance_exhausted"}}"#;
        let classified = sanitize_and_classify_openai_error(429, json, None);
        assert_eq!(classified.kind, OpenAiErrorKind::CreditBalanceExhausted);
        assert_eq!(classified.action_hint, "check_billing");
        assert!(classified.user_message.contains("credit_balance_exhausted"));
    }

    #[test]
    fn test_classify_organization_spend_limit_exceeded() {
        let json = r#"{"error":{"message":"Organization spend limit exceeded","type":"organization_spend_limit_exceeded","param":null,"code":"organization_spend_limit_exceeded"}}"#;
        let classified = sanitize_and_classify_openai_error(429, json, None);
        assert_eq!(classified.kind, OpenAiErrorKind::OrganizationSpendLimitExceeded);
        assert_eq!(classified.action_hint, "check_billing");
    }

    #[test]
    fn test_classify_organization_usage_limit_exceeded() {
        let json = r#"{"error":{"message":"Usage limit exceeded","type":"organization_usage_limit_exceeded","param":null,"code":"organization_usage_limit_exceeded"}}"#;
        let classified = sanitize_and_classify_openai_error(429, json, None);
        assert_eq!(classified.kind, OpenAiErrorKind::OrganizationUsageLimitExceeded);
        assert_eq!(classified.action_hint, "check_billing");
    }

    #[test]
    fn test_classify_project_spend_limit_exceeded() {
        let json = r#"{"error":{"message":"Project spend limit exceeded","type":"project_spend_limit_exceeded","param":null,"code":"project_spend_limit_exceeded"}}"#;
        let classified = sanitize_and_classify_openai_error(429, json, None);
        assert_eq!(classified.kind, OpenAiErrorKind::ProjectSpendLimitExceeded);
        assert_eq!(classified.action_hint, "check_billing");
    }

    #[test]
    fn test_classify_temporary_rate_limit_with_retry_after() {
        let json = r#"{"error":{"message":"Rate limit reached for gpt-4o on tokens per min (TPM): Limit 30000","type":"tokens","param":null,"code":"rate_limit_exceeded"}}"#;
        let classified = sanitize_and_classify_openai_error(429, json, Some(7));
        assert_eq!(
            classified.kind,
            OpenAiErrorKind::RateLimitExceeded {
                retry_after_secs: Some(7)
            }
        );
        assert_eq!(classified.action_hint, "retry_after");
        assert!(classified.user_message.contains("7 second(s)"));
        assert!(classified.user_message.contains("Retry-After: 7s"));
    }

    #[test]
    fn test_classify_temporary_rate_limit_without_retry_after() {
        let json = r#"{"error":{"message":"Rate limit reached for requests per minute","type":"requests","param":null,"code":"rate_limit_exceeded"}}"#;
        let classified = sanitize_and_classify_openai_error(429, json, None);
        assert_eq!(
            classified.kind,
            OpenAiErrorKind::RateLimitExceeded {
                retry_after_secs: None
            }
        );
        assert_eq!(classified.action_hint, "wait_and_retry");
        assert!(classified.user_message.contains("rate limit reached"));
    }

    #[test]
    fn test_classify_authentication_failed_401() {
        let json = r#"{"error":{"message":"Incorrect API key provided: sk-secret123"}}"#;
        let classified = sanitize_and_classify_openai_error(401, json, None);
        assert_eq!(classified.kind, OpenAiErrorKind::AuthenticationFailed);
        assert_eq!(classified.action_hint, "open_settings");
        assert!(!classified.user_message.contains("sk-secret123"));
    }

    #[test]
    fn test_classify_model_not_found_404() {
        let json = r#"{"error":{"message":"The model 'gpt-bad' does not exist"}}"#;
        let classified = sanitize_and_classify_openai_error(404, json, None);
        assert_eq!(classified.kind, OpenAiErrorKind::ModelNotFound);
        assert_eq!(classified.action_hint, "open_settings");
        assert!(classified.user_message.contains("model or endpoint not found"));
    }

    #[test]
    fn test_classify_server_unavailable_503() {
        let classified = sanitize_and_classify_openai_error(503, "Service Unavailable", None);
        assert_eq!(classified.kind, OpenAiErrorKind::ServerUnavailable);
        assert!(classified.user_message.contains("503"));
    }

    #[test]
    fn test_sanitize_error_text_redacts_keys() {
        let raw = "Error occurred with key sk-proj-supersecret123456789 and Bearer sk-anothersecret987654";
        let sanitized = sanitize_error_text(raw);
        assert!(!sanitized.contains("sk-proj-supersecret123456789"));
        assert!(!sanitized.contains("sk-anothersecret987654"));
        assert!(sanitized.contains("[REDACTED_KEY]"));
    }

    #[test]
    fn test_do_not_retry_quota_or_billing_errors() {
        let quota_json = r#"{"error":{"message":"insufficient quota","type":"insufficient_quota","code":"insufficient_quota"}}"#;
        let classified = sanitize_and_classify_openai_error(429, quota_json, Some(10));
        // Even if Retry-After was sent, a quota error is NOT a temporary rate limit!
        assert_eq!(classified.kind, OpenAiErrorKind::InsufficientQuota);
        assert_eq!(classified.action_hint, "check_billing");
        assert!(classified.user_message.contains("Waiting will not resolve this error"));
    }
}
