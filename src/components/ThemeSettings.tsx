import { useStore } from "@/lib/store";
import { validRankingPalette } from "@/lib/ranking-palette";
import { useEffect } from "react";
import { create } from "zustand";
import { load, save } from "@/lib/prefs";
import { validTheme, type Theme } from "@/lib/theme";
export const useTheme = create<{ theme: Theme; set: (theme: Theme) => void }>((set) => ({
  theme: validTheme(load("theme", "dark")),
  set(theme) { const safe = validTheme(theme); save("theme", safe); set({ theme: safe }); },
}));
export function useAppTheme() {
  const theme = useTheme((s) => s.theme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme === "light" ? "light" : "dark";
    document.documentElement.classList.toggle("dark", theme !== "light");
  }, [theme]);
}
export function ThemeSettings() {
  const { theme, set } = useTheme();
  const rankingPalette = useStore(s => s.rankingPalette);
  return <fieldset className="rounded-md border border-border p-3">
    <legend className="px-1 text-sm font-medium">Appearance</legend>
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))] gap-x-6 gap-y-3">
    <label className="flex items-center justify-between gap-3 text-xs">Theme
      <select aria-label="Theme" value={theme} onChange={(e) => set(e.target.value as Theme)}
        className="rounded border border-input bg-background px-2 py-1 text-foreground">
        <option value="dark">Dark</option><option value="light">Light</option><option value="grey">18% grey</option>
      </select>
    </label>
    <label className="flex items-center justify-between gap-3 text-xs">Ranking colours
      <select aria-label="Ranking colours" aria-describedby="ranking-colours-help" value={rankingPalette} onChange={event => useStore.getState().set("rankingPalette", validRankingPalette(event.target.value))}
        className="min-w-0 rounded border border-input bg-background px-2 py-1 text-foreground">
        <option value="classic">Blue–grey–red</option><option value="red-green">Red–green</option>
      </select>
    </label>
    </div>
    <p id="ranking-colours-help" className="mt-2 text-xs text-muted-foreground">Ranking colours apply to all thumbnail rank bars. Red–green uses green for the best frame and red for the lowest; rank numbers stay visible.</p>
    <p className="mt-2 text-xs text-muted-foreground">18% grey uses a neutral photographic surround. Photo pixels and rating colours are unchanged.</p>
  </fieldset>;
}
