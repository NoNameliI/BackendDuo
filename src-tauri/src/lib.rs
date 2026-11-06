use std::sync::atomic::{AtomicBool, Ordering};

use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, WindowEvent};
use tauri_plugin_notification::NotificationExt;

/// The first time the window goes to the tray, tell the user where it went.
static TRAY_HINT_SHOWN: AtomicBool = AtomicBool::new(false);

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Names allowed for exported files: `^[A-Za-z0-9_.-]{1,64}\.(csv|txt)$`, never a path.
/// Windows device names (CON, NUL, COM1, ...) are refused as well.
fn valid_export_name(name: &str) -> Option<(&str, &str)> {
    if name.is_empty() || name.len() > 64 {
        return None;
    }
    if !name.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'.' | b'-')) {
        return None;
    }
    let (stem, ext) = name.rsplit_once('.')?;
    // The pattern needs at least one character before the extension (and a dot never leads a name).
    if stem.is_empty() || stem.starts_with('.') || !matches!(ext, "csv" | "txt") {
        return None;
    }
    let device = stem.split('.').next().unwrap_or("").to_ascii_uppercase();
    let numbered = |prefix: &str| device.strip_prefix(prefix).is_some_and(|n| n.len() == 1 && n != "0" && n.bytes().all(|b| b.is_ascii_digit()));
    if matches!(device.as_str(), "CON" | "PRN" | "AUX" | "NUL") || numbered("COM") || numbered("LPT") {
        return None;
    }
    Some((stem, ext))
}

/// Saves a text export into the Downloads folder under a validated name and returns the full path.
/// An existing file is never overwritten: `-1`, `-2`, ... is appended to the name instead.
#[tauri::command]
fn save_export(app: AppHandle, name: String, text: String) -> Result<String, String> {
    let (stem, ext) = valid_export_name(&name).ok_or("недопустимое имя файла")?;
    let dir = app.path().download_dir().map_err(|e| e.to_string())?;
    for attempt in 0..1000u32 {
        let file = if attempt == 0 { name.clone() } else { format!("{stem}-{attempt}.{ext}") };
        let path: PathBuf = dir.join(file);
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(mut handle) => {
                handle.write_all(text.as_bytes()).map_err(|e| e.to_string())?;
                return Ok(path.to_string_lossy().into_owned());
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e.to_string()),
        }
    }
    Err("не удалось подобрать свободное имя файла".into())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // A second launch brings the running instance back from the tray instead of starting a new one.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main_window(app)))
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![save_export])
        .setup(|app| {
            let open = MenuItem::with_id(app, "open", "Открыть студию", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Выйти", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &quit])?;

            TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().cloned().expect("bundle icon is configured"))
                .tooltip("PostgreSQL Interactive Studio")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show_main_window(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main_window(tray.app_handle());
                    }
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the window keeps the app (and streak reminders) running in the tray.
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
                if !TRAY_HINT_SHOWN.swap(true, Ordering::Relaxed) {
                    let _ = window
                        .app_handle()
                        .notification()
                        .builder()
                        .title("Студия работает в трее")
                        .body("Откройте её щелчком по значку. Выйти можно через меню значка.")
                        .show();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("failed to run the application");
}

#[cfg(test)]
mod tests {
    use super::valid_export_name;

    #[test]
    fn export_names_are_strict() {
        for ok in ["14_1a2b.csv", "14_1a2b_t1.txt", "a-b.c_d.csv"] {
            assert!(valid_export_name(ok).is_some(), "{ok}");
        }
        for bad in ["", ".csv", "a.exe", "a.csv.exe", "../a.csv", "a/b.csv", "a\\b.csv", "a b.csv", "CON.txt", "nul.csv", "com1.txt", "ä.csv", ".hidden.csv"] {
            assert!(valid_export_name(bad).is_none(), "{bad}");
        }
        assert!(valid_export_name(&format!("{}.csv", "a".repeat(61))).is_none());
    }
}
