import { describe, expect, it } from "vitest";
import { compactWorkload, interpretStage } from "./performance-interpretation";
import { summarizeStage, type BenchmarkReport, type StageSummary } from "./performance";

const report: BenchmarkReport = {
  schemaVersion: 1, id: "test", kind: "benchmark", mode: "thorough", startedAtMs: 0, finishedAtMs: 100,
  environment: { appVersion: "test", build: "debug", os: "linux", arch: "x86_64", cpu: null, logicalCores: 4,
    memoryMb: null, gpu: null, aiProvider: "CPU", fixtureVersion: "3-6000x4000-texture-ai-cache" }, stages: [], coverage: [],
};
function stage(id: string, ms = 10, count = 24, perRun = 1): StageSummary {
  return summarizeStage({ id, label: id, category: "test", cache: "none", samplesMs: Array(count).fill(ms), units: count * perRun,
    bytes: 0, failures: 0, status: "passed", detail: null });
}

describe("benchmark interpretation", () => {
  it("keeps compact workloads accurate for reused photos, batches and recordings", () => {
    expect(compactWorkload(stage("portrait-orientation"), report)).toBe("1 reused photo · 24 MP · 24 runs");
    expect(compactWorkload(stage("scan-pairing", 10, 24, 50), report)).toBe("50 photo entries × 24 runs");
    expect(compactWorkload(stage("ingest-copy", 10, 3, 4), report)).toBe("4 RAW/JPEG pairs × 3 runs");
    expect(compactWorkload(stage("openFolder", 10, 3), { ...report, kind: "recording" })).toBe("3 requests · photo count unknown");
  });
  it("counts completed photo entry visits separately from unique scenes and repeated runs", () => {
    const scan = interpretStage(stage("scan-pairing", 10, 24, 50), report);
    expect(scan.workload).toContain("50 photo entries");
    expect(scan.workload).toContain("1200 entry visits");
    expect(scan.workload).toContain("same set is reused");
    expect(scan.guidance?.basis).toBe("per 50-entry batch");
    expect(scan.throughputUnit).toBe("entries");
    expect(interpretStage(stage("scan-pairing", 10, 2, 14), { ...report, mode: "quick" }).workload).toContain("28 entry visits");
  });
  it("describes repeated decode and inference fixtures without inflating unique photo counts", () => {
    expect(interpretStage(stage("portrait-orientation"), report).workload).toContain("24 MP");
    expect(interpretStage(stage("image-decode"), report).workload).toContain("not 24 different photos");
    expect(interpretStage(stage("face-analysis-cold", 100, 1), report).workload).toContain("512 × 512");
    expect(interpretStage(stage("histogram"), report).workload).toContain("thumbnail of the 24 MP texture");
    expect(interpretStage(stage("preview-foreground-under-load"), report).workload).toContain("not included in the foreground photo count");
  });
  it("uses pair, cache entry and record counts instead of calling all units photos", () => {
    expect(interpretStage(stage("ingest-copy", 1, 3, 4), report)).toMatchObject({ throughputUnit: "pairs", workload: expect.stringContaining("4 RAW/JPEG pairs (8 image files") });
    expect(interpretStage(stage("cache-trim", 1, 24, 8), report)).toMatchObject({ throughputUnit: "entries", workload: expect.stringContaining("no photo decode") });
    expect(interpretStage(stage("ai-result-cache-load"), report)).toMatchObject({ throughputUnit: "records", workload: expect.stringContaining("no image decode or inference") });
    expect(interpretStage(stage("session-history"), report).workload).toContain("no photos processed");
  });
  it("rates average latency rather than cumulative time and handles budget boundaries", () => {
    expect(interpretStage(stage("image-decode", 150), report).assessment).toBe("good");
    expect(interpretStage(stage("image-decode", 151), report).assessment).toBe("watch");
    expect(interpretStage(stage("image-decode", 750), report).assessment).toBe("alarming");
    expect(interpretStage(stage("preview-fit-warm", 50), report).assessment).toBe("alarming");
    expect(interpretStage(stage("advanced-face-cold", 50), report).assessment).toBe("good");
  });
  it("includes slow outliers in the score rating even when the typical run is fast", () => {
    const samples = summarizeStage({ id: "portrait-orientation", label: "Portrait", category: "decode", cache: "none",
      samplesMs: [100, 100, 3_000], units: 3, bytes: 0, failures: 0, status: "passed", detail: null });
    expect(samples.medianMs).toBe(100);
    expect(interpretStage(samples, report).assessment).toBe("alarming");
  });
  it("flags reliability independently and explains tentative and tail-latency readings", () => {
    expect(interpretStage({ ...stage("image-decode"), failures: 1 }, report).assessment).toBe("failed");
    expect(interpretStage({ ...stage("openFolder"), failures: 1 }, { ...report, kind: "recording" }).explanation).toContain("include failed attempts");
    expect(interpretStage(stage("face-analysis-cold", 100, 1), report).explanation).toContain("tentative");
    expect(interpretStage({ ...stage("image-decode"), p95Ms: 900 }, report).explanation).toContain("occasional stalls");
  });
  it("does not infer photo counts or speed ratings from real request recordings or unknown fixtures", () => {
    for (const context of [{ ...report, kind: "recording" as const }, { ...report, environment: { ...report.environment, fixtureVersion: "future-unknown" } }]) {
      expect(interpretStage(stage("image-decode"), context)).toMatchObject({ guidance: null, assessment: "unrated", workload: expect.stringContaining("photo count was not recorded") });
    }
    expect(interpretStage(stage("unknown-operation"), report).guidance).toBeNull();
    expect(interpretStage(stage("image-decode", 0, 0), report).guidance).toBeNull();
  });
  it("labels frontend batches as logic runs rather than decoded photos", () => {
    const demo = { ...report, mode: "quick" as const, environment: { ...report.environment, fixtureVersion: "frontend-1" } };
    expect(interpretStage(stage("frontend.review", 1, 5), demo)).toMatchObject({ throughputUnit: "runs", workload: expect.stringContaining("1,000 synthetic photo records") });
    expect(interpretStage(stage("frontend.crop", 1, 5), demo).workload).toContain("8 orientation/placement iterations");
  });
});


it("recognizes accelerated fixture workloads without changing photo counts", () => {
  const accelerated = { ...report, environment: { ...report.environment, fixtureVersion: "4-6000x4000-texture-gpu-ai", aiProvider: "CUDA" } };
  const stage = summarizeStage({ id: "face-analysis-warm", label: "Face analysis", category: "ai", cache: "warm", samplesMs: [20, 30, 40], units: 3, bytes: 0, failures: 0, status: "passed", detail: null });
  const interpreted = interpretStage(stage, accelerated);
  expect(interpreted.assessment).toBe("good");
  expect(interpreted.workload).toContain("3 completed runs");
  expect(compactWorkload(stage, accelerated)).toBe("1 reused photo · 512 × 512 · 3 runs");
});
