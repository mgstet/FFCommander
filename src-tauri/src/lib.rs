use std::collections::HashMap;
use std::io::{BufReader, Read};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::thread;
use tauri::{AppHandle, Emitter, Manager, State};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

struct AppState {
    children: Mutex<HashMap<String, std::process::Child>>,
}

#[tauri::command]
fn check_ffmpeg_path() -> bool {
    let mut cmd = Command::new("ffmpeg");
    cmd.arg("-version");
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    match cmd.output() {
        Ok(out) => out.status.success(),
        Err(_) => false,
    }
}

#[derive(Clone, serde::Serialize)]
struct ProgressPayload {
    job_id: String,
    line: String,
    success: Option<bool>,
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
    let mut cmd = Command::new("ffmpeg");
    cmd.args(args);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let mut child = cmd
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
                success: None,
            },
        );

        let reader = BufReader::new(stderr);
        let mut line_buffer = Vec::new();

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
                                success: None,
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

        if !line_buffer.is_empty() {
            let line_str = String::from_utf8_lossy(&line_buffer).to_string();
            let _ = app.emit(
                "ffmpeg-progress",
                ProgressPayload {
                    job_id: job_id_clone.clone(),
                    line: line_str,
                    success: None,
                },
            );
        }

        let state = app.state::<AppState>();
        let mut status_msg = String::from("Completed");
        let mut job_success = false;

        if let Ok(mut children) = state.children.lock() {
            if let Some(mut c) = children.remove(&job_id_clone) {
                if let Ok(status) = c.wait() {
                    status_msg = format!("Finished with status: {}", status);
                    job_success = status.success();
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
                success: Some(job_success),
            },
        );
    });

    Ok(())
}

#[tauri::command]
fn probe_file(path: String) -> Result<String, String> {
    let mut cmd = Command::new("ffprobe");
    cmd.args([
        "-v",
        "quiet",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        &path,
    ]);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let output = cmd
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

#[tauri::command]
fn get_ffmpeg_version() -> String {
    #[cfg(target_os = "windows")]
    use std::os::windows::process::CommandExt;

    let mut cmd = Command::new("ffmpeg");
    cmd.arg("-version");

    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

    match cmd.output() {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            stdout.lines().next().unwrap_or("FFmpeg Version Unknown").to_string()
        },
        Err(_) => "FFmpeg Not Found".to_string()
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
            get_ffmpeg_version,
            probe_file,
            enqueue_job,
            cancel_job
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
