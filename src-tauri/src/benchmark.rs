//! Isolated, local benchmarks for the native photo pipeline.
//!
//! Every generated photo, sidecar, preview cache and copy destination is kept
//! below one disposable temporary directory. The runner never opens an app
//! session, saves settings, contacts a service, or downloads a model.

use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;

use crate::ai;
use crate::cache::Cache;
use crate::framing;
use crate::ingest;
use crate::pool::Priority;
use crate::preview::{self, Tier};
use crate::raw::{
    self,
    io::{FileSource, ReadAt},
};
use crate::scan::{self, Kinds};
use crate::serve::{Previews, Wanted};
use crate::transfer;
use crate::xmp::{self, Color, Flag, Marks};

const FIXTURE_VERSION: &str = "3-6000x4000-texture-ai-cache";
const TOTAL_STAGES: usize = 30;
const MAX_QUICK_SECONDS: u64 = 60;
const MAX_THOROUGH_SECONDS: u64 = 300;
const THOROUGH_SAMPLES: usize = 24;
const ASTRONAUT_PNG: &[u8] = include_bytes!("../resources/benchmark/astronaut.png");
static NEXT_RUN: AtomicU64 = AtomicU64::new(1);
static RUNNER: OnceLock<Mutex<RunnerState>> = OnceLock::new();

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Quick,
    Thorough,
}

impl Mode {
    fn parse(value: &str) -> Result<Self, String> {
        match value {
            "quick" => Ok(Self::Quick),
            "thorough" => Ok(Self::Thorough),
            _ => Err("Choose quick or thorough.".into()),
        }
    }

    fn samples(self) -> usize {
        match self {
            Self::Quick => 3,
            Self::Thorough => THOROUGH_SAMPLES,
        }
    }

    fn fixtures(self) -> usize {
        match self {
            Self::Quick => 12,
            Self::Thorough => 48,
        }
    }

    fn seconds(self) -> u64 {
        match self {
            Self::Quick => MAX_QUICK_SECONDS,
            Self::Thorough => MAX_THOROUGH_SECONDS,
        }
    }
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RunState {
    Idle,
    Running,
    Completed,
    Cancelled,
    Failed,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum StageStatus {
    Passed,
    Failed,
    Skipped,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum CacheState {
    Cold,
    Warm,
    None,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum CoverageStatus {
    Measured,
    Skipped,
    Manual,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ReportKind {
    Benchmark,
    Recording,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Environment {
    pub app_version: String,
    pub build: String,
    pub os: String,
    pub arch: String,
    pub cpu: Option<String>,
    pub logical_cores: u32,
    pub memory_mb: Option<u64>,
    pub gpu: Option<String>,
    pub ai_provider: Option<String>,
    pub fixture_version: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stage {
    pub id: String,
    pub label: String,
    pub category: String,
    pub cache: CacheState,
    pub samples_ms: Vec<f64>,
    pub units: u64,
    pub bytes: u64,
    pub failures: u64,
    pub status: StageStatus,
    pub detail: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Coverage {
    pub id: String,
    pub label: String,
    pub status: CoverageStatus,
    pub reason: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub schema_version: u32,
    pub id: String,
    pub kind: ReportKind,
    pub mode: Option<Mode>,
    pub started_at_ms: u64,
    pub finished_at_ms: u64,
    pub environment: Environment,
    pub stages: Vec<Stage>,
    pub coverage: Vec<Coverage>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub run_id: Option<String>,
    pub state: RunState,
    pub completed: usize,
    pub total: usize,
    pub current: Option<String>,
    pub report: Option<Report>,
    pub error: Option<String>,
}

impl Default for Status {
    fn default() -> Self {
        Self {
            run_id: None,
            state: RunState::Idle,
            completed: 0,
            total: TOTAL_STAGES,
            current: None,
            report: None,
            error: None,
        }
    }
}

struct RunnerState {
    status: Status,
    cancel: Option<Arc<AtomicBool>>,
}

fn runner() -> &'static Mutex<RunnerState> {
    RUNNER.get_or_init(|| {
        Mutex::new(RunnerState {
            status: Status::default(),
            cancel: None,
        })
    })
}

/// Returns anonymous hardware and build details for local reporting previews.
#[tauri::command]
pub fn benchmark_environment() -> Environment {
    let cores = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(1);
    let build = format!(
        "{} {}{}",
        if cfg!(debug_assertions) {
            "debug"
        } else {
            "release"
        },
        if preview::CODEC == "turbo" {
            "turbo-jpeg"
        } else {
            "rust-jpeg"
        },
        if cfg!(feature = "cuda") { " cuda" } else { "" },
    );
    let ai_provider = if cfg!(target_os = "macos") {
        Some("Core ML or CPU fallback available".to_string())
    } else if cfg!(all(
        feature = "cuda",
        target_os = "linux",
        target_arch = "x86_64"
    )) && ai::acceleration::enabled()
    {
        Some("CUDA active; CPU fallback available".to_string())
    } else if cfg!(all(
        feature = "cuda",
        target_os = "linux",
        target_arch = "x86_64"
    )) {
        Some("CPU active; CUDA build available".to_string())
    } else {
        Some("CPU".to_string())
    };
    Environment {
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        build: build.to_string(),
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        cpu: cpu_name(),
        logical_cores: cores.min(u32::MAX as usize) as u32,
        memory_mb: total_memory_mb(),
        gpu: gpu_vendor(),
        ai_provider,
        fixture_version: FIXTURE_VERSION.to_string(),
    }
}

/// Starts one bounded benchmark in the background and returns its opaque ID.
#[tauri::command]
pub fn benchmark_start(mode: String) -> Result<String, String> {
    let mode = Mode::parse(&mode)?;
    let id = format!(
        "bench-{}-{}",
        timestamp_ms(),
        NEXT_RUN.fetch_add(1, Ordering::Relaxed)
    );
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut state = runner().lock().unwrap_or_else(|e| e.into_inner());
        if state.status.state == RunState::Running {
            return Err("A benchmark is already running.".into());
        }
        state.status = Status {
            run_id: Some(id.clone()),
            state: RunState::Running,
            completed: 0,
            total: TOTAL_STAGES,
            current: Some("Preparing local fixtures".into()),
            report: None,
            error: None,
        };
        state.cancel = Some(cancel.clone());
    }

    let thread_id = id.clone();
    let spawn = std::thread::Builder::new()
        .name("opencull-benchmark".into())
        .spawn(move || finish_run(thread_id, mode, cancel));
    if let Err(error) = spawn {
        let mut state = runner().lock().unwrap_or_else(|e| e.into_inner());
        state.status.state = RunState::Failed;
        state.status.current = None;
        state.status.error = Some("Could not start the benchmark worker.".into());
        state.cancel = None;
        let _ = error;
        return Err("Could not start the benchmark worker.".into());
    }
    Ok(id)
}

/// Reads the latest progress snapshot.
#[tauri::command]
pub fn benchmark_status() -> Status {
    runner()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .status
        .clone()
}

/// Requests cancellation of the matching active benchmark.
#[tauri::command]
pub fn benchmark_cancel(run_id: String) -> Result<(), String> {
    let state = runner().lock().unwrap_or_else(|e| e.into_inner());
    if state.status.state != RunState::Running || state.status.run_id.as_deref() != Some(&run_id) {
        return Err("That benchmark is no longer running.".into());
    }
    if let Some(cancel) = &state.cancel {
        cancel.store(true, Ordering::SeqCst);
    }
    Ok(())
}

fn finish_run(id: String, mode: Mode, cancel: Arc<AtomicBool>) {
    let started_at_ms = timestamp_ms();
    let started = Instant::now();
    let deadline = started + Duration::from_secs(mode.seconds());
    let mut progress = Progress::new(id.clone(), cancel, deadline);
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        crate::ai::onnx::with_isolated_cpu(|| run_benchmark(&mut progress, mode, started_at_ms))
    }))
    .unwrap_or(Err(()));
    let finished_at_ms = timestamp_ms();
    let timed_out = Instant::now() >= progress.deadline;
    let mut state = runner().lock().unwrap_or_else(|e| e.into_inner());
    if state.status.run_id.as_deref() != Some(&id) {
        return;
    }
    state.status.current = None;
    state.cancel = None;
    match result {
        Ok(mut report) => {
            report.finished_at_ms = finished_at_ms;
            state.status.completed = progress.completed;
            state.status.state = if progress.cancel.load(Ordering::SeqCst) {
                RunState::Cancelled
            } else if timed_out {
                RunState::Failed
            } else {
                RunState::Completed
            };
            if timed_out && !progress.cancel.load(Ordering::SeqCst) {
                state.status.error =
                    Some("Benchmark reached its time limit; see skipped stages.".into());
            }
            state.status.report = Some(report);
        }
        Err(()) => {
            state.status.state = if progress.cancel.load(Ordering::SeqCst) {
                RunState::Cancelled
            } else {
                RunState::Failed
            };
            state.status.error = Some(if progress.cancel.load(Ordering::SeqCst) {
                "Benchmark cancelled before a report was ready.".into()
            } else if timed_out {
                "Benchmark reached its time limit before a report was ready.".into()
            } else {
                "A local fixture or native pipeline operation could not complete.".into()
            });
        }
    }
}

struct Progress {
    id: String,
    cancel: Arc<AtomicBool>,
    deadline: Instant,
    completed: usize,
}

impl Progress {
    fn new(id: String, cancel: Arc<AtomicBool>, deadline: Instant) -> Self {
        Self {
            id,
            cancel,
            deadline,
            completed: 0,
        }
    }

    fn current(&self, label: &str) {
        let mut state = runner().lock().unwrap_or_else(|e| e.into_inner());
        if state.status.run_id.as_deref() == Some(&self.id) {
            state.status.current = Some(label.to_string());
            state.status.completed = self.completed;
        }
    }

    fn complete(&mut self) {
        self.completed += 1;
        let mut state = runner().lock().unwrap_or_else(|e| e.into_inner());
        if state.status.run_id.as_deref() == Some(&self.id) {
            state.status.completed = self.completed;
        }
    }

    fn stopping_reason(&self) -> Option<&'static str> {
        if self.cancel.load(Ordering::SeqCst) {
            Some("Not run because the benchmark was cancelled.")
        } else if Instant::now() >= self.deadline {
            Some("Not run because the benchmark reached its time limit.")
        } else {
            None
        }
    }
}

#[derive(Clone, Copy)]
struct StageSpec {
    id: &'static str,
    label: &'static str,
    category: &'static str,
    cache: CacheState,
    units: u64,
    bytes: u64,
    detail: Option<&'static str>,
}

fn measure(
    progress: &mut Progress,
    mode: Mode,
    spec: StageSpec,
    sample_count: usize,
    mut operation: impl FnMut(usize) -> Result<(), ()>,
) -> Stage {
    progress.current(spec.label);
    let mut samples_ms = Vec::with_capacity(sample_count);
    let mut failures = 0;
    let mut status = StageStatus::Passed;
    let mut detail = spec.detail.map(str::to_string);
    let mut stop_reason = None;

    for sample in 0..sample_count {
        if let Some(reason) = progress.stopping_reason() {
            stop_reason = Some(reason);
            break;
        }
        let started = Instant::now();
        match operation(sample) {
            Ok(()) => samples_ms.push(started.elapsed().as_secs_f64() * 1000.0),
            Err(()) if progress.cancel.load(Ordering::SeqCst) => {
                stop_reason = Some("Not run because the benchmark was cancelled.");
                break;
            }
            Err(()) => {
                failures += 1;
                status = StageStatus::Failed;
                detail = Some(
                    "One or more samples could not complete; local error text is omitted.".into(),
                );
                break;
            }
        }
    }

    if samples_ms.is_empty() && failures == 0 {
        status = StageStatus::Skipped;
        detail = Some(stop_reason.unwrap_or("No samples were run.").into());
    } else if let Some(reason) = stop_reason {
        detail = Some(match detail {
            Some(note) => format!("{note} Stopped early: {reason}"),
            None => reason.into(),
        });
    } else if mode == Mode::Thorough
        && matches!(spec.id, "face-analysis-cold" | "face-analysis-warm")
    {
        detail = Some(
            "One real face fixture; expensive model samples are capped to keep the run bounded."
                .into(),
        );
    }

    let completed_samples = samples_ms.len() as u64;
    let stage = Stage {
        id: spec.id.into(),
        label: spec.label.into(),
        category: spec.category.into(),
        cache: spec.cache,
        samples_ms,
        units: spec.units.saturating_mul(completed_samples),
        bytes: spec.bytes.saturating_mul(completed_samples),
        failures,
        status,
        detail,
    };
    progress.complete();
    stage
}

/// Times the foreground preview while an idle-priority preview request for
/// the same representative source is still pending. The background result is
/// drained after the timer stops so cleanup never races a worker.
fn measure_foreground_preview_under_load(
    progress: &mut Progress,
    mode: Mode,
    previews: &Previews,
    source: &Path,
    bytes: u64,
) -> Stage {
    let spec = StageSpec {
        id: "preview-foreground-under-load",
        label: "Foreground preview under background load",
        category: "preview",
        cache: CacheState::Cold,
        units: 1,
        bytes,
        detail: Some("Confirms an Idle Fit(2400) worker is active before timing a distinct Now Fit(2400) cache miss. Generated 6000x4000 source; overlap varies by scheduler. App cache misses only; OS cache uncontrolled."),
    };
    progress.current(spec.label);
    let mut samples_ms = Vec::with_capacity(mode.samples());
    let mut failures = 0;
    let mut status = StageStatus::Passed;
    let mut detail = spec.detail.map(str::to_string);
    let mut stop_reason = None;

    'samples: for sample in 0..mode.samples() {
        if let Some(reason) = progress.stopping_reason() {
            stop_reason = Some(reason);
            break;
        }

        // Reader dispatch is asynchronous and the pool holds Idle work during
        // its quiet window. Only start the foreground timer after the pool
        // confirms that this request is actively rendering. If it finishes
        // first, try again rather than calling queued work concurrent load.
        let mut pending_background = None;
        let mut background_failed = false;
        'attempts: for attempt in 0..4 {
            let (tx, rx) = mpsc::channel();
            previews.get(
                Wanted {
                    path: source.to_path_buf(),
                    version: format!("bg-load-{sample}-{attempt}"),
                    tier: Tier::Fit(2400),
                },
                Priority::Idle,
                move |result| {
                    let _ = tx.send(result.map(|_| ()));
                },
            );

            let attempt_deadline =
                (Instant::now() + Duration::from_millis(1200)).min(progress.deadline);
            loop {
                if let Some(reason) = progress.stopping_reason() {
                    if previews.pool.idle_running() == 0 {
                        previews.pool.clear_idle();
                    }
                    // Keep the fixture alive until an active decode is done;
                    // a queued request was just cancelled above.
                    let _ = rx.recv();
                    stop_reason = Some(reason);
                    break 'samples;
                }

                match rx.try_recv() {
                    Ok(Ok(())) => continue 'attempts,
                    Ok(Err(_)) | Err(mpsc::TryRecvError::Disconnected) => {
                        background_failed = true;
                        break 'attempts;
                    }
                    Err(mpsc::TryRecvError::Empty) => {}
                }

                if previews.pool.idle_running() > 0 {
                    // Recheck completion after observing an active worker so
                    // a just-finished request is never reported as load.
                    match rx.try_recv() {
                        Err(mpsc::TryRecvError::Empty) => {
                            pending_background = Some(rx);
                            break 'attempts;
                        }
                        Ok(Ok(())) => continue 'attempts,
                        Ok(Err(_)) | Err(mpsc::TryRecvError::Disconnected) => {
                            background_failed = true;
                            break 'attempts;
                        }
                    }
                }

                if Instant::now() >= attempt_deadline {
                    // A queued item can still be waiting out the quiet
                    // window. Cancel it before retrying so no old request can
                    // leak into the next contention sample.
                    previews.pool.clear_idle();
                    match rx.recv() {
                        Ok(Err(error)) if error == "no longer wanted" => continue 'attempts,
                        Ok(Ok(())) => continue 'attempts,
                        Ok(Err(_)) | Err(_) => {
                            background_failed = true;
                            break 'attempts;
                        }
                    }
                }
                std::thread::sleep(Duration::from_millis(1));
            }
        }

        if stop_reason.is_some() {
            break;
        }
        if background_failed {
            failures += 1;
            status = StageStatus::Failed;
            detail = Some(
                "A background preview request failed before active load could be measured; local error text is omitted."
                    .into(),
            );
            break;
        }
        let Some(background) = pending_background else {
            stop_reason = Some(
                "No active background preview was observed within four bounded attempts; no overlap sample was reported.",
            );
            break;
        };

        let started = Instant::now();
        let foreground = previews.get_blocking(
            Wanted {
                path: source.to_path_buf(),
                version: format!("fg-load-{sample}"),
                tier: Tier::Fit(2400),
            },
            Priority::Now,
        );
        let elapsed = started.elapsed().as_secs_f64() * 1000.0;
        let background_result = background.recv();
        match (foreground, background_result) {
            (Ok(foreground), Ok(Ok(()))) => {
                std::hint::black_box(foreground.bytes.len());
                samples_ms.push(elapsed);
            }
            _ => {
                failures += 1;
                status = StageStatus::Failed;
                detail = Some(
                    "A foreground or queued background preview could not complete; local error text is omitted."
                        .into(),
                );
                break;
            }
        }
    }

    if samples_ms.is_empty() && failures == 0 {
        status = StageStatus::Skipped;
        detail = Some(stop_reason.unwrap_or("No samples were run.").into());
    } else if let Some(reason) = stop_reason {
        detail = Some(match detail {
            Some(note) => format!("{note} Stopped early: {reason}"),
            None => reason.into(),
        });
    }

    let completed_samples = samples_ms.len() as u64;
    let stage = Stage {
        id: spec.id.into(),
        label: spec.label.into(),
        category: spec.category.into(),
        cache: spec.cache,
        samples_ms,
        units: spec.units.saturating_mul(completed_samples),
        bytes: spec.bytes.saturating_mul(completed_samples),
        failures,
        status,
        detail,
    };
    progress.complete();
    stage
}

fn skip_unexercised_judge(stage: &mut Stage, face_found: bool) {
    if !face_found && stage.status == StageStatus::Passed {
        stage.status = StageStatus::Skipped;
        stage.detail = Some(
            "No face was detected in the sample, so judge and eye-model performance is not represented."
                .into(),
        );
    }
}

struct TempRun {
    root: PathBuf,
}

impl TempRun {
    fn new(id: &str) -> Result<Self, ()> {
        let root =
            std::env::temp_dir().join(format!("opencull-benchmark-{}-{id}", std::process::id()));
        fs::create_dir_all(&root).map_err(|_| ())?;
        Ok(Self { root })
    }
}

impl Drop for TempRun {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

struct Fixtures {
    photos: PathBuf,
    raw: PathBuf,
    jpeg: PathBuf,
    representative_raw: PathBuf,
    portrait_raw: PathBuf,
    sidecar_photo: PathBuf,
    write_photo: PathBuf,
    pixels: Vec<u8>,
    width: u32,
    height: u32,
    raw_bytes: u64,
    photo_tree_bytes: u64,
    representative_bytes: u64,
    photo_count: usize,
    ingest_items: Vec<ingest::Item>,
    ingest_destinations: Vec<PathBuf>,
    ship_destinations: Vec<PathBuf>,
    trim_caches: Vec<Cache>,
}

fn create_fixtures(
    root: &Path,
    count: usize,
    samples: usize,
    progress: &Progress,
) -> Result<Fixtures, ()> {
    let photos = root.join("fixtures/photos");
    let mut directories = Vec::new();
    for name in ["day-a", "day-b", "day-c"] {
        let dir = photos.join(name);
        fs::create_dir_all(&dir).map_err(|_| ())?;
        directories.push(dir);
    }

    if progress.stopping_reason().is_some() {
        return Err(());
    }
    let (pixels, width, height) = decode_bundled_png(ASTRONAUT_PNG)?;
    let jpeg = preview::encode_jpeg(pixels.clone(), width, height, 86).map_err(|_| ())?;
    let jpeg = with_synthetic_exif(&jpeg, width, height, 1);
    let raw_bytes = make_synthetic_raf(&jpeg);
    let photo_tree_bytes =
        (raw_bytes.len() as u64 + jpeg.len() as u64).saturating_mul(count as u64 + 1);
    let mut ingest_items = Vec::new();
    let mut first_raw = None;
    let mut first_jpeg = None;

    for index in 0..count {
        if progress.stopping_reason().is_some() {
            return Err(());
        }
        let folder = &directories[index % directories.len()];
        let sequence = index / directories.len() + 1;
        let stem = format!("DSC_{sequence:04}");
        let raw = folder.join(format!("{stem}.RAF"));
        let jpeg_path = folder.join(format!("{stem}.JPG"));
        fs::write(&raw, &raw_bytes).map_err(|_| ())?;
        fs::write(&jpeg_path, &jpeg).map_err(|_| ())?;
        if first_raw.is_none() {
            first_raw = Some(raw.clone());
            first_jpeg = Some(jpeg_path.clone());
        }
        if index < 4 {
            ingest_items.push(ingest::Item {
                path: raw,
                display: jpeg_path,
            });
        }
    }

    let only_jpeg = directories[0].join("JPEG_ONLY.JPG");
    let only_raw = directories[0].join("RAW_ONLY.RAF");
    fs::write(&only_jpeg, &jpeg).map_err(|_| ())?;
    fs::write(&only_raw, &raw_bytes).map_err(|_| ())?;
    let raw = first_raw.ok_or(())?;
    let jpeg_path = first_jpeg.ok_or(())?;
    xmp::write(
        &raw,
        Marks {
            rating: 4,
            flag: Flag::Pick,
            color: Color::Green,
        },
    )
    .map_err(|_| ())?;

    // One generated 6000x4000 textured image drives realistic decode/resize
    // costs; a second copy carries EXIF orientation 6 for portrait output.
    // The smaller astronaut remains dedicated to face-model measurements.
    let representative_jpeg = make_textured_jpeg(6000, 4000, 1, progress)?;
    let representative_raw_bytes = make_synthetic_raf(&representative_jpeg);
    let representative_raw = root.join("fixtures/representative.RAF");
    fs::write(&representative_raw, &representative_raw_bytes).map_err(|_| ())?;
    let portrait_jpeg = make_textured_jpeg(6000, 4000, 6, progress)?;
    let portrait_raw_bytes = make_synthetic_raf(&portrait_jpeg);
    let portrait_raw = root.join("fixtures/portrait.RAF");
    fs::write(&portrait_raw, &portrait_raw_bytes).map_err(|_| ())?;

    let write_photo = root.join("fixtures/marks-write.jpg");
    fs::write(&write_photo, &jpeg).map_err(|_| ())?;
    let mut ingest_destinations = Vec::with_capacity(samples);
    let mut ship_destinations = Vec::with_capacity(samples);
    for index in 0..samples {
        let ingest = root.join(format!("copy/ingest-{index}"));
        fs::create_dir_all(&ingest).map_err(|_| ())?;
        ingest_destinations.push(ingest);
        let ship = root.join(format!("copy/ship-{index}"));
        fs::create_dir_all(&ship).map_err(|_| ())?;
        // Exercise KeepBoth conflict resolution without ever touching a source.
        fs::write(
            ship.join(raw.file_name().ok_or(())?),
            b"existing disposable destination",
        )
        .map_err(|_| ())?;
        ship_destinations.push(ship);
    }

    let mut trim_caches = Vec::with_capacity(samples);
    for index in 0..samples {
        let cache = Cache::new(root.join(format!("cache/trim-{index}")));
        for entry in 0..8 {
            let key = cache.path_for(Path::new(&format!("fixture-{entry}.jpg")), "v1", "thumb320");
            cache.put(&key, &jpeg);
        }
        trim_caches.push(cache);
    }

    Ok(Fixtures {
        photos,
        raw: raw.clone(),
        jpeg: jpeg_path,
        representative_raw,
        portrait_raw,
        sidecar_photo: raw.clone(),
        write_photo,
        pixels,
        width,
        height,
        raw_bytes: raw_bytes.len() as u64,
        photo_tree_bytes,
        representative_bytes: representative_raw_bytes.len() as u64,
        photo_count: count + 2,
        ingest_items,
        ingest_destinations,
        ship_destinations,
        trim_caches,
    })
}

fn run_benchmark(progress: &mut Progress, mode: Mode, started_at_ms: u64) -> Result<Report, ()> {
    let temp = TempRun::new(&progress.id)?;
    if let Some(reason) = progress.stopping_reason() {
        let _ = reason;
        return Err(());
    }
    progress.current("Preparing private benchmark fixtures");
    let samples = mode.samples();
    let fixtures = create_fixtures(&temp.root, mode.fixtures(), samples, progress)?;
    let preview_cache = Cache::new(temp.root.join("cache/previews"));
    let previews = Previews::new(preview_cache.clone());
    let bytes = fixtures.raw_bytes;
    let preview_bytes = fixtures.representative_bytes;
    let face_fixture_bytes = fs::metadata(&fixtures.jpeg).map(|m| m.len()).unwrap_or(0);
    let portrait_bytes = fs::metadata(&fixtures.portrait_raw)
        .map(|m| m.len())
        .unwrap_or(0);
    let mut stages = Vec::with_capacity(TOTAL_STAGES);

    let scan_spec = StageSpec { id: "scan-pairing", label: "Folder scan and RAW/JPEG pairing", category: "scan", cache: CacheState::None, units: fixtures.photo_count as u64, bytes: fixtures.photo_tree_bytes, detail: Some("Scans a disposable set of paired synthetic RAW/JPEG files; metadata includes total fixture bytes and does not represent removable-card speed.") };
    stages.push(measure(progress, mode, scan_spec, samples, |_| {
        let result = scan::scan_folder_media(&fixtures.photos, true, Kinds::Both, false);
        let paired = result
            .images
            .iter()
            .any(|i| i.path == fixtures.raw && i.display == fixtures.jpeg);
        if result.images.len() == fixtures.photo_count && paired {
            Ok(())
        } else {
            Err(())
        }
    }));

    let ingest_scan_spec = StageSpec {
        id: "ingest-scan",
        label: "Ingest media scan",
        category: "ingest",
        cache: CacheState::None,
        units: fixtures.photo_count as u64,
        bytes: fixtures.photo_tree_bytes,
        detail: Some(
            "Scans only disposable local fixture folders; no removable device is accessed.",
        ),
    };
    stages.push(measure(progress, mode, ingest_scan_spec, samples, |_| {
        let found = ingest::scan(&fixtures.photos);
        if found.len() == fixtures.photo_count {
            Ok(())
        } else {
            Err(())
        }
    }));

    let session_spec = StageSpec { id: "session-history", label: "Session save and history read", category: "sessions", cache: CacheState::Warm, units: 1, bytes: 132, detail: Some("Round trips a generated empty session through the native save and history implementation in a private folder.") };
    let latest_session = temp.root.join("sessions/latest.json");
    let session_value = serde_json::json!({
        "version": 1,
        "id": "benchmark-session",
        "name": "Benchmark fixture",
        "sources": [],
        "items": [],
        "stage": "review",
        "updatedAt": started_at_ms,
    });
    stages.push(measure(progress, mode, session_spec, samples, |_| {
        crate::review::save_history(&latest_session, &session_value).map_err(|_| ())?;
        let history = crate::review::history(&latest_session).map_err(|_| ())?;
        if history
            .first()
            .is_some_and(|entry| entry["id"] == "benchmark-session")
        {
            Ok(())
        } else {
            Err(())
        }
    }));

    let probe_spec = StageSpec { id: "metadata-probe", label: "RAW preview and EXIF probe", category: "metadata", cache: CacheState::None, units: 1, bytes, detail: Some("Synthetic Fujifilm-style header and EXIF point at a generated JPEG; this does not represent sensor-data decoding or a camera file.") };
    stages.push(measure(progress, mode, probe_spec, samples, |_| {
        let probe = raw::probe(&fixtures.raw).map_err(|_| ())?;
        if probe.embedded.is_empty() || probe.exif.date.is_none() {
            Err(())
        } else {
            Ok(())
        }
    }));

    let capture_spec = StageSpec {
        id: "capture-time",
        label: "Capture-time read",
        category: "metadata",
        cache: CacheState::None,
        units: 1,
        bytes,
        detail: Some("Reads the synthetic EXIF capture time from a local fixture."),
    };
    stages.push(measure(progress, mode, capture_spec, samples, |_| {
        raw::capture_time(&fixtures.raw)
            .filter(|time| time.is_finite())
            .map(|_| ())
            .ok_or(())
    }));

    let sidecar_spec = StageSpec {
        id: "sidecar-read",
        label: "Ratings and sidecar read",
        category: "sidecar",
        cache: CacheState::Warm,
        units: 1,
        bytes: 0,
        detail: Some("Reads the generated XMP sidecar and verifies its rating and pick flag."),
    };
    stages.push(measure(progress, mode, sidecar_spec, samples, |_| {
        let marks = xmp::read(&fixtures.sidecar_photo, None);
        if marks.rating == 4 && marks.flag == Flag::Pick {
            Ok(())
        } else {
            Err(())
        }
    }));

    for (tier, id, label) in [
        (
            Tier::Thumb(320),
            "preview-thumbnail-cold",
            "Thumbnail preview generation (cache miss)",
        ),
        (
            Tier::Fit(2400),
            "preview-fit-cold",
            "Fit preview generation (cache miss)",
        ),
        (
            Tier::Screen,
            "preview-screen-cold",
            "Screen preview generation (cache miss)",
        ),
    ] {
        let wanted = |version: String| Wanted {
            path: fixtures.representative_raw.clone(),
            version,
            tier,
        };
        let spec = StageSpec { id, label, category: "preview", cache: CacheState::Cold, units: 1, bytes: preview_bytes, detail: Some("Runs the native preview request and cache write on a generated 6000x4000 textured RAW preview; app-cache miss only, OS disk cache is uncontrolled.") };
        stages.push(measure(progress, mode, spec, samples, |sample| {
            let request = wanted(format!("cold-{id}-{sample}"));
            previews
                .get_blocking(request, Priority::Now)
                .map(|_| ())
                .map_err(|_| ())
        }));

        if tier != Tier::Screen {
            let warm_version = format!("warm-{id}");
            let warm = wanted(warm_version.clone());
            if progress.stopping_reason().is_none() {
                let _ = previews.get_blocking(warm, Priority::Now);
            }
            let spec = StageSpec {
                id: if tier == Tier::Thumb(320) { "preview-thumbnail-warm" } else { "preview-fit-warm" },
                label: if tier == Tier::Thumb(320) { "Thumbnail preview cache hit" } else { "Fit preview cache hit" },
                category: "preview",
                cache: CacheState::Warm,
                units: 1,
                bytes,
                detail: Some("Reads a preview from the private app cache after warm-up; OS disk cache is uncontrolled."),
            };
            stages.push(measure(progress, mode, spec, samples, |_| {
                let request = wanted(warm_version.clone());
                if !previews.has(&request) {
                    return Err(());
                }
                previews
                    .get_blocking(request, Priority::Now)
                    .map(|_| ())
                    .map_err(|_| ())
            }));
        } else {
            let warm_version = "warm-preview-screen".to_string();
            let warm = wanted(warm_version.clone());
            if progress.stopping_reason().is_none() {
                let _ = previews.get_blocking(warm, Priority::Now);
            }
            let spec = StageSpec { id: "preview-screen-warm", label: "Screen preview cache hit", category: "preview", cache: CacheState::Warm, units: 1, bytes: preview_bytes, detail: Some("Warm request after extracting or generating the screen-sized preview in the private app cache; OS disk cache is uncontrolled.") };
            stages.push(measure(progress, mode, spec, samples, |_| {
                let request = wanted(warm_version.clone());
                if !previews.has(&request) {
                    return Err(());
                }
                previews
                    .get_blocking(request, Priority::Now)
                    .map(|_| ())
                    .map_err(|_| ())
            }));
        }
    }

    stages.push(measure_foreground_preview_under_load(
        progress,
        mode,
        &previews,
        &fixtures.representative_raw,
        preview_bytes,
    ));

    // The Full preview route writes to the user's in-memory timing log. Mirror
    // its raw locate/read/orient work directly so this report stays isolated.
    let full_spec = StageSpec { id: "preview-full", label: "Full preview locate, read and orient", category: "preview", cache: CacheState::None, units: 1, bytes: preview_bytes, detail: Some("Measures the Full-tier raw work on the generated 6000x4000 textured fixture without adding benchmark entries to the app timing log.") };
    stages.push(measure(progress, mode, full_spec, samples, |_| {
        let source = FileSource::open(&fixtures.representative_raw).map_err(|_| ())?;
        let probe = raw::probe_source(&source);
        let embedded = probe.largest().ok_or(())?;
        let bytes = source
            .read_at(embedded.offset, embedded.len as usize)
            .ok_or(())?;
        let oriented = raw::jpeg::set_orientation(bytes, probe.orientation);
        std::hint::black_box(oriented);
        Ok(())
    }));

    let decode_spec = StageSpec {
        id: "image-decode",
        label: "Full photo decode and orientation",
        category: "decode",
        cache: CacheState::None,
        units: 1,
        bytes: preview_bytes,
        detail: Some("Decodes a generated 6000x4000 textured image to upright RGB pixels."),
    };
    stages.push(measure(progress, mode, decode_spec, samples, |_| {
        let decoded =
            preview::decode_upright(&fixtures.representative_raw, u32::MAX).map_err(|_| ())?;
        if decoded.width > 0 && decoded.height > 0 {
            std::hint::black_box(decoded.rgb);
            Ok(())
        } else {
            Err(())
        }
    }));

    let portrait_spec = StageSpec { id: "portrait-orientation", label: "Portrait EXIF orientation decode", category: "decode", cache: CacheState::None, units: 1, bytes: portrait_bytes, detail: Some("Decodes a generated 6000x4000 textured image with orientation 6 to 4000x6000 upright pixels.") };
    stages.push(measure(progress, mode, portrait_spec, samples, |_| {
        let decoded = preview::decode_upright(&fixtures.portrait_raw, u32::MAX).map_err(|_| ())?;
        if decoded.width == 4000 && decoded.height == 6000 {
            std::hint::black_box(decoded.rgb);
            Ok(())
        } else {
            Err(())
        }
    }));

    let histogram_version = "histogram-preview";
    let histogram_request = Wanted {
        path: fixtures.representative_raw.clone(),
        version: histogram_version.into(),
        tier: Tier::Thumb(320),
    };
    let histogram_preview = previews
        .get_blocking(histogram_request, Priority::Now)
        .map_err(|_| ())?;
    let histogram_spec = StageSpec { id: "histogram", label: "Histogram pixel calculation", category: "histogram", cache: CacheState::Warm, units: 1, bytes: histogram_preview.bytes.len() as u64, detail: Some("Measures the native histogram pixel algorithm on an app-cache thumbnail; excludes frontend rendering and OS disk-cache effects.") };
    stages.push(measure(progress, mode, histogram_spec, samples, |_| {
        let mut decoder = jpeg_decoder::Decoder::new(&histogram_preview.bytes[..]);
        let pixels = decoder.decode().map_err(|_| ())?;
        let info = decoder.info().ok_or(())?;
        let histogram = crate::commands::histogram_from_pixels(
            &pixels,
            info.width as u32,
            info.height as u32,
            None,
        );
        std::hint::black_box(histogram);
        Ok(())
    }));

    let face_spec = StageSpec { id: "face-analysis-cold", label: "Face analysis (first model use)", category: "ai", cache: CacheState::None, units: 1, bytes: face_fixture_bytes, detail: Some("Uses bundled YuNet and judge models on the licensed 512x512 astronaut sample; one inference is timed for cold model setup.") };
    let mut face_cold_found = false;
    let mut face_cold = measure(progress, mode, face_spec, 1, |_| {
        let analysis = ai::analyze(&fixtures.raw, ai::Rules::Basic).map_err(|_| ())?;
        face_cold_found = !analysis.faces.is_empty();
        std::hint::black_box(analysis);
        Ok(())
    });
    skip_unexercised_judge(&mut face_cold, face_cold_found);
    stages.push(face_cold);

    let warm_ai_samples = if mode == Mode::Quick { 1 } else { 5 };
    let face_warm_spec = StageSpec { id: "face-analysis-warm", label: "Face analysis (warm model use)", category: "ai", cache: CacheState::Warm, units: 1, bytes: face_fixture_bytes, detail: Some("Repeated local inference on one licensed astronaut sample; sample count is capped because model inference is expensive.") };
    let mut face_warm_found = true;
    let mut face_warm = measure(progress, mode, face_warm_spec, warm_ai_samples, |_| {
        let analysis = ai::analyze(&fixtures.raw, ai::Rules::Basic).map_err(|_| ())?;
        face_warm_found &= !analysis.faces.is_empty();
        std::hint::black_box(analysis);
        Ok(())
    });
    skip_unexercised_judge(&mut face_warm, face_warm_found);
    stages.push(face_warm);

    // Exercise the same durable result store used by AI analysis, without
    // touching the user's cache or rerunning a model inside the cache timings.
    let cache_record = ai::store::Record {
        faces: vec![ai::store::FaceRecord {
            x: 0.18,
            y: 0.12,
            w: 0.48,
            h: 0.56,
            subject: true,
            reason: None,
            eyes_shut: false,
            looking_away: false,
            maybe_away: false,
            sharpness: Some(82.0),
            eye: 0.31,
            eyes_read: true,
            state: Some("Smiling".into()),
            concern: 0,
            excused: 0.0,
            open: true,
        }],
        score: Some(0.86),
        focus: Some(0.9),
        gaze: Some(0.82),
        ..Default::default()
    };
    let cache_version = ai::store::version(ai::Rules::Basic).to_string();
    let result_cache = ai::store::Store::new(temp.root.join("cache/ai-results"));
    let save_folder = |sample: usize| temp.root.join(format!("ai-cache-save/set-{sample:02}"));
    let load_folder = temp.root.join("ai-cache-load/folder");
    let load_photo = load_folder.join("sample.RAF");
    let mut load_records = std::collections::HashMap::new();
    load_records.insert(
        load_photo.to_string_lossy().into_owned(),
        (cache_version.clone(), cache_record.clone()),
    );
    result_cache.save(&load_folder, ai::Rules::Basic, &load_records);

    let save_photo = save_folder(0).join("sample.RAF");
    let mut save_bytes_record = std::collections::HashMap::new();
    save_bytes_record.insert(
        save_photo.to_string_lossy().into_owned(),
        (cache_version.clone(), cache_record.clone()),
    );
    let cache_bytes = serde_json::to_vec(&save_bytes_record)
        .map(|bytes| bytes.len() as u64)
        .unwrap_or(0);
    let cache_save_spec = StageSpec {
        id: "ai-result-cache-save",
        label: "AI result cache write",
        category: "ai-cache",
        cache: CacheState::Cold,
        units: 1,
        bytes: cache_bytes,
        detail: Some("Writes generated analysis records through the native AI store to fresh keys in a private cache; model inference is excluded."),
    };
    let mut cache_save = measure(progress, mode, cache_save_spec, samples, |sample| {
        let folder = save_folder(sample);
        let photo = folder.join("sample.RAF");
        let mut known = std::collections::HashMap::new();
        known.insert(
            photo.to_string_lossy().into_owned(),
            (cache_version.clone(), cache_record.clone()),
        );
        result_cache.save(&folder, ai::Rules::Basic, &known);
        std::hint::black_box(result_cache.usage());
        Ok(())
    });
    let mut save_verification_failures = 0;
    for sample in 0..cache_save.samples_ms.len() {
        let folder = save_folder(sample);
        let photo = folder.join("sample.RAF");
        let known = result_cache.load_images(
            &folder,
            ai::Rules::Basic,
            [(photo.as_path(), cache_version.as_str())],
        );
        if ai::store::remembered(&known, &photo, &cache_version).as_ref() != Some(&cache_record) {
            save_verification_failures += 1;
        }
    }
    if save_verification_failures > 0 {
        cache_save.failures += save_verification_failures;
        cache_save.status = StageStatus::Failed;
        cache_save.detail = Some(
            "One or more writes could not be read back from the private AI result store.".into(),
        );
    }
    stages.push(cache_save);

    let cache_load_spec = StageSpec {
        id: "ai-result-cache-load",
        label: "AI result cache hit",
        category: "ai-cache",
        cache: CacheState::Warm,
        units: 1,
        bytes: cache_bytes,
        detail: Some("Loads a preseeded generated analysis record through the native AI store; the entry exists before timing and model inference is excluded."),
    };
    stages.push(measure(progress, mode, cache_load_spec, samples, |_| {
        let known = result_cache.load_images(
            &load_folder,
            ai::Rules::Basic,
            [(load_photo.as_path(), cache_version.as_str())],
        );
        if ai::store::remembered(&known, &load_photo, &cache_version).as_ref()
            == Some(&cache_record)
        {
            std::hint::black_box(known.len());
            Ok(())
        } else {
            Err(())
        }
    }));

    let advanced_cold_spec = StageSpec { id: "advanced-face-cold", label: "Advanced face analysis (first use)", category: "ai", cache: CacheState::None, units: 1, bytes: face_fixture_bytes, detail: Some("Runs bundled YOLO26n advanced face analysis on the licensed 512x512 astronaut sample; one cold inference is timed.") };
    let mut advanced_cold_found = false;
    let mut advanced_cold = measure(progress, mode, advanced_cold_spec, 1, |_| {
        let analysis = ai::analyze_record_with_finder(
            &fixtures.raw,
            ai::Rules::Advanced,
            false,
            ai::FaceFinder::Yolo,
        )
        .map_err(|_| ())?;
        advanced_cold_found = !analysis.faces.is_empty();
        std::hint::black_box(analysis);
        Ok(())
    });
    skip_unexercised_judge(&mut advanced_cold, advanced_cold_found);
    stages.push(advanced_cold);
    let advanced_warm_spec = StageSpec { id: "advanced-face-warm", label: "Advanced face analysis (warm use)", category: "ai", cache: CacheState::Warm, units: 1, bytes: face_fixture_bytes, detail: Some("Repeated bundled YOLO26n inference on one licensed sample; count is capped because model inference is expensive.") };
    let mut advanced_warm_found = true;
    let mut advanced_warm = measure(
        progress,
        mode,
        advanced_warm_spec,
        if mode == Mode::Quick { 1 } else { 3 },
        |_| {
            let analysis = ai::analyze_record_with_finder(
                &fixtures.raw,
                ai::Rules::Advanced,
                false,
                ai::FaceFinder::Yolo,
            )
            .map_err(|_| ())?;
            advanced_warm_found &= !analysis.faces.is_empty();
            std::hint::black_box(analysis);
            Ok(())
        },
    );
    skip_unexercised_judge(&mut advanced_warm, advanced_warm_found);
    stages.push(advanced_warm);

    let motion_spec = StageSpec { id: "motion-blur", label: "Motion-blur analysis", category: "ai", cache: CacheState::None, units: 1, bytes: face_fixture_bytes, detail: Some("Runs the local directional-blur check over a deterministic subject region from the bundled fixture.") };
    stages.push(measure(progress, mode, motion_spec, samples, |_| {
        let mut record = ai::store::Record {
            key: Some(ai::store::KeyRecord {
                x: 0.1,
                y: 0.1,
                w: 0.8,
                h: 0.8,
            }),
            ..Default::default()
        };
        ai::motion::annotate_pixels(
            &fixtures.pixels,
            fixtures.width,
            fixtures.height,
            &mut record,
        );
        std::hint::black_box(record.motion_blur);
        Ok(())
    }));

    let grouping_spec = StageSpec { id: "burst-grouping", label: "Burst and scene grouping", category: "grouping", cache: CacheState::None, units: fixtures.photo_count as u64, bytes: 0, detail: Some("Measures native burst timestamp grouping and face-record grouping; MobileCLIP embeddings are reported separately as unavailable unless installed.") };
    stages.push(measure(progress, mode, grouping_spec, samples, |_| {
        let times: Vec<_> = (0..fixtures.photo_count)
            .map(|n| Some(n as f64 * 80.0))
            .collect();
        let burst = crate::burst::group(&times);
        if burst.len() != times.len() {
            return Err(());
        }
        let record = ai::store::Record::default();
        let frames: Vec<_> = (0..fixtures.photo_count)
            .map(|n| ai::series::Frame {
                record: &record,
                time: Some(n as f64 * 80.0),
                burst: Some(1),
                upright: Some(true),
            })
            .collect();
        let grouped = ai::series::compare_run(&frames, false);
        if grouped.len() == frames.len() {
            std::hint::black_box(grouped);
            Ok(())
        } else {
            Err(())
        }
    }));

    let marks_spec = StageSpec {
        id: "marks-sidecar-write",
        label: "Rating and flag sidecar write",
        category: "sidecar",
        cache: CacheState::Warm,
        units: 1,
        bytes: 0,
        detail: Some("Updates a generated XMP sidecar beside a disposable JPEG."),
    };
    stages.push(measure(progress, mode, marks_spec, samples, |sample| {
        let marks = Marks {
            rating: (sample % 5 + 1) as u8,
            flag: Flag::Pick,
            color: Color::Green,
        };
        xmp::write(&fixtures.write_photo, marks).map_err(|_| ())
    }));

    let framing_spec = StageSpec { id: "crop-sidecar-write", label: "Crop and orientation sidecar write", category: "framing", cache: CacheState::Warm, units: 1, bytes: 0, detail: Some("Writes a generated crop into the disposable fixture sidecar using the native framing path.") };
    stages.push(measure(progress, mode, framing_spec, samples, |sample| {
        let wanted = framing::Wanted {
            framing: framing::Framing {
                turn: (sample % 8 + 1) as u8,
                crop: Some(framing::Crop {
                    cx: 256.0,
                    cy: 256.0,
                    w: 400.0,
                    h: 300.0,
                    angle: 1.5,
                }),
            },
            upright: (fixtures.width, fixtures.height),
            seed: Marks {
                rating: 3,
                flag: Flag::Pick,
                color: Color::Blue,
            },
        };
        framing::write(&fixtures.write_photo, Some(wanted.seed), &wanted)
            .map(|_| ())
            .map_err(|_| ())
    }));

    let copy_samples = samples;
    let ingest_spec = StageSpec { id: "ingest-copy", label: "Ingest copy with verification", category: "ingest", cache: CacheState::None, units: fixtures.ingest_items.len() as u64, bytes: fixtures.ingest_items.iter().map(|i| fs::metadata(&i.path).map(|m| m.len()).unwrap_or(0) + fs::metadata(&i.display).map(|m| m.len()).unwrap_or(0)).sum(), detail: Some("Copies a small local fixture set with the native size-check and naming path; source fixtures are retained.") };
    let cancel = progress.cancel.clone();
    stages.push(measure(
        progress,
        mode,
        ingest_spec,
        copy_samples,
        |sample| {
            let Some(destination) = fixtures.ingest_destinations.get(sample) else {
                return Err(());
            };
            let outcome = ingest::copy(
                &fixtures.ingest_items,
                destination,
                ingest::Policy::UniqueName,
                2,
                &cancel,
                &|_| {},
            );
            if outcome == ingest::Outcome::Success {
                Ok(())
            } else {
                Err(())
            }
        },
    ));

    let ship_spec = StageSpec { id: "ship-copy-conflicts", label: "Ship copy and conflict handling", category: "ship", cache: CacheState::None, units: 1, bytes: bytes + preview_bytes, detail: Some("Copies one synthetic RAW/JPEG pair and sidecar into a disposable destination with an intentional name collision; source files remain in place.") };
    let job = transfer::Job {
        owner: fixtures.raw.clone(),
        companions: vec![fixtures.jpeg.clone()],
    };
    stages.push(measure(progress, mode, ship_spec, copy_samples, |sample| {
        let Some(destination) = fixtures.ship_destinations.get(sample) else {
            return Err(());
        };
        if transfer::conflicts(std::slice::from_ref(&job), destination) != 1 {
            return Err(());
        }
        let outcome = transfer::run(
            std::slice::from_ref(&job),
            destination,
            false,
            transfer::Conflict::KeepBoth,
            |_| {},
        );
        if outcome.failed.is_empty()
            && outcome.placed.first().is_some_and(|path| path.exists())
            && fixtures.raw.exists()
            && fixtures.jpeg.exists()
        {
            Ok(())
        } else {
            Err(())
        }
    }));

    let trim_spec = StageSpec {
        id: "cache-trim",
        label: "Preview-cache trimming",
        category: "cache",
        cache: CacheState::Warm,
        units: 8,
        bytes: preview_bytes * 8,
        detail: Some(
            "Trims small disposable caches seeded before timing; app cache contents are untouched.",
        ),
    };
    stages.push(measure(progress, mode, trim_spec, samples, |sample| {
        let Some(cache) = fixtures.trim_caches.get(sample) else {
            return Err(());
        };
        cache.trim(0);
        if cache.usage().1 == 0 {
            Ok(())
        } else {
            Err(())
        }
    }));

    let coverage = build_coverage(&stages, mode);
    Ok(Report {
        schema_version: 1,
        id: progress.id.clone(),
        kind: ReportKind::Benchmark,
        mode: Some(mode),
        started_at_ms,
        finished_at_ms: timestamp_ms(),
        environment: {
            let mut environment = benchmark_environment();
            environment.ai_provider = Some("CPU (isolated benchmark)".into());
            environment
        },
        stages,
        coverage,
    })
}

fn build_coverage(stages: &[Stage], mode: Mode) -> Vec<Coverage> {
    let mut coverage: Vec<Coverage> = stages
        .iter()
        .map(|stage| Coverage {
            id: stage.id.clone(),
            label: stage.label.clone(),
            status: if stage.status == StageStatus::Skipped {
                CoverageStatus::Skipped
            } else {
                CoverageStatus::Measured
            },
            reason: stage.detail.clone(),
        })
        .collect();
    let mut add =
        |id: &'static str, label: &'static str, status: CoverageStatus, reason: &'static str| {
            coverage.push(Coverage {
                id: id.into(),
                label: label.into(),
                status,
                reason: Some(reason.into()),
            });
        };
    add("histogram-ui", "Histogram display and crop", CoverageStatus::Manual, "The Settings benchmark does not create or replace the active app session needed by the UI histogram command.");
    add(
        "application-startup",
        "Application startup",
        CoverageStatus::Manual,
        "The Settings benchmark runs after startup; process launch profiling must be performed separately.",
    );
    add(
        "filter-sort-navigation",
        "Filtering, sorting and keyboard navigation",
        CoverageStatus::Manual,
        "These behaviors run in the React view and require rendered interaction checks.",
    );
    add("session-ui-restore", "Session restore into the app", CoverageStatus::Manual, "Native save and history are measured in an isolated folder; reopening a session in the active React view requires a rendered interaction check.");
    add(
        "trash",
        "Move to trash",
        CoverageStatus::Manual,
        "The native trash service is intentionally not invoked by a benchmark.",
    );
    add(
        "video",
        "Native video playback",
        CoverageStatus::Manual,
        "Requires a real supported video and the native webview playback path.",
    );
    add("external-editor", "External editor launch", CoverageStatus::Manual, "Requires an installed editor and an explicit launch outside the isolated fixture workflow.");
    add(
        "updates",
        "Update check and installation",
        CoverageStatus::Manual,
        "Update checks contact a remote service and are outside the offline benchmark.",
    );
    add(
        "card-throughput",
        "Physical card and camera compatibility",
        CoverageStatus::Manual,
        "Synthetic local files cannot represent removable-device speed or a camera's RAW variant.",
    );
    add(
        "raw-sensor-decode",
        "RAW sensor development",
        CoverageStatus::Skipped,
        "Culltivate reads embedded JPEG previews and does not decode RAW sensor data.",
    );
    add("mobileclip", "MobileCLIP visual grouping", CoverageStatus::Skipped, "Optional MobileCLIP model is not bundled in the isolated fixture environment; the benchmark never downloads models.");
    add("accelerated-ai", "GPU-accelerated AI inference", CoverageStatus::Manual, "AI stages use an isolated CPU policy so benchmarking cannot change live GPU caches or provider fallback state.");
    add("frontend-render", "Grid, filmstrip, loupe and settings rendering", CoverageStatus::Manual, "Native fixture measurements do not include browser layout, React rendering or keyboard event handling.");
    add(
        "physical-ingest",
        "Card discovery and physical-card copying",
        CoverageStatus::Manual,
        "The benchmark covers local fixture scanning and safe copying, not removable media.",
    );
    add("settings-preferences", "Settings persistence and diagnostic delivery", CoverageStatus::Manual, "Reporting settings and outbound delivery are exercised by the Settings layer's separate mock-endpoint checks.");
    if mode == Mode::Thorough {
        add("native-runtime", "External editor, updater, trash and video runtime", CoverageStatus::Manual, "Long mode increases repeat counts for local work; external services and native device state remain manual checks.");
    }
    coverage
}

fn decode_bundled_png(bytes: &[u8]) -> Result<(Vec<u8>, u32, u32), ()> {
    let decoder = png::Decoder::new(Cursor::new(bytes));
    let mut reader = decoder.read_info().map_err(|_| ())?;
    let mut buffer = vec![0; reader.output_buffer_size().ok_or(())?];
    let info = reader.next_frame(&mut buffer).map_err(|_| ())?;
    let source = &buffer[..info.buffer_size()];
    let rgb = match info.color_type {
        png::ColorType::Rgb => source.to_vec(),
        png::ColorType::Rgba => source
            .chunks_exact(4)
            .flat_map(|px| [px[0], px[1], px[2]])
            .collect(),
        _ => return Err(()),
    };
    if info.width == 0
        || info.height == 0
        || rgb.len() != info.width as usize * info.height as usize * 3
    {
        return Err(());
    }
    Ok((rgb, info.width, info.height))
}

fn with_synthetic_exif(jpeg: &[u8], width: u32, height: u32, orientation: u16) -> Vec<u8> {
    let mut tiff = b"II\x2a\0\x08\0\0\0".to_vec();
    tiff.extend_from_slice(&2u16.to_le_bytes());
    push_tiff_entry(&mut tiff, 0x0112, 3, 1, orientation as u32);
    push_tiff_entry(&mut tiff, 0x8769, 4, 1, 38);
    tiff.extend_from_slice(&0u32.to_le_bytes());
    tiff.extend_from_slice(&5u16.to_le_bytes());
    push_tiff_entry(&mut tiff, 0x9003, 2, 20, 104);
    push_tiff_entry(&mut tiff, 0x9291, 2, 3, 124);
    push_tiff_entry(&mut tiff, 0x8827, 3, 1, 100);
    push_tiff_entry(&mut tiff, 0xA002, 4, 1, width);
    push_tiff_entry(&mut tiff, 0xA003, 4, 1, height);
    tiff.extend_from_slice(&0u32.to_le_bytes());
    tiff.extend_from_slice(b"2026:10:18 08:09:10\0");
    tiff.extend_from_slice(b"25\0");

    let mut payload = b"Exif\0\0".to_vec();
    payload.extend_from_slice(&tiff);
    let segment_length = (payload.len() + 2) as u16;
    let mut out = Vec::with_capacity(jpeg.len() + payload.len() + 4);
    out.extend_from_slice(&jpeg[..2]);
    out.extend_from_slice(&[0xff, 0xe1]);
    out.extend_from_slice(&segment_length.to_be_bytes());
    out.extend_from_slice(&payload);
    out.extend_from_slice(&jpeg[2..]);
    out
}

fn make_textured_jpeg(
    width: u32,
    height: u32,
    orientation: u16,
    progress: &Progress,
) -> Result<Vec<u8>, ()> {
    let mut pixels = Vec::with_capacity(width as usize * height as usize * 3);
    let mut noise = 0x7a31_52d9u32;
    for y in 0..height {
        if progress.stopping_reason().is_some() {
            return Err(());
        }
        for x in 0..width {
            noise = noise.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            let grain = ((noise >> 27) as i16 % 15) - 7;
            let r = ((x * 218 / width + y * 31 / height) as i16 + grain).clamp(0, 255) as u8;
            let g = ((y * 226 / height + x * 27 / width) as i16 + grain / 2).clamp(0, 255) as u8;
            let b = (((x + y) * 160 / (width + height)) as i16 + grain).clamp(0, 255) as u8;
            pixels.extend_from_slice(&[r, g, b]);
        }
    }
    let jpeg = preview::encode_jpeg(pixels, width, height, 86).map_err(|_| ())?;
    Ok(with_synthetic_exif(&jpeg, width, height, orientation))
}

fn push_tiff_entry(out: &mut Vec<u8>, tag: u16, kind: u16, count: u32, value: u32) {
    out.extend_from_slice(&tag.to_le_bytes());
    out.extend_from_slice(&kind.to_le_bytes());
    out.extend_from_slice(&count.to_le_bytes());
    if kind == 3 && count == 1 {
        out.extend_from_slice(&(value as u16).to_le_bytes());
        out.extend_from_slice(&[0, 0]);
    } else {
        out.extend_from_slice(&value.to_le_bytes());
    }
}

fn make_synthetic_raf(jpeg: &[u8]) -> Vec<u8> {
    let offset = 92u32;
    let mut out = vec![0; offset as usize];
    out[..15].copy_from_slice(b"FUJIFILMCCD-RAW");
    out[84..88].copy_from_slice(&offset.to_be_bytes());
    out[88..92].copy_from_slice(&(jpeg.len() as u32).to_be_bytes());
    out.extend_from_slice(jpeg);
    out
}

fn timestamp_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u64::MAX as u128) as u64
}

fn cpu_name() -> Option<String> {
    #[cfg(target_os = "linux")]
    {
        let text = fs::read_to_string("/proc/cpuinfo").ok()?;
        return text.lines().find_map(|line| {
            let (key, value) = line.split_once(':')?;
            matches!(key.trim(), "model name" | "Hardware" | "Processor")
                .then(|| safe_cpu_name(value.trim()))
                .flatten()
        });
    }
    #[cfg(not(target_os = "linux"))]
    {
        None
    }
}

fn safe_cpu_name(value: &str) -> Option<String> {
    if value.contains('/') || value.contains('\\') {
        return None;
    }
    let cleaned = value
        .chars()
        .filter(|ch| {
            ch.is_ascii_alphanumeric() || matches!(ch, ' ' | '-' | '_' | '(' | ')' | '.' | '@')
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let lower = cleaned.to_ascii_lowercase();
    if cleaned.is_empty()
        || cleaned.len() > 100
        || ![
            "cpu",
            "processor",
            "core",
            "xeon",
            "ryzen",
            "intel",
            "amd",
            "apple",
            "arm",
        ]
        .iter()
        .any(|marker| lower.contains(marker))
    {
        None
    } else {
        Some(cleaned)
    }
}

fn total_memory_mb() -> Option<u64> {
    #[cfg(target_os = "linux")]
    {
        let text = fs::read_to_string("/proc/meminfo").ok()?;
        let kb = text.lines().find_map(|line| {
            let (key, rest) = line.split_once(':')?;
            (key == "MemTotal")
                .then(|| rest.split_whitespace().next()?.parse::<u64>().ok())
                .flatten()
        })?;
        return Some(kb / 1024);
    }
    #[cfg(not(target_os = "linux"))]
    {
        None
    }
}

fn gpu_vendor() -> Option<String> {
    #[cfg(target_os = "linux")]
    {
        let entries = fs::read_dir("/sys/class/drm").ok()?;
        for entry in entries.flatten() {
            let Ok(vendor) = fs::read_to_string(entry.path().join("device/vendor")) else {
                continue;
            };
            let vendor = match vendor.trim().to_ascii_lowercase().as_str() {
                "0x10de" => "NVIDIA",
                "0x1002" => "AMD",
                "0x8086" => "Intel",
                _ => continue,
            };
            return Some(format!("{vendor} graphics device detected"));
        }
        None
    }
    #[cfg(target_os = "macos")]
    {
        Some("Apple graphics device detected".into())
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn report_contract_serializes_camel_case_and_lowercase_states() {
        let value = serde_json::to_value(Status::default()).unwrap();
        assert_eq!(value["runId"], serde_json::Value::Null);
        assert_eq!(value["state"], "idle");
        assert_eq!(value["total"], TOTAL_STAGES);
        assert!(value.get("run_id").is_none());
    }

    #[test]
    fn mode_only_accepts_supported_run_lengths() {
        assert_eq!(Mode::parse("quick").unwrap(), Mode::Quick);
        assert_eq!(Mode::parse("thorough").unwrap(), Mode::Thorough);
        assert!(Mode::parse("unbounded").is_err());
        assert!(Mode::Thorough.samples() >= 20);
    }

    #[test]
    fn synthetic_raf_fixture_probes_its_embedded_jpeg_and_exif() {
        let (pixels, width, height) = decode_bundled_png(ASTRONAUT_PNG).unwrap();
        let jpeg = preview::encode_jpeg(pixels, width, height, 86).unwrap();
        let jpeg = with_synthetic_exif(&jpeg, width, height, 1);
        let raw_bytes = make_synthetic_raf(&jpeg);
        let root = std::env::temp_dir().join(format!(
            "opencull-benchmark-fixture-test-{}",
            std::process::id()
        ));
        fs::create_dir_all(&root).unwrap();
        let path = root.join("sample.RAF");
        fs::write(&path, &raw_bytes).unwrap();

        let probe = raw::probe(&path).unwrap();

        assert_eq!(probe.embedded.len(), 1);
        assert_eq!(probe.exif.date.as_deref(), Some("2026:10:18 08:09:10"));
        assert_eq!(probe.exif.capture_ms, raw::capture_time(&path));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn quick_native_report_exercises_fixtures_and_passes_diagnostic_preview() {
        let id = format!(
            "bench-test-{}-{}",
            timestamp_ms(),
            NEXT_RUN.fetch_add(1, Ordering::Relaxed)
        );
        let cancel = Arc::new(AtomicBool::new(false));
        let mut progress = Progress::new(
            id,
            cancel,
            Instant::now() + Duration::from_secs(MAX_QUICK_SECONDS),
        );
        let report = crate::ai::onnx::with_isolated_cpu(|| {
            run_benchmark(&mut progress, Mode::Quick, timestamp_ms()).unwrap()
        });

        assert_eq!(report.stages.len(), TOTAL_STAGES);
        assert!(report
            .stages
            .iter()
            .any(|stage| stage.id == "preview-fit-cold"
                && stage.samples_ms.len() == Mode::Quick.samples()));
        assert!(
            report
                .stages
                .iter()
                .any(|stage| stage.id == "portrait-orientation"
                    && stage.status == StageStatus::Passed)
        );
        assert!(report
            .stages
            .iter()
            .any(|stage| stage.id == "session-history" && stage.status == StageStatus::Passed));
        assert!(report
            .stages
            .iter()
            .any(|stage| stage.id == "histogram" && stage.status == StageStatus::Passed));
        for id in ["ai-result-cache-save", "ai-result-cache-load"] {
            let stage = report.stages.iter().find(|stage| stage.id == id).unwrap();
            assert_eq!(stage.status, StageStatus::Passed, "{id}");
            assert_eq!(stage.samples_ms.len(), Mode::Quick.samples(), "{id}");
            assert_eq!(stage.units, Mode::Quick.samples() as u64, "{id}");
        }
        let under_load = report
            .stages
            .iter()
            .find(|stage| stage.id == "preview-foreground-under-load")
            .unwrap();
        assert_eq!(under_load.status, StageStatus::Passed);
        assert_eq!(under_load.samples_ms.len(), Mode::Quick.samples());
        assert!(under_load.detail.as_deref().unwrap().contains("scheduler"));
        let diagnostic = diagnostic_json(&report);
        let diagnostic: crate::diagnostic_delivery::DiagnosticReport =
            serde_json::from_value(diagnostic).unwrap();
        let preview = crate::diagnostic_delivery::diagnostics_preview(diagnostic, None).unwrap();
        assert!(preview.webhook_json.contains("6000x4000-texture"));
        assert!(!preview.webhook_json.contains("representative.RAF"));
    }

    fn diagnostic_json(report: &Report) -> serde_json::Value {
        let stages = report
            .stages
            .iter()
            .map(|stage| {
                let mut samples = stage.samples_ms.clone();
                samples.sort_by(f64::total_cmp);
                let count = samples.len();
                let total_ms: f64 = samples.iter().sum();
                let median_ms = if count == 0 {
                    0.0
                } else {
                    (samples[(count - 1) / 2] + samples[count / 2]) / 2.0
                };
                let p95_ms = (count >= 20).then(|| samples[(count * 95).div_ceil(100) - 1]);
                let throughput = (total_ms > 0.0 && stage.units > 0)
                    .then(|| stage.units as f64 * 1000.0 / total_ms);
                serde_json::json!({
                    "id": stage.id, "label": stage.label, "category": stage.category,
                    "cache": stage.cache, "status": stage.status,
                    "count": count, "totalMs": total_ms, "medianMs": median_ms,
                    "maxMs": samples.last().copied().unwrap_or(0.0), "p95Ms": p95_ms,
                    "units": stage.units, "bytes": stage.bytes, "failures": stage.failures,
                    "throughputPerSecond": throughput,
                })
            })
            .collect::<Vec<_>>();
        serde_json::json!({
            "schemaVersion": 2, "id": report.id, "systemId": "Fern-482731",
            "kind": report.kind, "mode": report.mode,
            "startedAtMs": report.started_at_ms, "finishedAtMs": timestamp_ms(),
            "environment": report.environment, "stages": stages,
            "coverage": report.coverage, "recommendations": [],
        })
    }

    #[test]
    fn cancellation_only_targets_the_current_run() {
        assert!(benchmark_cancel("unknown-run".into()).is_err());
    }

    #[test]
    fn active_run_rejects_concurrency_and_cleans_its_fixtures_on_cancel() {
        let id = benchmark_start("quick".into()).unwrap();
        assert_eq!(benchmark_status().state, RunState::Running);
        assert!(benchmark_start("quick".into()).is_err());
        benchmark_cancel(id.clone()).unwrap();

        let deadline = Instant::now() + Duration::from_secs(5);
        let mut status = benchmark_status();
        while status.state == RunState::Running && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(10));
            status = benchmark_status();
        }
        assert_eq!(status.state, RunState::Cancelled);
        assert_eq!(status.run_id.as_deref(), Some(id.as_str()));
        assert!(benchmark_cancel(id.clone()).is_err());
        let fixture_root =
            std::env::temp_dir().join(format!("opencull-benchmark-{}-{id}", std::process::id()));
        assert!(!fixture_root.exists());
    }
}
