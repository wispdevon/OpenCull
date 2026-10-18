import { invoke } from "@tauri-apps/api/core";
import { sceneFrames } from "./scene-frames";
import { resolveReview, REVIEW_CHOICES } from "./review";
import { latestSession, type RecentSession } from "./session-history";
import { followedBy, placement } from "./framing";
import { beginRecording, finishRecording, recordingActive } from "./performance-recording";
import { diagnosticReport, ntfySummary, FIELD_VERSION, type BenchmarkMode, type BenchmarkReport, type BenchmarkStatus,
  type DeliveryResult, type DiagnosticReport, type PerformanceEnvironment, type StageMeasurement } from "./performance";

const native = "__TAURI_INTERNALS__" in window;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());
function reportingError(error: unknown): Error {
  const messages: Record<string, string> = {
    destination_required: "Enter a webhook URL or an ntfy topic URL.",
    invalid_url: "Enter a complete, valid destination URL.",
    unsupported_url_scheme: "Diagnostic destinations must use HTTPS, or HTTP on loopback.",
    https_required: "Use HTTPS for remote destinations. HTTP is supported only on loopback.",
    ntfy_topic_required: "Include a topic in the ntfy URL, for example https://ntfy.sh/your-topic.",
    userinfo_forbidden: "Use the bearer-token field instead of putting credentials in a URL.",
    url_fragment_forbidden: "Remove the fragment after # from the destination URL.",
    not_approved: "Preview and approve the current reporting destinations first.",
    invalid_report: "This diagnostic report could not be validated. It remains on this device.",
    report_schema_changed: "The reporting fields changed. Review the preview again.",
  };
  return new Error(messages[String(error)] ?? "Diagnostic reporting could not be configured. Check the destination URLs and try again.");
}
export const subscribePerformance = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
let latest: BenchmarkReport | null = null;
export const getLatestReport = () => latest;
let status: BenchmarkStatus = { runId: null, state: "idle", completed: 0, total: 0, current: null, report: null, error: null };
let approval: string | null = null;
let reportingEpoch = 0;
let webhookToken = "";
let ntfyToken = "";
let reporting = { approved: false, webhookUrl: "", ntfyUrl: "", sending: false, reportId: null as string | null,
  result: null as DeliveryResult | null, error: null as string | null };
let environmentPromise: Promise<PerformanceEnvironment> | undefined;
let frontendRun: string | null = null;
let recovering: Promise<void> | null = null;
let initializedNativeStatus = false;
let automaticQueue = Promise.resolve();
let pendingAutomatic = 0;
function environment(): Promise<PerformanceEnvironment> {
  return environmentPromise ??= (native ? invoke<PerformanceEnvironment>("benchmark_environment")
    .catch(() => browserEnvironment("unavailable")) : Promise.resolve(browserEnvironment("browser-demo")))
    .finally(() => { environmentPromise = undefined; });
}
function browserEnvironment(build: string): PerformanceEnvironment {
  return { appVersion: build === "browser-demo" ? "demo" : "unknown", build, os: "unknown", arch: "unknown", cpu: null,
    logicalCores: Math.max(1, navigator.hardwareConcurrency || 1), memoryMb: null, gpu: null,
    aiProvider: null, fixtureVersion: "frontend-1" };
}
async function publish(report: BenchmarkReport): Promise<void> {
  latest = report;
  notify();
  if (approval) enqueueAutomatic(report);
}
function enqueueAutomatic(report: BenchmarkReport): void {
  if (!report.stages.some((stage) => stage.samplesMs.length > 0 || stage.failures > 0)) return;
  if (pendingAutomatic >= 5) {
    reporting = { ...reporting, error: "Automatic report queue is full. The latest report remains available for manual retry." };
    notify();
    return;
  }
  const epoch = reportingEpoch;
  pendingAutomatic++;
  automaticQueue = automaticQueue.catch(() => {}).then(async () => {
    try { if (epoch === reportingEpoch) await automaticSend(report); }
    finally { pendingAutomatic--; }
  });
}
async function automaticSend(report: BenchmarkReport): Promise<void> {
  if (!approval) return;
  if (!report.stages.some((stage) => stage.samplesMs.length > 0 || stage.failures > 0)) return;
  try { await performanceApi.send(approval, diagnosticReport(report), webhookToken || null, ntfyToken || null); }
  catch { /* Reporting state exposes failure without invalidating a benchmark. */ }
}
async function poll(runId: string): Promise<void> {
  try {
    while (status.runId === runId && status.state === "running") {
      const next = await invoke<BenchmarkStatus>("benchmark_status");
      if (status.runId !== runId) return;
      status = next;
      notify();
      if (next.state !== "running") {
        if (next.report) {
          latest = next.report;
          // Only completed runs are automatically sent. Cancelled/failed partial runs remain local.
          if (next.state === "completed") {
            frontendRun = runId;
            status = { ...next, state: "running", current: "Checking frontend logic" };
            notify();
            const frontend = await frontendStages(next.report.mode ?? "quick", () => status.runId !== runId || status.state !== "running");
            frontendRun = null;
            if (status.runId !== runId || status.state !== "running") return;
            next.report.stages.push(...frontend);
            next.report.coverage.push(...frontend.map((s) => ({ id: s.id, label: s.label, status: "measured" as const, reason: null })));
            next.report.finishedAtMs = Date.now();
            status = next;
            await publish(next.report);
          }
          notify();
        }
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  } catch {
    if (status.runId === runId) {
      status = { ...status, state: "failed", error: "Could not read benchmark progress. Reopen Performance to recover the native run status." };
      notify();
    }
  }
}

/** Each fixture sample yields so progress and cancellation remain responsive. */
async function frontendStages(mode: BenchmarkMode, cancelled: () => boolean): Promise<StageMeasurement[]> {
  const count = mode === "thorough" ? 20 : 5;
  const size = mode === "thorough" ? 10_000 : 1_000;
  const photos = Array.from({ length: size }, (_, i) => ({ rating: i % 6, flag: i % 7 === 0 ? "pick" : "none", color: "none" }));
  const order = Array.from({ length: size }, (_, i) => i);
  const cards: RecentSession[] = order.map((i) => ({ id: String(i), name: "Fixture", updatedAt: (i * 7919) % size,
    sources: [], count: 1, stage: "review", cover: null }));
  const framed = { fullWidth: 6000, fullHeight: 4000, framing: { turn: 6, crop: { cx: 2000, cy: 3000, w: 3200, h: 4800, angle: 2 } } };
  const cases: [string, string, () => unknown][] = [
    ["frontend.review", "Review filtering", () => resolveReview(REVIEW_CHOICES, photos, order, new Set(), 0)],
    ["frontend.scene", "Scene navigation lookup", () => sceneFrames(order, size - 5, (i) => Math.floor(i / 8))],
    ["frontend.resume", "Find latest saved session", () => latestSession(cards, null)],
    ["frontend.crop", "Crop and orientation geometry", () => { for (let i = 1; i <= 8; i++) { followedBy(i, 6); placement(framed); } }],
  ];
  const result: StageMeasurement[] = [];
  for (const [id, label, work] of cases) {
    const samplesMs: number[] = [];
    for (let i = 0; i < count && !cancelled(); i++) {
      await yieldToMain();
      const started = performance.now();
      work();
      samplesMs.push(performance.now() - started);
    }
    if (samplesMs.length) result.push({ id, label, category: "frontend", cache: "none", samplesMs,
      units: samplesMs.length, bytes: 0, failures: 0, status: "passed",
      detail: `Pure application logic on ${size} synthetic entries; excludes DOM rendering and native I/O.` });
    if (cancelled()) break;
  }
  return result;
}
async function yieldToMain(): Promise<void> {
  const scheduler = (globalThis as typeof globalThis & { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (scheduler?.yield) await scheduler.yield();
  else await new Promise((resolve) => setTimeout(resolve, 0));
}

export const performanceApi = {
  async start(mode: BenchmarkMode): Promise<string> {
    if (status.state === "running" || recordingActive()) throw new Error("Stop the active run or recording first.");
    if (mode !== "quick" && mode !== "thorough") throw new Error("Choose Quick or Thorough.");
    if (native) {
      const runId = await invoke<string>("benchmark_start", { mode });
      status = { runId, state: "running", completed: 0, total: 0, current: "Preparing fixtures", report: null, error: null };
      notify();
      void poll(runId);
      return runId;
    }
    const runId = `browser-${Date.now()}`;
    const startedAtMs = Date.now();
    status = { runId, state: "running", completed: 0, total: 4, current: "Frontend fixture checks", report: null, error: null };
    notify();
    void (async () => {
      const stages = await frontendStages(mode, () => status.state !== "running" || status.runId !== runId);
      if (status.runId !== runId || status.state !== "running") return;
      const report: BenchmarkReport = { schemaVersion: FIELD_VERSION, id: runId, kind: "benchmark", mode, startedAtMs,
        finishedAtMs: Date.now(), environment: await environment(), stages,
        coverage: [...stages.map((s) => ({ id: s.id, label: s.label, status: "measured" as const, reason: null })),
          { id: "native", label: "Native photo, AI, cache and copy pipelines", status: "skipped", reason: "Requires the desktop app. Browser results measure frontend fixture logic only." },
          { id: "rendering", label: "Image decode and visual interaction latency", status: "manual", reason: "Pure logic checks do not measure DOM painting, image decoding or display latency." }] };
      status = { runId, state: "completed", completed: 4, total: 4, current: null, report, error: null };
      await publish(report);
    })().catch(() => { status = { ...status, state: "failed", error: "Frontend benchmark could not complete." }; notify(); });
    return runId;
  },
  async status(): Promise<BenchmarkStatus> {
    if (native && (!initializedNativeStatus || status.state === "failed" && status.runId)) {
      recovering ??= (async () => {
        try {
          const expectedRun = status.runId;
          const recovered = await invoke<BenchmarkStatus>("benchmark_status");
          if (expectedRun && recovered.runId !== expectedRun) return;
          if (status.runId !== expectedRun) return;
          initializedNativeStatus = true;
          status = recovered;
          if (recovered.state === "running") void poll(recovered.runId!);
          else if (recovered.report && latest?.id !== recovered.report.id) {
            latest = recovered.report;
            if (recovered.state === "completed") enqueueAutomatic(recovered.report);
          }
        } catch { /* Keep the last local error and allow another explicit refresh. */ }
        finally { recovering = null; }
      })();
      await recovering;
    }
    return status;
  },
  async cancel(runId: string): Promise<void> {
    if (status.runId !== runId) return;
    if (frontendRun === runId) { status = { ...status, state: "cancelled", current: null }; notify(); }
    else if (native) await invoke("benchmark_cancel", { runId });
    else { status = { ...status, state: "cancelled", current: null }; notify(); }
  },
  startRecording(): void {
    if (status.state === "running") throw new Error("Wait for the benchmark to finish first.");
    beginRecording();
    void environment();
    notify();
  },
  async stopRecording(): Promise<BenchmarkReport> {
    const report = finishRecording(await environment());
    await publish(report);
    return report;
  },
  isRecording: recordingActive,
  async previewReport(): Promise<BenchmarkReport> {
    return { schemaVersion: FIELD_VERSION, id: "example-report", kind: "benchmark", mode: "quick", startedAtMs: Date.now(),
      finishedAtMs: Date.now(), environment: await environment(), stages: [{ id: "preview.fit.cold", label: "Fit preview (example)", category: "preview", cache: "cold",
        samplesMs: [60, 65, 70], units: 3, bytes: 0, failures: 0, status: "passed", detail: "Illustrative values, not measurements." }],
      coverage: [{ id: "example", label: "Example only", status: "manual", reason: "Illustrative preview; actual reports contain measured stage aggregates." }] };
  },
  async previewPayload(report: DiagnosticReport): Promise<{ webhookJson: string; ntfyMessage: string }> {
    if (!native) return { webhookJson: JSON.stringify(report), ntfyMessage: ntfySummary(report) };
    try { return await invoke("diagnostics_preview", { report }); }
    catch (error) { throw reportingError(error); }
  },
  reportingState: () => ({ ...reporting }),
  setReportingTokens(webhook: string, ntfy: string): void { webhookToken = webhook; ntfyToken = ntfy; },
  async approve(webhookUrl: string, ntfyUrl: string): Promise<string> {
    if (!native) throw new Error("Diagnostic delivery requires the desktop app.");
    const epoch = ++reportingEpoch;
    approval = null;
    reporting = { ...reporting, approved: false, sending: false, result: null, error: null, reportId: null };
    notify();
    let approved: string;
    try { approved = await invoke<string>("diagnostics_approve", { webhookUrl, ntfyUrl, fieldsVersion: FIELD_VERSION }); }
    catch (error) { throw reportingError(error); }
    if (epoch !== reportingEpoch) { await invoke("diagnostics_disable"); throw new Error("Reporting configuration changed. Preview it again."); }
    approval = approved;
    reporting = { ...reporting, approved: true, webhookUrl, ntfyUrl, error: null };
    notify();
    return approved;
  },
  async disableReporting(): Promise<void> {
    reportingEpoch++;
    approval = null;
    reporting = { ...reporting, approved: false, sending: false, result: null, error: null, reportId: null };
    notify();
    if (native) await invoke("diagnostics_disable");
  },
  async send(approved: string, report: DiagnosticReport, webhook: string | null, ntfy: string | null): Promise<DeliveryResult> {
    if (!native || approved !== approval || !reporting.approved) throw new Error("Preview and approve reporting first.");
    if (reporting.sending) throw new Error("A diagnostic report is already being sent.");
    const epoch = reportingEpoch;
    reporting = { ...reporting, sending: true, reportId: report.id, result: null, error: null };
    notify();
    try {
      const result = await invoke<DeliveryResult>("diagnostics_send", { approval: approved, report, webhookToken: webhook, ntfyToken: ntfy });
      if (epoch === reportingEpoch) reporting = { ...reporting, result };
      return result;
    } catch {
      const message = "Diagnostic delivery failed. Check the approved destinations and retry.";
      if (epoch === reportingEpoch) reporting = { ...reporting, error: message };
      throw new Error(message);
    } finally { if (epoch === reportingEpoch) reporting = { ...reporting, sending: false }; notify(); }
  },
  async retryReport(): Promise<void> {
    if (!latest || !approval) throw new Error("No approved report is available to retry.");
    await automaticSend(latest);
  },
};
