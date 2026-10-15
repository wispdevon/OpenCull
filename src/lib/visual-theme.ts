export type VisualTheme = "default" | "rapidraw";

export function validVisualTheme(value: unknown): VisualTheme {
  return value === "rapidraw" ? value : "default";
}

/** A preset supplies typography without overwriting the user's interface font. */
export function visualThemeFont(theme: VisualTheme, includedFont: boolean): string | null {
  return theme === "rapidraw" && includedFont
    ? '"Space Grotesk", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    : null;
}
