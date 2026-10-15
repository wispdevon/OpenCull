import { Switch } from "@/components/ui/switch";
import { useStore } from "@/lib/store";

export function ExperimentalZoomSettings() {
  const enabled = useStore((s) => s.experimentalSmoothZoom);
  return <fieldset className="space-y-3 rounded-lg border border-border p-4">
    <legend className="px-1 text-sm font-semibold">Experimental Features</legend>
    <label className="flex items-center justify-between gap-4">
      <span><span className="block text-sm font-medium">Smooth click zoom</span>
        <span className="block text-xs text-muted-foreground">A quick start and gentle stop inspired by macOS. Respects reduced motion. Dragging and wheel zoom remain immediate.</span></span>
      <Switch checked={enabled} onCheckedChange={(value) => useStore.getState().set("experimentalSmoothZoom", value)} aria-label="Smooth click zoom" />
    </label>
  </fieldset>;
}
