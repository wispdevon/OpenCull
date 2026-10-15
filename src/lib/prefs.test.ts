import { beforeEach, describe, expect, it } from "vitest";
import { load } from "./prefs";
beforeEach(() => localStorage.clear());
describe("preference validation", () => {
  it("does not hydrate a boolean or dimension from invalid config types", () => {
    localStorage.setItem("opencull.showExif", '"false"');
    localStorage.setItem("opencull.facePanelWidth", '"wide"');
    expect(load("showExif", false)).toBe(false);
    expect(load("facePanelWidth", 340)).toBe(340);
  });
  it("recovers from malformed legacy values", () => {
    localStorage.setItem("opencull.theme", "{oops");
    expect(load("theme", "dark")).toBe("dark");
  });
});
