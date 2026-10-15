import { useEffect } from "react";
import { create } from "zustand";
import { load, save } from "@/lib/prefs";
import { validVisualTheme, visualThemeFont, type VisualTheme } from "@/lib/visual-theme";
import "@/visual-theme.css";
import "@/wisp-theme.css";

export const useVisualTheme = create<{
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
