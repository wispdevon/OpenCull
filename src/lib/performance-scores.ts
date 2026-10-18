import type { HardwareIdentity, HardwareRatings } from "./hardware-ratings";
import type { BenchmarkReport, DiagnosticReport, StageMeasurement, StageSummary } from "./performance";

/** Changing fixtures, scored work or weights requires a new scoring version. */
export const SCORING_VERSION = 1;
export const SCORE_FIXTURE_VERSION = "4-6000x4000-texture-gpu-ai";
export const SYSTEM_WEIGHTS = Object.freeze({
  "preview-thumbnail-cold": .15,
  "preview-fit-cold": .25,
  "image-decode": .20,
  "portrait-orientation": .20,
  "scan-pairing": .10,
  "ingest-copy": .10,
});
export const GPU_WEIGHTS = Object.freeze({ "face-analysis-warm": .5, "advanced-face-warm": .5 });
const AI_INFERENCE_STAGES = ["face-analysis-cold", "face-analysis-warm", "advanced-face-cold", "advanced-face-warm"];

/** Exact fixture-4 native Thorough workload; frontend supplements are optional. */
export const THOROUGH_STAGE_SAMPLES = Object.freeze({
  "scan-pairing": 24,
  "ingest-scan": 24,
  "session-history": 24,
  "metadata-probe": 24,
  "capture-time": 24,
  "sidecar-read": 24,
  "preview-thumbnail-cold": 24,
  "preview-thumbnail-warm": 24,
  "preview-fit-cold": 24,
  "preview-fit-warm": 24,
  "preview-screen-cold": 24,
  "preview-screen-warm": 24,
  "preview-foreground-under-load": 24,
  "preview-full": 24,
  "image-decode": 24,
  "portrait-orientation": 24,
  "histogram": 24,
  "face-analysis-cold": 1,
  "face-analysis-warm": 5,
  "ai-result-cache-save": 24,
  "ai-result-cache-load": 24,
  "advanced-face-cold": 1,
  "advanced-face-warm": 3,
  "motion-blur": 24,
  "burst-grouping": 24,
  "marks-sidecar-write": 24,
  "crop-sidecar-write": 24,
  "ingest-copy": 24,
  "ship-copy-conflicts": 24,
  "cache-trim": 24,
});
export const FRONTEND_STAGE_SAMPLES: Readonly<Record<string, number>> = Object.freeze({
  "frontend.review": 20, "frontend.scene": 20, "frontend.resume": 20, "frontend.crop": 20,
});
export const FRONTEND_STAGE_UNITS: Readonly<Record<string, number>> = Object.freeze(
  Object.fromEntries(Object.keys(FRONTEND_STAGE_SAMPLES).map((id) => [id, 1])),
);
const BATCH_UNITS: Readonly<Record<string, number>> = Object.freeze({
  "scan-pairing": 50, "ingest-scan": 50, "burst-grouping": 50, "ingest-copy": 4, "cache-trim": 8,
});
/** Completed work units per sample, multiplied by sample count in each report. */
export const THOROUGH_STAGE_UNITS: Readonly<Record<string, number>> = Object.freeze(
  Object.fromEntries(Object.keys(THOROUGH_STAGE_SAMPLES).map((id) => [id, BATCH_UNITS[id] ?? 1])),
);

export interface ScoreCohort {
  os: string; arch: string; build: string; fixtureVersion: string;
}
export interface ScoreReference {
  id: string;
  cohort: ScoreCohort;
  runCount: number;
  installationCount: number;
  /** Frozen median of per-run arithmetic averages, in milliseconds. */
  system: Record<string, number>;
  gpu: Record<string, number> | null;
  provenance: { sourceCommit: string; collectedAt: string; method: string };
}
export interface TypicalStageStatistics {
  meanAverageMs: number;
  medianAverageMs: number;
  minAverageMs: number;
  maxAverageMs: number;
  runCount: number;
}
export interface TypicalSystem {
  /** Independent hardware-specification annotations, never derived from timings. */
  hardwareSpecs?: HardwareIdentity;
  hardwareRatings?: HardwareRatings;
  id: string;
  cohort: ScoreCohort;
  appVersion: string;
  cpu: string | null;
  logicalCores: number;
  memoryMb: number | null;
  gpu: string | null;
  aiProvider: string | null;
  runCount: number;
  installationCount: number;
  stages: Record<string, TypicalStageStatistics>;
  systemScore: number | null;
  gpuScore: number | null;
}
export interface TypicalDatabase {
  schemaVersion: 1;
  scoringVersion: 1;
  version: string;
  sourceUrl: string;
  references: ScoreReference[];
  systems: TypicalSystem[];
}
export type ScoreUnavailableReason =
  | "unsupported-report" | "incomplete-report" | "invalid-measurements"
  | "unmatched-cohort" | "invalid-reference" | "gpu-not-measured" | "gpu-fallback";
export interface ScoreResult {
  /** Dimensionless index, rounded to an integer in 1..1e9; higher is faster. */
  value: number | null;
  reason: ScoreUnavailableReason | null;
  referenceId: string | null;
}
export interface PerformanceScores {
  scoringVersion: 1;
  databaseVersion: string;
  /** The matched frozen reference ID; appVersion is deliberately not a cohort key. */
  cohortId: string | null;
  system: ScoreResult;
  /** CUDA-assisted photo AI pipeline, including CPU preparation and CPU graph operators. */
  gpu: ScoreResult;
}

interface MeasuredStage { averageMs: number; inference: unknown }
type Measurements = { stages: Map<string, MeasuredStage>; reason: null } | { stages: null; reason: ScoreUnavailableReason };
const positive = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;
const nonnegative = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const nonnegativeInteger = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const unavailable = (reason: ScoreUnavailableReason): ScoreResult => ({ value: null, reason, referenceId: null });

function measurements(report: BenchmarkReport | DiagnosticReport): Measurements {
  const stages = new Map<string, MeasuredStage>();
  if (!Array.isArray(report.stages)) return { stages: null, reason: "invalid-measurements" };
  const expected: Readonly<Record<string, number>> = THOROUGH_STAGE_SAMPLES;
  for (const stage of report.stages) {
    if (!stage || typeof stage.id !== "string" || stages.has(stage.id)) return { stages: null, reason: "invalid-measurements" };
    const native = Object.hasOwn(expected, stage.id);
    const required = native ? expected[stage.id] : Object.hasOwn(FRONTEND_STAGE_SAMPLES, stage.id) ? FRONTEND_STAGE_SAMPLES[stage.id] : undefined;
    if (required === undefined) return { stages: null, reason: "invalid-measurements" };
    if (stage.status !== "passed" || stage.failures !== 0) return { stages: null, reason: "incomplete-report" };
    const timing = average(stage, !native);
    if (!timing || !nonnegativeInteger(stage.units) || !nonnegativeInteger(stage.bytes)) return { stages: null, reason: "invalid-measurements" };
    if (timing.count < required) return { stages: null, reason: "incomplete-report" };
    if (timing.count > required || stage.units !== required * (native ? THOROUGH_STAGE_UNITS[stage.id] : FRONTEND_STAGE_UNITS[stage.id])) return { stages: null, reason: "invalid-measurements" };
    stages.set(stage.id, { averageMs: timing.mean, inference: "inference" in stage ? stage.inference : undefined });
  }
  if (Object.keys(expected).some((id) => !stages.has(id))) return { stages: null, reason: "incomplete-report" };
  return { stages, reason: null };
}

/** Do not import the browser diagnostic adapter: this module also runs directly in Node. */
function average(stage: StageMeasurement | StageSummary, allowZero: boolean): { count: number; mean: number } | null {
  const validTiming = allowZero ? nonnegative : positive;
  if ("samplesMs" in stage) {
    if (!Array.isArray(stage.samplesMs) || !stage.samplesMs.every(validTiming)) return null;
    const count = stage.samplesMs.length;
    if (count === 0) return { count, mean: 0 };
    const total = stage.samplesMs.reduce((sum, value) => sum + value, 0);
    return validTiming(total) && validTiming(total / count) ? { count, mean: total / count } : null;
  }
  if (stage.count === 0 && stage.totalMs === 0 && stage.medianMs === 0 && stage.maxMs === 0) return { count: 0, mean: 0 };
  if (!nonnegativeInteger(stage.count) || stage.count === 0 || !validTiming(stage.totalMs)
    || !validTiming(stage.medianMs) || !validTiming(stage.maxMs)
    || stage.medianMs > stage.maxMs || stage.maxMs > stage.totalMs
    || (stage.p95Ms !== null && (!validTiming(stage.p95Ms) || stage.p95Ms > stage.maxMs))) return null;
  const mean = stage.totalMs / stage.count;
  return validTiming(mean) && mean <= stage.maxMs * (1 + 1e-12) ? { count: stage.count, mean } : null;
}

function matches(cohort: ScoreCohort | undefined, environment: ScoreCohort): boolean {
  return !!cohort && cohort.os === environment.os && cohort.arch === environment.arch
    && cohort.build === environment.build && cohort.fixtureVersion === environment.fixtureVersion;
}

function validBaseline(values: Record<string, number> | null | undefined, weights: Readonly<Record<string, number>>): values is Record<string, number> {
  return !!values && Object.keys(weights).every((id) => Object.hasOwn(values, id) && positive(values[id]));
}

function index(stages: Map<string, MeasuredStage>, baseline: Record<string, number>, weights: Readonly<Record<string, number>>, referenceId: string): ScoreResult {
  const logRatio = Object.entries(weights).reduce((sum, [id, weight]) => sum + weight * (Math.log(baseline[id]) - Math.log(stages.get(id)!.averageMs)), 0);
  const value = Math.round(1000 * Math.exp(logRatio));
  return Number.isSafeInteger(value) && value >= 1 && value <= 1e9 ? { value, reason: null, referenceId } : unavailable("invalid-measurements");
}

function gpuEvidence(stages: Map<string, MeasuredStage>): ScoreUnavailableReason | null {
  let cpu = 0, cuda = 0, fallback = 0;
  for (const { inference } of stages.values()) {
    if (inference === undefined) continue;
    if (!inference || typeof inference !== "object") return "invalid-measurements";
    const usage = inference as Record<string, unknown>;
    if (!nonnegativeInteger(usage.cudaCalls) || !nonnegativeInteger(usage.cpuCalls) || !nonnegativeInteger(usage.cpuFallbackCalls)
      || usage.cpuFallbackCalls > usage.cpuCalls) return "invalid-measurements";
    cuda += usage.cudaCalls; cpu += usage.cpuCalls; fallback += usage.cpuFallbackCalls;
  }
  if (AI_INFERENCE_STAGES.some((id) => stages.get(id)!.inference === undefined)) return "gpu-not-measured";
  if (fallback > 0 || (cuda > 0 && cpu > 0)) return "gpu-fallback";
  for (const id of Object.keys(GPU_WEIGHTS)) {
    const usage = stages.get(id)!.inference as { cudaCalls: number; cpuCalls: number; cpuFallbackCalls: number } | undefined;
    if (!usage || usage.cudaCalls === 0) return "gpu-not-measured";
  }
  return null;
}

/** Pure, offline scoring. Public fleet statistics never move the frozen index-1000 anchor. */
export function scoreReport(report: BenchmarkReport | DiagnosticReport, database: TypicalDatabase): PerformanceScores {
  const result: PerformanceScores = { scoringVersion: SCORING_VERSION, databaseVersion: database?.version ?? "", cohortId: null,
    system: unavailable("unsupported-report"), gpu: unavailable("unsupported-report") };
  const fail = (reason: ScoreUnavailableReason): PerformanceScores => ({ ...result, system: unavailable(reason), gpu: unavailable(reason) });
  if (report.kind !== "benchmark" || report.mode !== "thorough" || report.environment?.fixtureVersion !== SCORE_FIXTURE_VERSION) return result;
  if (!("outcome" in report) || report.outcome !== "completed") return fail("incomplete-report");
  if (!nonnegativeInteger(report.startedAtMs) || !nonnegativeInteger(report.finishedAtMs) || report.finishedAtMs <= report.startedAtMs) return fail("invalid-measurements");
  const measured = measurements(report);
  if (measured.reason !== null) return fail(measured.reason);
  if (!database || database.schemaVersion !== 1 || database.scoringVersion !== SCORING_VERSION
    || typeof database.version !== "string" || !database.version.trim() || !Array.isArray(database.references)) return fail("invalid-reference");
  const candidates = database.references.filter((reference) => matches(reference?.cohort, report.environment));
  if (candidates.length === 0) return fail("unmatched-cohort");
  if (candidates.length !== 1) return fail("invalid-reference");
  const reference = candidates[0];
  if (typeof reference.id !== "string" || !reference.id.trim() || !nonnegativeInteger(reference.runCount) || reference.runCount < 3
    || !nonnegativeInteger(reference.installationCount) || reference.installationCount < 1 || reference.installationCount > reference.runCount
    || !validBaseline(reference.system, SYSTEM_WEIGHTS)) return fail("invalid-reference");
  result.cohortId = reference.id;
  result.system = index(measured.stages, reference.system, SYSTEM_WEIGHTS, reference.id);
  const evidence = gpuEvidence(measured.stages);
  result.gpu = evidence ? unavailable(evidence)
    : !validBaseline(reference.gpu, GPU_WEIGHTS) ? unavailable("invalid-reference")
    : index(measured.stages, reference.gpu, GPU_WEIGHTS, reference.id);
  return result;
}
