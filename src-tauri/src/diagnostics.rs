//! Short lived performance logs shown in Settings.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;

const MAX_ENTRIES: usize = 500;

static ENTRIES: OnceLock<Mutex<VecDeque<TimingLogEntry>>> = OnceLock::new();
static NEXT_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimingLogEntry {
    pub id: u64,
    pub timestamp_ms: u64,
    pub category: String,
    pub message: String,
}

fn entries() -> &'static Mutex<VecDeque<TimingLogEntry>> {
    ENTRIES.get_or_init(|| Mutex::new(VecDeque::with_capacity(MAX_ENTRIES)))
}

/// Add one timing event to the in-memory log, keeping the most recent entries.
pub fn record(category: &str, message: String) {
    let timestamp_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u64::MAX as u128) as u64;
    let entry = TimingLogEntry {
        id: NEXT_ID.fetch_add(1, Ordering::Relaxed),
        timestamp_ms,
        category: category.to_owned(),
        message,
    };
    let mut entries = entries()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if entries.len() == MAX_ENTRIES {
        entries.pop_front();
    }
    entries.push_back(entry);
}

#[tauri::command]
pub fn timing_logs() -> Vec<TimingLogEntry> {
    entries()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .iter()
        .cloned()
        .collect()
}

#[tauri::command]
pub fn clear_timing_logs() {
    entries()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clear();
}
