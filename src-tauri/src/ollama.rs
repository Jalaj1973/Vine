use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct OllamaStatusResponse {
    pub online: bool,
    pub active_model: String,
    pub models: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct OllamaGenerateRequest {
    model: String,
    prompt: String,
    system: Option<String>,
    stream: bool,
}

#[derive(Debug, Serialize, Deserialize)]
struct OllamaGenerateResponse {
    response: String,
    done: bool,
}

#[derive(Debug, Serialize, Deserialize)]
struct OllamaTagsResponse {
    models: Vec<OllamaModelTag>,
}

#[derive(Debug, Serialize, Deserialize)]
struct OllamaModelTag {
    name: String,
}

#[tauri::command]
pub async fn check_ollama_status() -> Result<OllamaStatusResponse, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .map_err(|e| e.to_string())?;

    match client.get("http://localhost:11434/api/tags").send().await {
        Ok(resp) => {
            if let Ok(tags) = resp.json::<OllamaTagsResponse>().await {
                let model_names: Vec<String> = tags.models.into_iter().map(|m| m.name).collect();
                let default_model = model_names
                    .first()
                    .cloned()
                    .unwrap_or_else(|| "llama3.2:3b".to_string());
                
                Ok(OllamaStatusResponse {
                    online: true,
                    active_model: default_model,
                    models: model_names,
                })
            } else {
                Ok(OllamaStatusResponse {
                    online: true,
                    active_model: "llama3.2:3b".to_string(),
                    models: vec!["llama3.2:3b".to_string()],
                })
            }
        }
        Err(_) => Ok(OllamaStatusResponse {
            online: false,
            active_model: "llama3.2:3b".to_string(),
            models: vec!["llama3.2:3b".to_string()],
        }),
    }
}

#[tauri::command]
pub async fn query_ollama(
    model: String,
    prompt: String,
    system_context: Option<String>,
) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;

    let req_body = OllamaGenerateRequest {
        model: if model.is_empty() { "llama3.2:3b".to_string() } else { model },
        prompt,
        system: system_context,
        stream: false,
    };

    match client.post("http://localhost:11434/api/generate").json(&req_body).send().await {
        Ok(res) => {
            if res.status().is_success() {
                let gen_res: OllamaGenerateResponse = res.json().await.map_err(|e| e.to_string())?;
                Ok(gen_res.response)
            } else {
                Err(format!("Ollama API returned HTTP status {}", res.status()))
            }
        }
        Err(e) => Err(format!("Could not connect to Ollama local daemon: {}", e)),
    }
}
