import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ setMarks: vi.fn(), closeFolder: vi.fn() }));
vi.mock("./api", () => ({ api, inTauri: false }));
import { useStore } from "./store";
import { perform } from "./shortcuts";
import { newReview } from "./review";
import { PLAIN } from "./framing";
import type { Photo } from "./types";

const photos: Photo[] = [0, 1, 2].map((index) => ({
  index, path: `/card/${index}.JPG`, display: `/card/${index}.JPG`, name: `${index}.JPG`,
  subpath: null, version: "1", size: 10, modified: 0, rating: 0, flag: "none", color: "none",
  exif: null, captureMs: null, fullWidth: 600, fullHeight: 400, framing: PLAIN, framable: true, group: null,
}));

beforeEach(() => {
  vi.clearAllMocks();
  useStore.setState({
    session: { id: 1, folder: "/card", name: "card", includeSubfolders: false, subfolderCount: 0, fileKinds: "both", leftOut: 0, timed: true },
    photos: photos.map((p) => ({ ...p })), order: [0, 1, 2], view: [0, 1, 2], current: 0,
    referenceIndex: null, viewMode: "scene", review: newReview(["/card"], photos),
    cropOpen: false, loading: false, selected: new Set(), undoStack: [], redoStack: [],
    speedCull: false, speedCullAlways: false, selfTest: true,
  });
});

describe("reference comparison", () => {
  it("pins the current still without changing navigation, selection or workspace preferences", () => {
    useStore.setState({ selected: new Set([0, 1]) });
    useStore.getState().pinReference();
    expect(useStore.getState().referenceIndex).toBe(0);
    expect(useStore.getState().current).toBe(0);
    expect(useStore.getState().selected).toEqual(new Set([0, 1]));
    expect(useStore.getState().viewMode).toBe("scene");
    expect(api.setMarks).not.toHaveBeenCalled();
  });

  it("keeps the reference pinned while navigating and marking only the current photo, with undo", () => {
    useStore.getState().pinReference();
    perform("nextImage");
    perform("rate5");
    perform("pick");
    expect(useStore.getState().referenceIndex).toBe(0);
    expect(useStore.getState().photos[0].rating).toBe(0);
    expect(useStore.getState().photos[0].flag).toBe("none");
    expect(useStore.getState().photos[1].rating).toBe(5);
    expect(useStore.getState().photos[1].flag).toBe("pick");
    perform("undo");
    expect(useStore.getState().photos[1].flag).toBe("none");
    expect(api.setMarks).not.toHaveBeenCalled();
  });

  it("replaces the reference without stepping off the current photo", () => {
    useStore.getState().pinReference();
    useStore.getState().next();
    useStore.getState().pinReference();
    expect(useStore.getState().referenceIndex).toBe(1);
    expect(useStore.getState().current).toBe(1);
  });

  it("opens and closes through the comparison shortcut without changing existing bindings", () => {
    perform("toggleReference");
    expect(useStore.getState().referenceIndex).toBe(0);
    perform("toggleReference");
    expect(useStore.getState().referenceIndex).toBeNull();
  });

  it("preserves normal-folder sidecar writes and speed culling", () => {
    useStore.setState({ review: null, speedCullAlways: true });
    useStore.getState().pinReference();
    useStore.getState().next();
    perform("rate4");
    expect(api.setMarks).toHaveBeenCalledOnce();
    expect(useStore.getState().photos[1].rating).toBe(4);
    expect(useStore.getState().current).toBe(2);
    expect(useStore.getState().referenceIndex).toBe(0);
  });

  it("survives filtering the reference out of the filmstrip", () => {
    useStore.getState().pinReference();
    useStore.getState().go(1);
    useStore.getState().setRating(5);
    useStore.getState().setRatingFilter(5);
    expect(useStore.getState().view).toEqual([1]);
    expect(useStore.getState().referenceIndex).toBe(0);
  });

  it("closes without changing the current photo or the prior grid workspace", () => {
    useStore.setState({ viewMode: "grid" });
    useStore.getState().pinReference();
    useStore.getState().next();
    useStore.getState().closeComparison();
    expect(useStore.getState().referenceIndex).toBeNull();
    expect(useStore.getState().viewMode).toBe("grid");
    expect(useStore.getState().current).toBe(1);
  });

  it("closes when a workspace is explicitly chosen or cropping starts", () => {
    useStore.getState().pinReference();
    useStore.getState().set("viewMode", "loupe");
    expect(useStore.getState().referenceIndex).toBeNull();
    useStore.getState().pinReference();
    useStore.getState().openCrop();
    expect(useStore.getState().referenceIndex).toBeNull();
    expect(useStore.getState().cropOpen).toBe(true);
  });

  it("shows Grid on G even when comparison was opened from Grid", () => {
    useStore.setState({ viewMode: "grid" });
    useStore.getState().pinReference();
    perform("viewGrid");
    expect(useStore.getState().referenceIndex).toBeNull();
    expect(useStore.getState().viewMode).toBe("grid");
  });

  it("clears a removed reference and clears comparison when the folder closes", () => {
    useStore.getState().pinReference();
    useStore.getState().forget([photos[0].path]);
    expect(useStore.getState().referenceIndex).toBeNull();
    useStore.getState().pinReference();
    useStore.getState().closeFolder();
    expect(useStore.getState().referenceIndex).toBeNull();
  });

  it("ignores videos, absent photos and requests while cropping", () => {
    useStore.setState({ photos: [{ ...photos[0], path: "/card/clip.MOV" }] });
    useStore.getState().pinReference();
    expect(useStore.getState().referenceIndex).toBeNull();
    useStore.setState({ photos, current: -1 });
    useStore.getState().pinReference();
    expect(useStore.getState().referenceIndex).toBeNull();
    useStore.setState({ current: 0, cropOpen: true });
    useStore.getState().pinReference();
    expect(useStore.getState().referenceIndex).toBeNull();
  });
});
