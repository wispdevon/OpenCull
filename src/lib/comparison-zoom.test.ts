import { describe, expect, it } from "vitest";
import { shareZoom, receiveZoom } from "./comparison-zoom";

describe("linked comparison zoom", () => {
  it("matches enlargement and relative position across different image and pane sizes", () => {
    const shared = shareZoom({ scale: 4, x: 600, y: -300 }, { w: 600, h: 400 })!;
    expect(shared).toEqual({ scale: 4, x: 0.25, y: 0.6875 });
    const target = receiveZoom(shared, { w: 320, h: 480 });
    expect(target).toEqual({ scale: 4, x: 320, y: -360 });
    expect(shareZoom(target, { w: 320, h: 480 })).toEqual(shared);
  });

  it("returns both photos to fit regardless of their dimensions", () => {
    const shared = shareZoom({ scale: 1, x: 0, y: 0 }, { w: 600, h: 400 })!;
    expect(receiveZoom(shared, { w: 320, h: 480 })).toEqual({ scale: 1, x: 0, y: 0 });
  });

  it("keeps the same displayed position when a cropped or rotated candidate changes shape", () => {
    const shared = shareZoom({ scale: 3, x: -450, y: 180 }, { w: 600, h: 400 })!;
    const target = receiveZoom(shared, { w: 400, h: 600 });
    const back = shareZoom(target, { w: 400, h: 600 })!;
    expect(back.x).toBeCloseTo(0.75);
    expect(back.y).toBeCloseTo(0.35);
    expect(back.scale).toBe(3);
  });

  it("mirrors even a small zoom from fit on differently cropped photos", () => {
    const shared = shareZoom({ scale: 1.1, x: 0, y: 0 }, { w: 720, h: 480 })!;
    expect(receiveZoom(shared, { w: 320, h: 480 }).scale).toBe(1.1);
  });

  it("respects the existing fit and maximum zoom limits", () => {
    expect(receiveZoom({ scale: 0.1, x: 0.3, y: 0.7 }, { w: 600, h: 400 }))
      .toEqual({ scale: 1, x: 0, y: 0 });
    expect(receiveZoom({ scale: 40, x: 0.25, y: 0.75 }, { w: 600, h: 400 }))
      .toEqual({ scale: 20, x: 3000, y: -2000 });
  });

  it("does not publish invalid positions before the canvas has been measured", () => {
    expect(shareZoom({ scale: 2, x: 0, y: 0 }, { w: 0, h: 0 })).toBeNull();
    expect(shareZoom({ scale: 2, x: 0, y: 0 }, { w: 600, h: 0 })).toBeNull();
  });
});
