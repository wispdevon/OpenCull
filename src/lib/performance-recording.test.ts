import { afterEach, describe, expect, it } from "vitest";
import { beginRecording, finishRecording, instrumentBackend, recordingActive } from "./performance-recording";
import { diagnosticReport, type PerformanceEnvironment } from "./performance";

const environment: PerformanceEnvironment = { appVersion: "test", build: "debug", os: "test", arch: "test", cpu: null,
  logicalCores: 1, memoryMb: null, gpu: null, aiProvider: null, fixtureVersion: "test" };
afterEach(() => { if (recordingActive()) finishRecording(environment); });
describe("opt-in bounded recording", () => {
  it("passes the original promise through when disabled", () => {
    const expected = Promise.resolve("ok");
    const backend = instrumentBackend({ openFolder: () => expected });
    expect(backend.openFolder()).toBe(expected);
  });
  it("records fixed operation names and failures without arguments or raw errors", async () => {
    const backend = instrumentBackend({ openFolder: async (_path: string) => "ok", ship: async () => { throw new Error("/private/photo.jpg denied"); } });
    beginRecording();
    await backend.openFolder("/private/photo.jpg");
    await expect(backend.ship()).rejects.toThrow("denied");
    const report = finishRecording(environment);
    expect(report.stages.map((s) => [s.id, s.failures])).toEqual([["openFolder", 0], ["ship", 1]]);
    expect(JSON.stringify(diagnosticReport(report))).not.toMatch(/private|photo\.jpg|denied/);
  });
  it("caps measured calls and preserves consistent units and failures", async () => {
    const backend = instrumentBackend({ openFolder: async () => "ok" });
    beginRecording();
    for (let i = 0; i < 600; i++) await backend.openFolder();
    const report = finishRecording(environment);
    expect(report.stages[0].samplesMs).toHaveLength(500);
    expect(report.stages[0].units).toBe(500);
  });
  it("does not attach late completions to a newer recording", async () => {
    let resolve!: () => void;
    const backend = instrumentBackend({ openFolder: () => new Promise<void>((done) => { resolve = done; }) });
    beginRecording();
    const request = backend.openFolder();
    finishRecording(environment);
    beginRecording();
    resolve();
    await request;
    expect(finishRecording(environment).stages).toEqual([]);
  });
  it("preserves synchronous exceptions", () => {
    const error = new Error("failed");
    const backend = instrumentBackend({ openFolder: () => { throw error; } });
    beginRecording();
    expect(() => backend.openFolder()).toThrow(error);
    expect(finishRecording(environment).stages[0].failures).toBe(1);
  });
});
