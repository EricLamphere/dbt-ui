use std::process::Child;
use std::time::Duration;

use tauri::{Manager, RunEvent};

const BACKEND_HEALTH_URL: &str = "http://127.0.0.1:8001/api/health";
const BACKEND_POLL_TIMEOUT: Duration = Duration::from_secs(20);
const BACKEND_POLL_INTERVAL: Duration = Duration::from_millis(200);

/// Holds the backend process's child handle for the lifetime of the app so it
/// can be killed explicitly on shutdown — nothing else guarantees its cleanup
/// on every exit path (e.g. force-quit) without this.
struct BackendProcess(std::sync::Mutex<Option<Child>>);

/// Kills the backend process and any of its direct children.
///
/// The PyInstaller-bundled backend forks a `multiprocessing.resource_tracker`
/// helper process (spawned the first time anything touches `multiprocessing`, e.g.
/// via `ProcessPoolExecutor` import machinery). That helper is deliberately designed
/// to survive a plain kill of its parent so it can clean up shared resources, which
/// left it (and the port 8001 listener) orphaned when we only killed the tracked PID.
/// `pkill -P <pid>` reaps any such children before/alongside killing the parent.
fn kill_backend_tree(mut child: Child) {
    let pid = child.id();
    let _ = std::process::Command::new("pkill")
        .args(["-9", "-P", &pid.to_string()])
        .status();
    let _ = child.kill();
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
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

            // Spawned directly from the onedir resource folder rather than as a
            // Tauri sidecar/externalBin: PyInstaller onefile mode re-extracts the
            // whole interpreter into a fresh temp dir (and macOS Gatekeeper
            // re-validates that "new" unsigned binary) on every single launch,
            // adding ~7s to startup. onedir's executable lives at a fixed path on
            // disk across launches, so extraction and the Gatekeeper check each
            // only happen once, ever.
            let backend_exe = resource_dir
                .join("binaries")
                .join("dbt-ui-backend")
                .join("dbt-ui-backend");

            let child = std::process::Command::new(&backend_exe)
                .env("DBT_UI_FRONTEND_DIST", frontend_dist.to_string_lossy().to_string())
                .env("DBT_UI_DATA_DIR", data_dir.to_string_lossy().to_string())
                .spawn()
                .expect("failed to spawn dbt-ui-backend");

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
