import { expect, it } from "vitest";
import { highestScoringFace } from "./face-target";
import type { AiFace } from "./types";

const photo = { fullWidth: 6000, fullHeight: 4000, framing: { turn: 1, crop: null } };
const face = (sharpness: number | null, subject = true, x = 0.2) => ({ x, y: 0.2, w: 0.1, h: 0.1, sharpness, subject }) as AiFace;
it("targets the highest scored subject rather than a sharper background face", () => {
  const best = face(80);
  expect(highestScoringFace([face(20), face(99, false), best], photo)).toBe(best);
});
it("uses background faces when no scored subjects exist and keeps ties stable", () => {
  const best = face(80, false);
  expect(highestScoringFace([best, face(80, false)], photo)).toBe(best);
});
it("falls back for unavailable, invalid, unscored or cropped-out faces", () => {
  expect(highestScoringFace([], photo)).toBeNull();
  expect(highestScoringFace([face(null), face(NaN), face(99, true, 2)], photo)).toBeNull();
  expect(highestScoringFace([face(80)], { ...photo, fullWidth: 0 })).toBeNull();
  const cropped = { ...photo, framing: { turn: 1, crop: { cx: 4500, cy: 2000, w: 1800, h: 2000, angle: 0 } } };
  expect(highestScoringFace([face(99)], cropped)).toBeNull();
});
