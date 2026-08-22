//! Bootstrap orchestration for J.A.R.V.I.S. Setup.
//!
//! Simplified port of Hermes' bootstrap.rs: resolves the bundled install script,
//! runs it, streams its output to the frontend as `bootstrap` events, then on
//! success launches the installed J.A.R.V.I.S. desktop app and exits.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Instant;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::{mpsc, Mutex};

use crate::events::{BootstrapEvent, LogStream, StageInfo, StageState};
use crate::powershell;
use crate::AppState;

#[derive(Debug, Deserialize, Default)]
pub struct StartBootstrapArgs {
    pub commit: Option<String>,
    pub branch: Option<String>,
    pub include_desktop: bool,
    pub jarvis_home: Option<String>,
    /// Optional install path override (defaults to LOCALAPPDATA\Programs\@jarvisdesktop\J.A.R.V.I.S).
    pub install_path: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct BootstrapStatus {
    pub running: bool,
    pub completed: bool,
    pub install_root: Option<String>,
    pub last_error: Option<String>,
}

pub struct BootstrapHandle {
    pub cancel_tx: mpsc::Sender<()>,
    pub started_at: Instant,
    pub status: BootstrapStatus,
}

#[tauri::command]
pub async fn start_bootstrap(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    args: StartBootstrapArgs,
) -> Result<(), String> {
    let mut guard = state.bootstrap.lock().await;
    if let Some(h) = guard.as_ref() {
        if h.status.running {
            return Err("Bootstrap is already running".into());
        }
    }

    let (cancel_tx, cancel_rx) = mpsc::channel::<()>(1);
    let handle = BootstrapHandle {
        cancel_tx,
        started_at: Instant::now(),
        status: BootstrapStatus {
            running: true,
            completed: false,
            install_root: None,
            last_error: None,
        },
    };
    *guard = Some(handle);
    drop(guard);

    let app_for_task = app.clone();
    let state_for_task = state.inner().clone();
    let args_for_task = args;
    let cancel_rx = Arc::new(Mutex::new(Some(cancel_rx)));

    tauri::async_runtime::spawn(async move {
        let result = run_bootstrap(app_for_task.clone(), args_for_task, cancel_rx).await;

        let mut guard = state_for_task.bootstrap.lock().await;
        if let Some(h) = guard.as_mut() {
            h.status.running = false;
            match &result {
                Ok(root) => {
                    h.status.completed = true;
                    h.status.install_root = Some(root.clone());
                    h.status.last_error = None;
                }
                Err(err) => {
                    h.status.completed = false;
                    h.status.last_error = Some(err.to_string());
                }
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub async fn start_update() -> Result<(), String> {
    Err("Update mode is not available in this build.".into())
}

#[tauri::command]
pub async fn cancel_bootstrap(state: State<'_, Arc<AppState>>) -> Result<(), String> {
    let guard = state.bootstrap.lock().await;
    if let Some(h) = guard.as_ref() {
        let _ = h.cancel_tx.try_send(());
    }
    Ok(())
}

#[tauri::command]
pub async fn get_bootstrap_status(
    state: State<'_, Arc<AppState>>,
) -> Result<BootstrapStatus, String> {
    let guard = state.bootstrap.lock().await;
    Ok(match guard.as_ref() {
        Some(h) => h.status.clone(),
        None => BootstrapStatus {
            running: false,
            completed: false,
            install_root: None,
            last_error: None,
        },
    })
}

#[tauri::command]
pub async fn open_log_dir() -> Result<(), String> {
    let local = std::env::var("LOCALAPPDATA").unwrap_or_else(|_| {
        std::env::var("USERPROFILE")
            .map(|u| format!("{u}\\AppData\\Local"))
            .unwrap_or_else(|_| "C:\\Program Files".into())
    });
    // Log file lives next to the installed app (install.ps1 writes bootstrap-installer.log into InstallRoot).
    let dir = format!("{}\\Programs\\Jarvis-Glas", local);
    let _ = std::fs::create_dir_all(&dir);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("explorer.exe")
            .arg(&dir)
            .creation_flags(0x0800_0000)
            .spawn()
            .map_err(|e| format!("failed to open log dir: {e}"))?;
    }
    Ok(())
}

/// Emit a typed event on the single `bootstrap` channel.
fn emit(app: &AppHandle, event: BootstrapEvent) {
    let _ = app.emit(BootstrapEvent::CHANNEL, event);
}

async fn run_bootstrap(
    app: AppHandle,
    args: StartBootstrapArgs,
    cancel_rx_holder: Arc<Mutex<Option<mpsc::Receiver<()>>>>,
) -> Result<String, String> {
    let install_root = args
        .install_path
        .filter(|p| !p.trim().is_empty())
        .unwrap_or_else(|| {
            let local =
                std::env::var("LOCALAPPDATA").unwrap_or_else(|_| "C:\\Program Files".into());
            // User-confirmed install path: %LOCALAPPDATA%\Programs\Jarvis-Glas
            format!("{}\\Programs\\Jarvis-Glas", local)
        });

    // Granular stages, mirrored from install.ps1's [stage:NAME] markers.
    // `github-check` is a real network round-trip (like Hermes' version probe),
    // so the user sees progress instead of an instant copy.
    let stages = vec![
        StageInfo {
            name: "github-check".into(),
            title: "GitHub-Version pruefen".into(),
            category: "setup".into(),
            needs_user_input: false,
        },
        StageInfo {
            name: "prepare".into(),
            title: "Vorbereiten".into(),
            category: "setup".into(),
            needs_user_input: false,
        },
        StageInfo {
            name: "copy".into(),
            title: "Dateien kopieren".into(),
            category: "setup".into(),
            needs_user_input: false,
        },
        StageInfo {
            name: "shortcut".into(),
            title: "Verknuepfung erstellen".into(),
            category: "setup".into(),
            needs_user_input: false,
        },
        StageInfo {
            name: "finalize".into(),
            title: "Abschliessen".into(),
            category: "setup".into(),
            needs_user_input: false,
        },
    ];

    emit(
        &app,
        BootstrapEvent::Manifest {
            stages: stages.clone(),
            protocol_version: Some(1),
        },
    );

    let script = resolve_install_script(&app)?;

    // Track the currently-running stage so we can mark it succeeded when the
    // next [stage:NAME] marker arrives (or the script ends).
    let current_stage: Arc<std::sync::Mutex<Option<String>>> =
        Arc::new(std::sync::Mutex::new(None));
    let mark_running = |app: &AppHandle, name: &str| {
        emit(
            app,
            BootstrapEvent::Stage {
                name: name.to_string(),
                state: StageState::Running,
                duration_ms: None,
                error: None,
            },
        );
    };
    let mark_succeeded = |app: &AppHandle, name: &str| {
        emit(
            app,
            BootstrapEvent::Stage {
                name: name.to_string(),
                state: StageState::Succeeded,
                duration_ms: None,
                error: None,
            },
        );
    };

    // Stage 1: GitHub version check (real network call).
    mark_running(&app, &stages[0].name.clone());
    *current_stage.lock().unwrap() = Some(stages[0].name.clone());
    match check_github_release().await {
        Ok(info) => {
            emit_log(
                &app,
                &format!(
                    "[github] latest release: {} ({})",
                    info.tag, info.asset_size
                ),
                LogStream::Stdout,
            );
            mark_succeeded(&app, &stages[0].name.clone());
            let _ = current_stage.lock().unwrap().take();
        }
        Err(e) => {
            // Non-fatal: continue with local copy even if the check fails.
            emit_log(
                &app,
                &format!("[github] check failed (continuing): {e}"),
                LogStream::Stderr,
            );
            mark_succeeded(&app, &stages[0].name.clone());
            let _ = current_stage.lock().unwrap().take();
        }
    }

    // Stage 2: prepare
    mark_running(&app, &stages[1].name.clone());
    *current_stage.lock().unwrap() = Some(stages[1].name.clone());

    let result = {
        let mut cancel_guard = cancel_rx_holder.lock().await;
        let cancel_rx = cancel_guard.take();
        drop(cancel_guard);
        powershell::run_script(
            &script,
            &[
                "-InstallRoot".into(),
                install_root.clone(),
                "-SourceUnpacked".into(),
                resolve_source_unpacked(),
            ],
            powershell::StreamSink {
                on_stdout_line: Box::new({
                    let app = app.clone();
                    let current = current_stage.clone();
                    move |l| {
                        // Detect [stage:NAME] markers from install.ps1 and
                        // transition the previous stage to succeeded, the new
                        // one to running.
                        if let Some(rest) = l.strip_prefix("[stage:") {
                            if let Some((name, _msg)) = rest.split_once(']') {
                                let new_stage = name.trim().to_string();
                                let prev = current.lock().unwrap().take();
                                if let Some(p) = prev {
                                    if p != new_stage {
                                        mark_succeeded(&app, &p);
                                    }
                                }
                                mark_running(&app, &new_stage);
                                *current.lock().unwrap() = Some(new_stage);
                                return;
                            }
                        }
                        emit_log(&app, l, LogStream::Stdout);
                    }
                }),
                on_stderr_line: Box::new({
                    let app = app.clone();
                    move |l| emit_log(&app, l, LogStream::Stderr)
                }),
            },
            cancel_rx,
        )
        .await
    };

    // Mark the final stage succeeded (or failed) based on outcome.
    let final_stage = current_stage.lock().unwrap().take();
    match result {
        Ok(outcome) => {
            if outcome.killed {
                if let Some(s) = &final_stage {
                    emit(
                        &app,
                        BootstrapEvent::Stage {
                            name: s.clone(),
                            state: StageState::Failed,
                            duration_ms: None,
                            error: None,
                        },
                    );
                }
                emit(
                    &app,
                    BootstrapEvent::Failed {
                        stage: final_stage,
                        error: "Installation abgebrochen.".into(),
                    },
                );
                return Err("aborted".into());
            }
            if outcome.exit_code != Some(0) {
                let msg = format!("install.ps1 exit code {:?}", outcome.exit_code);
                if let Some(s) = &final_stage {
                    emit(
                        &app,
                        BootstrapEvent::Stage {
                            name: s.clone(),
                            state: StageState::Failed,
                            duration_ms: None,
                            error: None,
                        },
                    );
                }
                emit(
                    &app,
                    BootstrapEvent::Failed {
                        stage: final_stage,
                        error: msg.clone(),
                    },
                );
                return Err(msg);
            }
            // Success: mark the final stage succeeded.
            if let Some(s) = &final_stage {
                mark_succeeded(&app, s);
            }
        }
        Err(e) => {
            if let Some(s) = &final_stage {
                emit(
                    &app,
                    BootstrapEvent::Stage {
                        name: s.clone(),
                        state: StageState::Failed,
                        duration_ms: None,
                        error: None,
                    },
                );
            }
            emit(
                &app,
                BootstrapEvent::Failed {
                    stage: final_stage,
                    error: e.to_string(),
                },
            );
            return Err(e.to_string());
        }
    }

    emit(
        &app,
        BootstrapEvent::Complete {
            install_root: install_root.clone(),
        },
    );

    Ok(install_root)
}

/// Resolve the bundled install script from Tauri's resource dir.
/// We ship install.ps1 next to the binary (Tauri copies `resources/` there).
fn resolve_install_script(app: &AppHandle) -> Result<PathBuf, String> {
    // Candidate locations, in priority order:
    //   1. Tauri's resource_dir/resources/install.ps1 (dev + some bundles)
    //   2. side-by-side with the running exe (NSIS bundle copies resources next to it)
    //   3. resource_dir/install.ps1 (flat, in case Tauri flattens)
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("resources").join("install.ps1"));
        candidates.push(resource_dir.join("install.ps1"));
    }
    if let Some(exe) = std::env::current_exe().ok().and_then(|p| p.parent().map(|d| d.to_path_buf())) {
        candidates.push(exe.join("resources").join("install.ps1"));
        candidates.push(exe.join("install.ps1"));
    }

    for c in &candidates {
        if c.exists() {
            return Ok(c.clone());
        }
    }
    Err(format!(
        "install.ps1 nicht gefunden. Gesuchte Orte: {:?}",
        candidates
    ))
}

/// Path to the Electron win-unpacked build we copy into the install dir.
fn resolve_source_unpacked() -> String {
    std::env::var("JARVIS_SOURCE_UNPACKED")
        .unwrap_or_else(|_| "win-unpacked".into())
}

fn emit_log(app: &AppHandle, line: &str, stream: LogStream) {
    emit(
        app,
        BootstrapEvent::Log {
            stage: Some("github-check".into()),
            line: line.to_string(),
            stream,
        },
    );
}

/// Probes the latest GitHub release for Icarus-B4/jarvis-desktop_glas.
/// Returns the tag and the size of the first asset (used for a progress hint).
/// Network failures are non-fatal — the installer falls back to the bundled
/// build. This mirrors Hermes' version probe stage (a real round-trip so the
/// user sees progress rather than an instant local copy).
async fn check_github_release() -> Result<GitHubReleaseInfo, String> {
    let url = "https://api.github.com/repos/Icarus-B4/jarvis-desktop_glas/releases/latest";
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("github client: {e}"))?;

    let resp = client
        .get(url)
        .header("User-Agent", "jarvis-setup/0.1.0")
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("github request failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("github API HTTP {}", resp.status()));
    }

    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("github json parse: {e}"))?;

    let tag = json
        .get("tag_name")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown")
        .to_string();

    let asset_size = json
        .get("assets")
        .and_then(|a| a.as_array())
        .and_then(|arr| arr.first())
        .and_then(|a| a.get("size"))
        .and_then(|s| s.as_u64())
        .unwrap_or(0);

    Ok(GitHubReleaseInfo {
        tag,
        asset_size,
    })
}

struct GitHubReleaseInfo {
    tag: String,
    asset_size: u64,
}

#[tauri::command]
pub async fn launch_jarvis_desktop(
    app: AppHandle,
    install_root: String,
) -> Result<(), String> {
    let exe = Path::new(&install_root).join("Jarvis-Glas.exe");
    if !exe.exists() {
        return Err(format!(
            "Jarvis-Glas.exe nicht gefunden unter {}",
            exe.display()
        ));
    }
    let mut cmd = std::process::Command::new(&exe);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        // DETACHED_PROCESS = 0x00000008 — keep the app alive after we exit.
        cmd.creation_flags(0x0000_0008);
    }
    cmd.spawn().map_err(|e| format!("failed to launch {}: {e}", exe.display()))?;

    tokio::time::sleep(std::time::Duration::from_millis(150)).await;
    app.exit(0);
    Ok(())
}
