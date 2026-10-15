//! Saved card sessions live on this computer, never beside source photos.
use std::{fs, io::Write, path::{Path, PathBuf}, sync::Mutex};
use serde_json::Value;
use tauri::Manager;
static WRITING: Mutex<()> = Mutex::new(());
fn path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("sessions/latest.json"))
}
fn save(path: &Path, value: &Value) -> Result<(), String> {
    let parent = path.parent().ok_or("No session directory")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let tmp = parent.join(".latest.tmp");
    let result = (|| {
        let mut options = fs::OpenOptions::new(); options.write(true).create(true).truncate(true);
        #[cfg(unix)] { use std::os::unix::fs::OpenOptionsExt; options.mode(0o600); }
        let mut file = options.open(&tmp).map_err(|e| e.to_string())?;
        file.write_all(&serde_json::to_vec(value).map_err(|e| e.to_string())?).and_then(|_| file.sync_all()).map_err(|e| e.to_string())?;
        fs::rename(&tmp, path).map_err(|e| e.to_string())
    })();
    if result.is_err() { let _ = fs::remove_file(tmp); }
    result
}
#[tauri::command]
pub fn review_save(app: tauri::AppHandle, value: Value) -> Result<(), String> {
    let _lock = WRITING.lock().map_err(|e| e.to_string())?;
    if value.get("version").and_then(Value::as_u64) != Some(1) || !value.get("items").is_some_and(Value::is_array) { return Err("Invalid session".into()); }
    save(&path(&app)?, &value)
}
#[tauri::command]
pub fn review_load(app: tauri::AppHandle) -> Result<Option<Value>, String> {
    let _lock = WRITING.lock().map_err(|e| e.to_string())?;
    match fs::read(path(&app)?) {
        Ok(bytes) => serde_json::from_slice(&bytes).map(Some).map_err(|e| format!("Saved session could not be read: {e}")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}
#[cfg(test)] mod tests {
    use super::*;
    #[test] fn session_is_stored_separately_and_replaced_whole() {
        let root = std::env::temp_dir().join(format!("opencull-review-{}", std::process::id()));
        let path = root.join("sessions/latest.json");
        save(&path, &serde_json::json!({"version":1,"items":[]})).unwrap();
        save(&path, &serde_json::json!({"version":1,"items":["chosen"]})).unwrap();
        let read: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(read["items"][0], "chosen"); assert!(!root.join("sessions/.latest.tmp").exists());
        fs::remove_dir_all(root).unwrap();
    }
}
