import { describe, expect, it } from "vitest";
import { rateHardware, type HardwareCatalogue } from "./hardware-ratings";
import hardwareCatalogue from "../../benchmarks/hardware-specifications.json";
import type { BenchmarkReport, DiagnosticReport, StageMeasurement, StageSummary } from "./performance";
import {
  GPU_WEIGHTS, SCORE_FIXTURE_VERSION, SYSTEM_WEIGHTS, THOROUGH_STAGE_SAMPLES,
  scoreReport, type ScoreUnavailableReason, type TypicalDatabase,
} from "./performance-scores";

type CompletedReport = BenchmarkReport & { outcome: "completed" | "cancelled" | "failed" };
type Inference = { cudaCalls: number; cpuCalls: number; cpuFallbackCalls: number };
type EvidenceStage = StageMeasurement & { inference?: Inference };
const aiStages = ["face-analysis-cold", "face-analysis-warm", "advanced-face-cold", "advanced-face-warm"];
const unitsPerRun: Record<string, number> = { "scan-pairing": 50, "ingest-scan": 50, "burst-grouping": 50, "ingest-copy": 4, "cache-trim": 8 };

function report(cuda = false): CompletedReport {
  return {
    schemaVersion: 3, id: "local-run", kind: "benchmark", mode: "thorough", outcome: "completed",
    startedAtMs: 1, finishedAtMs: 30_001,
    environment: { appVersion: "0.7.0", build: "release", os: "linux", arch: "x86_64", cpu: "Example CPU",
      logicalCores: 8, memoryMb: 16_384, gpu: cuda ? "NVIDIA Example" : null, aiProvider: cuda ? "CUDA" : "CPU", fixtureVersion: SCORE_FIXTURE_VERSION },
    stages: Object.entries(THOROUGH_STAGE_SAMPLES).map(([id, count]) => ({
      id, label: id, category: "test", cache: "none", samplesMs: Array(count).fill(10),
      units: count * (unitsPerRun[id] ?? 1), bytes: 0, failures: 0, status: "passed", detail: null,
      ...(aiStages.includes(id) ? { inference: { cudaCalls: cuda ? count : 0, cpuCalls: cuda ? 0 : count, cpuFallbackCalls: 0 } } : {}),
    })), coverage: [],
  };
}

function database(): TypicalDatabase {
  return {
    schemaVersion: 1, scoringVersion: 1, version: "2026-10-18.1", sourceUrl: "https://example.org/benchmarks/typical-speeds.json",
    references: [{ id: "linux-x86_64-release-fixture4", cohort: { os: "linux", arch: "x86_64", build: "release", fixtureVersion: SCORE_FIXTURE_VERSION },
      runCount: 3, installationCount: 1,
      system: Object.fromEntries(Object.keys(SYSTEM_WEIGHTS).map((id) => [id, 10])),
      gpu: Object.fromEntries(Object.keys(GPU_WEIGHTS).map((id) => [id, 10])),
      provenance: { sourceCommit: "abc123", collectedAt: "2026-10-18", method: "Three compiler-idle desktop runs; other desktop activity uncontrolled." } }],
    systems: [],
  };
}

function summary(input: CompletedReport): DiagnosticReport {
  return {
    ...input, systemId: "local-installation", recommendations: [], performanceScores: scoreReport(input, database()),
    hardwareRatings: rateHardware(input.environment.hardwareSpecs ?? { cpuModel: null, gpuModel: null, installedMemoryMb: null }, hardwareCatalogue as HardwareCatalogue),
    stages: input.stages.map((stage): StageSummary => {
      const { samplesMs, detail: _detail, ...rest } = stage;
      const values = [...samplesMs].sort((a, b) => a - b);
      return { ...rest, count: values.length, totalMs: values.reduce((a, b) => a + b, 0),
        medianMs: (values[Math.floor((values.length - 1) / 2)] + values[Math.floor(values.length / 2)]) / 2,
        maxMs: values[values.length - 1], p95Ms: values.length >= 20 ? values[Math.ceil(values.length * .95) - 1] : null,
        throughputPerSecond: stage.units * 1000 / values.reduce((a, b) => a + b, 0) };
    }),
  };
}

function expectUnavailable(input: BenchmarkReport | DiagnosticReport, reason: ScoreUnavailableReason, db = database()) {
  const scores = scoreReport(input, db);
  expect(scores.system).toMatchObject({ value: null, reason });
  expect(scores.gpu).toMatchObject({ value: null, reason });
}

describe("fixed benchmark score protocol", () => {
  it("anchors an eligible report at 1000 and doubles when its scored work is twice as fast", () => {
    const input = report(true);
    expect(Object.keys(THOROUGH_STAGE_SAMPLES)).toHaveLength(30);
    expect(scoreReport(input, database())).toMatchObject({ scoringVersion: 1, databaseVersion: "2026-10-18.1", cohortId: "linux-x86_64-release-fixture4",
      system: { value: 1000, reason: null, referenceId: "linux-x86_64-release-fixture4" }, gpu: { value: 1000, reason: null } });
    for (const stage of input.stages) stage.samplesMs = stage.samplesMs.map((v) => v / 2);
    expect(scoreReport(input, database()).system.value).toBe(2000);
    expect(scoreReport(input, database()).gpu.value).toBe(2000);
    for (const stage of input.stages) stage.samplesMs = stage.samplesMs.map((v) => v * 4);
    expect(scoreReport(input, database()).system.value).toBe(500);
  });

  it("uses fixed geometric weights and arithmetic mean per run, preserving slow outliers", () => {
    const input = report(true);
    const decode = input.stages.find((stage) => stage.id === "image-decode")!;
    decode.samplesMs = Array(23).fill(5).concat(125); // Mean 10, median 5.
    expect(scoreReport(input, database()).system.value).toBe(1000);
    decode.samplesMs = Array(24).fill(5);
    expect(scoreReport(input, database()).system.value).toBe(Math.round(1000 * 2 ** .2));
    const basic = input.stages.find((stage) => stage.id === "face-analysis-warm")!;
    basic.samplesMs.fill(2.5);
    expect(scoreReport(input, database()).gpu.value).toBe(2000);
  });

  it("scores raw and aggregate reports identically without mutating either input", () => {
    const input = report(true), db = database();
    input.stages[0].samplesMs[0] = 100;
    const before = structuredClone({ input, db });
    expect(scoreReport(summary(input), db)).toEqual(scoreReport(input, db));
    expect({ input, db }).toEqual(before);
  });

  it("keeps the non-AI system score independent of inference provider and GPU speed", () => {
    const input = report();
    expect(scoreReport(input, database())).toMatchObject({ system: { value: 1000 }, gpu: { value: null, reason: "gpu-not-measured" } });
    const cuda = report(true);
    for (const stage of cuda.stages.filter((stage) => aiStages.includes(stage.id))) stage.samplesMs.fill(1000);
    expect(scoreReport(cuda, database()).system.value).toBe(1000);
  });

  it("requires a completed native Thorough run with the recognized fixture", () => {
    for (const outcome of [undefined, "cancelled", "failed"] as const) {
      const input = { ...report(), outcome } as BenchmarkReport;
      expectUnavailable(input, "incomplete-report");
    }
    expectUnavailable({ ...report(), mode: "quick" }, "unsupported-report");
    expectUnavailable({ ...report(), kind: "recording", mode: null }, "unsupported-report");
    const input = report(); input.environment.fixtureVersion = "frontend-1";
    expectUnavailable(input, "unsupported-report");
  });

  it("requires all 30 native stages and their exact sample counts", () => {
    const missing = report(); missing.stages.pop();
    expectUnavailable(missing, "incomplete-report");
    const partial = report(); partial.stages[0].samplesMs.pop(); partial.stages[0].units -= 50;
    expectUnavailable(partial, "incomplete-report");
    const extra = report(); extra.stages[0].samplesMs.push(10); extra.stages[0].units += 50;
    expectUnavailable(extra, "invalid-measurements");
  });

  it("allows complete frontend supplements without including them in the score", () => {
    const input = report();
    input.stages.push({ id: "frontend.review", label: "Review", category: "frontend", cache: "none", samplesMs: Array(20).fill(.001),
      units: 20, bytes: 0, failures: 0, status: "passed", detail: null });
    expect(scoreReport(input, database()).system.value).toBe(1000);
    input.stages.at(-1)!.samplesMs.pop(); input.stages.at(-1)!.units--;
    expectUnavailable(input, "incomplete-report");
  });

  it("preserves native scores when optional frontend timings round to zero", () => {
    const input = report(true);
    input.stages.push({ id: "frontend.scene", label: "Scene", category: "frontend", cache: "none", samplesMs: Array(20).fill(0),
      units: 20, bytes: 0, failures: 0, status: "passed", detail: null });
    expect(scoreReport(input, database())).toMatchObject({ system: { value: 1000 }, gpu: { value: 1000 } });
    expect(scoreReport(summary(input), database())).toEqual(scoreReport(input, database()));
    input.stages.at(-1)!.samplesMs[0] = -1;
    expectUnavailable(input, "invalid-measurements");
  });

  it("rejects duplicate, unknown, failed and skipped stages", () => {
    const duplicate = report(); duplicate.stages.push(structuredClone(duplicate.stages[0]));
    expectUnavailable(duplicate, "invalid-measurements");
    const unknown = report(); unknown.stages.push({ ...unknown.stages[0], id: "future-stage" });
    expectUnavailable(unknown, "invalid-measurements");
    for (const status of ["failed", "skipped"] as const) {
      const input = report(); input.stages[0].status = status;
      expectUnavailable(input, "incomplete-report");
    }
    const failure = report(); failure.stages[0].failures = 1;
    expectUnavailable(failure, "incomplete-report");
  });

  it("rejects nonpositive/nonfinite timings and mismatched fixture work", () => {
    for (const value of [0, -1, NaN, Infinity]) {
      const input = report(); input.stages[0].samplesMs[0] = value;
      expectUnavailable(input, "invalid-measurements");
    }
    const batch = report(); batch.stages[0].units = 24;
    expectUnavailable(batch, "invalid-measurements");
    const aggregate = summary(report()); aggregate.stages[0].count = 23.5;
    expectUnavailable(aggregate, "invalid-measurements");
    const overflow = report(); overflow.stages[0].samplesMs.fill(Number.MAX_VALUE);
    expectUnavailable(overflow, "invalid-measurements");
  });

  it("matches fixture/build/OS/architecture exactly while permitting future app versions", () => {
    for (const key of ["build", "os", "arch"] as const) {
      const input = report(); input.environment[key] = "different";
      expectUnavailable(input, "unmatched-cohort");
    }
    const input = report(); input.environment.appVersion = "0.8.0";
    expect(scoreReport(input, database()).system.value).toBe(1000);
  });

  it("requires typed CUDA evidence rather than trusting provider or device labels", () => {
    const input = report(true);
    for (const stage of input.stages as EvidenceStage[]) delete stage.inference;
    expect(scoreReport(input, database()).gpu).toMatchObject({ value: null, reason: "gpu-not-measured" });
    const mixed = report(true);
    (mixed.stages.find((stage) => stage.id === "face-analysis-warm")! as EvidenceStage).inference!.cpuCalls = 1;
    expect(scoreReport(mixed, database()).gpu).toMatchObject({ value: null, reason: "gpu-fallback" });
    const coldFallback = report(true);
    (coldFallback.stages.find((stage) => stage.id === "advanced-face-cold")! as EvidenceStage).inference!.cpuFallbackCalls = 1;
    (coldFallback.stages.find((stage) => stage.id === "advanced-face-cold")! as EvidenceStage).inference!.cpuCalls = 1;
    expect(scoreReport(coldFallback, database())).toMatchObject({ system: { value: 1000 }, gpu: { value: null, reason: "gpu-fallback" } });
  });

  it("does not score malformed CUDA counters or zero-CUDA warm stages", () => {
    for (const value of [-1, NaN, .5, Infinity]) {
      const input = report(true);
      (input.stages.find((stage) => stage.id === "face-analysis-warm")! as EvidenceStage).inference!.cudaCalls = value;
      expect(scoreReport(input, database()).gpu).toMatchObject({ value: null, reason: "invalid-measurements" });
      expect(scoreReport(input, database()).system.value).toBe(1000);
    }
    const input = report(true);
    (input.stages.find((stage) => stage.id === "advanced-face-warm")! as EvidenceStage).inference!.cudaCalls = 0;
    expect(scoreReport(input, database()).gpu).toMatchObject({ value: null, reason: "gpu-not-measured" });
    const invalidFallback = report(true);
    (invalidFallback.stages.find((stage) => stage.id === "advanced-face-warm")! as EvidenceStage).inference!.cpuFallbackCalls = 1;
    expect(scoreReport(invalidFallback, database()).gpu).toEqual({ value: null, reason: "invalid-measurements", referenceId: null });
  });

  it("requires inference evidence from all four native AI stages", () => {
    for (const id of aiStages) {
      const input = report(true);
      delete (input.stages.find((stage) => stage.id === id)! as EvidenceStage).inference;
      const expected = { system: { value: 1000 }, gpu: { value: null, reason: "gpu-not-measured", referenceId: null } };
      expect(scoreReport(input, database())).toMatchObject(expected);
      expect(scoreReport(summary(input), database())).toMatchObject(expected);
    }
  });

  it("rejects null or malformed cold-stage inference counters while preserving the system score", () => {
    for (const id of ["face-analysis-cold", "advanced-face-cold"]) {
      for (const inference of [null, { cudaCalls: 1, cpuFallbackCalls: 0 }]) {
        const input = report(true);
        Object.assign(input.stages.find((stage) => stage.id === id)!, { inference });
        const expected = { system: { value: 1000 }, gpu: { value: null, reason: "invalid-measurements", referenceId: null } };
        expect(scoreReport(input, database())).toMatchObject(expected);
        expect(scoreReport(summary(input), database())).toMatchObject(expected);
      }
    }
  });

  it("requires a unique complete frozen reference with at least three baseline runs", () => {
    for (const value of [0, -1, NaN, Infinity]) {
      const db = database(); db.references[0].system["image-decode"] = value;
      expectUnavailable(report(), "invalid-reference", db);
    }
    const missing = database(); delete missing.references[0].system["ingest-copy"];
    expectUnavailable(report(), "invalid-reference", missing);
    const few = database(); few.references[0].runCount = 2;
    expectUnavailable(report(), "invalid-reference", few);
    const duplicate = database(); duplicate.references.push(structuredClone(duplicate.references[0]));
    expectUnavailable(report(), "invalid-reference", duplicate);
    const absent = database(); absent.references = [];
    expectUnavailable(report(), "unmatched-cohort", absent);
  });

  it("keeps a valid system score when that cohort has no GPU baseline", () => {
    const db = database(); db.references[0].gpu = null;
    expect(scoreReport(report(true), db)).toMatchObject({ system: { value: 1000 }, gpu: { value: null, reason: "invalid-reference" } });
  });

  it("returns unavailable rather than fabricating an index outside the finite score range", () => {
    const input = report(true);
    for (const stage of input.stages) stage.samplesMs.fill(Number.MIN_VALUE);
    expectUnavailable(input, "invalid-measurements");
  });
});
