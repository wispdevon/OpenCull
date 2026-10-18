import { beforeEach, describe, expect, it } from "vitest";
import { getSystemId } from "./performance-preferences";

beforeEach(() => localStorage.clear());
describe("diagnostic preferences", () => {
  it("persists a readable random installation alias and replaces invalid values", () => {
    const id = getSystemId();
    expect(id).toMatch(/^[a-z]+-[a-z]+-\d{6}$/);
    expect(getSystemId()).toBe(id);
    localStorage.setItem("opencull.performanceSystemId", JSON.stringify("private-hostname"));
    expect(getSystemId()).toMatch(/^[a-z]+-[a-z]+-\d{6}$/);
  });
});
