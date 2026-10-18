import type { StageSummary } from "@/lib/performance";
import { ETC_COLOR, FUNCTION_COLORS } from "./lospec500";
import { RECORDED_OPERATION_IDS } from "./performance-recording";

export const ETC_THRESHOLD_MS = 1_000;

export interface TimingSegment {
  id: string;
  label: string;
  totalMs: number;
  sharePercent: number;
  color: string;
  stage?: StageSummary;
}

export interface TimingBreakdown {
  totalMs: number;
  functions: TimingSegment[];
  minorFunctions: TimingSegment[];
  etc: TimingSegment | null;
}

/**
 * Summarize measured cumulative stage time for the overview. Stages below one
 * second stay available in the expandable list but share one bar segment.
 */
export function timingBreakdown(stages: readonly StageSummary[]): TimingBreakdown {
  const measured = stages.filter((stage) =>
    stage.status !== "skipped" && Number.isFinite(stage.totalMs) && stage.totalMs > 0,
  ).sort((left, right) => right.totalMs - left.totalMs || left.id.localeCompare(right.id));
  const totalMs = measured.reduce((sum, stage) => sum + stage.totalMs, 0);
  const toSegment = (stage: StageSummary): TimingSegment => ({
    id: stage.id,
    label: stage.label,
    totalMs: stage.totalMs,
    sharePercent: totalMs > 0 ? stage.totalMs / totalMs * 100 : 0,
    color: colorForStage(stage.id),
    stage,
  });
  const major = measured.filter((stage) => stage.totalMs >= ETC_THRESHOLD_MS);
  const minor = measured.filter((stage) => stage.totalMs < ETC_THRESHOLD_MS);
  const minorTotal = minor.reduce((sum, stage) => sum + stage.totalMs, 0);

  return {
    totalMs,
    functions: major.map(toSegment),
    minorFunctions: minor.map(toSegment),
    etc: minorTotal > 0 ? {
      id: "etc",
      label: "etc",
      totalMs: minorTotal,
      sharePercent: minorTotal / totalMs * 100,
      color: ETC_COLOR,
    } : null,
  };
}

/** A deterministic color for a function across reports and sort orders. */
export function colorForStage(id: string): string {
  const knownIndex = KNOWN_STAGES.indexOf(id);
  if (knownIndex >= 0) return FUNCTION_COLORS[knownIndex];
  const recordedColor = RECORDING_COLORS.get(id);
  if (recordedColor) return recordedColor;
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return FUNCTION_COLORS[(hash >>> 0) % FUNCTION_COLORS.length];
}

// Fixed IDs keep known fixture colors unique and independent of report ordering.
const KNOWN_STAGES = [
  "scan-pairing", "ingest-scan", "session-history", "metadata-probe", "capture-time", "sidecar-read",
  "preview-thumbnail-cold", "preview-fit-cold", "preview-screen-cold", "preview-thumbnail-warm", "preview-fit-warm",
  "preview-screen-warm", "preview-full", "image-decode", "portrait-orientation", "histogram",
  "face-analysis-cold", "face-analysis-warm", "advanced-face-cold", "advanced-face-warm", "motion-blur",
  "burst-grouping", "marks-sidecar-write", "crop-sidecar-write", "ingest-copy", "ship-copy-conflicts", "cache-trim",
  "ai-result-cache-save", "ai-result-cache-load", "preview-foreground-under-load",
  "frontend.review", "frontend.scene", "frontend.resume", "frontend.crop",
];

const RECORDING_COLORS = (() => {
  // Shared IDs (currently histogram) retain their native color. Reserve those
  // slots before assigning the other operations so no recording swatches clash.
  const used = new Set(RECORDED_OPERATION_IDS.map((id) => KNOWN_STAGES.indexOf(id)).filter((index) => index >= 0));
  const colors = new Map<string, string>();
  let next = 0;
  for (const id of RECORDED_OPERATION_IDS) {
    let index = KNOWN_STAGES.indexOf(id);
    if (index < 0) {
      while (used.has(next)) next++;
      index = next++;
      used.add(index);
    }
    colors.set(id, FUNCTION_COLORS[index % FUNCTION_COLORS.length]);
  }
  return colors;
})();
