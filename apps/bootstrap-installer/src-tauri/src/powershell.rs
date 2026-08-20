//! Drives PowerShell (Windows) / bash (Unix) for our bundled install script.
//!
//! Simplified port of Hermes' powershell.rs: spawn the script, stream stdout/
//! stderr lines to the caller, support cancellation. We keep line-buffered
//! streaming + the CREATE_NO_WINDOW flag so no console flashes behind the Tauri
//! window.

use std::path::Path;
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};

pub struct StreamSink {
    pub on_stdout_line: Box<dyn Fn(&str) + Send + Sync>,
    pub on_stderr_line: Box<dyn Fn(&str) + Send + Sync>,
}

pub struct ScriptResult {
    pub exit_code: Option<i32>,
    pub killed: bool,
}

/// Cancellation signal.
pub type CancelRx = tokio::sync::mpsc::Receiver<()>;

pub async fn run_script(
    script_path: &Path,
    args: &[String],
    sink: StreamSink,
    mut cancel_rx: Option<CancelRx>,
) -> std::io::Result<ScriptResult> {
    let mut cmd = build_command(script_path, args);
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    {
        // CREATE_NO_WINDOW = 0x08000000
        cmd.creation_flags(0x0800_0000);
    }

    let mut child: Child = cmd.spawn()?;
    let stdout = child.stdout.take().expect("stdout piped");
    let stderr = child.stderr.take().expect("stderr piped");

    let mut stdout_reader = BufReader::new(stdout);
    let mut stderr_reader = BufReader::new(stderr);
    let mut killed = false;

    let mut out_buf = String::new();
    let mut err_buf = String::new();

    loop {
        tokio::select! {
            n = stdout_reader.read_line(&mut out_buf) => {
                match n {
                    Ok(0) => break, // EOF
                    Ok(_) => {
                        let line = out_buf.trim_end().to_string();
                        out_buf.clear();
                        (sink.on_stdout_line)(&line);
                    }
                    Err(_) => break,
                }
            }
            n = stderr_reader.read_line(&mut err_buf) => {
                match n {
                    Ok(0) => {} // stderr EOF — keep draining stdout
                    Ok(_) => {
                        let line = err_buf.trim_end().to_string();
                        err_buf.clear();
                        (sink.on_stderr_line)(&line);
                    }
                    Err(_) => {}
                }
            }
            _ = recv_cancel(&mut cancel_rx) => {
                killed = true;
                let _ = child.start_kill();
                break;
            }
        }
    }

    // Drain remaining lines.
    while stdout_reader.read_line(&mut out_buf).await? > 0 {
        let line = out_buf.trim_end().to_string();
        out_buf.clear();
        (sink.on_stdout_line)(&line);
    }
    while stderr_reader.read_line(&mut err_buf).await? > 0 {
        let line = err_buf.trim_end().to_string();
        err_buf.clear();
        (sink.on_stderr_line)(&line);
    }

    let status = child.wait().await?;
    Ok(ScriptResult {
        exit_code: status.code(),
        killed,
    })
}

#[cfg(target_os = "windows")]
fn build_command(script_path: &Path, args: &[String]) -> Command {
    // Strip the \\?\ long-path prefix — PowerShell 5.1's $MyInvocation /
    // $PSScriptRoot misbehave when the script path carries it, and Join-Path
    // then fails with a NULL-drive error.
    let path_str = script_path
        .to_string_lossy()
        .strip_prefix(r"\\?\")
        .unwrap_or(&script_path.to_string_lossy())
        .to_string();
    let mut cmd = Command::new("powershell.exe");
    cmd.arg("-NoProfile")
        .arg("-ExecutionPolicy")
        .arg("Bypass")
        .arg("-File")
        .arg(path_str);
    for a in args {
        cmd.arg(a);
    }
    cmd
}

#[cfg(not(target_os = "windows"))]
fn build_command(script_path: &Path, args: &[String]) -> Command {
    let mut cmd = Command::new("bash");
    cmd.arg(script_path);
    for a in args {
        cmd.arg(a);
    }
    cmd
}

async fn recv_cancel(rx: &mut Option<CancelRx>) {
    match rx {
        Some(r) => {
            let _ = r.recv().await;
        }
        None => std::future::pending::<()>().await,
    }
}
