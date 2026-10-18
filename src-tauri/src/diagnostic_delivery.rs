//! Explicitly approved delivery of aggregate benchmark diagnostics.
//!
//! Approval and destinations live only for this process. The report type is a
//! deliberately small allowlist: it has no photo, path, EXIF, sample-array, or
//! raw-error fields.

use std::{net::IpAddr, sync::Mutex, time::Duration};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use reqwest::{header, redirect::Policy, Client, Url};
use serde::{de::Deserializer, Deserialize, Serialize};
use tauri::State;

const CURRENT_FIELDS_VERSION: u32 = 2;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_URL_BYTES: usize = 2_048;
const MAX_REPORT_BYTES: usize = 128 * 1024;
const MAX_DIAGNOSTIC_SUMMARY_BYTES: usize = 1_000;
const MAX_SUMMARY_RECOMMENDATION_CHARS: usize = 160;
const MAX_TOKEN_BYTES: usize = 2_048;
const MAX_STAGES: usize = 100;
const MAX_COVERAGE: usize = 100;
const MAX_RECOMMENDATIONS: usize = 50;
const MAX_REPORT_AGE_MS: u64 = 366 * 24 * 60 * 60 * 1_000;
const PERFORMANCE_NTFY_URL: &str = "https://ntfy.sh/culltivate-perf";
const LOGS_NTFY_URL: &str = "https://ntfy.sh/culltivate-logs";
const MEDIA_EXTENSIONS: [&str; 25] = [
    ".jpg", ".jpeg", ".jpe", ".png", ".gif", ".tif", ".tiff", ".webp", ".heic", ".raw", ".arw",
    ".cr2", ".cr3", ".nef", ".raf", ".rw2", ".dng", ".orf", ".pef", ".srw", ".xmp", ".mp4", ".mov",
    ".mkv", ".avi",
];

/// The approved diagnostic report contract. Every nested struct rejects
/// unknown fields so additional frontend data cannot silently enter uploads.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DiagnosticReport {
    pub schema_version: u32,
    pub id: String,
    pub system_id: String,
    pub kind: ReportKind,
    #[serde(deserialize_with = "required_option")]
    pub mode: Option<BenchmarkMode>,
    pub started_at_ms: u64,
    pub finished_at_ms: u64,
    pub environment: Environment,
    pub stages: Vec<StageSummary>,
    pub coverage: Vec<Coverage>,
    pub recommendations: Vec<Recommendation>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ReportKind {
    Benchmark,
    Recording,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum BenchmarkMode {
    Quick,
    Thorough,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Environment {
    pub app_version: String,
    pub build: String,
    pub os: String,
    pub arch: String,
    #[serde(deserialize_with = "required_option")]
    pub cpu: Option<String>,
    pub logical_cores: u32,
    #[serde(deserialize_with = "required_option")]
    pub memory_mb: Option<u64>,
    #[serde(deserialize_with = "required_option")]
    pub gpu: Option<String>,
    #[serde(deserialize_with = "required_option")]
    pub ai_provider: Option<String>,
    pub fixture_version: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StageSummary {
    pub id: String,
    pub label: String,
    pub category: String,
    pub cache: CacheState,
    pub status: StageStatus,
    pub count: u32,
    pub total_ms: f64,
    pub median_ms: f64,
    pub max_ms: f64,
    #[serde(deserialize_with = "required_option")]
    pub p95_ms: Option<f64>,
    pub units: u64,
    pub bytes: u64,
    pub failures: u32,
    #[serde(deserialize_with = "required_option")]
    pub throughput_per_second: Option<f64>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum CacheState {
    Cold,
    Warm,
    None,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum StageStatus {
    Passed,
    Failed,
    Skipped,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Coverage {
    pub id: String,
    pub label: String,
    pub status: CoverageStatus,
    #[serde(deserialize_with = "required_option")]
    pub reason: Option<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum CoverageStatus {
    Measured,
    Skipped,
    Manual,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Recommendation {
    pub stage_id: String,
    pub priority: Priority,
    pub evidence: String,
    pub action: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Priority {
    High,
    Medium,
    Low,
}

fn required_option<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer)
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DeliveryStatus {
    Sent,
    Failed,
    Disabled,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DestinationResult {
    pub status: DeliveryStatus,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeliveryResult {
    pub webhook: DestinationResult,
    pub ntfy: DestinationResult,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticPreview {
    pub webhook_json: String,
    pub ntfy_message: String,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticConfiguration {
    pub webhook_configured: bool,
    pub ntfy_url: &'static str,
    pub logs_url: &'static str,
}

#[derive(Clone)]
struct ApprovedDestination {
    url: Url,
    is_discord_webhook: bool,
}

#[derive(Clone)]
struct Approval {
    id: String,
    fields_version: u32,
    webhook: Option<ApprovedDestination>,
    ntfy: Option<ApprovedDestination>,
    logs: Option<ApprovedDestination>,
}

/// Managed as Tauri application state. Neither tokens nor reports are stored.
#[derive(Default)]
pub struct DiagnosticDelivery {
    approval: Mutex<Option<Approval>>,
}

#[tauri::command]
pub fn diagnostics_approve(
    state: State<'_, DiagnosticDelivery>,
    settings: State<'_, crate::settings::Settings>,
    fields_version: u32,
) -> Result<String, String> {
    approve_configured(&state, &settings, fields_version)
}

#[tauri::command]
pub fn diagnostics_configuration(
    settings: State<'_, crate::settings::Settings>,
) -> Result<DiagnosticConfiguration, String> {
    diagnostics_configuration_for(&settings)
}

#[tauri::command]
pub fn diagnostics_disable(state: State<'_, DiagnosticDelivery>) -> Result<(), String> {
    disable(&state)
}

fn disable(state: &DiagnosticDelivery) -> Result<(), String> {
    let mut active = state
        .approval
        .lock()
        .map_err(|_| "approval_unavailable".to_owned())?;
    *active = None;
    Ok(())
}

/// Return the exact native payloads for the consent preview shown in Settings.
/// This performs no network request and stores neither the report nor secrets.
#[tauri::command]
pub fn diagnostics_preview(
    settings: State<'_, crate::settings::Settings>,
    report: DiagnosticReport,
) -> Result<DiagnosticPreview, String> {
    let webhook_url = configured_webhook_url(&settings)?;
    preview_report(report, webhook_url.as_deref())
}

pub(crate) fn preview_report(
    report: DiagnosticReport,
    webhook_url: Option<&str>,
) -> Result<DiagnosticPreview, String> {
    validate_report(&report)?;
    let webhook = webhook_payload(&report, webhook_url)?;
    if webhook.len() > MAX_REPORT_BYTES {
        return Err("report_too_large".to_owned());
    }
    let webhook_json = String::from_utf8(webhook).map_err(|_| "invalid_report".to_owned())?;
    Ok(DiagnosticPreview {
        webhook_json,
        ntfy_message: build_diagnostic_summary(&report),
    })
}

#[tauri::command]
pub async fn diagnostics_send(
    state: State<'_, DiagnosticDelivery>,
    approval: String,
    report: DiagnosticReport,
) -> Result<DeliveryResult, String> {
    send_diagnostics(&state, &approval, report, None, None).await
}

async fn send_diagnostics(
    state: &DiagnosticDelivery,
    approval: &str,
    report: DiagnosticReport,
    webhook_token: Option<&str>,
    ntfy_token: Option<&str>,
) -> Result<DeliveryResult, String> {
    let active = state
        .approval
        .lock()
        .map_err(|_| "approval_unavailable".to_owned())?
        .clone()
        .ok_or_else(|| "not_approved".to_owned())?;

    if active.id != approval {
        return Err("not_approved".to_owned());
    }
    if active.fields_version != CURRENT_FIELDS_VERSION
        || report.schema_version != active.fields_version
    {
        return Err("report_schema_changed".to_owned());
    }

    validate_report(&report)?;
    let webhook_body = webhook_payload_for_destination(&report, active.webhook.as_ref())?;
    if webhook_body.len() > MAX_REPORT_BYTES {
        return Err("report_too_large".to_owned());
    }

    // reqwest is built without a default TLS provider in this project. Install
    // the same ring provider used by the existing local model downloader.
    let _ = rustls::crypto::ring::default_provider().install_default();
    let client = Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .redirect(Policy::none())
        .build()
        .map_err(|_| "client_unavailable".to_owned())?;

    if !approval_is_current(state, &active) {
        return Err("not_approved".to_owned());
    }
    let webhook = match &active.webhook {
        Some(destination) => match bearer_header(webhook_token) {
            Ok(token) => {
                send_request(
                    &client,
                    destination,
                    "application/json",
                    webhook_body,
                    token,
                )
                .await
            }
            Err(()) => failed("invalid_token"),
        },
        None => disabled(),
    };

    // A disable or destination change can arrive while the first endpoint is
    // responding. Recheck before starting another destination request.
    let ntfy = if approval_is_current(state, &active) {
        let destination = match report.kind {
            ReportKind::Benchmark => active.ntfy.as_ref(),
            ReportKind::Recording => active.logs.as_ref(),
        };
        send_ntfy(&client, destination, ntfy_token, &report).await
    } else {
        disabled()
    };

    Ok(DeliveryResult { webhook, ntfy })
}

fn approval_is_current(state: &DiagnosticDelivery, expected: &Approval) -> bool {
    let Ok(active) = state.approval.lock() else {
        return false;
    };
    active.as_ref().is_some_and(|active| {
        active.id == expected.id && active.fields_version == expected.fields_version
    })
}

fn approve(
    state: &DiagnosticDelivery,
    webhook_url: &str,
    ntfy_url: &str,
    logs_url: &str,
    fields_version: u32,
) -> Result<String, String> {
    if fields_version != CURRENT_FIELDS_VERSION {
        return Err("unsupported_fields_version".to_owned());
    }
    let webhook = parse_destination(webhook_url, false)?;
    let ntfy = parse_destination(ntfy_url, true)?;
    let logs = parse_destination(logs_url, true)?;
    if webhook.is_none() && ntfy.is_none() && logs.is_none() {
        return Err("destination_required".to_owned());
    }

    let id = new_approval_id()?;
    let approval = Approval {
        id: id.clone(),
        fields_version,
        webhook,
        ntfy,
        logs,
    };
    let mut active = state
        .approval
        .lock()
        .map_err(|_| "approval_unavailable".to_owned())?;
    *active = Some(approval);
    Ok(id)
}

fn approve_configured(
    state: &DiagnosticDelivery,
    settings: &crate::settings::Settings,
    fields_version: u32,
) -> Result<String, String> {
    let webhook_url = configured_webhook_url(settings)?;
    approve(
        state,
        webhook_url.as_deref().unwrap_or_default(),
        PERFORMANCE_NTFY_URL,
        LOGS_NTFY_URL,
        fields_version,
    )
}

fn diagnostics_configuration_for(
    settings: &crate::settings::Settings,
) -> Result<DiagnosticConfiguration, String> {
    Ok(DiagnosticConfiguration {
        webhook_configured: configured_webhook_url(settings)?.is_some(),
        ntfy_url: PERFORMANCE_NTFY_URL,
        logs_url: LOGS_NTFY_URL,
    })
}

fn configured_webhook_url(settings: &crate::settings::Settings) -> Result<Option<String>, String> {
    let Some(encoded) = crate::settings::performance_webhook_encoded(settings)? else {
        return Ok(None);
    };
    if encoded.len() > (MAX_URL_BYTES * 4).div_ceil(3) + 4 {
        return Ok(None);
    }
    let Ok(decoded) = STANDARD.decode(encoded.as_bytes()) else {
        return Ok(None);
    };
    let Ok(url) = String::from_utf8(decoded) else {
        return Ok(None);
    };
    if parse_destination(&url, false).is_ok_and(|destination| destination.is_some()) {
        Ok(Some(url))
    } else {
        Ok(None)
    }
}

fn new_approval_id() -> Result<String, String> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).map_err(|_| "randomness_unavailable".to_owned())?;
    let mut id = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        use std::fmt::Write as _;
        write!(&mut id, "{byte:02x}").map_err(|_| "randomness_unavailable".to_owned())?;
    }
    Ok(id)
}

fn parse_destination(raw: &str, is_ntfy: bool) -> Result<Option<ApprovedDestination>, String> {
    if raw.is_empty() {
        return Ok(None);
    }
    if raw.len() > MAX_URL_BYTES
        || raw.trim() != raw
        || raw.chars().any(char::is_control)
        || raw.chars().any(char::is_whitespace)
    {
        return Err("invalid_url".to_owned());
    }

    let url = Url::parse(raw).map_err(|_| "invalid_url".to_owned())?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("unsupported_url_scheme".to_owned());
    }
    if authority_has_userinfo(raw) || !url.username().is_empty() || url.password().is_some() {
        return Err("userinfo_forbidden".to_owned());
    }
    if url.fragment().is_some() {
        return Err("url_fragment_forbidden".to_owned());
    }
    if url.scheme() == "http" && !is_loopback_host(&url) {
        return Err("https_required".to_owned());
    }
    if is_ntfy
        && !url
            .path_segments()
            .is_some_and(|mut segments| segments.any(|part| !part.is_empty()))
    {
        return Err("ntfy_topic_required".to_owned());
    }

    let is_discord_host = is_discord_host(url.host_str().unwrap_or_default());
    let is_discord_webhook = !is_ntfy && is_discord_webhook_url(&url);
    if !is_ntfy && is_discord_host && !is_discord_webhook {
        return Err("invalid_discord_webhook".to_owned());
    }

    Ok(Some(ApprovedDestination {
        url,
        is_discord_webhook,
    }))
}

fn is_discord_host(host: &str) -> bool {
    matches!(
        host.to_ascii_lowercase().as_str(),
        "discord.com"
            | "canary.discord.com"
            | "ptb.discord.com"
            | "discordapp.com"
            | "canary.discordapp.com"
            | "ptb.discordapp.com"
    )
}

fn is_discord_webhook_url(url: &Url) -> bool {
    if !is_discord_host(url.host_str().unwrap_or_default()) {
        return false;
    }
    let segments: Vec<&str> = url
        .path_segments()
        .into_iter()
        .flatten()
        .filter(|segment| !segment.is_empty())
        .collect();
    segments.len() == 4
        && segments[0] == "api"
        && segments[1] == "webhooks"
        && !segments[2].is_empty()
        && !segments[3].is_empty()
        && segments[2].bytes().all(|byte| byte.is_ascii_digit())
        && segments[3]
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
}

fn webhook_payload(
    report: &DiagnosticReport,
    webhook_url: Option<&str>,
) -> Result<Vec<u8>, String> {
    if webhook_url.is_some_and(|url| {
        Url::parse(url)
            .ok()
            .is_some_and(|url| is_discord_webhook_url(&url))
    }) {
        serde_json::to_vec(&discord_webhook_payload(report))
            .map_err(|_| "invalid_report".to_owned())
    } else {
        serde_json::to_vec(report).map_err(|_| "invalid_report".to_owned())
    }
}

fn webhook_payload_for_destination(
    report: &DiagnosticReport,
    destination: Option<&ApprovedDestination>,
) -> Result<Vec<u8>, String> {
    if destination.is_some_and(|destination| destination.is_discord_webhook) {
        serde_json::to_vec(&discord_webhook_payload(report))
            .map_err(|_| "invalid_report".to_owned())
    } else {
        serde_json::to_vec(report).map_err(|_| "invalid_report".to_owned())
    }
}

fn discord_webhook_payload(report: &DiagnosticReport) -> serde_json::Value {
    serde_json::json!({
        "content": build_diagnostic_summary(report),
        "allowed_mentions": { "parse": [] },
    })
}

fn build_diagnostic_summary(report: &DiagnosticReport) -> String {
    let duration = report.finished_at_ms.saturating_sub(report.started_at_ms);
    let heading = match report.kind {
        ReportKind::Benchmark => {
            let mode = match report.mode {
                Some(BenchmarkMode::Quick) => "quick",
                Some(BenchmarkMode::Thorough) => "thorough",
                None => "unknown",
            };
            format!("Culltivate benchmark ({mode})")
        }
        ReportKind::Recording => "Culltivate recording".to_owned(),
    };
    let failures: u64 = report
        .stages
        .iter()
        .map(|stage| stage.failures as u64)
        .sum();
    let mut lines = vec![
        heading,
        format!("- System: {}", report.system_id),
        format!(
            "- Duration: {} · {failures} failures",
            format_duration(duration)
        ),
    ];

    let mut slowest: Vec<&StageSummary> = report
        .stages
        .iter()
        .filter(|stage| stage.status != StageStatus::Skipped && stage.count > 0)
        .collect();
    slowest.sort_by(|left, right| right.total_ms.total_cmp(&left.total_ms));
    for stage in slowest.into_iter().take(3) {
        lines.push(format!(
            "- {}: {} total · {}/run",
            stage.label,
            format_duration(stage.total_ms as u64),
            format_duration(stage.median_ms as u64)
        ));
    }
    if let Some(recommendation) = report.recommendations.first() {
        lines.push(format!(
            "- Suggestion: {}",
            truncate_chars(&recommendation.action, MAX_SUMMARY_RECOMMENDATION_CHARS)
        ));
    }
    truncate_utf8(&lines.join("\n"), MAX_DIAGNOSTIC_SUMMARY_BYTES)
}

fn truncate_chars(value: &str, max_chars: usize) -> String {
    if value.chars().count() <= max_chars {
        return value.to_owned();
    }
    let mut truncated: String = value.chars().take(max_chars.saturating_sub(1)).collect();
    truncated.push('…');
    truncated
}

fn authority_has_userinfo(raw: &str) -> bool {
    let Some((_, after_scheme)) = raw.split_once("://") else {
        return false;
    };
    let authority = after_scheme
        .split(['/', '?', '#'])
        .next()
        .unwrap_or_default();
    authority.contains('@')
}

fn is_loopback_host(url: &Url) -> bool {
    let Some(host) = url.host_str() else {
        return false;
    };
    if host.eq_ignore_ascii_case("localhost") {
        return true;
    }
    host.parse::<IpAddr>()
        .is_ok_and(|address| address.is_loopback())
}

fn bearer_header(token: Option<&str>) -> Result<Option<header::HeaderValue>, ()> {
    let Some(token) = token else {
        return Ok(None);
    };
    if token.is_empty()
        || token.len() > MAX_TOKEN_BYTES
        || !token
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-._~+/=".contains(&byte))
    {
        return Err(());
    }
    let value = format!("Bearer {token}");
    header::HeaderValue::from_str(&value)
        .map(Some)
        .map_err(|_| ())
}

async fn send_ntfy(
    client: &Client,
    destination: Option<&ApprovedDestination>,
    token: Option<&str>,
    report: &DiagnosticReport,
) -> DestinationResult {
    let Some(destination) = destination else {
        return disabled();
    };
    let token = match bearer_header(token) {
        Ok(token) => token,
        Err(()) => return failed("invalid_token"),
    };
    let body = build_diagnostic_summary(report);
    send_request(
        client,
        destination,
        "text/plain; charset=utf-8",
        body.into_bytes(),
        token,
    )
    .await
}

async fn send_request(
    client: &Client,
    destination: &ApprovedDestination,
    content_type: &'static str,
    body: Vec<u8>,
    token: Option<header::HeaderValue>,
) -> DestinationResult {
    let mut request = client
        .post(request_url(destination))
        .header(header::CONTENT_TYPE, content_type)
        .body(body);
    if let Some(token) = token {
        request = request.header(header::AUTHORIZATION, token);
    }

    match request.send().await {
        Ok(response) if response.status().is_success() => sent(),
        Ok(response) => failed(if response.status().is_redirection() {
            "http_3xx"
        } else if response.status().is_client_error() {
            "http_4xx"
        } else if response.status().is_server_error() {
            "http_5xx"
        } else {
            "http_error"
        }),
        Err(error) if error.is_timeout() => failed("timeout"),
        Err(_) => failed("network"),
    }
}

fn request_url(destination: &ApprovedDestination) -> Url {
    let mut url = destination.url.clone();
    if destination.is_discord_webhook {
        let mut query: Vec<(String, String)> = url
            .query_pairs()
            .filter(|(key, _)| key != "wait")
            .map(|(key, value)| (key.into_owned(), value.into_owned()))
            .collect();
        query.push(("wait".to_owned(), "true".to_owned()));
        url.query_pairs_mut().clear().extend_pairs(query);
    }
    url
}

fn sent() -> DestinationResult {
    DestinationResult {
        status: DeliveryStatus::Sent,
        error: None,
    }
}

fn disabled() -> DestinationResult {
    DestinationResult {
        status: DeliveryStatus::Disabled,
        error: None,
    }
}

fn failed(category: &str) -> DestinationResult {
    DestinationResult {
        status: DeliveryStatus::Failed,
        error: Some(category.to_owned()),
    }
}

fn validate_report(report: &DiagnosticReport) -> Result<(), String> {
    if report.schema_version != CURRENT_FIELDS_VERSION
        || !is_identifier(&report.id, 128)
        || !is_identifier(&report.system_id, 80)
        || report.finished_at_ms < report.started_at_ms
        || report.finished_at_ms - report.started_at_ms > MAX_REPORT_AGE_MS
        || (report.kind == ReportKind::Benchmark && report.mode.is_none())
        || (report.kind == ReportKind::Recording && report.mode.is_some())
        || report.stages.len() > MAX_STAGES
        || report.coverage.len() > MAX_COVERAGE
        || report.recommendations.len() > MAX_RECOMMENDATIONS
    {
        return Err("invalid_report".to_owned());
    }

    let environment = &report.environment;
    for (value, max) in [
        (environment.app_version.as_str(), 40),
        (environment.build.as_str(), 80),
        (environment.os.as_str(), 40),
        (environment.arch.as_str(), 40),
        (environment.fixture_version.as_str(), 40),
    ] {
        validate_text(value, max, false)?;
    }
    if let Some(cpu) = &environment.cpu {
        validate_cpu_text(cpu, 100)?;
    }
    for value in [
        environment.gpu.as_deref(),
        environment.ai_provider.as_deref(),
    ]
    .into_iter()
    .flatten()
    {
        validate_text(value, 100, false)?;
    }
    if environment.logical_cores > 512
        || environment
            .memory_mb
            .is_some_and(|value| value > 16_777_216)
    {
        return Err("invalid_report".to_owned());
    }

    for stage in &report.stages {
        if !is_identifier(&stage.id, 80)
            || stage.failures > 1_000_000
            || stage.count > 10_000_000
            || !valid_measurement(stage.total_ms)
            || !valid_measurement(stage.median_ms)
            || !valid_measurement(stage.max_ms)
            || stage.total_ms < stage.max_ms
            || stage.median_ms > stage.max_ms
            || stage.p95_ms.is_some_and(|value| {
                !valid_measurement(value)
                    || stage.count < 20
                    || value < stage.median_ms
                    || value > stage.max_ms
            })
            || stage
                .throughput_per_second
                .is_some_and(|value| !valid_measurement(value))
            || stage.count == 0
                && (stage.total_ms != 0.0
                    || stage.median_ms != 0.0
                    || stage.max_ms != 0.0
                    || stage.p95_ms.is_some()
                    || stage.throughput_per_second.is_some())
        {
            return Err("invalid_report".to_owned());
        }
        validate_text(&stage.label, 100, false)?;
        validate_text(&stage.category, 40, false)?;
    }

    for coverage in &report.coverage {
        if !is_identifier(&coverage.id, 80) {
            return Err("invalid_report".to_owned());
        }
        validate_text(&coverage.label, 100, false)?;
        if let Some(reason) = &coverage.reason {
            validate_text(reason, 240, false)?;
        }
    }

    for recommendation in &report.recommendations {
        if !is_identifier(&recommendation.stage_id, 80) {
            return Err("invalid_report".to_owned());
        }
        validate_text(&recommendation.evidence, 400, false)?;
        validate_text(&recommendation.action, 400, false)?;
    }

    Ok(())
}

fn is_identifier(value: &str, max: usize) -> bool {
    !value.is_empty()
        && value.len() <= max
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'.'))
        && !value.starts_with('.')
        && !value.ends_with('.')
        && !value.contains("..")
        && !contains_media_extension(value)
}

fn valid_measurement(value: f64) -> bool {
    value.is_finite() && (0.0..=1.0e15).contains(&value)
}

fn validate_text(value: &str, max: usize, allow_empty: bool) -> Result<(), String> {
    validate_text_inner(value, max, allow_empty, false)
}

fn validate_cpu_text(value: &str, max: usize) -> Result<(), String> {
    validate_text_inner(value, max, false, true)
}

fn validate_text_inner(
    value: &str,
    max: usize,
    allow_empty: bool,
    allow_cpu_frequency: bool,
) -> Result<(), String> {
    if value.len() > max
        || (!allow_empty && value.trim().is_empty())
        || value.chars().any(char::is_control)
        || value.contains('@') && !(allow_cpu_frequency && has_cpu_frequency_marker(value))
        || looks_like_path(value)
        || looks_like_exif_timestamp(value)
        || value.as_bytes().get(1) == Some(&b':')
            && value
                .as_bytes()
                .first()
                .is_some_and(u8::is_ascii_alphabetic)
            && value
                .as_bytes()
                .get(2)
                .is_some_and(|byte| !byte.is_ascii_whitespace())
    {
        return Err("invalid_report".to_owned());
    }

    let lowered = value.to_ascii_lowercase();
    if contains_media_extension(value)
        || [".com", ".net", ".org"]
            .iter()
            .any(|extension| lowered.contains(extension))
    {
        return Err("invalid_report".to_owned());
    }
    Ok(())
}

fn has_cpu_frequency_marker(value: &str) -> bool {
    let Some((prefix, suffix)) = value.split_once('@') else {
        return false;
    };
    let prefix = prefix.to_ascii_lowercase();
    let suffix = suffix.trim_start();
    !suffix.contains('@')
        && suffix
            .chars()
            .next()
            .is_some_and(|character| character.is_ascii_digit())
        && (prefix.contains("cpu")
            || prefix.contains("processor")
            || prefix.contains("core")
            || prefix.contains("xeon")
            || prefix.contains("ryzen"))
}

fn contains_media_extension(value: &str) -> bool {
    let lowered = value.to_ascii_lowercase();
    MEDIA_EXTENSIONS
        .iter()
        .any(|extension| lowered.contains(extension))
}

fn looks_like_path(value: &str) -> bool {
    let lowered = value.to_ascii_lowercase();
    value.contains('\\')
        || value.starts_with('/')
        || value.starts_with("~/")
        || value.contains("//")
        || value.contains("://")
        || value.contains("..")
        || ["%2f", "%5c", "%3a"]
            .iter()
            .any(|part| lowered.contains(part))
        || value.split('/').any(|part| {
            matches!(
                part.to_ascii_lowercase().as_str(),
                "home"
                    | "users"
                    | "pictures"
                    | "photos"
                    | "dcim"
                    | "documents"
                    | "desktop"
                    | "mnt"
                    | "media"
                    | "volumes"
            )
        })
}

fn looks_like_exif_timestamp(value: &str) -> bool {
    value.as_bytes().windows(10).any(|window| {
        window[0..4].iter().all(|byte| byte.is_ascii_digit())
            && window[4] == b':'
            && window[5..7].iter().all(|byte| byte.is_ascii_digit())
            && window[7] == b':'
            && window[8..10].iter().all(|byte| byte.is_ascii_digit())
    })
}

fn format_duration(milliseconds: u64) -> String {
    if milliseconds < 1_000 {
        format!("{milliseconds} ms")
    } else if milliseconds < 60_000 {
        format!("{:.1} s", milliseconds as f64 / 1_000.0)
    } else {
        format!("{:.1} min", milliseconds as f64 / 60_000.0)
    }
}

fn truncate_utf8(value: &str, max_bytes: usize) -> String {
    if value.len() <= max_bytes {
        return value.to_owned();
    }
    let ellipsis = "…";
    let mut end = max_bytes.saturating_sub(ellipsis.len());
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}{ellipsis}", &value[..end])
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{Read, Write},
        net::{SocketAddr, TcpListener, TcpStream},
        sync::{mpsc, Arc},
        thread,
        time::Instant,
    };

    struct CapturedRequest {
        headers: String,
        body: Vec<u8>,
    }

    fn receive_request(stream: &mut TcpStream) -> CapturedRequest {
        let mut bytes = Vec::new();
        let mut buffer = [0u8; 1024];
        let header_end = loop {
            let read = stream.read(&mut buffer).unwrap();
            assert!(read > 0, "request ended before headers");
            bytes.extend_from_slice(&buffer[..read]);
            if let Some(index) = bytes.windows(4).position(|window| window == b"\r\n\r\n") {
                break index + 4;
            }
        };
        let headers = String::from_utf8(bytes[..header_end].to_vec()).unwrap();
        let content_length = headers
            .lines()
            .find_map(|line| {
                let (name, value) = line.split_once(':')?;
                name.eq_ignore_ascii_case("content-length")
                    .then(|| value.trim().parse::<usize>().unwrap())
            })
            .unwrap_or(0);
        while bytes.len() < header_end + content_length {
            let read = stream.read(&mut buffer).unwrap();
            assert!(read > 0, "request ended before complete body");
            bytes.extend_from_slice(&buffer[..read]);
        }
        CapturedRequest {
            headers,
            body: bytes[header_end..header_end + content_length].to_vec(),
        }
    }

    fn mock_server(
        status: &str,
        extra_headers: &str,
    ) -> (SocketAddr, thread::JoinHandle<CapturedRequest>) {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let address = listener.local_addr().unwrap();
        let status = status.to_owned();
        let extra_headers = extra_headers.to_owned();
        let handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let captured = receive_request(&mut stream);
            write!(
                stream,
                "HTTP/1.1 {status}\r\n{extra_headers}Content-Length: 0\r\nConnection: close\r\n\r\n"
            )
            .unwrap();
            captured
        });
        (address, handle)
    }

    fn blocked_mock_server() -> (
        SocketAddr,
        mpsc::Receiver<CapturedRequest>,
        mpsc::Sender<()>,
        thread::JoinHandle<()>,
    ) {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let address = listener.local_addr().unwrap();
        let (request_sender, request_receiver) = mpsc::channel();
        let (release_sender, release_receiver) = mpsc::channel();
        let handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let captured = receive_request(&mut stream);
            request_sender.send(captured).unwrap();
            release_receiver.recv().unwrap();
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
            )
            .unwrap();
        });
        (address, request_receiver, release_sender, handle)
    }

    fn endpoint(address: SocketAddr, path: &str) -> String {
        format!("http://{address}{path}")
    }

    fn test_report() -> DiagnosticReport {
        DiagnosticReport {
            schema_version: 2,
            id: "test-run-1".to_owned(),
            system_id: "Fern-482731".to_owned(),
            kind: ReportKind::Benchmark,
            mode: Some(BenchmarkMode::Quick),
            started_at_ms: 1_000,
            finished_at_ms: 2_500,
            environment: Environment {
                app_version: "0.6.1".to_owned(),
                build: "test".to_owned(),
                os: "linux".to_owned(),
                arch: "x86_64".to_owned(),
                cpu: Some("Intel(R) Core(TM) i7 CPU @ 2.80GHz".to_owned()),
                logical_cores: 8,
                memory_mb: Some(16_384),
                gpu: None,
                ai_provider: Some("ONNX CPU".to_owned()),
                fixture_version: "v1".to_owned(),
            },
            stages: vec![StageSummary {
                id: "preview-fit".to_owned(),
                label: "Fit preview".to_owned(),
                category: "preview".to_owned(),
                cache: CacheState::Cold,
                status: StageStatus::Passed,
                count: 2,
                total_ms: 30.0,
                median_ms: 15.0,
                max_ms: 20.0,
                p95_ms: None,
                units: 2,
                bytes: 1_024,
                failures: 0,
                throughput_per_second: Some(66.6),
            }],
            coverage: vec![Coverage {
                id: "preview-pipeline".to_owned(),
                label: "Preview pipeline".to_owned(),
                status: CoverageStatus::Measured,
                reason: None,
            }],
            recommendations: vec![Recommendation {
                stage_id: "preview-fit".to_owned(),
                priority: Priority::Medium,
                evidence: "Cold preview rendering dominates measured time".to_owned(),
                action: "Reuse cached previews".to_owned(),
            }],
        }
    }

    fn approve_for(state: &DiagnosticDelivery, webhook_url: String, ntfy_url: String) -> String {
        approve(state, &webhook_url, &ntfy_url, "", 2).unwrap()
    }

    fn approve_with_logs(
        state: &DiagnosticDelivery,
        webhook_url: String,
        ntfy_url: String,
        logs_url: String,
    ) -> String {
        approve(state, &webhook_url, &ntfy_url, &logs_url, 2).unwrap()
    }

    fn settings_with_values(
        values: serde_json::Value,
    ) -> (crate::settings::Settings, std::path::PathBuf) {
        use std::{fs, sync::Mutex};
        static NEXT_SETTINGS_TEST: std::sync::atomic::AtomicU64 =
            std::sync::atomic::AtomicU64::new(0);
        let path = std::env::temp_dir().join(format!(
            "opencull-diagnostic-settings-{}-{}.json",
            std::process::id(),
            NEXT_SETTINGS_TEST.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        fs::write(&path, serde_json::to_vec(&values).unwrap()).unwrap();
        (crate::settings::Settings(Mutex::new(path.clone())), path)
    }

    #[test]
    fn native_configuration_uses_fixed_topics_and_hides_the_webhook() {
        let webhook = "http://127.0.0.1:8123/hook";
        let encoded = STANDARD.encode(webhook);
        let (settings, path) = settings_with_values(serde_json::json!({
            "performanceWebhookEncoded": encoded,
            "performanceNtfyUrl": "https://attacker.invalid/other-topic",
            "performanceLogsNtfyUrl": "https://attacker.invalid/other-logs"
        }));
        let configuration = diagnostics_configuration_for(&settings).unwrap();

        assert_eq!(
            configuration,
            DiagnosticConfiguration {
                webhook_configured: true,
                ntfy_url: PERFORMANCE_NTFY_URL,
                logs_url: LOGS_NTFY_URL,
            }
        );
        let visible = serde_json::to_string(&configuration).unwrap();
        assert!(!visible.contains(webhook));

        let state = DiagnosticDelivery::default();
        let approval = approve_configured(&state, &settings, CURRENT_FIELDS_VERSION).unwrap();
        let active = state.approval.lock().unwrap().clone().unwrap();
        assert_eq!(active.id, approval);
        assert_eq!(active.webhook.as_ref().unwrap().url.as_str(), webhook);
        assert_eq!(
            active.ntfy.as_ref().unwrap().url.as_str(),
            PERFORMANCE_NTFY_URL
        );
        assert_eq!(active.logs.as_ref().unwrap().url.as_str(), LOGS_NTFY_URL);

        let preview = preview_report(
            test_report(),
            configured_webhook_url(&settings).unwrap().as_deref(),
        )
        .unwrap();
        assert!(!preview.webhook_json.contains(webhook));
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn invalid_or_absent_local_webhook_is_reported_as_unconfigured() {
        let (settings, path) = settings_with_values(serde_json::json!({
            "performanceWebhookEncoded": "not-base64!",
            "performanceNtfyUrl": "https://attacker.invalid/topic"
        }));
        let configuration = diagnostics_configuration_for(&settings).unwrap();
        assert!(!configuration.webhook_configured);
        assert_eq!(configuration.ntfy_url, PERFORMANCE_NTFY_URL);
        assert_eq!(configuration.logs_url, LOGS_NTFY_URL);
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn approval_accepts_https_and_loopback_http_only() {
        let state = DiagnosticDelivery::default();
        assert!(approve(&state, "http://example.com/hook", "", "", 2).is_err());
        assert!(approve(&state, "https://user@example.com/hook", "", "", 2).is_err());
        assert!(approve(&state, "", "https://ntfy.sh", "", 2).is_err());
        assert!(approve(&state, "", "https://ntfy.sh/topic", "", 2).is_ok());
        assert!(approve(&state, "http://127.0.0.1:8123/hook", "", "", 2).is_ok());
        assert!(approve(&state, "https://discord.com/not-a-webhook", "", "", 2).is_err());
        assert!(approve(
            &state,
            "https://discord.com/api/webhooks/123456/test-token",
            "",
            "",
            2
        )
        .is_ok());
    }

    #[test]
    fn replacing_approved_destinations_revokes_the_previous_approval() {
        let state = DiagnosticDelivery::default();
        let previous = approve_for(
            &state,
            "https://hooks.example.test/first".to_owned(),
            String::new(),
        );
        let current = approve_for(
            &state,
            "https://hooks.example.test/second".to_owned(),
            String::new(),
        );
        assert_ne!(previous, current);

        let result = tauri::async_runtime::block_on(send_diagnostics(
            &state,
            &previous,
            test_report(),
            None,
            None,
        ));
        assert_eq!(result.unwrap_err(), "not_approved");
    }

    #[test]
    fn disabling_while_webhook_is_pending_prevents_the_ntfy_request() {
        let (webhook_address, webhook_requests, release_webhook, webhook_thread) =
            blocked_mock_server();
        let ntfy_listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        ntfy_listener.set_nonblocking(true).unwrap();
        let ntfy_address = ntfy_listener.local_addr().unwrap();
        let state = Arc::new(DiagnosticDelivery::default());
        let approval = approve_for(
            &state,
            endpoint(webhook_address, "/hook"),
            endpoint(ntfy_address, "/topic"),
        );

        let send_state = Arc::clone(&state);
        let send_approval = approval.clone();
        let send_thread = thread::spawn(move || {
            tauri::async_runtime::block_on(send_diagnostics(
                &send_state,
                &send_approval,
                test_report(),
                None,
                None,
            ))
        });

        let request = webhook_requests
            .recv_timeout(Duration::from_secs(2))
            .expect("webhook should start first");
        assert!(request.headers.starts_with("POST /hook HTTP/1.1"));
        disable(&state).unwrap();
        release_webhook.send(()).unwrap();
        let result = send_thread.join().unwrap().unwrap();
        webhook_thread.join().unwrap();

        assert_eq!(result.webhook.status, DeliveryStatus::Sent);
        assert_eq!(result.ntfy.status, DeliveryStatus::Disabled);
        match ntfy_listener.accept() {
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {}
            Ok(_) => panic!("ntfy must not receive a request after consent is disabled"),
            Err(error) => panic!("unexpected listener error: {error}"),
        }
    }

    #[test]
    fn webhook_and_ntfy_send_exact_aggregate_body_and_bearer_headers() {
        let (webhook_address, webhook_thread) = mock_server("200 OK", "");
        let (ntfy_address, ntfy_thread) = mock_server("201 Created", "");
        let state = DiagnosticDelivery::default();
        let approval = approve_for(
            &state,
            endpoint(webhook_address, "/hook"),
            endpoint(ntfy_address, "/topic"),
        );
        let report = test_report();
        let preview = preview_report(report.clone(), None).unwrap();

        let result = tauri::async_runtime::block_on(send_diagnostics(
            &state,
            &approval,
            report.clone(),
            Some("webhook-secret"),
            Some("ntfy-secret"),
        ))
        .unwrap();

        assert_eq!(result.webhook.status, DeliveryStatus::Sent);
        assert_eq!(result.ntfy.status, DeliveryStatus::Sent);
        let webhook_request = webhook_thread.join().unwrap();
        let ntfy_request = ntfy_thread.join().unwrap();
        assert!(webhook_request.headers.starts_with("POST /hook HTTP/1.1"));
        let webhook_headers = webhook_request.headers.to_ascii_lowercase();
        assert!(webhook_headers.contains("content-type: application/json"));
        assert!(webhook_headers.contains("authorization: bearer webhook-secret"));
        assert_eq!(webhook_request.body, serde_json::to_vec(&report).unwrap());
        assert!(!String::from_utf8_lossy(&webhook_request.body).contains("webhook-secret"));
        assert!(ntfy_request.headers.starts_with("POST /topic HTTP/1.1"));
        let ntfy_headers = ntfy_request.headers.to_ascii_lowercase();
        assert!(ntfy_headers.contains("authorization: bearer ntfy-secret"));
        assert!(ntfy_headers.contains("content-type: text/plain; charset=utf-8"));
        assert!(ntfy_request.body.len() <= MAX_DIAGNOSTIC_SUMMARY_BYTES);
        let message = String::from_utf8(ntfy_request.body).unwrap();
        assert_eq!(message, preview.ntfy_message);
        assert!(message.contains("Fit preview"));
        assert!(message.contains("- Suggestion: Reuse cached previews"));
        assert!(message.contains("- System: Fern-482731"));
        assert!(!message.contains("webhook-secret"));
        assert!(!message.contains("ntfy-secret"));
    }

    #[test]
    fn discord_preview_uses_the_supported_compact_payload_without_mentions() {
        let report = test_report();
        let discord_url = "https://discord.com/api/webhooks/123456/test-token";
        let preview = preview_report(report.clone(), Some(discord_url)).unwrap();
        let preview_value: serde_json::Value = serde_json::from_str(&preview.webhook_json).unwrap();
        let destination = parse_destination(discord_url, false).unwrap().unwrap();
        let send_value: serde_json::Value = serde_json::from_slice(
            &webhook_payload_for_destination(&report, Some(&destination)).unwrap(),
        )
        .unwrap();

        assert_eq!(preview_value, send_value);
        assert_eq!(
            preview_value["allowed_mentions"]["parse"],
            serde_json::json!([])
        );
        let content = preview_value["content"].as_str().unwrap();
        assert!(content.contains("- System: Fern-482731"));
        assert!(content.contains("Fit preview"));
        assert!(content.chars().count() <= 2_000);
        assert_eq!(content, preview.ntfy_message);
        assert!(!preview.webhook_json.contains("test-token"));
    }

    #[test]
    fn shared_summary_shows_only_three_stages_one_tip_and_no_hardware_details() {
        let mut report = test_report();
        report.environment.gpu = Some("Private GPU model".to_owned());
        let mut stages = Vec::new();
        for (id, label, total_ms, median_ms, max_ms) in [
            ("stage-one", "Slow one", 100.0, 30.0, 50.0),
            ("stage-two", "Slow two", 90.0, 25.0, 45.0),
            ("stage-three", "Slow three", 80.0, 20.0, 40.0),
            ("stage-four", "Hidden fourth", 70.0, 15.0, 35.0),
        ] {
            let mut stage = report.stages[0].clone();
            stage.id = id.to_owned();
            stage.label = label.to_owned();
            stage.count = 3;
            stage.total_ms = total_ms;
            stage.median_ms = median_ms;
            stage.max_ms = max_ms;
            stages.push(stage);
        }
        report.stages = stages;
        report.recommendations = vec![
            Recommendation {
                stage_id: "stage-one".to_owned(),
                priority: Priority::High,
                evidence: "Verbose evidence should stay private from this summary".to_owned(),
                action: "Investigate slow preview reuse".to_owned(),
            },
            Recommendation {
                stage_id: "stage-two".to_owned(),
                priority: Priority::Low,
                evidence: "Second recommendation evidence".to_owned(),
                action: "Second recommendation should be omitted".to_owned(),
            },
        ];

        let message = build_diagnostic_summary(&report);
        let lines: Vec<&str> = message.lines().collect();
        assert_eq!(lines[0], "Culltivate benchmark (quick)");
        assert_eq!(lines[1], "- System: Fern-482731");
        assert_eq!(lines[2], "- Duration: 1.5 s · 0 failures");
        assert_eq!(lines[3], "- Slow one: 100 ms total · 30 ms/run");
        assert_eq!(lines[4], "- Slow two: 90 ms total · 25 ms/run");
        assert_eq!(lines[5], "- Slow three: 80 ms total · 20 ms/run");
        assert_eq!(lines[6], "- Suggestion: Investigate slow preview reuse");
        assert_eq!(lines.len(), 7);
        for omitted in [
            "Hidden fourth",
            "Private GPU model",
            "Intel(R) Core",
            "ONNX CPU",
            "Verbose evidence",
            "Second recommendation",
            "coverage",
        ] {
            assert!(
                !message.contains(omitted),
                "unexpected summary field: {omitted}"
            );
        }
        assert!(message.len() <= 1_000);
    }

    #[test]
    fn discord_delivery_url_requests_server_confirmation_and_preserves_other_query_values() {
        let destination = parse_destination(
            "https://discord.com/api/webhooks/123456/test-token?thread_id=789&wait=false",
            false,
        )
        .unwrap()
        .unwrap();
        let query: std::collections::HashMap<String, String> = request_url(&destination)
            .query_pairs()
            .into_owned()
            .collect();

        assert_eq!(query.get("wait").map(String::as_str), Some("true"));
        assert_eq!(query.get("thread_id").map(String::as_str), Some("789"));
    }

    #[test]
    fn recording_reports_route_to_logs_while_benchmarks_use_performance_topic() {
        let (performance_address, performance_thread) = mock_server("200 OK", "");
        let (logs_address, logs_thread) = mock_server("200 OK", "");
        let state = DiagnosticDelivery::default();
        let approval = approve_with_logs(
            &state,
            String::new(),
            endpoint(performance_address, "/culltivate-perf"),
            endpoint(logs_address, "/culltivate-logs"),
        );

        let benchmark_result = tauri::async_runtime::block_on(send_diagnostics(
            &state,
            &approval,
            test_report(),
            None,
            None,
        ))
        .unwrap();
        let mut recording_report = test_report();
        recording_report.kind = ReportKind::Recording;
        recording_report.mode = None;
        let recording_result = tauri::async_runtime::block_on(send_diagnostics(
            &state,
            &approval,
            recording_report,
            None,
            None,
        ))
        .unwrap();

        assert_eq!(benchmark_result.ntfy.status, DeliveryStatus::Sent);
        assert_eq!(recording_result.ntfy.status, DeliveryStatus::Sent);
        let performance_request = performance_thread.join().unwrap();
        let logs_request = logs_thread.join().unwrap();
        assert!(performance_request
            .headers
            .starts_with("POST /culltivate-perf HTTP/1.1"));
        assert!(logs_request
            .headers
            .starts_with("POST /culltivate-logs HTTP/1.1"));
        assert!(String::from_utf8(performance_request.body)
            .unwrap()
            .contains("- System: Fern-482731"));
        assert!(String::from_utf8(logs_request.body)
            .unwrap()
            .contains("Culltivate recording"));
    }

    #[test]
    fn redirect_is_reported_without_following_it() {
        let (target_address, _target_listener) = {
            let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
            listener.set_nonblocking(true).unwrap();
            (listener.local_addr().unwrap(), listener)
        };
        let (redirect_address, redirect_thread) = mock_server(
            "302 Found",
            &format!("Location: {}\r\n", endpoint(target_address, "/capture")),
        );
        let state = DiagnosticDelivery::default();
        let approval = approve_for(&state, endpoint(redirect_address, "/hook"), String::new());

        let result = tauri::async_runtime::block_on(send_diagnostics(
            &state,
            &approval,
            test_report(),
            None,
            None,
        ))
        .unwrap();

        assert_eq!(result.webhook.status, DeliveryStatus::Failed);
        assert_eq!(result.webhook.error.as_deref(), Some("http_3xx"));
        let _ = redirect_thread.join().unwrap();
        let start = Instant::now();
        loop {
            match _target_listener.accept() {
                Ok(_) => panic!("redirect target must not receive a request"),
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {}
                Err(error) => panic!("unexpected listener error: {error}"),
            }
            if start.elapsed() > Duration::from_millis(150) {
                break;
            }
            thread::sleep(Duration::from_millis(5));
        }
    }

    #[test]
    fn destination_failures_are_independent_and_disabled_is_reported() {
        let (webhook_address, webhook_thread) = mock_server("503 Service Unavailable", "");
        let (ntfy_address, ntfy_thread) = mock_server("200 OK", "");
        let state = DiagnosticDelivery::default();
        let approval = approve_for(
            &state,
            endpoint(webhook_address, "/hook"),
            endpoint(ntfy_address, "/topic"),
        );

        let result = tauri::async_runtime::block_on(send_diagnostics(
            &state,
            &approval,
            test_report(),
            None,
            None,
        ))
        .unwrap();

        assert_eq!(result.webhook.status, DeliveryStatus::Failed);
        assert_eq!(result.webhook.error.as_deref(), Some("http_5xx"));
        assert_eq!(result.ntfy.status, DeliveryStatus::Sent);
        webhook_thread.join().unwrap();
        ntfy_thread.join().unwrap();

        let result =
            tauri::async_runtime::block_on(send_ntfy(&Client::new(), None, None, &test_report()));
        assert_eq!(result.status, DeliveryStatus::Disabled);
    }

    #[test]
    fn report_rejects_unlisted_fields_and_path_like_text() {
        let mut value = serde_json::to_value(test_report()).unwrap();
        value["unexpected"] = serde_json::json!("private");
        assert!(serde_json::from_value::<DiagnosticReport>(value).is_err());

        let mut value = serde_json::to_value(test_report()).unwrap();
        value.as_object_mut().unwrap().remove("systemId");
        assert!(serde_json::from_value::<DiagnosticReport>(value).is_err());

        let mut report = test_report();
        report.recommendations[0].action = "Open /home/alice/photo.jpg".to_owned();
        assert_eq!(validate_report(&report).unwrap_err(), "invalid_report");

        report.recommendations[0].action = "Investigate measured latency".to_owned();
        report.environment.cpu = Some("photographer@example.com".to_owned());
        assert_eq!(validate_report(&report).unwrap_err(), "invalid_report");

        report.environment.cpu = None;
        report.system_id = "photos@home".to_owned();
        assert_eq!(validate_report(&report).unwrap_err(), "invalid_report");
    }

    #[test]
    fn failed_attempt_without_samples_and_generated_evidence_are_valid() {
        let mut report = test_report();
        report.stages[0].id = "preview.fit.cold".to_owned();
        report.stages[0].status = StageStatus::Failed;
        report.stages[0].count = 0;
        report.stages[0].failures = 1;
        report.stages[0].total_ms = 0.0;
        report.stages[0].median_ms = 0.0;
        report.stages[0].max_ms = 0.0;
        report.stages[0].throughput_per_second = None;
        report.recommendations[0].stage_id = "preview.fit.cold".to_owned();
        report.recommendations[0].evidence =
            "Fit preview: 0 samples, median 0.0 ms, max 0.0 ms, 1 failures.".to_owned();
        assert!(validate_report(&report).is_ok());

        let preview = preview_report(report.clone(), None).unwrap();
        assert_eq!(
            preview.webhook_json,
            String::from_utf8(serde_json::to_vec(&report).unwrap()).unwrap()
        );
        assert!(preview.ntfy_message.contains("- Suggestion:"));
        assert!(preview.ntfy_message.len() <= MAX_DIAGNOSTIC_SUMMARY_BYTES);
    }

    #[test]
    fn curated_slash_labels_are_allowed_but_paths_filenames_and_exif_are_rejected() {
        let mut report = test_report();
        report.stages[0].label = "Folder scan and RAW/JPEG pairing".to_owned();
        report.coverage[0].label = "Preview cache hits/misses".to_owned();
        report.recommendations[0].evidence =
            "Fit preview: median 65.0 ms across cold samples.".to_owned();
        assert!(validate_report(&report).is_ok());

        report.recommendations[0].evidence = "Captured 2026:10:18 12:30:01".to_owned();
        assert_eq!(validate_report(&report).unwrap_err(), "invalid_report");

        report.recommendations[0].evidence = "Fit preview: median 65.0 ms".to_owned();
        report.id = "IMG_0001.jpg".to_owned();
        assert_eq!(validate_report(&report).unwrap_err(), "invalid_report");
    }

    #[test]
    fn shared_summary_caps_one_suggestion_and_stays_within_1000_utf8_bytes() {
        let mut report = test_report();
        report.recommendations = (0..MAX_RECOMMENDATIONS)
            .map(|index| Recommendation {
                stage_id: format!("stage-{index}"),
                priority: Priority::Low,
                evidence: "é".repeat(200),
                action: "é".repeat(200),
            })
            .collect();
        let message = build_diagnostic_summary(&report);
        assert!(message.len() <= MAX_DIAGNOSTIC_SUMMARY_BYTES);
        assert!(message.ends_with('…'));
        assert_eq!(message.matches("- Suggestion:").count(), 1);
    }
}
