import { Switch } from "@/components/ui/switch";
import { useStore } from "@/lib/store";

export function ExperimentalFilmstripSettings() {
  const enabled = useStore((s) => s.experimentalNativeFilmstrip);
  return <fieldset className="space-y-3 rounded-lg border border-border p-4">
    <legend className="px-1 text-sm font-semibold">Experimental Features</legend>
    <label className="flex items-center justify-between gap-4">
      <span><span className="block text-sm font-medium">Native-aspect filmstrip</span>
        <span className="block text-xs text-muted-foreground">Keep each photo’s proportions in a single row. Portraits take less width; landscapes take more.</span></span>
      <Switch checked={enabled} onCheckedChange={(value) => useStore.getState().set("experimentalNativeFilmstrip", value)} aria-label="Native-aspect filmstrip" />
    </label>
  </fieldset>;
}
