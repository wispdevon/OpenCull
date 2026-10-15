//! Opt-in inference selection. Rendering is configured independently.
use std::sync::{Mutex, atomic::{AtomicBool, Ordering}};

static FAILED: AtomicBool = AtomicBool::new(false);
static FAILURE: Mutex<Option<String>> = Mutex::new(None);

fn requested_on(platform: &str, arch: &str, compiled: bool, requested: Option<&str>) -> bool {
    platform == "linux" && arch == "x86_64" && compiled && requested == Some("cuda")
}

pub fn requested() -> bool {
    requested_on(std::env::consts::OS, std::env::consts::ARCH,
        cfg!(all(feature = "cuda", target_os = "linux", target_arch = "x86_64")),
        std::env::var("OPENCULL_AI").ok().as_deref())
}
pub fn enabled() -> bool { requested() && !FAILED.load(Ordering::Acquire) }

pub fn fallback(reason: String) {
    if !FAILED.swap(true, Ordering::AcqRel) {
        eprintln!("[ai] CUDA unavailable; continuing on CPU: {reason}");
        *FAILURE.lock().unwrap_or_else(|e| e.into_inner()) = Some(reason);
    }
}
pub fn failure() -> Option<String> { FAILURE.lock().unwrap_or_else(|e| e.into_inner()).clone() }

#[cfg(test)] mod tests {
    use super::*;
    #[test] fn cuda_requires_opt_in_supported_target_and_build() {
        assert!(requested_on("linux", "x86_64", true, Some("cuda")));
        for (os, arch, compiled, request) in [
            ("macos", "aarch64", true, Some("cuda")),
            ("macos", "x86_64", true, Some("cuda")),
            ("windows", "x86_64", true, Some("cuda")),
            ("linux", "aarch64", true, Some("cuda")),
            ("linux", "x86_64", false, Some("cuda")),
            ("linux", "x86_64", true, None),
            ("linux", "x86_64", true, Some("cpu")),
        ] { assert!(!requested_on(os, arch, compiled, request)); }
    }
}
