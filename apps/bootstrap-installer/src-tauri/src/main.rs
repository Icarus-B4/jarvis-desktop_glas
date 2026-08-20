// J.A.R.V.I.S. Setup — Tauri entrypoint.
// Strips the console window on release builds (like Hermes) so double-clicking
// the .exe shows ONLY the Tauri window.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    jarvis_bootstrap_lib::run();
}
