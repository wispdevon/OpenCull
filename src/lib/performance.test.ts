import { describe, expect, it } from "vitest";
import bundledDatabase from "../../benchmarks/typical-speeds.json";
import hardwareCatalogueJSON from "../../benchmarks/hardware-specifications.json";
import { rateHardware, type HardwareCatalogue } from "./hardware-ratings";
import { diagnosticReport, ntfySummary, rankedStages, recommendations, stageScoreMs, summarizeStage, type BenchmarkReport, type StageMeasurement } from "./performance";

const hardwareCatalogue = hardwareCatalogueJSON as HardwareCatalogue;
const knownHardware = {
  cpuModel: "AMD Ryzen 5 7500F 6-Core Processor",
  gpuModel: "NVIDIA GeForce RTX 3060 Ti",
  installedMemoryMb: 32 * 1024,
};

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
  it("projects outcome and inference counters with an explicit allowlist", () => {
    const measured = {
      ...stage([12]),
      inference: { cudaCalls: 7, cpuCalls: 3, cpuFallbackCalls: 2, private: "discard me" },
    } as unknown as StageMeasurement;
    const source = Object.assign(exampleReport([measured]), {
      outcome: "completed",
      performanceScores: { scoringVersion: 1, databaseVersion: "untrusted", cohortId: "secret", system: { value: 999, reason: null, referenceId: "secret" }, gpu: {} },
      hardwareRatings: { formulaVersion: 1, catalogueVersion: "untrusted", system: { value: 999, reason: null }, gpu: {} },
    });
    source.environment.hardwareSpecs = { ...knownHardware, systemSerial: "private serial" } as typeof knownHardware;
    const projected = diagnosticReport(source);

    expect(projected).toMatchObject({ schemaVersion: 4, outcome: "completed" });
    expect(projected.stages[0].inference).toEqual({ cudaCalls: 7, cpuCalls: 3, cpuFallbackCalls: 2 });
    expect(projected.environment.hardwareSpecs).toEqual(knownHardware);
    expect(projected.hardwareRatings).toEqual(rateHardware(knownHardware, hardwareCatalogue));
    expect(projected.hardwareRatings).toMatchObject({
      system: { value: 2063, reason: null },
      gpu: { value: 1372, reason: null },
    });
    expect(projected.performanceScores).toMatchObject({
      scoringVersion: 1,
      databaseVersion: bundledDatabase.version,
      cohortId: null,
      system: { value: null, reason: "unsupported-report", referenceId: null },
      gpu: { value: null, reason: "unsupported-report", referenceId: null },
    });
    expect(JSON.stringify(projected)).not.toMatch(/discard me|private|serial|untrusted|secret/);

    const legacy = diagnosticReport(exampleReport());
    expect(legacy.outcome).toBeNull();
    expect(legacy.hardwareRatings).toEqual(rateHardware({ cpuModel: null, gpuModel: null, installedMemoryMb: null }, hardwareCatalogue));
    expect(legacy.hardwareRatings.system).toEqual({ value: null, reason: "unknown-cpu" });
    expect(legacy.hardwareRatings.gpu).toEqual({ value: null, reason: "unknown-gpu" });
  });
  it("keeps notification previews to three stages and one short suggestion", () => {
    const report = diagnosticReport(exampleReport(Array.from({ length: 5 }, (_, i) => stage([100 + i], { id: `test-${i}`, label: `Stage ${i}` }))));
    report.environment.cpu = "AMD Ryzen 5 7500F";
    report.recommendations = Array.from({ length: 3 }, () => ({ stageId: "test-0", priority: "high" as const, action: "a".repeat(300), evidence: "Verbose evidence should stay out" }));
    const summary = ntfySummary(report);
    expect(summary.match(/^- Stage /gm)).toHaveLength(3);
    expect(summary.match(/^- Suggestion:/gm)).toHaveLength(1);
    expect(summary).toContain(report.systemId);
    expect(summary).not.toMatch(/Verbose evidence/);
    expect(summary).toContain("CPU: AMD Ryzen 5 7500F");
    expect(new TextEncoder().encode(summary).length).toBeLessThanOrEqual(1_900);
  });
  it("records all visible environment fields, elapsed and measured totals", () => {
    const source = exampleReport([stage([10, 10, 100]), stage([500], { status: "skipped" })]);
    source.environment = { appVersion: "0.7.0", build: "debug turbo-jpeg cuda", os: "linux", arch: "x86_64", cpu: "AMD Ryzen 5 7500F", logicalCores: 12, memoryMb: 31616, gpu: "NVIDIA GeForce RTX 3060 Ti", aiProvider: "CUDA", fixtureVersion: "4-6000x4000-texture-gpu-ai" };
    const message = ntfySummary(diagnosticReport(source));
    for (const value of ["v0.7.0", "debug turbo-jpeg cuda", "linux / x86_64", "AMD Ryzen 5 7500F", "12 cores", "31616 MB", "NVIDIA GeForce RTX 3060 Ti", "AI: CUDA", "4-6000x4000-texture-gpu-ai", "0.1 s elapsed", "0.1 s measured", "1 stages", "40.0 ms score", "10.0 ms typical"]) expect(message).toContain(value);
  });
  it("summarizes fixed hardware ratings and does not label timing indexes as hardware scores", () => {
    const source = exampleReport([stage([100], { label: "Slow stage" })]);
    source.environment.hardwareSpecs = knownHardware;
    const report = diagnosticReport(source);
    const message = ntfySummary(report);
    expect(message.indexOf("- Hardware rating: formula v1 · catalogue 1.0.0")).toBeLessThan(message.indexOf("- Slow stage:"));
    expect(message).toContain("- System hardware rating: 2063");
    expect(message).toContain("- GPU hardware rating: 1372");
    expect(message).not.toContain("- System score:");
    expect(message).not.toContain("- GPU score:");
  });
  it("bounds large Unicode notification previews without splitting characters", () => {
    const report = diagnosticReport(exampleReport(Array.from({ length: 3 }, (_, i) => stage([1], { id: String(i), label: "顔".repeat(120) }))));
    Object.assign(report.environment, { cpu: "顔".repeat(100), gpu: "顔".repeat(100), aiProvider: "顔".repeat(100) });
    const message = ntfySummary(report);
    expect(new TextEncoder().encode(message).length).toBeLessThanOrEqual(1900);
    expect(message).not.toContain("\uFFFD");
    expect(message).toContain("App: vtest");
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
    expect(JSON.parse(json)).toMatchObject({ schemaVersion: 4, systemId: expect.stringMatching(/^[a-z]+-[a-z]+-\d{6}$/) });
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
