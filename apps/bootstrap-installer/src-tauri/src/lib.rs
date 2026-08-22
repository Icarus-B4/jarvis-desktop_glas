//! J.A.R.V.I.S. Setup — Tauri entrypoint.
//!
//! Drives a bundled install.ps1 (Windows) / install.sh (Unix) the same way the
//! Hermes bootstrap installer drives its script: spawn it, stream stdout/stderr
//! lines as `bootstrap` events to the React frontend, then launch the installed
//! app on success. WebView2 is auto-installed by Tauri's embedBootstrapper.

mod events;
mod powershell;
mod bootstrap;
use std::sync::Arc;
use tokio::sync::Mutex;

pub struct AppState {
    pub bootstrap: Mutex<Option<bootstrap::BootstrapHandle>>,
}

impl AppState {
    fn new() -> Self {
        Self {
            bootstrap: Mutex::new(None),
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(Arc::new(AppState::new()))
        .invoke_handler(tauri::generate_handler![
            bootstrap::start_bootstrap,
            bootstrap::start_update,
            bootstrap::cancel_bootstrap,
            bootstrap::get_bootstrap_status,
            bootstrap::launch_jarvis_desktop,
            bootstrap::open_log_dir,
            get_log_path,
            get_jarvis_home,
            get_mode,
            get_install_root,
        ])
        .run(tauri::generate_context!())
        .expect("error while running J.A.R.V.I.S. Setup");
}

// --- Static info commands used by the store on mount ---

#[tauri::command]
fn get_install_root() -> String {
    let local = std::env::var("LOCALAPPDATA").unwrap_or_else(|_| {
        // User-agnostic fallback: derive from USERPROFILE, never a developer's
        // hardcoded profile path (breaks on other machines).
        std::env::var("USERPROFILE")
            .map(|u| format!("{u}\\AppData\\Local"))
            .unwrap_or_else(|_| "C:\\Program Files".into())
    });
    // Matches run_bootstrap: %LOCALAPPDATA%\Programs\Jarvis-Glas
    format!("{}\\Programs\\Jarvis-Glas", local)
}

#[tauri::command]
fn get_log_path() -> String {
    let local = std::env::var("LOCALAPPDATA").unwrap_or_else(|_| {
        std::env::var("USERPROFILE")
            .map(|u| format!("{u}\\AppData\\Local"))
            .unwrap_or_else(|_| "C:\\Program Files".into())
    });
    format!("{}\\jarvis\\logs\\bootstrap-installer.log", local)
}

#[tauri::command]
fn get_jarvis_home() -> String {
    let local = std::env::var("LOCALAPPDATA").unwrap_or_else(|_| {
        std::env::var("USERPROFILE")
            .map(|u| format!("{u}\\AppData\\Local"))
            .unwrap_or_else(|_| "C:\\Program Files".into())
    });
    format!("{}\\jarvis", local)
}

#[tauri::command]
fn get_mode() -> String {
    // Bare launch = install mode.
    "install".into()
}
