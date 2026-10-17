//! Per-photo inference timings collected for AI scan chunk logs.

use std::cell::Cell;
use std::time::Duration;

#[derive(Clone, Copy, Debug, Default)]
pub struct ModelTime {
    pub elapsed: Duration,
    pub calls: usize,
}

impl ModelTime {
    fn record(&mut self, elapsed: Duration) {
        self.elapsed = self.elapsed.saturating_add(elapsed);
        self.calls += 1;
    }

    fn add(&mut self, other: Self) {
        self.elapsed = self.elapsed.saturating_add(other.elapsed);
        self.calls += other.calls;
    }
}

#[derive(Clone, Copy, Debug, Default)]
pub struct InferenceTimes {
    pub yunet: ModelTime,
    pub yolo: ModelTime,
}

impl InferenceTimes {
    pub fn add(&mut self, other: Self) {
        self.yunet.add(other.yunet);
        self.yolo.add(other.yolo);
    }
}

thread_local! {
    static CURRENT: Cell<Option<InferenceTimes>> = const { Cell::new(None) };
}

/// Collect model calls made synchronously during one photo's analysis.
pub fn collect<T>(analyze: impl FnOnce() -> T) -> (T, InferenceTimes) {
    let previous = CURRENT.with(|current| current.replace(Some(InferenceTimes::default())));
    let result = analyze();
    let times = CURRENT
        .with(|current| current.replace(previous))
        .unwrap_or_default();
    (result, times)
}

pub fn yunet(elapsed: Duration) {
    record(|times| times.yunet.record(elapsed));
}

pub fn yolo(elapsed: Duration) {
    record(|times| times.yolo.record(elapsed));
}

fn record(update: impl FnOnce(&mut InferenceTimes)) {
    CURRENT.with(|current| {
        if let Some(mut times) = current.get() {
            update(&mut times);
            current.set(Some(times));
        }
    });
}
