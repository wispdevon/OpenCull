/** Versioned, aggregate-only diagnostic schema. Never include photo identifiers. */
import { getSystemId } from "./performance-preferences";
export const FIELD_VERSION = 2;
export type BenchmarkMode = "quick" | "thorough";
export interface PerformanceEnvironment {
  appVersion: string; build: string; os: string; arch: string;
  cpu: string | null; logicalCores: number; memoryMb: number | null;
  gpu: string | null; aiProvider: string | null; fixtureVersion: string;
}
export interface StageMeasurement {
  id: string; label: string; category: string; cache: "cold" | "warm" | "none";
  samplesMs: number[]; units: number; bytes: number; failures: number;
  status: "passed" | "failed" | "skipped"; detail: string | null;
}
export interface CoverageEntry {
  id: string; label: string; status: "measured" | "skipped" | "manual"; reason: string | null;
}
export interface BenchmarkReport {
  schemaVersion: number; id: string; kind: "benchmark" | "recording"; mode: BenchmarkMode | null;
  startedAtMs: number; finishedAtMs: number; environment: PerformanceEnvironment;
  stages: StageMeasurement[]; coverage: CoverageEntry[];
}
export interface BenchmarkStatus {
  runId: string | null; state: "idle" | "running" | "completed" | "cancelled" | "failed";
  completed: number; total: number; current: string | null; report: BenchmarkReport | null; error: string | null;
}
export interface StageSummary extends Omit<StageMeasurement, "samplesMs" | "detail"> {
  count: number; totalMs: number; medianMs: number; maxMs: number; p95Ms: number | null;
  throughputPerSecond: number | null;
}
export interface Recommendation {
  stageId: string; priority: "high" | "medium" | "low"; evidence: string; action: string;
}
export interface DiagnosticReport extends Omit<BenchmarkReport, "stages"> {
  systemId: string; stages: StageSummary[]; recommendations: Recommendation[];
}
export interface DestinationResult { status: "sent" | "failed" | "disabled"; error: string | null }
export interface DeliveryResult { webhook: DestinationResult; ntfy: DestinationResult }

export function summarizeStage(stage: StageMeasurement): StageSummary {
  const samples = stage.samplesMs.filter((v) => Number.isFinite(v) && v >= 0).sort((a, b) => a - b);
  const count = samples.length;
  const totalMs = samples.reduce((sum, v) => sum + v, 0);
  return {
    id: stage.id, label: stage.label, category: stage.category, cache: stage.cache,
    units: stage.units, bytes: stage.bytes, failures: stage.failures, status: stage.status,
    count, totalMs,
    medianMs: count ? (samples[Math.floor((count - 1) / 2)] + samples[Math.floor(count / 2)]) / 2 : 0,
    maxMs: samples[count - 1] ?? 0,
    p95Ms: count >= 20 ? samples[Math.ceil(count * 0.95) - 1] : null,
    throughputPerSecond: totalMs > 0 && stage.units > 0 ? stage.units * 1000 / totalMs : null,
  };
}

/** Arithmetic mean in milliseconds per sampled run. */
export function stageScoreMs(stage: Pick<StageSummary, "totalMs" | "count">): number | null {
  return stage.count > 0 && Number.isFinite(stage.count) && Number.isFinite(stage.totalMs) ? stage.totalMs / stage.count : null;
}

export function rankedStages(report: BenchmarkReport, by: "total" | "latency" | "score"): StageSummary[] {
  return report.stages.map(summarizeStage).filter((s) => s.count > 0 && s.status !== "skipped")
    .sort((a, b) => (by === "total" ? b.totalMs - a.totalMs : by === "score" ? stageScoreMs(b)! - stageScoreMs(a)! : b.medianMs - a.medianMs) || a.id.localeCompare(b.id));
}

export function recommendations(report: BenchmarkReport): Recommendation[] {
  const result: Recommendation[] = [];
  const stages = rankedStages(report, "total");
  for (const stage of stages) {
    const evidence = `${stage.label}: ${stage.count} samples, median ${stage.medianMs.toFixed(1)} ms, max ${stage.maxMs.toFixed(1)} ms, ${stage.failures} failures.`;
    if (stage.failures) {
      result.push({ stageId: stage.id, priority: "high", evidence, action: "Investigate the categorized failures and add a regression case before optimizing this operation." });
    }
    const cold = stage.cache === "warm" ? stages.find((s) => s.cache === "cold" && s.id.replace(/[._-]cold$/, "") === stage.id.replace(/[._-]warm$/, "")) : undefined;
    if (cold && cold.medianMs > Math.max(1, stage.medianMs * 3)) {
      result.push({ stageId: stage.id, priority: "medium", evidence: `${evidence} Cold median ${cold.medianMs.toFixed(1)} ms.`, action: "Cache reuse is materially faster on these fixtures. Investigate missed cache hits and foreground prefetch behavior before changing cache limits." });
    }
    if (stage.medianMs >= 50) {
      const isAnalysis = stage.category === "ai" || stage.category === "grouping" || stage.id === "aiScan" || stage.id === "aiCompare";
      const action = isAnalysis
        ? "Profile model initialization, inference and provider fallback separately; compare bounded concurrency while preserving analysis results."
        : /preview|decode|histogram/.test(stage.category + stage.id)
          ? "Profile reading, decoding and resizing separately; compare cache reuse and available JPEG acceleration while checking identical orientation and dimensions."
          : /frontend/.test(stage.category)
            ? "Profile this interaction's main-thread work; test indexed lookups, bounded rendering or yielding, preserving navigation and ordering."
            : "Profile this stage to separate computation, filesystem work and waiting; compare one targeted change against repeated baseline runs.";
      result.push({ stageId: stage.id, priority: stage.medianMs >= 200 ? "high" : "medium", evidence, action });
    } else if (stage.count >= 20 && stage.p95Ms! > Math.max(10, stage.medianMs * 4)) {
      result.push({ stageId: stage.id, priority: "medium", evidence, action: "Investigate tail latency and contention with repeated runs; do not optimize from a single outlier." });
    }
  }
  // A failed operation can have no successful samples at all.
  for (const stage of report.stages.filter((s) => s.failures > 0 && s.samplesMs.length === 0)) {
    result.push({ stageId: stage.id, priority: "high", evidence: `${stage.label}: ${stage.failures} failures and no completed samples.`, action: "Resolve the failure and add a regression case before making performance comparisons." });
  }
  return result.sort((a, b) => ({ high: 0, medium: 1, low: 2 })[a.priority] - ({ high: 0, medium: 1, low: 2 })[b.priority]).slice(0, 12);
}

export function diagnosticReport(report: BenchmarkReport): DiagnosticReport {
  // Explicit field construction excludes unknown fields, samples and stage details.
  const e = report.environment;
  return {
    schemaVersion: FIELD_VERSION, systemId: getSystemId(), id: report.id, kind: report.kind, mode: report.mode,
    startedAtMs: report.startedAtMs, finishedAtMs: report.finishedAtMs,
    environment: { appVersion: e.appVersion, build: e.build, os: e.os, arch: e.arch, cpu: e.cpu,
      logicalCores: e.logicalCores, memoryMb: e.memoryMb, gpu: e.gpu, aiProvider: e.aiProvider, fixtureVersion: e.fixtureVersion },
    stages: report.stages.map(summarizeStage),
    coverage: report.coverage.map((c) => ({ id: c.id, label: c.label, status: c.status, reason: c.reason })),
    recommendations: recommendations(report),
  };
}

export function ntfySummary(report: DiagnosticReport): string {
  const failures = report.stages.reduce((n, s) => n + s.failures, 0);
  const slow = [...report.stages].filter((s) => s.count).sort((a, b) => b.totalMs - a.totalMs).slice(0, 3);
  return [
    `Culltivate ${report.kind}${report.mode ? ` (${report.mode})` : ""}`,
    `- System: ${report.systemId}`,
    `- Duration: ${Math.max(0, (report.finishedAtMs - report.startedAtMs) / 1000).toFixed(1)} s · ${failures} failures`,
    ...slow.map((s) => `- ${s.label}: ${(s.totalMs / 1000).toFixed(1)} s total · ${s.medianMs.toFixed(1)} ms/run`),
    ...report.recommendations.slice(0, 1).map((r) => `- Suggestion: ${Array.from(r.action).slice(0, 160).join("")}${Array.from(r.action).length > 160 ? "…" : ""}`),
  ].join("\n");
}
