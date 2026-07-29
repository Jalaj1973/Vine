use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionMetadata {
    pub id: String,
    pub title: String,
    pub created_at: u64,
    pub duration_seconds: u64,
    pub transcript_count: usize,
    pub formatted_date: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptEntry {
    pub id: String,
    pub speaker: String,
    pub text: String,
    pub timestamp_sec: u64,
    pub formatted_time: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionData {
    pub metadata: SessionMetadata,
    pub notes: String,
    pub transcripts: Vec<TranscriptEntry>,
}

fn get_sessions_dir() -> PathBuf {
    let mut path = dirs::data_dir().unwrap_or_else(|| PathBuf::from("."));
    path.push("atlas-ai");
    path.push("sessions");
    fs::create_dir_all(&path).ok();
    path
}

#[tauri::command]
pub fn get_app_status() -> Result<String, String> {
    Ok("Atlas AI Local Persistence Ready".to_string())
}

#[tauri::command]
pub fn list_sessions() -> Result<Vec<SessionMetadata>, String> {
    let dir = get_sessions_dir();
    let mut list = Vec::new();

    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let meta_path = entry.path().join("metadata.json");
            if meta_path.exists() {
                if let Ok(content) = fs::read_to_string(meta_path) {
                    if let Ok(meta) = serde_json::from_str::<SessionMetadata>(&content) {
                        list.push(meta);
                    }
                }
            }
        }
    }

    list.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(list)
}

#[tauri::command]
pub fn create_session() -> Result<SessionData, String> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();

    let id = format!("session_{}", now);
    let session_dir = get_sessions_dir().join(&id);
    fs::create_dir_all(&session_dir).map_err(|e| e.to_string())?;

    let meta = SessionMetadata {
        id: id.clone(),
        title: format!("Live Session ({})", format_date(now)),
        created_at: now,
        duration_seconds: 0,
        transcript_count: 0,
        formatted_date: format_date(now),
    };

    let session_data = SessionData {
        metadata: meta.clone(),
        notes: "# Live Session Notes\n\n- Meeting started.\n".to_string(),
        transcripts: vec![], // Completely clean - ZERO dummy entries
    };

    fs::write(
        session_dir.join("metadata.json"),
        serde_json::to_string_pretty(&meta).unwrap(),
    ).map_err(|e| e.to_string())?;

    fs::write(
        session_dir.join("notes.md"),
        &session_data.notes,
    ).map_err(|e| e.to_string())?;

    fs::write(
        session_dir.join("transcripts.json"),
        serde_json::to_string_pretty(&session_data.transcripts).unwrap(),
    ).map_err(|e| e.to_string())?;

    Ok(session_data)
}

#[tauri::command]
pub fn load_session(id: String) -> Result<SessionData, String> {
    let session_dir = get_sessions_dir().join(&id);

    let meta_str = fs::read_to_string(session_dir.join("metadata.json")).map_err(|e| e.to_string())?;
    let metadata: SessionMetadata = serde_json::from_str(&meta_str).map_err(|e| e.to_string())?;

    let notes = fs::read_to_string(session_dir.join("notes.md")).unwrap_or_default();
    
    let transcripts_str = fs::read_to_string(session_dir.join("transcripts.json")).unwrap_or_else(|_| "[]".to_string());
    let transcripts: Vec<TranscriptEntry> = serde_json::from_str(&transcripts_str).unwrap_or_default();

    Ok(SessionData {
        metadata,
        notes,
        transcripts,
    })
}

#[tauri::command]
pub fn save_session_notes(id: String, notes: String) -> Result<(), String> {
    let session_dir = get_sessions_dir().join(&id);
    fs::write(session_dir.join("notes.md"), notes).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_transcript_entry(
    id: String,
    speaker: String,
    text: String,
    timestamp_sec: u64,
) -> Result<TranscriptEntry, String> {
    let session_dir = get_sessions_dir().join(&id);
    
    let mins = timestamp_sec / 60;
    let secs = timestamp_sec % 60;
    let formatted_time = format!("{:02}:{:02}", mins, secs);

    let entry = TranscriptEntry {
        id: format!("t_{}_{}", timestamp_sec, rand_suffix()),
        speaker,
        text,
        timestamp_sec,
        formatted_time,
    };

    let mut transcripts: Vec<TranscriptEntry> = Vec::new();
    let file_path = session_dir.join("transcripts.json");
    if file_path.exists() {
        if let Ok(content) = fs::read_to_string(&file_path) {
            if let Ok(existing) = serde_json::from_str::<Vec<TranscriptEntry>>(&content) {
                transcripts = existing;
            }
        }
    }

    transcripts.push(entry.clone());
    fs::write(&file_path, serde_json::to_string_pretty(&transcripts).unwrap()).map_err(|e| e.to_string())?;

    if let Ok(meta_str) = fs::read_to_string(session_dir.join("metadata.json")) {
        if let Ok(mut meta) = serde_json::from_str::<SessionMetadata>(&meta_str) {
            meta.transcript_count = transcripts.len();
            meta.duration_seconds = timestamp_sec;
            let _ = fs::write(session_dir.join("metadata.json"), serde_json::to_string_pretty(&meta).unwrap());
        }
    }

    Ok(entry)
}

#[tauri::command]
pub fn delete_session(id: String) -> Result<(), String> {
    let session_dir = get_sessions_dir().join(&id);
    if session_dir.exists() {
        fs::remove_dir_all(session_dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn format_date(timestamp: u64) -> String {
    let mins = (timestamp / 60) % 60;
    let hours = (timestamp / 3600) % 24;
    format!("{:02}:{:02} GMT", hours, mins)
}

fn rand_suffix() -> u16 {
    (std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos() % 10000) as u16
}
