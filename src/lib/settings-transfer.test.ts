import { describe, expect, it } from "vitest";
import { exportSettings, parseSettingsImport } from "./settings-transfer";
const document = (values: unknown, version = 1) => JSON.stringify({ format: "opencull-settings", version, values });
describe("portable settings", () => {
  it("round-trips preferences and shortcuts without folder/session history", () => {
    const text = exportSettings({ theme: "grey", homeLayout: "classic", showExif: true, font: { choice: "custom", family: "Noto Sans" }, shortcuts: { nextImage: { code: "KeyJ", mod: true } }, recents: ["/private"], "session.secret": { source: "/card" } });
    expect(text).not.toContain("/private"); expect(text).not.toContain("/card");
    expect(parseSettingsImport(text)).toEqual({ theme: "grey", homeLayout: "classic", showExif: true, font: { choice: "custom", family: "Noto Sans" }, shortcuts: { nextImage: { code: "KeyJ", mod: true } } });
  });
  it("rejects malformed, oversized, unsupported and empty documents", () => {
    for (const text of ["{", "x".repeat(1024 * 1024 + 1), document({}, 2), document({}), JSON.stringify({ theme: "dark" })]) expect(() => parseSettingsImport(text)).toThrow();
  });
  it("rejects invalid types, ranges and enums before applying anything", () => {
    for (const values of [{ showExif: "true" }, { interfaceScale: 9 }, { theme: "blue" }, { filmstripHeight: -1 }, { gridColumns: 2.5 }, { font: { choice: "custom", family: "a\u0000b" } }, { shortcuts: { nextImage: { code: "KeyJ", mod: "yes" } } }]) expect(() => parseSettingsImport(document(values))).toThrow();
  });
  it("rejects unknown fields and prototype keys rather than applying them", () => {
    expect(() => parseSettingsImport(document({ recents: ["/card"] }))).toThrow();
    expect(() => parseSettingsImport('{"format":"opencull-settings","version":1,"values":{"__proto__":{"polluted":true}}}')).toThrow();
    expect(() => parseSettingsImport(document({ shortcuts: { surprise: { code: "KeyJ" } } }))).toThrow();
  });
});
