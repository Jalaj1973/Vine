// Prevents additional console window on Windows in release, do not remove!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod export;
mod ocr;
mod ollama;
mod overlay;
mod session;
mod whisper_engine;

use export::export_session_markdown;
use ocr::{capture_active_browser_tab, capture_full_screen_ocr, capture_screen_region_ocr};
use ollama::{check_ollama_status, query_ollama};
use overlay::{configure_discreet_overlay, start_window_drag};
use session::{
    add_transcript_entry, create_session, delete_session, get_app_status, load_session,
    list_sessions, save_session_notes,
};
use whisper_engine::{get_whisper_info, process_audio_chunk, start_native_stt, stop_native_stt};

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_app_status,
            list_sessions,
            create_session,
            load_session,
            save_session_notes,
            add_transcript_entry,
            delete_session,
            get_whisper_info,
            process_audio_chunk,
            start_native_stt,
            stop_native_stt,
            check_ollama_status,
            query_ollama,
            capture_screen_region_ocr,
            capture_full_screen_ocr,
            capture_active_browser_tab,
            export_session_markdown,
            configure_discreet_overlay,
            start_window_drag,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
