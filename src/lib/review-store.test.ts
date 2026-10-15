import { beforeEach, describe, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ setMarks: vi.fn(), setFraming: vi.fn() }));
vi.mock("./api", () => ({ api, inTauri: false }));
import { useStore } from "./store";
import { newReview } from "./review";
import { PLAIN } from "./framing";
import type { Photo } from "./types";
const photo: Photo = { path: "/card/A.JPG", display: "/card/A.JPG", name: "A.JPG", subpath: null, version: "1", size: 10, modified: 0, index: 0, rating: 0, flag: "none", color: "none", exif: null, captureMs: null, fullWidth: 100, fullHeight: 100, framing: PLAIN, framable: true, group: null };
beforeEach(() => {
  vi.clearAllMocks();
  useStore.setState({ review: newReview(["/card"], [photo]), photos: [{ ...photo }], current: 0, order: [0], view: [0], loading: false, undoStack: [], redoStack: [], selected: new Set(), selfTest: false, embedInJpeg: true });
});
describe("source-safe review", () => {
  it("keeps flags and undo local even when embedded JPEG writing is enabled", () => {
    useStore.getState().setFlag("reject");
    expect(useStore.getState().review?.decisions[photo.path].flag).toBe("reject");
    expect(api.setMarks).not.toHaveBeenCalled();
    useStore.getState().undo();
    expect(useStore.getState().photos[0].flag).toBe("none");
    expect(api.setMarks).not.toHaveBeenCalled();
  });
  it("keeps crops local", () => {
    useStore.getState().setFraming(0, { turn: 6, crop: null });
    expect(useStore.getState().review?.decisions[photo.path].framing.turn).toBe(6);
    expect(api.setFraming).not.toHaveBeenCalled();
  });
  it("normal folder marks still write sidecars", () => {
    useStore.setState({ review: null }); useStore.getState().setRating(3);
    expect(api.setMarks).toHaveBeenCalledOnce();
  });
  it("always confirms source deletion during card review", () => {
    useStore.setState({ askBeforeTrash: false }); useStore.getState().requestTrash([0]);
    expect(useStore.getState().trashPending).toEqual([0]);
  });
});
