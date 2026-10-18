import type { StageSummary } from "@/lib/performance";

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
      color: "var(--muted-foreground)",
    } : null,
  };
}

/** A deterministic color for a function across reports and sort orders. */
export function colorForStage(id: string): string {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const hue = (hash >>> 0) % 360;
  return `hsl(${hue} 68% 46%)`;
}
