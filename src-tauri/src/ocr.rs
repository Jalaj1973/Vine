use std::fs;
use std::process::Command;

#[tauri::command]
pub fn capture_screen_region_ocr() -> Result<String, String> {
    let temp_img = std::env::temp_dir().join("atlas_ocr_capture.png");

    if temp_img.exists() {
        let _ = fs::remove_file(&temp_img);
    }

    let capture_status = Command::new("screencapture")
        .arg("-i")
        .arg(&temp_img)
        .status()
        .map_err(|e| format!("Failed to launch macOS screencapture tool: {}", e))?;

    if !capture_status.success() || !temp_img.exists() {
        return Err("Screen capture cancelled".to_string());
    }

    run_apple_vision_ocr(&temp_img, "accurate")
}

#[tauri::command]
pub fn capture_full_screen_ocr() -> Result<String, String> {
    let temp_img = std::env::temp_dir().join("atlas_full_ocr.png");

    if temp_img.exists() {
        let _ = fs::remove_file(&temp_img);
    }

    let capture_status = Command::new("screencapture")
        .arg("-x")
        .arg(&temp_img)
        .status()
        .map_err(|e| format!("Failed to capture screen: {}", e))?;

    if !capture_status.success() || !temp_img.exists() {
        return Err("Full screen capture failed".to_string());
    }

    run_apple_vision_ocr(&temp_img, "fast")
}

#[tauri::command]
pub fn capture_active_browser_tab() -> Result<String, String> {
    // 1. Primary Engine: Direct AppleScript DOM text extraction from Google Chrome / Arc / Safari (~15ms)
    let script = r#"
    on run
        try
            tell application "Google Chrome"
                if (count of windows) > 0 then
                    set tTitle to title of active tab of front window
                    set tURL to URL of active tab of front window
                    set tText to execute front window's active tab javascript "document.body.innerText"
                    if tText is not missing value and length of tText > 15 then
                        return "URL: " & tURL & "\nTitle: " & tTitle & "\n\n" & tText
                    end if
                end if
            end tell
        on error
        end try

        try
            tell application "Arc"
                if (count of windows) > 0 then
                    set tTitle to title of active tab of front window
                    set tURL to URL of active tab of front window
                    set tText to execute front window's active tab javascript "document.body.innerText"
                    if tText is not missing value and length of tText > 15 then
                        return "URL: " & tURL & "\nTitle: " & tTitle & "\n\n" & tText
                    end if
                end if
            end tell
        on error
        end try

        try
            tell application "Safari"
                if (count of windows) > 0 then
                    set tTitle to name of current tab of front window
                    set tURL to URL of current tab of front window
                    set tText to execute front window's current tab javascript "document.body.innerText"
                    if tText is not missing value and length of tText > 15 then
                        return "URL: " & tURL & "\nTitle: " & tTitle & "\n\n" & tText
                    end if
                end if
            end tell
        on error
        end try

        return ""
    end run
    "#;

    if let Ok(output) = Command::new("osascript").arg("-e").arg(script).output() {
        if output.status.success() {
            let extracted = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !extracted.is_empty() 
                && !extracted.contains("Atlas Co-Pilot") 
                && !extracted.contains("Atlas AI Desktop") 
            {
                let truncated = if extracted.len() > 3000 {
                    extracted[..3000].to_string()
                } else {
                    extracted
                };
                return Ok(truncated);
            }
        }
    }

    // 2. Targeted Chrome Window ID Capture via screencapture -l + Fast Apple Vision OCR (~30ms)
    let get_browser_window_id_script = r#"
    tell application "System Events"
        if exists (process "Google Chrome") then
            tell process "Google Chrome"
                if (count of windows) > 0 then
                    return id of window 1
                end if
            end tell
        else if exists (process "Arc") then
            tell process "Arc"
                if (count of windows) > 0 then
                    return id of window 1
                end if
            end tell
        else if exists (process "Safari") then
            tell process "Safari"
                if (count of windows) > 0 then
                    return id of window 1
                end if
            end tell
        end if
    end tell
    return ""
    "#;

    if let Ok(output) = Command::new("osascript").arg("-e").arg(get_browser_window_id_script).output() {
        if output.status.success() {
            let win_id_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if let Ok(win_id) = win_id_str.parse::<u32>() {
                let temp_img = std::env::temp_dir().join("atlas_browser_window.png");
                
                let status = Command::new("screencapture")
                    .arg("-l")
                    .arg(win_id.to_string())
                    .arg("-x")
                    .arg(&temp_img)
                    .status();

                if let Ok(st) = status {
                    if st.success() && temp_img.exists() {
                        let ocr_res = run_apple_vision_ocr(&temp_img, "fast");
                        let _ = fs::remove_file(temp_img);
                        if let Ok(ocr_text) = ocr_res {
                            if !ocr_text.contains("Atlas Co-Pilot") && ocr_text.len() > 15 {
                                return Ok(ocr_text);
                            }
                        }
                    }
                }
            }
        }
    }

    capture_full_screen_ocr()
}

fn run_apple_vision_ocr(image_path: &std::path::Path, level: &str) -> Result<String, String> {
    let rec_level_code = if level == "fast" {
        "request.recognitionLevel = .fast"
    } else {
        "request.recognitionLevel = .accurate"
    };

    let swift_script = format!(
        r#"
import Vision
import AppKit

let path = "{}"
guard let image = NSImage(contentsOfFile: path),
      let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {{
    exit(1)
}}

let request = VNRecognizeTextRequest {{ request, error in
    guard let observations = request.results as? [VNRecognizedTextObservation] else {{ return }}
    let recognizedText = observations.compactMap {{ $0.topCandidates(1).first?.string }}.joined(separator: "\n")
    print(recognizedText)
}}
{}

let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
try? handler.perform([request])
"#,
        image_path.to_string_lossy(),
        rec_level_code
    );

    let output = Command::new("swift")
        .arg("-e")
        .arg(&swift_script)
        .output()
        .map_err(|e| format!("Failed to execute Apple Vision OCR: {}", e))?;

    let _ = fs::remove_file(image_path);

    if output.status.success() {
        let extracted = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if extracted.is_empty() {
            Ok("[No text detected on screen]".to_string())
        } else {
            Ok(extracted)
        }
    } else {
        let err = String::from_utf8_lossy(&output.stderr);
        Err(format!("Apple Vision OCR error: {}", err))
    }
}
