import type { BenchmarkReport, StageSummary } from "./performance";

export interface StageInterpretation {
  workload: string;
  throughputUnit: string;
  guidance: { goodMs: number; alarmingMs: number; basis: string } | null;
  assessment: "good" | "watch" | "alarming" | "failed" | "unrated";
  explanation: string;
}

// Product investigation budgets, not population percentiles or hardware claims.
// Based on the fixture work in benchmark.rs and the local baselines documented
// in tasks/performance-measurements.md. Keep ranges broad across systems.
const BUDGETS: Record<string, [number, number]> = {
  "scan-pairing": [50, 500], "ingest-scan": [50, 500], "session-history": [20, 250],
  "metadata-probe": [5, 100], "capture-time": [5, 100], "sidecar-read": [5, 100],
  "preview-thumbnail-cold": [80, 300], "preview-fit-cold": [150, 500], "preview-screen-cold": [100, 400],
  "preview-thumbnail-warm": [5, 50], "preview-fit-warm": [5, 50], "preview-screen-warm": [5, 50],
  "preview-foreground-under-load": [200, 1_000], "preview-full": [20, 200],
  "image-decode": [150, 750], "portrait-orientation": [250, 1_000], "histogram": [10, 100],
  "face-analysis-cold": [1_000, 5_000], "face-analysis-warm": [100, 1_000],
  "advanced-face-cold": [2_000, 10_000], "advanced-face-warm": [250, 2_000],
  "motion-blur": [50, 500], "ai-result-cache-save": [20, 250], "ai-result-cache-load": [5, 100],
  "burst-grouping": [20, 250], "marks-sidecar-write": [20, 250], "crop-sidecar-write": [20, 250],
  "ingest-copy": [100, 2_000], "ship-copy-conflicts": [100, 2_000], "cache-trim": [20, 250],
  "frontend.review": [8, 50], "frontend.scene": [8, 50], "frontend.resume": [8, 50], "frontend.crop": [2, 16],
};

export function interpretStage(stage: StageSummary, report: BenchmarkReport): StageInterpretation {
  const result: StageInterpretation = {
    workload: `${stage.count} completed ${report.kind === "recording" ? "request timings" : "timed runs"}; photo count was not recorded.`,
    throughputUnit: report.kind === "recording" ? "requests" : "units", guidance: null, assessment: "unrated",
    explanation: "No comparable fixture budget. Compare repeated runs on this system with the same workload.",
  };
  // Real request timings have unknown batch sizes; never pretend each call is a photo.
  const frontend = stage.id.startsWith("frontend.");
  const knownFixture = ["2-6000x4000-texture", "3-6000x4000-texture-ai-cache"].includes(report.environment.fixtureVersion);
  if (report.kind === "benchmark" && (knownFixture || frontend && report.environment.fixtureVersion === "frontend-1")) {
    const perRun = stage.count > 0 ? stage.units / stage.count : 0;
    const runs = `${stage.count} completed ${stage.count === 1 ? "run" : "runs"}`;
    let basis = "per run";
    if (["scan-pairing", "ingest-scan", "burst-grouping"].includes(stage.id)) {
      const source = stage.id === "burst-grouping" ? "synthetic photo records" : "photo entries (RAW/JPEG pairs count as one)";
      result.workload = `${perRun} ${source} per run × ${runs} = ${stage.units} entry visits. The same set is reused.`;
      result.throughputUnit = "entries";
      basis = `per ${perRun}-entry batch`;
    } else if (stage.id === "ingest-copy" || stage.id === "ship-copy-conflicts") {
      result.workload = `${perRun} RAW/JPEG ${perRun === 1 ? "pair" : "pairs"} (${perRun * 2} image files, plus sidecars) per run × ${runs} = ${stage.units} pair copies. The same source set is reused.`;
      result.throughputUnit = "pairs";
      basis = `per ${perRun}-pair batch`;
    } else if (stage.id === "cache-trim") {
      result.workload = `${perRun} seeded cache entries per run × ${runs} = ${stage.units} entries; no photo decode.`;
      result.throughputUnit = "entries";
      basis = `per ${perRun}-entry cache`;
    } else if (stage.id === "session-history") {
      result.workload = `One empty session save/history round trip per run × ${runs}; no photos processed.`;
      result.throughputUnit = "round trips";
    } else if (frontend) {
      const entries = report.mode === "thorough" ? "10,000" : "1,000";
      result.workload = stage.id === "frontend.crop"
        ? `8 orientation/placement iterations per run × ${runs}; geometry only, no photo pixels.`
        : `${entries} synthetic ${stage.id === "frontend.resume" ? "session records" : "photo records"} per run × ${runs}; logic only, no photo pixels.`;
      // Frontend units count invocations, not records visited.
      result.throughputUnit = "runs";
      basis = stage.id === "frontend.crop" ? "per 8-iteration run" : `per ${entries}-record run`;
    } else if (["ai-result-cache-save", "ai-result-cache-load"].includes(stage.id)) {
      result.workload = `One generated photo-analysis record per run × ${runs}; no image decode or inference.`;
      result.throughputUnit = "records";
      basis = "per record";
    } else if (Object.hasOwn(BUDGETS, stage.id)) {
      const large = /^(preview-|image-decode$|portrait-orientation$)/.test(stage.id);
      const image = stage.id === "histogram" ? "320-tier thumbnail of the 24 MP texture" : large ? "6000 × 4000 (24 MP) textured fixture" : "512 × 512 astronaut fixture";
      const task = /sidecar/.test(stage.id) ? "sidecar operation" : stage.id === "histogram" ? "thumbnail histogram" : "photo operation";
      result.workload = `One reused ${image}; 1 ${task} per run × ${runs} = ${stage.units} operations. This is not ${stage.count} different photos.`;
      if (stage.id === "preview-foreground-under-load") result.workload += " A separate preview worker adds background load; it is not included in the foreground photo count.";
      result.throughputUnit = "operations";
      basis = `per ${task}`;
    }
    const budget = BUDGETS[stage.id];
    if (budget && stage.count > 0 && stage.status !== "skipped") {
      result.guidance = { goodMs: budget[0], alarmingMs: budget[1], basis };
      result.assessment = stage.medianMs >= budget[1] ? "alarming" : stage.medianMs <= budget[0] ? "good" : "watch";
      result.explanation = result.assessment === "alarming"
        ? "Typical latency exceeds this rough investigation budget. Repeat while idle, then profile this stage."
        : result.assessment === "good" ? "Typical latency is within this rough fixture budget."
        : "Between the rough targets; compare idle repeat runs before treating this as a problem.";
      if (stage.count < 5) result.explanation += " Fewer than 5 samples: tentative reading.";
      if (stage.p95Ms !== null && stage.p95Ms >= budget[1] && result.assessment !== "alarming") {
        result.explanation += " P95 reaches the investigation threshold even though the median does not; check occasional stalls.";
      }
    }
  }
  if (stage.failures > 0 || stage.status === "failed") {
    result.assessment = "failed";
    result.explanation = report.kind === "recording"
      ? "A request failed. Investigate reliability before judging its speed; recorded request timings include failed attempts."
      : "An operation or result check failed. Investigate reliability before judging its speed; a timed result can still fail validation.";
  }
  return result;
}
