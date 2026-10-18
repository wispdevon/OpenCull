import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyPreferences, initializePreferences, load, save, snapshotPreferences } from "./prefs";
beforeEach(() => localStorage.clear());
describe("preference validation", () => {
  it("blocks legacy diagnostic destinations from reads, writes, snapshots and imports", async () => {
    for (const key of ["performanceWebhookEncoded", "performanceWebhookUrl", "performanceNtfyUrl", "performanceLogsNtfyUrl"]) {
      localStorage.setItem(`opencull.${key}`, JSON.stringify("private-value"));
      expect(load(key, "hidden")).toBe("hidden");
      expect(snapshotPreferences()).not.toHaveProperty(key);
      save(key, "replacement");
      expect(localStorage.getItem(`opencull.${key}`)).toBe('"private-value"');
      await expect(applyPreferences({ theme: "light", [key]: "replacement" })).rejects.toThrow("destinations are fixed");
      expect(localStorage.getItem("opencull.theme")).toBeNull();
    }
    await initializePreferences();
    for (const key of ["performanceWebhookEncoded", "performanceWebhookUrl", "performanceNtfyUrl", "performanceLogsNtfyUrl"]) {
      expect(localStorage.getItem(`opencull.${key}`)).toBeNull();
    }
  });
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
  it("rolls back an import if browser storage fails partway through", async () => {
    localStorage.setItem("opencull.theme", '"dark"');
    localStorage.setItem("opencull.showExif", "false");
    const original = localStorage.setItem.bind(localStorage);
    const write = vi.spyOn(localStorage, "setItem").mockImplementation((key, value) => {
      if (key === "opencull.showExif" && value === "true") throw new Error("Storage full");
      original(key, value);
    });
    try {
      await expect(applyPreferences({ theme: "light", showExif: true })).rejects.toThrow("Storage full");
      expect(load("theme", "dark")).toBe("dark");
      expect(load("showExif", false)).toBe(false);
    } finally { write.mockRestore(); }
  });
});
