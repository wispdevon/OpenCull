import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
const environment = { appVersion: "test", build: "debug", os: "linux", arch: "x86_64", cpu: null,
  logicalCores: 2, memoryMb: null, gpu: null, aiProvider: null, fixtureVersion: "test" };
function benchmarkReport(id: string) {
  return { schemaVersion: 2, id, kind: "benchmark", mode: "thorough", startedAtMs: 100, finishedAtMs: 200,
    environment, stages: [{ id: "preview.cold", label: "Cold preview", category: "preview", cache: "cold",
      samplesMs: [80], units: 1, bytes: 0, failures: 0, status: "passed", detail: null }],
    coverage: [{ id: "preview.cold", label: "Cold preview", status: "measured", reason: null }] };
}
beforeEach(() => {
  vi.resetModules();
  invoke.mockReset();
  Object.assign(window, { __TAURI_INTERNALS__: {} });
  invoke.mockImplementation(async (command: string) => {
    if (command === "benchmark_environment") return environment;
    if (command === "diagnostics_configuration") return { webhookConfigured: true, ntfyUrl: "https://ntfy.sh/culltivate-perf", logsUrl: "https://ntfy.sh/culltivate-logs" };
    if (command === "diagnostics_approve") return "approval-1";
    if (command === "diagnostics_send") return { webhook: { status: "sent", error: null }, ntfy: { status: "disabled", error: null } };
    if (command === "diagnostics_preview") return { webhookJson: "exact-json", ntfyMessage: "exact-message" };
  });
});
afterEach(() => { delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__; });

describe("performance controller", () => {
  it("loads hardware metadata without starting a benchmark or enabling reporting", async () => {
    const { performanceApi } = await import("./performance-api");
    expect(await performanceApi.getEnvironment()).toEqual(environment);
    expect(invoke.mock.calls.map(([name]) => name)).toEqual(["benchmark_environment"]);
  });
  it("approves distinct performance and log topics with the current system-ID schema", async () => {
    const { performanceApi } = await import("./performance-api");
    await performanceApi.approve();
    expect(invoke).toHaveBeenCalledWith("diagnostics_approve", {
      fieldsVersion: 4,
    });
    expect(performanceApi.reportingState().logsUrl).toBe("https://ntfy.sh/culltivate-logs");
    expect(performanceApi.reportingState()).not.toHaveProperty("webhookUrl");
  });
  it("explains invalid reporting destinations without sending a report", async () => {
    const { performanceApi } = await import("./performance-api");
    invoke.mockRejectedValueOnce("https_required");
    await expect(performanceApi.approve()).rejects.toThrow("The installed reporting destination must use HTTPS");
    expect(performanceApi.reportingState().approved).toBe(false);
    expect(invoke.mock.calls.some(([name]) => name === "diagnostics_send")).toBe(false);
  });
  it("records locally without any delivery before approval", async () => {
    const { performanceApi, getLatestReport } = await import("./performance-api");
    performanceApi.startRecording();
    await performanceApi.stopRecording();
    expect(getLatestReport()?.kind).toBe("recording");
    expect(invoke.mock.calls.every(([name]) => name === "benchmark_environment")).toBe(true);
  });
  it("sends aggregate recordings after approval, including when no view subscribes", async () => {
    const { performanceApi } = await import("./performance-api");
    const { instrumentBackend } = await import("./performance-recording");
    const backend = instrumentBackend({ openFolder: async (_path: string) => true });
    await performanceApi.approve();
    performanceApi.startRecording();
    await backend.openFolder("/private/photo.jpg");
    await performanceApi.stopRecording();
    await vi.waitFor(() => expect(performanceApi.reportingState().sending).toBe(false));
    const send = invoke.mock.calls.find(([name]) => name === "diagnostics_send")?.[1];
    expect(send.approval).toBe("approval-1");
    expect(send).not.toHaveProperty("webhookToken");
    expect(send).not.toHaveProperty("ntfyToken");
    expect(send.report.stages[0].count).toBe(1);
    expect(JSON.stringify(send.report)).not.toMatch(/private|photo\.jpg|samplesMs|Token/);
    expect(performanceApi.reportingState().result?.webhook.status).toBe("sent");
    expect(performanceApi.reportingState().reportKind).toBe("recording");
  });
  it("revokes consent immediately and keeps further recordings local", async () => {
    const { performanceApi } = await import("./performance-api");
    await performanceApi.approve();
    const disabling = performanceApi.disableReporting();
    expect(performanceApi.reportingState().approved).toBe(false);
    await disabling;
    performanceApi.startRecording();
    await performanceApi.stopRecording();
    expect(invoke.mock.calls.some(([name]) => name === "diagnostics_send")).toBe(false);
  });
  it("uses the exact native payload preview without approving or sending", async () => {
    const { performanceApi } = await import("./performance-api");
    const { diagnosticReport } = await import("./performance");
    const preview = await performanceApi.previewPayload(diagnosticReport(await performanceApi.previewReport()));
    expect(preview).toEqual({ webhookJson: "exact-json", ntfyMessage: "exact-message" });
    const args = invoke.mock.calls.find(([name]) => name === "diagnostics_preview")?.[1];
    expect(Object.keys(args)).toEqual(["report"]);
    expect(invoke.mock.calls.some(([name]) => name === "diagnostics_send" || name === "diagnostics_approve")).toBe(false);
  });
  it("keeps a finished recording available when delivery fails", async () => {
    const { performanceApi, getLatestReport } = await import("./performance-api");
    const { instrumentBackend } = await import("./performance-recording");
    await performanceApi.approve();
    invoke.mockImplementation(async (command: string) => {
      if (command === "benchmark_environment") return environment;
      if (command === "diagnostics_send") throw new Error("secret internal endpoint error");
    });
    performanceApi.startRecording();
    await instrumentBackend({ openFolder: async () => true }).openFolder();
    await expect(performanceApi.stopRecording()).resolves.toMatchObject({ kind: "recording" });
    expect(getLatestReport()?.kind).toBe("recording");
    await vi.waitFor(() => expect(performanceApi.reportingState().error).toBe("Diagnostic delivery failed. Check the approved destinations and retry."));
  });
  it("does not send empty recordings after approval", async () => {
    const { performanceApi } = await import("./performance-api");
    await performanceApi.approve();
    performanceApi.startRecording();
    await performanceApi.stopRecording();
    expect(invoke.mock.calls.some(([name]) => name === "diagnostics_send")).toBe(false);
  });
  it("keeps an approved benchmark local unless the caller explicitly chooses submit", async () => {
    const { performanceApi, getLatestReport } = await import("./performance-api");
    invoke.mockImplementation(async (command: string) => {
      if (command === "benchmark_environment") return environment;
      if (command === "diagnostics_configuration") return { webhookConfigured: true, ntfyUrl: "https://ntfy.sh/culltivate-perf", logsUrl: "https://ntfy.sh/culltivate-logs" };
      if (command === "diagnostics_approve") return "approval-1";
      if (command === "benchmark_start") return "local-run";
      if (command === "benchmark_status") return { runId: "local-run", state: "completed", completed: 1, total: 1, current: null, report: benchmarkReport("local-run"), error: null };
      return undefined;
    });
    await performanceApi.approve();
    await performanceApi.start("thorough", false);
    await vi.waitFor(() => expect(getLatestReport()?.id).toBe("local-run"));
    await vi.waitFor(async () => expect(getLatestReport()?.stages.length).toBeGreaterThan(1));
    expect(invoke.mock.calls.some(([name]) => name === "diagnostics_send")).toBe(false);
  });
  it("automatically submits an explicitly requested benchmark after approval", async () => {
    const { performanceApi } = await import("./performance-api");
    invoke.mockImplementation(async (command: string) => {
      if (command === "benchmark_environment") return environment;
      if (command === "diagnostics_configuration") return { webhookConfigured: true, ntfyUrl: "https://ntfy.sh/culltivate-perf", logsUrl: "https://ntfy.sh/culltivate-logs" };
      if (command === "diagnostics_approve") return "approval-1";
      if (command === "benchmark_start") return "submit-run";
      if (command === "benchmark_status") return { runId: "submit-run", state: "completed", completed: 1, total: 1, current: null, report: benchmarkReport("submit-run"), error: null };
      if (command === "diagnostics_send") return { webhook: { status: "sent", error: null }, ntfy: { status: "sent", error: null } };
      return undefined;
    });
    await performanceApi.approve();
    await performanceApi.start("thorough", true);
    await vi.waitFor(() => expect(invoke.mock.calls.some(([name]) => name === "diagnostics_send")).toBe(true));
    const start = invoke.mock.calls.find(([name]) => name === "benchmark_start");
    expect(start?.[1]).toEqual({ mode: "thorough" });
  });
  it("requires approval before starting a benchmark intended for submission", async () => {
    const { performanceApi } = await import("./performance-api");
    await expect(performanceApi.start("thorough", true)).rejects.toThrow("Preview and approve diagnostic reporting");
    expect(invoke.mock.calls.some(([name]) => name === "benchmark_start" || name === "diagnostics_send")).toBe(false);
  });
  it("does not revive a submit choice when consent changes during benchmark startup", async () => {
    const { performanceApi, getLatestReport } = await import("./performance-api");
    let resolveStart!: (value: string) => void;
    let approvedCount = 0;
    invoke.mockImplementation(async (command: string) => {
      if (command === "benchmark_environment") return environment;
      if (command === "diagnostics_configuration") return { webhookConfigured: true, ntfyUrl: "https://ntfy.sh/culltivate-perf", logsUrl: "https://ntfy.sh/culltivate-logs" };
      if (command === "diagnostics_approve") return `approval-${++approvedCount}`;
      if (command === "benchmark_start") return new Promise<string>((resolve) => { resolveStart = resolve; });
      if (command === "benchmark_status") return { runId: "stale-consent-run", state: "completed", completed: 1, total: 1, current: null, report: benchmarkReport("stale-consent-run"), error: null };
      if (command === "diagnostics_send") return { webhook: { status: "sent", error: null }, ntfy: { status: "sent", error: null } };
      return undefined;
    });
    await performanceApi.approve();
    const starting = performanceApi.start("thorough", true);
    await vi.waitFor(() => expect(resolveStart).toBeTypeOf("function"));
    await performanceApi.disableReporting();
    await performanceApi.approve();
    resolveStart("stale-consent-run");
    await starting;
    await vi.waitFor(() => expect(getLatestReport()?.id).toBe("stale-consent-run"));
    await vi.waitFor(async () => expect(getLatestReport()?.stages.length).toBeGreaterThan(1));
    expect(invoke.mock.calls.some(([name]) => name === "diagnostics_send")).toBe(false);
  });
  it("marks a report cancelled when frontend checks are cancelled after native completion", async () => {
    const { performanceApi, getLatestReport } = await import("./performance-api");
    let resume!: () => void;
    const yieldWork = vi.fn(() => new Promise<void>((resolve) => { resume = resolve; }));
    vi.stubGlobal("scheduler", { yield: yieldWork });
    try {
      invoke.mockImplementation(async (command: string) => {
        if (command === "benchmark_start") return "frontend-cancel";
        if (command === "benchmark_status") return { runId: "frontend-cancel", state: "completed", completed: 1, total: 1, current: null,
          report: { ...benchmarkReport("frontend-cancel"), outcome: "completed" }, error: null };
      });
      const runId = await performanceApi.start("thorough");
      await vi.waitFor(() => expect(yieldWork).toHaveBeenCalled());
      await performanceApi.cancel(runId);
      expect(getLatestReport()?.outcome).toBe("cancelled");
      resume();
      await Promise.resolve();
      expect(invoke.mock.calls.some(([name]) => name === "diagnostics_send")).toBe(false);
    } finally {
      resume?.();
      vi.unstubAllGlobals();
    }
  });
  it("does not submit if cancellation races with native benchmark completion", async () => {
    const { performanceApi, getLatestReport } = await import("./performance-api");
    let resolveStatus!: (value: unknown) => void;
    let resolveCancel!: () => void;
    invoke.mockImplementation(async (command: string) => {
      if (command === "benchmark_environment") return environment;
      if (command === "diagnostics_configuration") return { webhookConfigured: true, ntfyUrl: "https://ntfy.sh/culltivate-perf", logsUrl: "https://ntfy.sh/culltivate-logs" };
      if (command === "diagnostics_approve") return "approval-1";
      if (command === "benchmark_start") return "cancel-race-run";
      if (command === "benchmark_status") return new Promise((resolve) => { resolveStatus = resolve; });
      if (command === "benchmark_cancel") return new Promise<void>((resolve) => { resolveCancel = resolve; });
      return undefined;
    });
    await performanceApi.approve();
    const runId = await performanceApi.start("thorough", true);
    await vi.waitFor(() => expect(resolveStatus).toBeTypeOf("function"));
    const cancelling = performanceApi.cancel(runId);
    await vi.waitFor(() => expect(resolveCancel).toBeTypeOf("function"));
    resolveStatus({ runId, state: "completed", completed: 1, total: 1, current: null, report: benchmarkReport(runId), error: null });
    await vi.waitFor(async () => expect(getLatestReport()?.stages.length).toBeGreaterThan(1));
    await vi.waitFor(() => expect(invoke.mock.calls.some(([name]) => name === "diagnostics_send")).toBe(false));
    resolveCancel();
    await cancelling;
    expect(invoke.mock.calls.some(([name]) => name === "diagnostics_send")).toBe(false);
  });
  it("finishes saving while delivery is pending and ignores its result after disable", async () => {
    const { performanceApi } = await import("./performance-api");
    const { instrumentBackend } = await import("./performance-recording");
    await performanceApi.approve();
    let delivered!: (value: unknown) => void;
    invoke.mockImplementation(async (command: string) => {
      if (command === "benchmark_environment") return environment;
      if (command === "diagnostics_send") return new Promise((resolve) => { delivered = resolve; });
    });
    performanceApi.startRecording();
    await instrumentBackend({ openFolder: async () => true }).openFolder();
    await expect(performanceApi.stopRecording()).resolves.toMatchObject({ kind: "recording" });
    await vi.waitFor(() => expect(performanceApi.reportingState().sending).toBe(true));
    await performanceApi.disableReporting();
    delivered({ webhook: { status: "sent", error: null }, ntfy: { status: "disabled", error: null } });
    await Promise.resolve();
    expect(performanceApi.reportingState()).toMatchObject({ approved: false, sending: false, result: null });
  });
  it("recovers a native run after a failed progress request", async () => {
    const { performanceApi, getLatestReport } = await import("./performance-api");
    let checks = 0;
    invoke.mockImplementation(async (command: string) => {
      if (command === "diagnostics_configuration") return { webhookConfigured: true, ntfyUrl: "https://ntfy.sh/culltivate-perf", logsUrl: "https://ntfy.sh/culltivate-logs" };
      if (command === "diagnostics_approve") return "approval-1";
      if (command === "benchmark_start") return "recover-run";
      if (command === "benchmark_status") {
        if (++checks === 1) throw new Error("temporary IPC failure");
        return { runId: "recover-run", state: "completed", completed: 1, total: 1, current: null, report: benchmarkReport("recover-run"), error: null };
      }
      if (command === "diagnostics_send") return { webhook: { status: "sent", error: null }, ntfy: { status: "sent", error: null } };
    });
    await performanceApi.approve();
    await performanceApi.start("quick");
    await Promise.resolve();
    await expect(performanceApi.status()).resolves.toMatchObject({ state: "completed", error: null });
    expect(checks).toBe(2);
    expect(getLatestReport()?.id).toBe("recover-run");
    expect(invoke.mock.calls.some(([name]) => name === "diagnostics_send")).toBe(false);
  });
  it("sends a submitted benchmark once after recovering a transient progress failure", async () => {
    const { performanceApi, getLatestReport, subscribePerformance } = await import("./performance-api");
    let checks = 0;
    let notices = 0;
    invoke.mockImplementation(async (command: string) => {
      if (command === "diagnostics_configuration") return { webhookConfigured: true, ntfyUrl: "https://ntfy.sh/culltivate-perf", logsUrl: "https://ntfy.sh/culltivate-logs" };
      if (command === "diagnostics_approve") return "approval-1";
      if (command === "benchmark_start") return "recover-submit-run";
      if (command === "benchmark_status") {
        if (++checks === 1) throw new Error("temporary IPC failure");
        return { runId: "recover-submit-run", state: "completed", completed: 1, total: 1, current: null, report: benchmarkReport("recover-submit-run"), error: null };
      }
      if (command === "diagnostics_send") return { webhook: { status: "sent", error: null }, ntfy: { status: "sent", error: null } };
    });
    await performanceApi.approve();
    const unsubscribe = subscribePerformance(() => { notices++; });
    await performanceApi.start("thorough", true);
    await vi.waitFor(() => expect(notices).toBeGreaterThanOrEqual(2));
    await expect(performanceApi.status()).resolves.toMatchObject({ state: "completed", error: null });
    await vi.waitFor(() => expect(performanceApi.reportingState().result?.webhook.status).toBe("sent"));
    await performanceApi.status();
    expect(checks).toBe(2);
    expect(getLatestReport()?.id).toBe("recover-submit-run");
    expect(invoke.mock.calls.filter(([name]) => name === "diagnostics_send")).toHaveLength(1);
    unsubscribe();
  });
});
