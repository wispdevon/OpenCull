//! Renderer profiles are applied before GTK/WebKit is initialized.
use serde::Serialize;
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Profile { Auto, Nvidia, Compatibility, Software }
impl Profile {
    fn parse(value: &str) -> Option<Self> {
        match value { "auto" => Some(Self::Auto), "nvidia" => Some(Self::Nvidia), "compatibility" => Some(Self::Compatibility), "software" => Some(Self::Software), _ => None }
    }
}
fn choose(args: impl Iterator<Item=String>, environment: Option<String>) -> Profile {
    let requested = args.filter_map(|s| s.strip_prefix("--graphics=").map(str::to_owned)).last().or(environment);
    requested.as_deref().and_then(Profile::parse).unwrap_or(Profile::Auto)
}
pub fn initialize() -> Profile {
    let profile = choose(std::env::args().skip(1), std::env::var("OPENCULL_GRAPHICS").ok());
    #[cfg(target_os="linux")]
    match profile {
        Profile::Nvidia => {
            // Keep accelerated compositing; only replace the failing GBM
            // buffer transport. Disabling the whole renderer would disable GPU composition.
            for name in ["WEBKIT_DISABLE_DMABUF_RENDERER", "WEBKIT_DISABLE_COMPOSITING_MODE", "LIBGL_ALWAYS_SOFTWARE"] { std::env::remove_var(name); }
            std::env::set_var("WEBKIT_DMABUF_RENDERER_FORCE_SHM", "1");
            std::env::set_var("WEBKIT_DMABUF_RENDERER_DISABLE_GBM", "1");
            // WebKitGTK 2.54's Skia compositor flashed previous frames in
            // menus and zoom on the tested NVIDIA stack. Keep GPU composition
            // with the fallback compositor; preserve an explicit opt-in to Skia.
            if std::env::var_os("WEBKIT_USE_SKIA_FOR_COMPOSITION").is_none() {
                std::env::set_var("WEBKIT_USE_SKIA_FOR_COMPOSITION", "0");
            }
            if std::env::var_os("GDK_BACKEND").is_none() && std::env::var_os("DISPLAY").is_some() { std::env::set_var("GDK_BACKEND", "x11"); }
            std::env::set_var("__GLX_VENDOR_LIBRARY_NAME", "nvidia");
        },
        Profile::Compatibility => { std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1"); },
        Profile::Software => { std::env::set_var("LIBGL_ALWAYS_SOFTWARE", "1"); std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1"); },
        Profile::Auto => {},
    }
    eprintln!("[graphics] requested profile: {profile:?}");
    profile
}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct GraphicsInfo { requested: Profile, platform: &'static str, dmabuf_disabled: bool, software_forced: bool, shared_memory_transport: bool, fallback_compositor: bool }
#[tauri::command]
pub fn graphics_info(profile: tauri::State<Profile>) -> GraphicsInfo {
    GraphicsInfo { requested: *profile, platform: std::env::consts::OS,
        dmabuf_disabled: std::env::var("WEBKIT_DISABLE_DMABUF_RENDERER").as_deref() == Ok("1"),
        software_forced: std::env::var("LIBGL_ALWAYS_SOFTWARE").as_deref() == Ok("1"),
        shared_memory_transport: std::env::var("WEBKIT_DMABUF_RENDERER_FORCE_SHM").as_deref() == Ok("1"),
        fallback_compositor: cfg!(target_os = "linux") && std::env::var("WEBKIT_USE_SKIA_FOR_COMPOSITION").as_deref() == Ok("0") }
}
#[cfg(test)] mod tests {
    use super::*;
    #[cfg(target_os = "linux")]
    #[test]
    fn nvidia_compositor_default_and_explicit_override() {
        for explicit in [None, Some("1")] {
            let mut child = std::process::Command::new(std::env::current_exe().unwrap());
            child.args(["--exact", "graphics::tests::compositor_environment_child", "--nocapture"])
                .env("OPENCULL_GRAPHICS", "nvidia")
                .env("OPENCULL_COMPOSITOR_TEST_CHILD", explicit.unwrap_or("0"))
                .env_remove("WEBKIT_USE_SKIA_FOR_COMPOSITION");
            if let Some(value) = explicit { child.env("WEBKIT_USE_SKIA_FOR_COMPOSITION", value); }
            assert!(child.status().unwrap().success());
        }
    }
    #[cfg(target_os = "linux")]
    #[test]
    fn compositor_environment_child() {
        let Ok(expected) = std::env::var("OPENCULL_COMPOSITOR_TEST_CHILD") else { return; };
        assert_eq!(initialize(), Profile::Nvidia);
        assert_eq!(std::env::var("WEBKIT_USE_SKIA_FOR_COMPOSITION").ok().as_deref(), Some(expected.as_str()));
    }
    #[test] fn profiles_are_opt_in_and_cli_overrides_environment() {
        assert_eq!(choose(std::iter::empty(), None),Profile::Auto);
        assert_eq!(choose(std::iter::empty(),Some("nvidia".into())),Profile::Nvidia);
        assert_eq!(choose(["--graphics=software".into()].into_iter(),Some("nvidia".into())),Profile::Software);
        assert_eq!(choose(["/Photos/nvidia".into()].into_iter(),None),Profile::Auto);
        assert_eq!(choose(std::iter::empty(),Some("bad".into())),Profile::Auto);
    }
}
