#[tauri::command]
pub fn configure_discreet_overlay(window: tauri::Window) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use cocoa::base::id;
        use objc::{msg_send, sel, sel_impl};

        if let Ok(ns_win_ptr) = window.ns_window() {
            let ns_window = ns_win_ptr as id;
            unsafe {
                // Set NSWindowSharingType to NSWindowSharingNone (0) to exclude window from screen capture streams
                let () = msg_send![ns_window, setSharingType: 0usize];
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn start_window_drag(window: tauri::Window) -> Result<(), String> {
    window.start_dragging().map_err(|e| e.to_string())
}
