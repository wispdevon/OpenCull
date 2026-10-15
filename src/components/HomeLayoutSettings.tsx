import { create } from "zustand";
import { useState } from "react";
import { applyPreferences, load, save } from "@/lib/prefs";
import { useVisualTheme } from "./VisualThemeSettings";
import { useFont } from "./FontSettings";
import { useTheme } from "./ThemeSettings";
import { useScale } from "./InterfaceScaleSettings";
import { useStore, type Store } from "@/lib/store";
import { parseSettingsImport } from "@/lib/settings-transfer";
import wispPreset from "@/lib/presets/wisp.json";
import { Button } from "./ui/button";

type HomeLayout = "spacious" | "classic";
export const useHomeLayout = create<{ layout: HomeLayout; setLayout: (layout: HomeLayout) => void }>((set) => ({
  layout: load<string>("homeLayout", "spacious") === "classic" ? "classic" : "spacious",
  setLayout(layout) { save("homeLayout", layout); set({ layout }); },
}));

export function HomeLayoutSettings() {
  const { layout, setLayout } = useHomeLayout();
  const { theme, setTheme, includedFont, setIncludedFont } = useVisualTheme();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const applyWisp = async () => {
    setBusy(true); setError("");
    try {
      const values = parseSettingsImport(JSON.stringify(wispPreset));
      await applyPreferences(values);
      const state = useStore.getState();
      const changed = Object.fromEntries(Object.entries(values).filter(([key]) => Object.hasOwn(state, key) && typeof state[key as keyof Store] !== "function"));
      useStore.setState(changed as Partial<Store>);
      const next = useStore.getState();
      next.setSort(next.sort, next.sortAscending);
      useFont.getState().set({ choice: "space-grotesk", family: "" });
      useTheme.getState().set("grey");
      useScale.getState().set(1.25);
      setLayout("classic"); setIncludedFont(true); setTheme("wisp");
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  };
  return <>
    <fieldset disabled={busy} className="space-y-3 rounded-md border border-border">
      <legend className="px-1">Interface design</legend>
      <div className="flex flex-wrap gap-4">
        {([['default', 'OpenCull'], ['rapidraw', 'RapidRAW inspired'], ['wisp', 'Wisp']] as const).map(([value, label]) =>
          <label key={value} className="flex items-center gap-2">
            <input type="radio" name="interface-design" checked={theme === value} onChange={() => value === "wisp" ? void applyWisp() : setTheme(value)} />{label}
          </label>)}
      </div>
      <p className="text-sm text-muted-foreground">OpenCull keeps the original design. RapidRAW adds a split welcome page. Wisp applies the included culling preset: RapidRAW-style layout, contrasting grey panels, 18% grey surround, Space Grotesk and 125% interface scale.</p>
      {theme === "wisp" && <Button variant="outline" onClick={() => void applyWisp()}>Restore Wisp preset</Button>}
      {busy && <p role="status" className="text-sm">Applying Wisp preset…</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {(theme === "rapidraw" || theme === "wisp") && <label className="flex items-center gap-2">
        <input type="checkbox" checked={includedFont} onChange={(e) => setIncludedFont(e.target.checked)} />Use included Space Grotesk font
      </label>}
    </fieldset>
    <fieldset className="space-y-3 rounded-md border border-border">
      <legend className="px-1">Home layout</legend>
      <div className="flex flex-col gap-3">
        <label className="flex items-center gap-2"><input type="radio" name="home-layout" checked={layout === "spacious"} onChange={() => setLayout("spacious")} />Spacious · actions below heading</label>
        <label className="flex items-center gap-2"><input type="radio" name="home-layout" checked={layout === "classic"} onChange={() => setLayout("classic")} />Classic · actions at upper right</label>
      </div>
      <p className="text-sm text-muted-foreground">Controls wrap on smaller windows. This choice is independent of colour mode, font and scale.</p>
    </fieldset>
  </>;
}
