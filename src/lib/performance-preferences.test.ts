import { beforeEach, describe, expect, it } from "vitest";
import { getSystemId, loadWebhookUrl, saveWebhookUrl } from "./performance-preferences";

beforeEach(() => localStorage.clear());
describe("diagnostic preferences", () => {
  it("stores webhook credentials encoded and clears legacy plaintext", () => {
    localStorage.setItem("opencull.performanceWebhookUrl", JSON.stringify("https://example.com/old"));
    saveWebhookUrl("https://example.com/webhook?token=test");
    expect(loadWebhookUrl()).toBe("https://example.com/webhook?token=test");
    expect(localStorage.getItem("opencull.performanceWebhookEncoded")).not.toContain("example.com");
    expect(localStorage.getItem("opencull.performanceWebhookUrl")).toBe('""');
    saveWebhookUrl("");
    expect(loadWebhookUrl()).toBe("");
  });
  it("migrates existing URLs and tolerates corrupt encoded values", () => {
    localStorage.setItem("opencull.performanceWebhookUrl", JSON.stringify("https://example.com/hook"));
    expect(loadWebhookUrl()).toBe("https://example.com/hook");
    expect(localStorage.getItem("opencull.performanceWebhookUrl")).toBe('""');
    localStorage.setItem("opencull.performanceWebhookEncoded", '"invalid!"');
    expect(loadWebhookUrl()).toBe("");
  });
  it("persists a readable random installation alias and replaces invalid values", () => {
    const id = getSystemId();
    expect(id).toMatch(/^[a-z]+-[a-z]+-\d{6}$/);
    expect(getSystemId()).toBe(id);
    localStorage.setItem("opencull.performanceSystemId", JSON.stringify("private-hostname"));
    expect(getSystemId()).toMatch(/^[a-z]+-[a-z]+-\d{6}$/);
  });
});
