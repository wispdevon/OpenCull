import { useEffect } from "react";
import { create } from "zustand";
import { load, save } from "@/lib/prefs";
import { validVisualTheme, visualThemeFont, type VisualTheme } from "@/lib/visual-theme";
import "@/visual-theme.css";
import "@/wisp-theme.css";

const useVisualTheme = create<{
  theme: VisualTheme;
  includedFont: boolean;
  setTheme: (theme: VisualTheme) => void;
  setIncludedFont: (included: boolean) => void;
}>((set) => ({
  theme: validVisualTheme(load("visualTheme", "default")),
  includedFont: load("visualThemeFont", true) === true,
  setTheme(theme) {
    const safe = validVisualTheme(theme);
    save("visualTheme", safe);
    set({ theme: safe });
  },
  setIncludedFont(includedFont) {
    save("visualThemeFont", includedFont);
    set({ includedFont });
  },
}));

export function useDesignTheme() {
  return useVisualTheme((s) => s.theme);
}

export function useAppVisualTheme() {
  const { theme, includedFont } = useVisualTheme();
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.visualTheme = theme;
    const font = visualThemeFont(theme, includedFont);
    if (font) root.style.setProperty("--visual-theme-font", font);
    else root.style.removeProperty("--visual-theme-font");
  }, [theme, includedFont]);
}

export function VisualThemeSettings() {
  const { theme, includedFont, setTheme, setIncludedFont } = useVisualTheme();
  return (
    <fieldset className="space-y-3 rounded-md border border-border p-3">
      <legend className="px-1 text-sm font-medium">Design theme</legend>
      <label className="flex items-center justify-between gap-3 text-xs">Design
        <select aria-label="Design theme" value={theme} onChange={(e) => setTheme(e.target.value as VisualTheme)}
          className="rounded border border-input bg-background px-2 py-1 text-foreground">
          <option value="default">OpenCull</option>
          <option value="rapidraw">RapidRAW inspired</option>
          <option value="wisp">Wisp</option>
        </select>
      </label>
      <p className="text-xs text-muted-foreground">OpenCull is the original layout. RapidRAW adds a photographic split page. Wisp adds distinct surfaces, stronger contrast and violet accents. Your colour mode stays separate.</p>
      {theme === "rapidraw" && <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={includedFont} onChange={(e) => setIncludedFont(e.target.checked)} />
        Use included Space Grotesk font
      </label>}
    </fieldset>
  );
}
