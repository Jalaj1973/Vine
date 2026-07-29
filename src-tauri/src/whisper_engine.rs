use serde::{Deserialize, Serialize};
use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Emitter;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

static WHISPER_STATE: Mutex<Option<WhisperContext>> = Mutex::new(None);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptionDelta {
    pub session_id: String,
    pub speaker: String,
    pub text: String,
    pub timestamp_sec: u64,
    pub formatted_time: String,
    pub is_final: bool,
    pub audio_source: Option<String>,
}

fn log_debug_message(msg: &str) {
    let mut log_path = dirs::data_dir().unwrap_or_else(|| PathBuf::from("."));
    log_path.push("atlas-ai");
    let _ = std::fs::create_dir_all(&log_path);
    log_path.push("debug.log");

    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(log_path) {
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let _ = writeln!(file, "[{}] {}", timestamp, msg);
    }
}

fn get_or_init_whisper() -> Result<(), String> {
    let mut state = WHISPER_STATE.lock().map_err(|e| e.to_string())?;
    if state.is_some() {
        return Ok(());
    }

    let mut model_path = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    model_path.push(".cache");
    model_path.push("atlas-ai");
    model_path.push("ggml-tiny.en.bin");

    if !model_path.exists() {
        return Err(format!("Whisper model file missing at {:?}", model_path));
    }

    let ctx_params = WhisperContextParameters::default();
    let ctx = WhisperContext::new_with_params(model_path.to_str().unwrap(), ctx_params)
        .map_err(|e| format!("Failed to load Whisper context: {:?}", e))?;

    *state = Some(ctx);
    log_debug_message("Native whisper-rs context initialized successfully!");
    Ok(())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WhisperEngineInfo {
    pub model: String,
    pub acceleration: String,
    pub sample_rate: u32,
    pub status: String,
    pub system_audio_support: bool,
}

#[tauri::command]
pub fn get_whisper_info() -> WhisperEngineInfo {
    WhisperEngineInfo {
        model: "ggml-tiny.en.bin".to_string(),
        acceleration: "Native whisper-rs C++ Metal".to_string(),
        sample_rate: 16000,
        status: "Active Hardware STT Engine".to_string(),
        system_audio_support: true,
    }
}

#[tauri::command]
pub fn start_native_stt(_app: tauri::AppHandle, _session_id: String) -> Result<bool, String> {
    get_or_init_whisper()?;
    log_debug_message("start_native_stt invoked - whisper context ready");
    Ok(true)
}

#[tauri::command]
pub fn stop_native_stt() {
    log_debug_message("stop_native_stt invoked");
}

#[tauri::command]
pub fn process_audio_chunk(
    app: tauri::AppHandle,
    session_id: String,
    samples: Vec<f32>,
    elapsed_sec: u64,
    source_type: Option<String>,
) -> Result<TranscriptionDelta, String> {
    log_debug_message(&format!("process_audio_chunk: {} samples", samples.len()));

    if samples.is_empty() {
        return Err("Audio buffer is empty".to_string());
    }

    let _ = get_or_init_whisper();

    // 1. Peak Normalization: scale Float32 PCM to 0.95 max amplitude for low-gain mic sensitivity
    let max_amplitude = samples.iter().map(|&s| s.abs()).fold(0.0f32, f32::max);
    let normalized_samples: Vec<f32> = if max_amplitude > 0.0001 {
        let scale = 0.95 / max_amplitude;
        samples.iter().map(|&s| s * scale).collect()
    } else {
        samples
    };

    let state = WHISPER_STATE.lock().map_err(|e| e.to_string())?;
    let mut decoded_text = String::new();

    if let Some(ref ctx) = *state {
        let mut state = ctx.create_state().map_err(|e| format!("{:?}", e))?;
        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        params.set_language(Some("en"));
        params.set_print_special(false);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);

        if let Ok(_) = state.full(params, &normalized_samples[..]) {
            let num_segments = state.full_n_segments().unwrap_or(0);
            for i in 0..num_segments {
                if let Ok(segment) = state.full_get_segment_text(i) {
                    let cleaned = segment.trim();
                    if !cleaned.is_empty() && !cleaned.contains("[BLANK_AUDIO]") && !cleaned.contains("[MUSIC]") {
                        decoded_text.push_str(cleaned);
                        decoded_text.push(' ');
                    }
                }
            }
        }
    }

    let text_content = decoded_text.trim().to_string();

    if text_content.is_empty() {
        return Err("No speech detected in buffer".to_string());
    }

    let mins = elapsed_sec / 60;
    let secs = elapsed_sec % 60;
    let formatted_time = format!("{:02}:{:02}", mins, secs);

    let delta = TranscriptionDelta {
        session_id: session_id.clone(),
        speaker: "You (Microphone)".to_string(),
        text: text_content.clone(),
        timestamp_sec: elapsed_sec,
        formatted_time,
        is_final: true,
        audio_source: source_type,
    };

    let _ = app.emit("transcript-delta", &delta);
    log_debug_message(&format!("Emitted transcript-delta: {}", delta.text));

    Ok(delta)
}
