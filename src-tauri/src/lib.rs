use std::time::Duration;

use tauri::{Manager, RunEvent};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

const BACKEND_HEALTH_URL: &str = "http://127.0.0.1:8001/api/health";
const BACKEND_POLL_TIMEOUT: Duration = Duration::from_secs(20);
const BACKEND_POLL_INTERVAL: Duration = Duration::from_millis(200);

/// Holds the sidecar's child handle for the lifetime of the app so it can be
/// killed explicitly on shutdown — Tauri does not guarantee sidecar cleanup on
/// every exit path (e.g. force-quit) without this.
struct BackendProcess(std::sync::Mutex<Option<CommandChild>>);

/// Kills the sidecar and any of its direct children.
///
/// The PyInstaller one-file backend binary forks a `multiprocessing.resource_tracker`
/// helper process (spawned the first time anything touches `multiprocessing`, e.g.
/// via `ProcessPoolExecutor` import machinery). That helper is deliberately designed
/// to survive a plain kill of its parent so it can clean up shared resources, which
/// left it (and the port 8001 listener) orphaned when we only killed the tracked PID.
/// `pkill -P <pid>` reaps any such children before/alongside killing the parent.
fn kill_backend_tree(child: CommandChild) {
    let pid = child.pid();
    let _ = std::process::Command::new("pkill")
        .args(["-9", "-P", &pid.to_string()])
        .status();
    let _ = child.kill();
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(BackendProcess(std::sync::Mutex::new(None)))
        .setup(|app| {
            let resource_dir = app
                .path()
                .resource_dir()
                .expect("failed to resolve resource dir");
            let frontend_dist = resource_dir.join("binaries").join("frontend_dist");

            let data_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");

            let shell = app.shell();
            let (_rx, child) = shell
                .sidecar("dbt-ui-backend")
                .expect("failed to create dbt-ui-backend sidecar command")
                .env("DBT_UI_FRONTEND_DIST", frontend_dist.to_string_lossy().to_string())
                .env("DBT_UI_DATA_DIR", data_dir.to_string_lossy().to_string())
                .spawn()
                .expect("failed to spawn dbt-ui-backend sidecar");

            app.state::<BackendProcess>()
                .0
                .lock()
                .unwrap()
                .replace(child);

            let window = app
                .get_webview_window("main")
                .expect("main window not found");

            // The window is created with url = http://127.0.0.1:8001 and starts
            // loading it immediately — almost always before the sidecar backend
            // has bound the port, since the sidecar was just spawned above. That
            // initial load fails (connection refused) and WKWebView does not
            // auto-retry, so simply calling window.show() later reveals an
            // already-failed blank page. Poll the backend, then explicitly
            // navigate once it's actually up, and only show the window after that
            // navigation has been issued.
            std::thread::spawn(move || {
                let started = std::time::Instant::now();
                loop {
                    if reqwest::blocking::get(BACKEND_HEALTH_URL)
                        .map(|r| r.status().is_success())
                        .unwrap_or(false)
                    {
                        break;
                    }
                    if started.elapsed() > BACKEND_POLL_TIMEOUT {
                        break;
                    }
                    std::thread::sleep(BACKEND_POLL_INTERVAL);
                }
                let url = "http://127.0.0.1:8001".parse().expect("valid backend url");
                let _ = window.navigate(url);
                let _ = window.show();
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let RunEvent::ExitRequested { .. } | RunEvent::Exit = event {
                if let Some(child) = app_handle.state::<BackendProcess>().0.lock().unwrap().take() {
                    kill_backend_tree(child);
                }
            }
        });
}
