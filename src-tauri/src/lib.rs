//! Tackle Tactics desktop shell: the web build in a native window, plus the career save file.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::Manager;

/// `<app data>/career.json` (on macOS: ~/Library/Application Support/com.tackletactics.game/).
fn save_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("career.json"))
}

fn backup_of(path: &Path) -> PathBuf {
    path.with_extension("json.bak")
}

fn valid_json(text: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(text).is_ok()
}

/// The saved career, or the backup if the main file is missing or damaged, or nothing.
fn read_at(path: &Path) -> Option<String> {
    for candidate in [path.to_path_buf(), backup_of(path)] {
        if let Ok(text) = fs::read_to_string(&candidate) {
            if valid_json(&text) {
                return Some(text);
            }
            log::warn!("ignoring damaged save {}", candidate.display());
        }
    }
    None
}

/// Atomic write: temp file, fsync, keep the previous save as a backup, then rename into place.
fn write_at(path: &Path, data: &str) -> Result<(), String> {
    if !valid_json(data) {
        return Err("refusing to save invalid JSON".into());
    }
    let tmp = path.with_extension("json.tmp");
    {
        let mut f = fs::File::create(&tmp).map_err(|e| e.to_string())?;
        f.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
        f.sync_all().map_err(|e| e.to_string())?;
    }
    if path.exists() {
        fs::copy(path, backup_of(path)).map_err(|e| e.to_string())?;
    }
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}

/// Starting over: the old career is moved aside (career.previous.json), never destroyed outright.
fn delete_at(path: &Path) -> Result<(), String> {
    if path.exists() {
        fs::rename(path, path.with_extension("previous.json")).map_err(|e| e.to_string())?;
    }
    let _ = fs::remove_file(backup_of(path));
    Ok(())
}

#[tauri::command]
fn read_save(app: tauri::AppHandle) -> Result<Option<String>, String> {
    Ok(read_at(&save_file(&app)?))
}

#[tauri::command]
fn write_save(app: tauri::AppHandle, data: String) -> Result<(), String> {
    write_at(&save_file(&app)?, &data)
}

#[tauri::command]
fn delete_save(app: tauri::AppHandle) -> Result<(), String> {
    delete_at(&save_file(&app)?)
}

#[tauri::command]
fn save_path(app: tauri::AppHandle) -> Result<String, String> {
    Ok(save_file(&app)?.display().to_string())
}

// ------------------------------------------------------------------ your music folder

/// Audio the radio plays from the player's own folder.
const SONG_EXTS: &[&str] = &["mp3", "m4a", "aac", "ogg", "oga", "opus", "wav", "flac", "aif", "aiff"];

/// `<Music>/Tackle Tactics` (the app data folder if the system has no Music folder), created on demand.
fn music_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .audio_dir()
        .or_else(|_| app.path().app_data_dir())
        .map_err(|e| e.to_string())?;
    let dir = base.join("Tackle Tactics");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn is_song(path: &Path) -> bool {
    path.is_file()
        && path
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| SONG_EXTS.contains(&e.to_ascii_lowercase().as_str()))
}

/// A file name inside the folder: no separators or parent steps, so nothing outside can be read.
fn song_path(dir: &Path, name: &str) -> Result<PathBuf, String> {
    if name.is_empty() || name.contains(['/', '\\']) || name == ".." || name == "." {
        return Err("not a song in the music folder".into());
    }
    let path = dir.join(name);
    if !is_song(&path) {
        return Err("not a song in the music folder".into());
    }
    Ok(path)
}

#[tauri::command]
fn music_folder(app: tauri::AppHandle) -> Result<String, String> {
    Ok(music_dir(&app)?.display().to_string())
}

/// The song files in the folder, by name.
#[tauri::command]
fn list_music(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let dir = music_dir(&app)?;
    let mut names: Vec<String> = fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter(|e| is_song(&e.path()))
        .filter_map(|e| e.file_name().into_string().ok())
        .filter(|n| !n.starts_with('.'))
        .collect();
    names.sort();
    Ok(names)
}

/// One song's bytes (sent raw, not as JSON), for the radio to play.
#[tauri::command]
fn read_song(app: tauri::AppHandle, name: String) -> Result<tauri::ipc::Response, String> {
    let path = song_path(&music_dir(&app)?, &name)?;
    Ok(tauri::ipc::Response::new(fs::read(path).map_err(|e| e.to_string())?))
}

/// Show the folder in Finder / Explorer / the file manager.
#[tauri::command]
fn open_music_folder(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let dir = music_dir(&app)?;
    app.opener()
        .open_path(dir.to_string_lossy(), None::<&str>)
        .map_err(|e| e.to_string())
}

/// Size the window to the screen it opens on: up to 1600×900, at most 92% of the usable area
/// (menu bar and Dock excluded), kept at 16:9 and centred. The window starts hidden so it never
/// flashes at the wrong size or half off-screen.
fn fit_to_screen(window: &tauri::WebviewWindow) {
    let monitor = window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten());
    let Some(monitor) = monitor else { return };
    let scale = monitor.scale_factor();
    let area = monitor.work_area();
    let (ax, ay) = (area.position.x as f64 / scale, area.position.y as f64 / scale);
    let (aw, ah) = (area.size.width as f64 / scale, area.size.height as f64 / scale);
    let mut w = (aw * 0.92).min(1600.0);
    let mut h = (ah * 0.92).min(900.0);
    // keep the game's 16:9 stage proportions
    if w / h > 16.0 / 9.0 {
        w = h * 16.0 / 9.0
    } else {
        h = w * 9.0 / 16.0
    }
    let _ = window.set_size(tauri::LogicalSize::new(w.round(), h.round()));
    let _ = window.set_position(tauri::LogicalPosition::new(
        (ax + (aw - w) / 2.0).round(),
        (ay + (ah - h) / 2.0).round(),
    ));
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                fit_to_screen(&window);
                let _ = window.show();
            }
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            read_save,
            write_save,
            delete_save,
            save_path,
            music_folder,
            list_music,
            read_song,
            open_music_folder
        ])
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_save(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("tt-save-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir.join("career.json")
    }

    #[test]
    fn writes_reads_and_keeps_a_backup() {
        let p = temp_save("roundtrip");
        assert_eq!(read_at(&p), None);
        write_at(&p, r#"{"day":1}"#).unwrap();
        write_at(&p, r#"{"day":2}"#).unwrap();
        assert_eq!(read_at(&p).as_deref(), Some(r#"{"day":2}"#));
        assert_eq!(fs::read_to_string(backup_of(&p)).unwrap(), r#"{"day":1}"#);
        assert!(!p.with_extension("json.tmp").exists());
    }

    #[test]
    fn song_names_cannot_leave_the_music_folder() {
        let dir = std::env::temp_dir().join(format!("tt-music-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("Band - Song.mp3"), b"id3").unwrap();
        fs::write(dir.join("notes.txt"), b"hi").unwrap();
        assert!(song_path(&dir, "Band - Song.mp3").is_ok());
        assert!(song_path(&dir, "notes.txt").is_err());
        assert!(song_path(&dir, "missing.mp3").is_err());
        for evil in ["../career.json", "..", "a/b.mp3", "a\\b.mp3", ""] {
            assert!(song_path(&dir, evil).is_err(), "{evil}");
        }
    }

    #[test]
    fn falls_back_to_the_backup_when_damaged() {
        let p = temp_save("damaged");
        write_at(&p, r#"{"day":1}"#).unwrap();
        write_at(&p, r#"{"day":2}"#).unwrap();
        fs::write(&p, "{\"day\": 3, trunc").unwrap();
        assert_eq!(read_at(&p).as_deref(), Some(r#"{"day":1}"#));
    }

    #[test]
    fn rejects_invalid_json_and_moves_old_careers_aside() {
        let p = temp_save("delete");
        assert!(write_at(&p, "not json").is_err());
        write_at(&p, r#"{"day":5}"#).unwrap();
        delete_at(&p).unwrap();
        assert_eq!(read_at(&p), None);
        assert_eq!(
            fs::read_to_string(p.with_extension("previous.json")).unwrap(),
            r#"{"day":5}"#
        );
    }
}
