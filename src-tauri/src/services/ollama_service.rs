use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use reqwest::header::{HeaderMap, HeaderValue, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use crate::models::ai::{ChatMessage, StreamEvent};

pub const DEFAULT_OLLAMA_ENDPOINT: &str = "http://127.0.0.1:11434";
pub const DEFAULT_OLLAMA_MODEL: &str = "qwen2.5-coder:3b";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OllamaModelDetails {
    #[serde(default)]
    pub format: Option<String>,
    #[serde(default)]
    pub family: Option<String>,
    #[serde(default)]
    pub parameter_size: Option<String>,
    #[serde(default)]
    pub quantization_level: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OllamaModelItem {
    pub name: String,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub size: Option<u64>,
    #[serde(default)]
    pub details: Option<OllamaModelDetails>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OllamaTagsResponse {
    #[serde(default)]
    pub models: Vec<OllamaModelItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OllamaChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OllamaChatRequest {
    pub model: String,
    pub messages: Vec<OllamaChatMessage>,
    pub stream: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OllamaChatChunk {
    pub model: Option<String>,
    pub message: Option<OllamaChatMessage>,
    #[serde(default)]
    pub done: bool,
    #[serde(default)]
    pub done_reason: Option<String>,
    #[serde(default)]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OllamaChatResponse {
    pub model: Option<String>,
    pub message: Option<OllamaChatMessage>,
    #[serde(default)]
    pub done: bool,
    #[serde(default)]
    pub error: Option<String>,
}

pub struct OllamaClient {
    client: reqwest::Client,
}

impl Default for OllamaClient {
    fn default() -> Self {
        Self::new()
    }
}

impl OllamaClient {
    pub fn new() -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(120))
            .connect_timeout(Duration::from_secs(5))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());
        Self { client }
    }

    pub fn new_with_client(client: reqwest::Client) -> Self {
        Self { client }
    }

    /// Normalizes endpoint URL, trimming whitespace and stripping trailing slashes.
    pub fn normalize_endpoint(endpoint: &str) -> String {
        let trimmed = endpoint.trim();
        if trimmed.is_empty() {
            DEFAULT_OLLAMA_ENDPOINT.to_string()
        } else {
            trimmed.trim_end_matches('/').to_string()
        }
    }

    /// Verifies availability of the local Ollama server by querying `/api/tags`
    /// and checks if the configured model is installed.
    pub async fn verify_connection(&self, endpoint: &str, model: &str) -> Result<String, String> {
        let base_url = Self::normalize_endpoint(endpoint);
        let tags_url = format!("{}/api/tags", base_url);

        let response = match self
            .client
            .get(&tags_url)
            .timeout(Duration::from_secs(4))
            .send()
            .await
        {
            Ok(resp) => resp,
            Err(err) => {
                let err_str = err.to_string();
                if err.is_connect() || err_str.contains("refused") || err_str.contains("connect") {
                    return Err(format!(
                        "Cannot connect to Ollama server at '{}'. Please verify that Ollama is installed and running ('ollama serve').",
                        base_url
                    ));
                } else if err.is_timeout() {
                    return Err(format!(
                        "Connection to Ollama server at '{}' timed out. The server may be unresponsive.",
                        base_url
                    ));
                }
                return Err(format!(
                    "Failed to connect to Ollama at '{}': {}",
                    base_url, err_str
                ));
            }
        };

        let status = response.status();
        if !status.is_success() {
            let status_code = status.as_u16();
            let body = response.text().await.unwrap_or_default();
            return Err(format!(
                "Ollama server at '{}' returned HTTP {} status: {}",
                base_url, status_code, body
            ));
        }

        let body_bytes = response.bytes().await.map_err(|e| {
            format!("Failed to read response from Ollama at '{}': {}", base_url, e)
        })?;

        let tags_res: OllamaTagsResponse = serde_json::from_slice(&body_bytes).map_err(|e| {
            format!(
                "Received invalid response format from Ollama tags endpoint at '{}': {}",
                base_url, e
            )
        })?;

        let target_model = model.trim();
        let target_base = target_model.split(':').next().unwrap_or(target_model);

        let model_found = tags_res.models.iter().any(|m| {
            let m_name = m.name.trim();
            m_name == target_model
                || m_name.split(':').next().unwrap_or(m_name) == target_base
                || m.model.as_deref().unwrap_or("").trim() == target_model
        });

        let installed_names: Vec<&str> = tags_res.models.iter().map(|m| m.name.as_str()).collect();

        if model_found {
            Ok(format!(
                "Connected to local Ollama server at {}. Model '{}' is installed and ready.",
                base_url, target_model
            ))
        } else if !installed_names.is_empty() {
            Ok(format!(
                "Connected to local Ollama server at {}. Note: target model '{}' not in detected models: [{}].",
                base_url,
                target_model,
                installed_names.join(", ")
            ))
        } else {
            Ok(format!(
                "Connected to local Ollama server at {}. No models found installed. Run 'ollama pull {}' to download it.",
                base_url, target_model
            ))
        }
    }

    /// Non-streaming chat generation through `/api/chat`.
    pub async fn chat_completion(
        &self,
        endpoint: &str,
        model: &str,
        messages: &[ChatMessage],
    ) -> Result<String, String> {
        let base_url = Self::normalize_endpoint(endpoint);
        let chat_url = format!("{}/api/chat", base_url);

        let trimmed_model = if model.trim().is_empty() {
            DEFAULT_OLLAMA_MODEL
        } else {
            model.trim()
        };

        let ollama_messages: Vec<OllamaChatMessage> = messages
            .iter()
            .map(|m| OllamaChatMessage {
                role: m.role.clone(),
                content: m.content.clone(),
            })
            .collect();

        let request_body = OllamaChatRequest {
            model: trimmed_model.to_string(),
            messages: ollama_messages,
            stream: false,
        };

        let mut headers = HeaderMap::new();
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));

        let response = match self
            .client
            .post(&chat_url)
            .headers(headers)
            .json(&request_body)
            .send()
            .await
        {
            Ok(resp) => resp,
            Err(e) => {
                let err_str = e.to_string();
                if e.is_connect() || err_str.contains("refused") || err_str.contains("connect") {
                    return Err(format!(
                        "Cannot connect to Ollama at '{}'. Ensure the Ollama server is running.",
                        base_url
                    ));
                }
                return Err(format!("Ollama chat request failed: {}", err_str));
            }
        };

        let status = response.status();
        let status_code = status.as_u16();
        let body_text = response.text().await.unwrap_or_default();

        if !status.is_success() {
            if status_code == 404 {
                return Err(format!(
                    "Model '{}' was not found on local Ollama server (HTTP 404). Run 'ollama pull {}' to install it.",
                    trimmed_model, trimmed_model
                ));
            }
            return Err(format!(
                "Ollama chat generation error (HTTP {}): {}",
                status_code, body_text
            ));
        }

        let parsed: OllamaChatResponse = serde_json::from_str(&body_text).map_err(|e| {
            format!("Failed to parse Ollama chat completion response: {}. Body: {}", e, body_text)
        })?;

        if let Some(err) = parsed.error {
            return Err(format!("Ollama reported an error: {}", err));
        }

        let content = parsed
            .message
            .map(|m| m.content)
            .unwrap_or_default();

        Ok(content)
    }

    /// Streaming chat generation through `/api/chat` using NDJSON streaming (`stream: true`).
    /// Emits `StreamEvent::Chunk(text)`, respects `cancel_token`, and finishes with `StreamEvent::Done`.
    pub async fn stream_chat_completion<F>(
        &self,
        endpoint: &str,
        model: &str,
        messages: &[ChatMessage],
        cancel_token: Arc<AtomicBool>,
        mut on_event: F,
    ) -> Result<(), String>
    where
        F: FnMut(StreamEvent) -> Result<(), String>,
    {
        let base_url = Self::normalize_endpoint(endpoint);
        let chat_url = format!("{}/api/chat", base_url);

        let trimmed_model = if model.trim().is_empty() {
            DEFAULT_OLLAMA_MODEL
        } else {
            model.trim()
        };

        if cancel_token.load(Ordering::Relaxed) {
            let _ = on_event(StreamEvent::Cancelled);
            return Ok(());
        }

        let ollama_messages: Vec<OllamaChatMessage> = messages
            .iter()
            .map(|m| OllamaChatMessage {
                role: m.role.clone(),
                content: m.content.clone(),
            })
            .collect();

        let request_body = OllamaChatRequest {
            model: trimmed_model.to_string(),
            messages: ollama_messages,
            stream: true,
        };

        let mut headers = HeaderMap::new();
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));

        let response = match self
            .client
            .post(&chat_url)
            .headers(headers)
            .json(&request_body)
            .send()
            .await
        {
            Ok(resp) => resp,
            Err(e) => {
                let err_str = e.to_string();
                let err_msg = if e.is_connect() || err_str.contains("refused") || err_str.contains("connect") {
                    format!(
                        "Cannot connect to Ollama at '{}'. Ensure Ollama is running ('ollama serve').",
                        base_url
                    )
                } else if e.is_timeout() {
                    format!("Connection to Ollama at '{}' timed out.", base_url)
                } else {
                    format!("Ollama request failed: {}", err_str)
                };
                let _ = on_event(StreamEvent::Error(err_msg.clone()));
                return Err(err_msg);
            }
        };

        let status = response.status();
        let status_code = status.as_u16();

        if !status.is_success() {
            let body_text = response.text().await.unwrap_or_default();
            let err_msg = if status_code == 404 {
                format!(
                    "Model '{}' not found on local Ollama server (HTTP 404). Run 'ollama pull {}' to install it.",
                    trimmed_model, trimmed_model
                )
            } else {
                format!(
                    "Ollama streaming generation error (HTTP {}): {}",
                    status_code, body_text
                )
            };
            let _ = on_event(StreamEvent::Error(err_msg.clone()));
            return Err(err_msg);
        }

        let mut response = response;
        let mut buffer = String::new();

        while let Some(chunk) = response.chunk().await.map_err(|e| {
            let err_msg = format!("Error reading stream from Ollama: {}", e);
            let _ = on_event(StreamEvent::Error(err_msg.clone()));
            err_msg
        })? {
            if cancel_token.load(Ordering::Relaxed) {
                let _ = on_event(StreamEvent::Cancelled);
                return Ok(());
            }

            let chunk_str = String::from_utf8_lossy(&chunk);
            buffer.push_str(&chunk_str);

            while let Some(newline_pos) = buffer.find('\n') {
                let line = buffer[..newline_pos].trim().to_string();
                buffer.drain(..=newline_pos);

                if line.is_empty() {
                    continue;
                }

                if cancel_token.load(Ordering::Relaxed) {
                    let _ = on_event(StreamEvent::Cancelled);
                    return Ok(());
                }

                if let Ok(parsed) = serde_json::from_str::<OllamaChatChunk>(&line) {
                    if let Some(err) = parsed.error {
                        let err_msg = format!("Ollama stream error: {}", err);
                        let _ = on_event(StreamEvent::Error(err_msg.clone()));
                        return Err(err_msg);
                    }

                    if let Some(msg) = parsed.message {
                        if !msg.content.is_empty() {
                            let _ = on_event(StreamEvent::Chunk(msg.content));
                        }
                    }

                    if parsed.done {
                        let _ = on_event(StreamEvent::Done);
                        return Ok(());
                    }
                }
            }
        }

        // Handle any trailing line remaining in buffer
        let trimmed_rem = buffer.trim();
        if !trimmed_rem.is_empty() {
            if let Ok(parsed) = serde_json::from_str::<OllamaChatChunk>(trimmed_rem) {
                if let Some(msg) = parsed.message {
                    if !msg.content.is_empty() {
                        let _ = on_event(StreamEvent::Chunk(msg.content));
                    }
                }
            }
        }

        let _ = on_event(StreamEvent::Done);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    fn spawn_mock_ollama_server<F>(handler: F) -> (String, std::sync::mpsc::Sender<()>, Arc<std::sync::atomic::AtomicUsize>)
    where
        F: Fn(usize, &str) -> (u16, Vec<(&'static str, String)>, Vec<u8>) + Send + 'static,
    {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind ephemeral port");
        let local_addr = listener.local_addr().expect("local addr");
        let base_url = format!("http://{}", local_addr);

        let (shutdown_tx, shutdown_rx) = std::sync::mpsc::channel();
        let req_count = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let count_clone = req_count.clone();

        std::thread::spawn(move || {
            let _ = listener.set_nonblocking(true);
            loop {
                if shutdown_rx.try_recv().is_ok() {
                    break;
                }

                match listener.accept() {
                    Ok((mut stream, _)) => {
                        let current_count = count_clone.fetch_add(1, Ordering::SeqCst) + 1;
                        let mut received = Vec::new();
                        let mut buf = [0u8; 1024];

                        loop {
                            let n = match stream.read(&mut buf) {
                                Ok(0) => break,
                                Ok(n) => n,
                                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                                    std::thread::sleep(Duration::from_millis(10));
                                    continue;
                                }
                                Err(_) => break,
                            };
                            received.extend_from_slice(&buf[..n]);

                            let mut header_end = None;
                            let mut content_length = 0;

                            for window in received.windows(4) {
                                if window == b"\r\n\r\n" {
                                    let pos = received.windows(4).position(|w| w == b"\r\n\r\n").unwrap();
                                    header_end = Some(pos);
                                    let head_str = String::from_utf8_lossy(&received[..pos]);
                                    for line in head_str.lines() {
                                        if line.to_ascii_lowercase().starts_with("content-length:") {
                                            if let Some(val) = line.split(':').nth(1) {
                                                content_length = val.trim().parse::<usize>().unwrap_or(0);
                                            }
                                        }
                                    }
                                    break;
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
                            404 => "Not Found",
                            500 => "Internal Server Error",
                            _ => "Response",
                        };

                        let mut resp = format!("HTTP/1.1 {} {}\r\n", status_code, reason);
                        for (k, v) in headers {
                            resp.push_str(&format!("{}: {}\r\n", k, v));
                        }
                        resp.push_str(&format!("Content-Length: {}\r\n", body.len()));
                        resp.push_str("Connection: close\r\n\r\n");

                        let _ = stream.write_all(resp.as_bytes());
                        let _ = stream.write_all(&body);
                        let _ = stream.flush();
                        let _ = stream.shutdown(std::net::Shutdown::Write);
                    }
                    Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        std::thread::sleep(Duration::from_millis(10));
                    }
                    Err(_) => break,
                }
            }
        });

        (base_url, shutdown_tx, req_count)
    }

    #[test]
    fn test_normalize_endpoint() {
        assert_eq!(OllamaClient::normalize_endpoint("http://127.0.0.1:11434"), "http://127.0.0.1:11434");
        assert_eq!(OllamaClient::normalize_endpoint("http://localhost:11434/"), "http://localhost:11434");
        assert_eq!(OllamaClient::normalize_endpoint("   http://127.0.0.1:11434///   "), "http://127.0.0.1:11434");
        assert_eq!(OllamaClient::normalize_endpoint(""), DEFAULT_OLLAMA_ENDPOINT);
    }

    #[test]
    fn test_verify_connection_success_with_model() {
        let (base_url, _shutdown, _req_count) = spawn_mock_ollama_server(|_count, req| {
            assert!(req.contains("GET /api/tags"));
            let body = r#"{"models":[{"name":"qwen2.5-coder:3b","model":"qwen2.5-coder:3b","size":1929912626}]}"#.as_bytes().to_vec();
            (200, vec![("Content-Type", "application/json".to_string())], body)
        });

        let client = OllamaClient::new();
        let res = tauri::async_runtime::block_on(client.verify_connection(&base_url, "qwen2.5-coder:3b"));
        assert!(res.is_ok());
        let msg = res.unwrap();
        assert!(msg.contains("Connected to local Ollama server"));
        assert!(msg.contains("Model 'qwen2.5-coder:3b' is installed and ready"));
    }

    #[test]
    fn test_verify_connection_model_not_found_in_list() {
        let (base_url, _shutdown, _req_count) = spawn_mock_ollama_server(|_count, _req| {
            let body = r#"{"models":[{"name":"llama3.2:1b","model":"llama3.2:1b","size":123456}]}"#.as_bytes().to_vec();
            (200, vec![("Content-Type", "application/json".to_string())], body)
        });

        let client = OllamaClient::new();
        let res = tauri::async_runtime::block_on(client.verify_connection(&base_url, "qwen2.5-coder:3b"));
        assert!(res.is_ok());
        let msg = res.unwrap();
        assert!(msg.contains("not in detected models"));
    }

    #[test]
    fn test_verify_connection_server_offline() {
        // Query port that is closed
        let client = OllamaClient::new();
        let res = tauri::async_runtime::block_on(client.verify_connection("http://127.0.0.1:59999", "qwen2.5-coder:3b"));
        assert!(res.is_err());
        let err = res.unwrap_err();
        assert!(err.contains("Cannot connect to Ollama server"));
        assert!(err.contains("ollama serve"));
    }

    #[test]
    fn test_non_streaming_chat_completion() {
        let (base_url, _shutdown, _req_count) = spawn_mock_ollama_server(|_count, req| {
            assert!(req.contains("POST /api/chat"));
            assert!(req.contains(r#""stream":false"#));
            let body = r#"{"model":"qwen2.5-coder:3b","message":{"role":"assistant","content":"fn main() {}"},"done":true}"#.as_bytes().to_vec();
            (200, vec![("Content-Type", "application/json".to_string())], body)
        });

        let client = OllamaClient::new();
        let messages = vec![ChatMessage {
            role: "user".to_string(),
            content: "write a main function".to_string(),
        }];

        let res = tauri::async_runtime::block_on(client.chat_completion(&base_url, "qwen2.5-coder:3b", &messages));
        assert!(res.is_ok());
        assert_eq!(res.unwrap(), "fn main() {}");
    }

    #[test]
    fn test_streaming_chat_completion_ndjson() {
        let (base_url, _shutdown, _req_count) = spawn_mock_ollama_server(|_count, req| {
            assert!(req.contains("POST /api/chat"));
            assert!(req.contains(r#""stream":true"#));
            let chunk1 = r#"{"model":"qwen2.5-coder:3b","message":{"role":"assistant","content":"Hello "},"done":false}"#;
            let chunk2 = r#"{"model":"qwen2.5-coder:3b","message":{"role":"assistant","content":"World!"},"done":false}"#;
            let chunk3 = r#"{"model":"qwen2.5-coder:3b","message":{"role":"assistant","content":""},"done":true}"#;
            let body = format!("{}\n{}\n{}\n", chunk1, chunk2, chunk3).into_bytes();
            (200, vec![("Content-Type", "application/x-ndjson".to_string())], body)
        });

        let client = OllamaClient::new();
        let messages = vec![ChatMessage {
            role: "user".to_string(),
            content: "say hello".to_string(),
        }];

        let cancel_token = Arc::new(AtomicBool::new(false));
        let mut chunks = Vec::new();
        let mut done_received = false;

        let res = tauri::async_runtime::block_on(client.stream_chat_completion(
            &base_url,
            "qwen2.5-coder:3b",
            &messages,
            cancel_token,
            |event| {
                match event {
                    StreamEvent::Chunk(c) => chunks.push(c),
                    StreamEvent::Done => done_received = true,
                    _ => {}
                }
                Ok(())
            },
        ));

        assert!(res.is_ok());
        assert_eq!(chunks, vec!["Hello ", "World!"]);
        assert!(done_received);
    }

    #[test]
    fn test_streaming_cancellation() {
        let (base_url, _shutdown, _req_count) = spawn_mock_ollama_server(|_count, _req| {
            let chunk1 = r#"{"model":"qwen2.5-coder:3b","message":{"role":"assistant","content":"Token 1"},"done":false}"#;
            let body = format!("{}\n", chunk1).into_bytes();
            (200, vec![("Content-Type", "application/x-ndjson".to_string())], body)
        });

        let client = OllamaClient::new();
        let messages = vec![ChatMessage {
            role: "user".to_string(),
            content: "cancel test".to_string(),
        }];

        let cancel_token = Arc::new(AtomicBool::new(true)); // Pre-cancelled
        let mut cancelled_received = false;

        let res = tauri::async_runtime::block_on(client.stream_chat_completion(
            &base_url,
            "qwen2.5-coder:3b",
            &messages,
            cancel_token,
            |event| {
                if let StreamEvent::Cancelled = event {
                    cancelled_received = true;
                }
                Ok(())
            },
        ));

        assert!(res.is_ok());
        assert!(cancelled_received);
    }

    #[test]
    fn test_live_ollama_local_request() {
        let client = OllamaClient::new();
        let verify_res = tauri::async_runtime::block_on(
            client.verify_connection(DEFAULT_OLLAMA_ENDPOINT, DEFAULT_OLLAMA_MODEL)
        );
        if let Ok(msg) = verify_res {
            println!("Live Ollama verify success: {}", msg);
            assert!(msg.contains("Connected to local Ollama server"));

            let messages = vec![ChatMessage {
                role: "user".to_string(),
                content: "say 'ANTIGRAVITY_OLLAMA_OK' in one word".to_string(),
            }];
            let cancel_token = Arc::new(AtomicBool::new(false));
            let mut output = String::new();
            let mut done = false;

            let stream_res = tauri::async_runtime::block_on(client.stream_chat_completion(
                DEFAULT_OLLAMA_ENDPOINT,
                DEFAULT_OLLAMA_MODEL,
                &messages,
                cancel_token,
                |event| {
                    match event {
                        StreamEvent::Chunk(c) => output.push_str(&c),
                        StreamEvent::Done => done = true,
                        _ => {}
                    }
                    Ok(())
                },
            ));

            assert!(stream_res.is_ok(), "Live stream failed: {:?}", stream_res.err());
            assert!(done, "Stream should complete with Done");
            assert!(!output.trim().is_empty(), "Live Ollama response should not be empty");
            println!("Live Ollama output: {}", output.trim());
        }
    }
}
