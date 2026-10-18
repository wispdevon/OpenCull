//! The CUDA provider, isolated from macOS and ordinary CPU builds.
pub fn provider() -> ort::ep::ExecutionProviderDispatch {
    ort::ep::CUDA::default()
        // CUDA_VISIBLE_DEVICES remaps the visible device list; logical device
        // zero is what the driver query below names as well.
        .with_device_id(0)
        .with_arena_extend_strategy(ort::ep::ArenaExtendStrategy::SameAsRequested)
        .with_tf32(false)
        .build()
        .error_on_failure()
}

/// Probe the installed driver and runtime without allocating model sessions.
pub fn detect() -> Result<(), String> {
    // SAFETY: only the platform CUDA libraries are loaded. The two symbols use
    // the documented CUDA Driver API C ABI; handles live through every call.
    unsafe {
        let names = ["libcuda.so.1", "libcudart.so.13", "libcublas.so.13", "libcublasLt.so.13", "libcurand.so.10", "libcudnn.so.9"];
        let libraries = names.iter().map(|name| libloading::Library::new(name).map_err(|e| format!("{name}: {e}"))).collect::<Result<Vec<_>,_>>()?;
        let initialize: libloading::Symbol<unsafe extern "C" fn(u32) -> i32> = libraries[0].get(b"cuInit\0").map_err(|e| e.to_string())?;
        let count_devices: libloading::Symbol<unsafe extern "C" fn(*mut i32) -> i32> = libraries[0].get(b"cuDeviceGetCount\0").map_err(|e| e.to_string())?;
        let status = initialize(0);
        if status != 0 { return Err(format!("CUDA driver initialization failed ({status})")); }
        let mut count = 0;
        let status = count_devices(&mut count);
        if status != 0 || count == 0 { return Err(format!("No usable CUDA device ({status})")); }
        Ok(())
    }
}

/// Returns the name for CUDA's logical device zero, which is the ordinal used
/// by `provider()`. The driver applies CUDA_VISIBLE_DEVICES remapping here.
pub fn device_name() -> Result<String, String> {
    // SAFETY: CUDA Driver API signatures and handles are documented by NVIDIA;
    // the library remains loaded for the lifetime of its function pointers.
    unsafe {
        let driver =
            libloading::Library::new("libcuda.so.1").map_err(|_| "CUDA driver unavailable")?;
        let initialize: libloading::Symbol<unsafe extern "C" fn(u32) -> i32> =
            driver
                .get(b"cuInit\0")
                .map_err(|_| "CUDA driver API unavailable")?;
        let get_device: libloading::Symbol<unsafe extern "C" fn(*mut i32, i32) -> i32> =
            driver
                .get(b"cuDeviceGet\0")
                .map_err(|_| "CUDA device lookup unavailable")?;
        let get_name: libloading::Symbol<unsafe extern "C" fn(*mut i8, i32, i32) -> i32> =
            driver
                .get(b"cuDeviceGetName\0")
                .map_err(|_| "CUDA device name unavailable")?;
        if initialize(0) != 0 {
            return Err("CUDA driver initialization failed".into());
        }
        let mut device = 0;
        if get_device(&mut device, 0) != 0 {
            return Err("CUDA device lookup failed".into());
        }
        let mut bytes = [0i8; 256];
        if get_name(bytes.as_mut_ptr(), bytes.len() as i32, device) != 0 {
            return Err("CUDA device name lookup failed".into());
        }
        let bytes = bytes.iter().map(|byte| *byte as u8).collect::<Vec<_>>();
        clean_device_name(&bytes).ok_or_else(|| "CUDA returned an invalid device name".into())
    }
}

fn clean_device_name(bytes: &[u8]) -> Option<String> {
    let nul = bytes.iter().position(|byte| *byte == 0).unwrap_or(bytes.len());
    let value = std::str::from_utf8(&bytes[..nul]).ok()?.trim();
    if value.is_empty() || value.len() > 100 || value.chars().any(char::is_control) {
        return None;
    }
    Some(value.to_owned())
}

#[cfg(test)]
mod device_name_tests {
    use super::*;

    #[test]
    fn device_names_are_trimmed_and_reject_empty_or_controlled_text() {
        assert_eq!(
            clean_device_name(b" NVIDIA GeForce RTX 3060 Ti \0"),
            Some("NVIDIA GeForce RTX 3060 Ti".into())
        );
        assert_eq!(clean_device_name(b"\0"), None);
        assert_eq!(clean_device_name(b"NVIDIA\nGPU\0"), None);
    }
}
