import { describe, expect, it } from "vitest";
import { diagnosticReport, ntfySummary, rankedStages, recommendations, stageScoreMs, summarizeStage, type BenchmarkReport, type StageMeasurement } from "./performance";

const stage = (values: number[], extra: Partial<StageMeasurement> = {}): StageMeasurement => ({
  id: "preview.fit.cold", label: "Fit preview", category: "preview", cache: "cold", samplesMs: values,
  units: values.length, bytes: 0, failures: 0, status: "passed", detail: null, ...extra,
});
export const exampleReport = (stages: StageMeasurement[] = []): BenchmarkReport => ({
  schemaVersion: 1, id: "example", kind: "benchmark", mode: "quick", startedAtMs: 0, finishedAtMs: 100,
  environment: { appVersion: "test", build: "debug", os: "linux", arch: "x86_64", cpu: null, logicalCores: 4,
    memoryMb: null, gpu: null, aiProvider: null, fixtureVersion: "test" }, stages, coverage: [],
});

describe("performance reports", () => {
  it("scores average milliseconds per run, independently of median and repeat count", () => {
    const summary = summarizeStage(stage([10, 10, 100, NaN, -1]));
    expect(stageScoreMs(summary)).toBe(40);
    expect(summary.medianMs).toBe(10);
    expect(stageScoreMs(summarizeStage(stage([10, 10, 100, 10, 10, 100])))).toBe(40);
    expect(stageScoreMs(summarizeStage(stage([])))).toBeNull();
    const report = exampleReport([stage([10, 10, 100]), stage([30, 30, 30], { id: "steady" })]);
    expect(rankedStages(report, "score")[0].id).toBe("preview.fit.cold");
    expect(rankedStages(report, "latency")[0].id).toBe("steady");
  });
  it("keeps notification previews to three stages and one short suggestion", () => {
    const report = diagnosticReport(exampleReport(Array.from({ length: 5 }, (_, i) => stage([100 + i], { id: `test-${i}`, label: `Stage ${i}` }))));
    report.environment.cpu = "CPU should stay out of the short message";
    report.recommendations = Array.from({ length: 3 }, () => ({ stageId: "test-0", priority: "high" as const, action: "a".repeat(300), evidence: "Verbose evidence should stay out" }));
    const summary = ntfySummary(report);
    expect(summary.match(/^- Stage /gm)).toHaveLength(3);
    expect(summary.match(/^- Suggestion:/gm)).toHaveLength(1);
    expect(summary).toContain(report.systemId);
    expect(summary).not.toMatch(/Verbose evidence|CPU should/);
    expect(summary.length).toBeLessThan(1_000);
  });
  it("uses finite samples, an even median, and hides unreliable p95", () => {
    const summary = summarizeStage(stage([8, 2, NaN, Infinity, -2]));
    expect(summary).toMatchObject({ count: 2, totalMs: 10, medianMs: 5, maxMs: 8, p95Ms: null });
    expect(summarizeStage(stage(Array.from({ length: 20 }, (_, i) => i + 1))).p95Ms).toBe(19);
  });
  it("separates total workload cost from typical latency and excludes skipped cases", () => {
    const report = exampleReport([stage([10, 10, 10]), stage([25], { id: "slow" }), stage([100], { id: "skipped", status: "skipped" })]);
    expect(rankedStages(report, "total").map((s) => s.id)).toEqual(["preview.fit.cold", "slow"]);
    expect(rankedStages(report, "latency").map((s) => s.id)).toEqual(["slow", "preview.fit.cold"]);
  });
  it("excludes raw details, samples and unexpected fields from delivery", () => {
    const input = exampleReport([stage([10], { detail: "/Photos/private.jpg failed" })]);
    Object.assign(input, { photo: "secret.jpg" });
    Object.assign(input.environment, { hostname: "private-machine" });
    const json = JSON.stringify(diagnosticReport(input));
    expect(json).not.toMatch(/private|secret|samplesMs|detail|hostname/);
    expect(JSON.parse(json).stages[0].count).toBe(1);
    expect(JSON.parse(json)).toMatchObject({ schemaVersion: 2, systemId: expect.stringMatching(/^[a-z]+-[a-z]+-\d{6}$/) });
  });
  it("prioritizes reliability failures even without completed samples", () => {
    const suggestions = recommendations(exampleReport([stage([], { failures: 2, status: "failed" })]));
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].priority).toBe("high");
  });
  it("ties suggestions to measured latency and matched cache tiers", () => {
    expect(recommendations(exampleReport([stage([1])]))).toEqual([]);
    const suggestions = recommendations(exampleReport([stage([100]), stage([1], { id: "preview.fit.warm", cache: "warm" })]));
    expect(suggestions.some((s) => /Cache reuse/.test(s.action))).toBe(true);
    expect(suggestions.every((s) => s.evidence.length > 0)).toBe(true);
  });
  it("keeps portrait decoding suggestions separate from AI inference", () => {
    const portrait = recommendations(exampleReport([stage([160], { id: "portrait-orientation", category: "decode" })]));
    expect(portrait[0].action).toContain("decoding");
    expect(portrait[0].action).not.toContain("model");
    expect(recommendations(exampleReport([stage([160], { id: "face-analysis-warm", category: "ai" })]))[0].action).toContain("model");
    expect(recommendations(exampleReport([stage([160], { id: "ai-result-cache-load", category: "ai-cache" })]))[0].action).not.toContain("model");
  });
});
