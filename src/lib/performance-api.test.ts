import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
const environment = { appVersion: "test", build: "debug", os: "linux", arch: "x86_64", cpu: null,
  logicalCores: 2, memoryMb: null, gpu: null, aiProvider: null, fixtureVersion: "test" };
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
  it("approves distinct performance and log topics with the current system-ID schema", async () => {
    const { performanceApi } = await import("./performance-api");
    await performanceApi.approve();
    expect(invoke).toHaveBeenCalledWith("diagnostics_approve", {
      fieldsVersion: 2,
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
    const { performanceApi } = await import("./performance-api");
    let checks = 0;
    invoke.mockImplementation(async (command: string) => {
      if (command === "benchmark_start") return "recover-run";
      if (command === "benchmark_status") {
        if (++checks === 1) throw new Error("temporary IPC failure");
        return { runId: "recover-run", state: "completed", completed: 1, total: 1, current: null, report: null, error: null };
      }
    });
    await performanceApi.start("quick");
    await Promise.resolve();
    await expect(performanceApi.status()).resolves.toMatchObject({ state: "completed", error: null });
    expect(checks).toBe(2);
  });
});
