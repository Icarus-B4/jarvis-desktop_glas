//! Event types streamed from Rust → React (mirrors the Hermes bootstrap protocol).
//! The Tauri event channel name is "bootstrap"; the `type` discriminator routes.
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StageInfo {
    pub name: String,
    pub title: String,
    pub category: String,
    #[serde(rename = "needs_user_input", alias = "needsUserInput", default)]
    pub needs_user_input: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StageState {
    Running,
    Succeeded,
    Skipped,
    Failed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum LogStream {
    Stdout,
    Stderr,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum BootstrapEvent {
    Manifest {
        stages: Vec<StageInfo>,
        #[serde(rename = "protocolVersion")]
        protocol_version: Option<u32>,
    },
    Stage {
        name: String,
        state: StageState,
        #[serde(rename = "durationMs", skip_serializing_if = "Option::is_none")]
        duration_ms: Option<u64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },
    Log {
        #[serde(skip_serializing_if = "Option::is_none")]
        stage: Option<String>,
        line: String,
        stream: LogStream,
    },
    Complete {
        #[serde(rename = "installRoot")]
        install_root: String,
    },
    Failed {
        #[serde(skip_serializing_if = "Option::is_none")]
        stage: Option<String>,
        error: String,
    },
}

impl BootstrapEvent {
    pub const CHANNEL: &'static str = "bootstrap";
}
