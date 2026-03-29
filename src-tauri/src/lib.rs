use std::collections::HashMap;
use std::io::{BufReader, Read};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::thread;
use tauri::{AppHandle, Emitter, Manager, State};

struct AppState {
    children: Mutex<HashMap<String, std::process::Child>>,
}

#[tauri::command]
fn check_ffmpeg_path() -> bool {
    let output = Command::new("ffmpeg").arg("-version").output();
    match output {
        Ok(out) => out.status.success(),
        Err(_) => false,
    }
}

#[derive(Clone, serde::Serialize)]
struct ProgressPayload {
    job_id: String,
    line: String,
}

#[tauri::command]
fn cancel_job(state: State<'_, AppState>, job_id: String) -> Result<(), String> {
    if let Ok(mut children) = state.children.lock() {
        if let Some(mut child) = children.remove(&job_id) {
            let _ = child.kill();
            return Ok(());
        }
    }
    Err("Job not found or already completed".to_string())
}

#[tauri::command]
fn enqueue_job(
    app: AppHandle,
    state: State<'_, AppState>,
    job_id: String,
    args: Vec<String>,
) -> Result<(), String> {
    let mut child = Command::new("ffmpeg")
        .args(args)
        .stderr(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn ffmpeg: {}", e))?;

    let stderr = child.stderr.take().unwrap();
    state.children.lock().unwrap().insert(job_id.clone(), child);

    let job_id_clone = job_id.clone();
    thread::spawn(move || {
        let _ = app.emit(
            "ffmpeg-started",
            ProgressPayload {
                job_id: job_id_clone.clone(),
                line: "Job started...".to_string(),
            },
        );

        let reader = BufReader::new(stderr);
        let mut line_buffer = Vec::new();

        // Iterate byte-by-byte through the buffer to detect both \n and \r live
        for byte_result in reader.bytes() {
            if let Ok(c) = byte_result {
                if c == b'\n' || c == b'\r' {
                    let line_str = String::from_utf8_lossy(&line_buffer).to_string();
                    if !line_str.trim().is_empty() {
                        let _ = app.emit(
                            "ffmpeg-progress",
                            ProgressPayload {
                                job_id: job_id_clone.clone(),
                                line: line_str,
                            },
                        );
                    }
                    line_buffer.clear();
                } else {
                    line_buffer.push(c);
                }
            } else {
                break;
            }
        }

        // Flush remaining
        if !line_buffer.is_empty() {
            let line_str = String::from_utf8_lossy(&line_buffer).to_string();
            let _ = app.emit(
                "ffmpeg-progress",
                ProgressPayload {
                    job_id: job_id_clone.clone(),
                    line: line_str,
                },
            );
        }

        let state = app.state::<AppState>();
        let mut status_msg = String::from("Completed");

        if let Ok(mut children) = state.children.lock() {
            if let Some(mut c) = children.remove(&job_id_clone) {
                if let Ok(status) = c.wait() {
                    status_msg = format!("Finished with status: {}", status);
                } else {
                    status_msg = String::from("Job Killed / Failed to wait");
                }
            } else {
                status_msg = String::from("Job Killed / Stopped");
            }
        }

        let _ = app.emit(
            "ffmpeg-complete",
            ProgressPayload {
                job_id: job_id_clone,
                line: status_msg,
            },
        );
    });

    Ok(())
}

#[tauri::command]
fn probe_file(path: String) -> Result<String, String> {
    let output = Command::new("ffprobe")
        .args([
            "-v",
            "quiet",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            &path,
        ])
        .output()
        .map_err(|e| format!("Failed to spawn ffprobe: {}", e))?;

    if output.status.success() {
        let json_str = String::from_utf8_lossy(&output.stdout).to_string();
        Ok(json_str)
    } else {
        let err_str = String::from_utf8_lossy(&output.stderr).to_string();
        Err(format!("ffprobe error: {}", err_str))
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState {
            children: Mutex::new(HashMap::new()),
        })
        .invoke_handler(tauri::generate_handler![
            check_ffmpeg_path,
            enqueue_job,
            cancel_job,
            probe_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
