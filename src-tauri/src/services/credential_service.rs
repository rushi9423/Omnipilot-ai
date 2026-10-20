use keyring::Entry;
use reqwest::header::HeaderValue;
use std::collections::HashMap;
use std::sync::RwLock;

pub trait CredentialStorage: Send + Sync {
    fn get_key(&self) -> Result<Option<String>, String> {
        self.get_key_for_provider("openai")
    }

    fn set_key(&self, key: &str) -> Result<(), String> {
        self.set_key_for_provider("openai", key)
    }

    fn delete_key(&self) -> Result<(), String> {
        self.delete_key_for_provider("openai")
    }

    fn has_key(&self) -> Result<bool, String> {
        self.has_key_for_provider("openai")
    }

    fn get_key_for_provider(&self, provider: &str) -> Result<Option<String>, String>;
    fn set_key_for_provider(&self, provider: &str, key: &str) -> Result<(), String>;
    fn delete_key_for_provider(&self, provider: &str) -> Result<(), String>;
    fn has_key_for_provider(&self, provider: &str) -> Result<bool, String>;
}

/// Windows Credential Manager implementation using the native Windows Vault via the `keyring` crate.
/// Manages provider-separated credentials (e.g. `openai_api_key`, `gemini_api_key`) under service `OmniPilotAI`.
pub struct KeyringCredentialStore {
    service_name: String,
}

impl Default for KeyringCredentialStore {
    fn default() -> Self {
        Self::new()
    }
}

impl KeyringCredentialStore {
    pub fn new() -> Self {
        Self {
            service_name: "OmniPilotAI".to_string(),
        }
    }

    pub fn credential_target_for_provider(provider: &str) -> String {
        match provider.trim().to_lowercase().as_str() {
            "gemini" => "gemini_api_key".to_string(),
            _ => "openai_api_key".to_string(),
        }
    }
}

impl CredentialStorage for KeyringCredentialStore {
    fn get_key_for_provider(&self, provider: &str) -> Result<Option<String>, String> {
        let username = Self::credential_target_for_provider(provider);
        let entry = Entry::new(&self.service_name, &username)
            .map_err(|e| format!("Windows Credential Manager initialization error: {}", e))?;

        match entry.get_password() {
            Ok(secret) => {
                let trimmed = secret.trim();
                if trimmed.is_empty() {
                    Ok(None)
                } else {
                    Ok(Some(trimmed.to_string()))
                }
            }
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(format!("Windows Credential Manager query failed for {}: {}", username, e)),
        }
    }

    fn set_key_for_provider(&self, provider: &str, key: &str) -> Result<(), String> {
        validate_provider_api_key_format(provider, key)?;

        let username = Self::credential_target_for_provider(provider);
        let entry = Entry::new(&self.service_name, &username)
            .map_err(|e| format!("Windows Credential Manager initialization error: {}", e))?;

        entry
            .set_password(key.trim())
            .map_err(|e| format!("Failed to save secret in Windows Credential Manager for {}: {}", username, e))
    }

    fn delete_key_for_provider(&self, provider: &str) -> Result<(), String> {
        let username = Self::credential_target_for_provider(provider);
        let entry = Entry::new(&self.service_name, &username)
            .map_err(|e| format!("Windows Credential Manager initialization error: {}", e))?;

        match entry.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(format!("Failed to delete credential from Windows Credential Manager for {}: {}", username, e)),
        }
    }

    fn has_key_for_provider(&self, provider: &str) -> Result<bool, String> {
        Ok(self.get_key_for_provider(provider)?.is_some())
    }
}

/// In-memory mock credential store for automated tests to avoid mutating user's Windows Credential Manager.
/// Supports provider-separated credential mapping without cross-provider overwriting.
pub struct MockCredentialStore {
    stored: RwLock<HashMap<String, String>>,
}

impl Default for MockCredentialStore {
    fn default() -> Self {
        Self::new()
    }
}

impl MockCredentialStore {
    pub fn new() -> Self {
        Self {
            stored: RwLock::new(HashMap::new()),
        }
    }

    pub fn with_key(key: &str) -> Self {
        let mut map = HashMap::new();
        map.insert("openai".to_string(), key.to_string());
        Self {
            stored: RwLock::new(map),
        }
    }

    pub fn with_provider_key(provider: &str, key: &str) -> Self {
        let mut map = HashMap::new();
        map.insert(provider.trim().to_lowercase(), key.to_string());
        Self {
            stored: RwLock::new(map),
        }
    }
}

impl CredentialStorage for MockCredentialStore {
    fn get_key_for_provider(&self, provider: &str) -> Result<Option<String>, String> {
        let lock = self.stored.read().map_err(|e| e.to_string())?;
        let norm = provider.trim().to_lowercase();
        Ok(lock.get(&norm).cloned())
    }

    fn set_key_for_provider(&self, provider: &str, key: &str) -> Result<(), String> {
        validate_provider_api_key_format(provider, key)?;
        let mut lock = self.stored.write().map_err(|e| e.to_string())?;
        let norm = provider.trim().to_lowercase();
        lock.insert(norm, key.trim().to_string());
        Ok(())
    }

    fn delete_key_for_provider(&self, provider: &str) -> Result<(), String> {
        let mut lock = self.stored.write().map_err(|e| e.to_string())?;
        let norm = provider.trim().to_lowercase();
        lock.remove(&norm);
        Ok(())
    }

    fn has_key_for_provider(&self, provider: &str) -> Result<bool, String> {
        let lock = self.stored.read().map_err(|e| e.to_string())?;
        let norm = provider.trim().to_lowercase();
        Ok(lock.contains_key(&norm))
    }
}

/// Validates that a supplied OpenAI API key is nonempty and correctly formatted (sk-...).
pub fn validate_api_key_format(key: &str) -> Result<(), String> {
    let trimmed = key.trim();
    if trimmed.is_empty() {
        return Err("OpenAI API key cannot be empty or contain only whitespace.".to_string());
    }
    if trimmed.len() < 12 {
        return Err("API key is too short to be a valid OpenAI credential.".to_string());
    }
    if !trimmed.starts_with("sk-") {
        return Err("API key must begin with 'sk-' (e.g. standard OpenAI key or project key 'sk-proj-...').".to_string());
    }
    if !trimmed.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err("API key contains invalid characters. Only alphanumeric characters, hyphens, and underscores are allowed.".to_string());
    }
    Ok(())
}

/// Validates that a supplied Google Gemini credential is non-empty and safe for storage and HTTP transport.
/// Accidental leading and trailing whitespace is trimmed.
///
/// Removes obsolete prefix restrictions (e.g. mandatory 'AIza') to support both standard legacy keys
/// and newer Google AI Studio authorization keys (including the 'AQ.' prefix) as well as OAuth tokens.
///
/// NOTE: Passing format validation does NOT guarantee the credential is active or authorized.
/// True authenticity and model access are verified by making an authenticated request against Google's API (e.g. GET /v1beta/models).
pub fn validate_gemini_api_key_format(key: &str) -> Result<(), String> {
    let trimmed = key.trim();
    if trimmed.is_empty() {
        return Err("Gemini API key cannot be empty or contain only whitespace.".to_string());
    }
    if trimmed.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err("Gemini API key cannot contain internal whitespace or control characters.".to_string());
    }
    if HeaderValue::from_str(trimmed).is_err() {
        return Err("Gemini API key contains invalid characters for an HTTP header.".to_string());
    }
    Ok(())
}

/// Unified validator routing to the correct validation rules for each provider.
pub fn validate_provider_api_key_format(provider: &str, key: &str) -> Result<(), String> {
    match provider.trim().to_lowercase().as_str() {
        "gemini" => validate_gemini_api_key_format(key),
        _ => validate_api_key_format(key),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_api_key_format() {
        assert!(validate_api_key_format("sk-proj-1234567890abcdef").is_ok());
        assert!(validate_api_key_format("sk-1234567890abcdef").is_ok());
        assert!(validate_api_key_format("").is_err());
        assert!(validate_api_key_format("   ").is_err());
        assert!(validate_api_key_format("sk-short").is_err());
        assert!(validate_api_key_format("pk-proj-1234567890abcdef").is_err());
        assert!(validate_api_key_format("sk-has space 123456").is_err());
    }

    #[test]
    fn test_validate_gemini_api_key_format() {
        // Standard legacy AIza key
        assert!(validate_gemini_api_key_format("AIzaSyB1234567890abcdefghijklmnopqrstu").is_ok());
        assert!(validate_gemini_api_key_format("AIza1234567890abcdefghijklmn").is_ok());
        // Newer Google AI Studio AQ. key
        assert!(validate_gemini_api_key_format("AQ.AbMockKey1234567890abcdef.xyz_123-456").is_ok());
        assert!(validate_gemini_api_key_format("AQ.v2_secure_token_987654321").is_ok());
        // Leading and trailing whitespace should be accepted (trimmed)
        assert!(validate_gemini_api_key_format("   AQ.AbMockKey1234567890abcdef.xyz_123-456   \n").is_ok());
        assert!(validate_gemini_api_key_format("  AIzaSyB1234567890abcdefghijklmnopqrstu  ").is_ok());
        // Empty or whitespace-only keys must be rejected
        assert!(validate_gemini_api_key_format("").is_err());
        assert!(validate_gemini_api_key_format("   ").is_err());
        assert!(validate_gemini_api_key_format("\t\n").is_err());
        // Keys with internal whitespace or control characters must be rejected
        assert!(validate_gemini_api_key_format("AQ.AbMock Key123").is_err());
        assert!(validate_gemini_api_key_format("AIzaSy has space 123456").is_err());
        assert!(validate_gemini_api_key_format("AQ.Mock\0Key").is_err());
    }

    #[test]
    fn test_mock_credential_store_isolation() {
        let store = MockCredentialStore::new();
        assert_eq!(store.has_key_for_provider("openai").unwrap(), false);
        assert_eq!(store.has_key_for_provider("gemini").unwrap(), false);

        // Store OpenAI key
        assert!(store.set_key_for_provider("openai", "sk-proj-test-openai-123").is_ok());
        assert_eq!(store.has_key_for_provider("openai").unwrap(), true);
        assert_eq!(store.has_key_for_provider("gemini").unwrap(), false);
        assert_eq!(store.get_key_for_provider("openai").unwrap(), Some("sk-proj-test-openai-123".to_string()));
        assert_eq!(store.get_key_for_provider("gemini").unwrap(), None);

        // Store Gemini AQ.-style key with surrounding whitespace; must be trimmed and stored securely
        assert!(store.set_key_for_provider("gemini", "  AQ.AbMockGeminiKey1234567890abcdef.xyz_123  ").is_ok());
        assert_eq!(store.has_key_for_provider("gemini").unwrap(), true);
        assert_eq!(store.has_key_for_provider("openai").unwrap(), true);
        assert_eq!(store.get_key_for_provider("gemini").unwrap(), Some("AQ.AbMockGeminiKey1234567890abcdef.xyz_123".to_string()));
        assert_eq!(store.get_key_for_provider("openai").unwrap(), Some("sk-proj-test-openai-123".to_string()));

        // Delete OpenAI key - Gemini key MUST remain intact
        assert!(store.delete_key_for_provider("openai").is_ok());
        assert_eq!(store.has_key_for_provider("openai").unwrap(), false);
        assert_eq!(store.has_key_for_provider("gemini").unwrap(), true);
        assert_eq!(store.get_key_for_provider("gemini").unwrap(), Some("AQ.AbMockGeminiKey1234567890abcdef.xyz_123".to_string()));

        // Delete Gemini key
        assert!(store.delete_key_for_provider("gemini").is_ok());
        assert_eq!(store.has_key_for_provider("gemini").unwrap(), false);
    }
}
