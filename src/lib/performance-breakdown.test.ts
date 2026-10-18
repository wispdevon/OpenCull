import { describe, expect, it } from "vitest";

import { colorForStage, timingBreakdown } from "./performance-breakdown";
import type { StageSummary } from "./performance";
import { ETC_COLOR, FUNCTION_COLORS, LOSPEC500 } from "./lospec500";
import { RECORDED_OPERATION_IDS } from "./performance-recording";

function summary(id: string, totalMs: number, status: StageSummary["status"] = "passed"): StageSummary {
  return {
    id,
    label: id,
    category: "test",
    cache: "none",
    units: 1,
    bytes: 0,
    failures: 0,
    status,
    count: 1,
    totalMs,
    medianMs: totalMs,
    maxMs: totalMs,
    p95Ms: null,
    throughputPerSecond: 1_000 / totalMs,
  };
}

describe("timing breakdown", () => {
  it("uses only bundled Lospec500 colors, including the reserved etc color", () => {
    expect(LOSPEC500).toHaveLength(42);
    expect(new Set(FUNCTION_COLORS).size).toBe(FUNCTION_COLORS.length);
    expect(FUNCTION_COLORS).not.toContain(ETC_COLOR);
    for (const id of ["image-decode", "portrait-orientation", "frontend.review", "unknown-function"]) {
      expect(LOSPEC500).toContain(colorForStage(id));
    }
    expect(timingBreakdown([summary("small", 10)]).etc?.color).toBe(ETC_COLOR);
  });
  it("assigns a different stable palette color to every recorded operation", () => {
    expect(RECORDED_OPERATION_IDS.length).toBeLessThanOrEqual(FUNCTION_COLORS.length);
    const colors = RECORDED_OPERATION_IDS.map(colorForStage);
    expect(new Set(colors).size).toBe(RECORDED_OPERATION_IDS.length);
    expect(colors.every((color) => color !== ETC_COLOR)).toBe(true);
  });
  it("groups each stage below one second into etc and keeps exactly one second separate", () => {
    const breakdown = timingBreakdown([
      summary("small-a", 250),
      summary("threshold", 1_000),
      summary("small-b", 750),
      summary("skipped", 4_000, "skipped"),
    ]);

    expect(breakdown.totalMs).toBe(2_000);
    expect(breakdown.functions.map(({ id }) => id)).toEqual(["threshold"]);
    expect(breakdown.minorFunctions.map(({ id }) => id)).toEqual(["small-b", "small-a"]);
    expect(breakdown.etc).toMatchObject({ totalMs: 1_000, sharePercent: 50, label: "etc" });
    expect(breakdown.functions[0].sharePercent).toBe(50);
  });

  it("keeps each function separate if every stage reaches the threshold", () => {
    const breakdown = timingBreakdown([summary("first", 1_000), summary("second", 1_250)]);

    expect(breakdown.functions.map(({ id }) => id)).toEqual(["second", "first"]);
    expect(breakdown.minorFunctions).toEqual([]);
    expect(breakdown.etc).toBeNull();
  });

  it("assigns stable, distinct colors to the measured functions", () => {
    const first = timingBreakdown([summary("scan", 1_100), summary("preview", 2_100)]);
    const reordered = timingBreakdown([summary("preview", 2_100), summary("scan", 1_100)]);
    const colors = new Map(first.functions.map(({ id, color }) => [id, color]));

    expect(colorForStage("scan")).toBe(colorForStage("scan"));
    expect(reordered.functions.map(({ id, color }) => [id, color])).toEqual(
      first.functions.map(({ id, color }) => [id, color]),
    );
    expect(colors.get("scan")).not.toBe(colors.get("preview"));
  });

  it("returns an empty overview when no positive completed measurements exist", () => {
    expect(timingBreakdown([summary("zero", 0), summary("skipped", 2_000, "skipped")])).toEqual({
      totalMs: 0,
      functions: [],
      minorFunctions: [],
      etc: null,
    });
  });
});
