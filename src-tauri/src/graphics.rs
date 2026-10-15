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
            for name in ["WEBKIT_DISABLE_COMPOSITING_MODE", "LIBGL_ALWAYS_SOFTWARE"] { std::env::remove_var(name); }
            // Current proprietary drivers can reject WebKit GBM buffers. Keep
            // hardware compositing, but use the compatible presentation path.
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
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
pub struct GraphicsInfo { requested: Profile, platform: &'static str, dmabuf_disabled: bool, software_forced: bool }
#[tauri::command]
pub fn graphics_info(profile: tauri::State<Profile>) -> GraphicsInfo {
    GraphicsInfo { requested: *profile, platform: std::env::consts::OS,
        dmabuf_disabled: std::env::var("WEBKIT_DISABLE_DMABUF_RENDERER").as_deref() == Ok("1"),
        software_forced: std::env::var("LIBGL_ALWAYS_SOFTWARE").as_deref() == Ok("1") }
}
#[cfg(test)] mod tests {
    use super::*;
    #[test] fn profiles_are_opt_in_and_cli_overrides_environment() {
        assert_eq!(choose(std::iter::empty(), None),Profile::Auto);
        assert_eq!(choose(std::iter::empty(),Some("nvidia".into())),Profile::Nvidia);
        assert_eq!(choose(["--graphics=software".into()].into_iter(),Some("nvidia".into())),Profile::Software);
        assert_eq!(choose(["/Photos/nvidia".into()].into_iter(),None),Profile::Auto);
        assert_eq!(choose(std::iter::empty(),Some("bad".into())),Profile::Auto);
    }
}
