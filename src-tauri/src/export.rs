use crate::session::load_session;
use std::fs;
use std::path::PathBuf;

#[tauri::command]
pub fn export_session_markdown(id: String) -> Result<String, String> {
    let session_data = load_session(id)?;

    let mut content = String::new();
    content.push_str(&format!("# {}\n\n", session_data.metadata.title));
    content.push_str(&format!("- **Session ID**: {}\n", session_data.metadata.id));
    content.push_str(&format!("- **Date**: {}\n", session_data.metadata.formatted_date));
    content.push_str(&format!("- **Duration**: {} seconds\n", session_data.metadata.duration_seconds));
    content.push_str("- **Privacy**: 100% Offline (Atlas AI Desktop)\n\n");
    content.push_str("---\n\n");

    content.push_str("## 📝 Session Notes\n\n");
    content.push_str(&session_data.notes);
    content.push_str("\n\n---\n\n");

    content.push_str("## 🎙️ Audio Speech Transcripts & Screen OCR Logs\n\n");
    if session_data.transcripts.is_empty() {
        content.push_str("*No speech entries recorded for this session.*\n\n");
    } else {
        for item in session_data.transcripts {
            content.push_str(&format!("#### [{}] {}\n{}\n\n", item.formatted_time, item.speaker, item.text));
        }
    }

    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    let downloads_dir = PathBuf::from(home).join("Downloads");
    
    if !downloads_dir.exists() {
        let _ = fs::create_dir_all(&downloads_dir);
    }

    let export_filename = format!("Atlas_Session_{}.md", session_data.metadata.id);
    let target_path = downloads_dir.join(&export_filename);

    fs::write(&target_path, content).map_err(|e| format!("Failed to write export Markdown file: {}", e))?;

    Ok(target_path.to_string_lossy().to_string())
}
