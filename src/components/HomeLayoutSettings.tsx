import { create } from "zustand";
import { load, save } from "@/lib/prefs";
import { useVisualTheme } from "./VisualThemeSettings";

type HomeLayout = "spacious" | "classic";
export const useHomeLayout = create<{ layout: HomeLayout; setLayout: (layout: HomeLayout) => void }>((set) => ({
  layout: load<string>("homeLayout", "spacious") === "classic" ? "classic" : "spacious",
  setLayout(layout) { save("homeLayout", layout); set({ layout }); },
}));

export function HomeLayoutSettings() {
  const { layout, setLayout } = useHomeLayout();
  const { theme, setTheme, includedFont, setIncludedFont } = useVisualTheme();
  return <>
    <fieldset className="space-y-3 rounded-md border border-border">
      <legend className="px-1">Interface design</legend>
      <div className="flex flex-wrap gap-4">
        {([['default', 'OpenCull'], ['rapidraw', 'RapidRAW inspired'], ['wisp', 'Wisp']] as const).map(([value, label]) =>
          <label key={value} className="flex items-center gap-2">
            <input type="radio" name="interface-design" checked={theme === value} onChange={() => setTheme(value)} />{label}
          </label>)}
      </div>
      <p className="text-sm text-muted-foreground">OpenCull keeps the original design. RapidRAW adds a split welcome page. Wisp adds distinct surfaces, readable metadata and violet accents.</p>
      {theme === "rapidraw" && <label className="flex items-center gap-2">
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
