import { useStore } from "@/lib/store";
export function StackLayoutSettings() {
  const fixed = useStore((s) => s.stackFilmstripAtBottom);
  return <fieldset className="space-y-2 rounded-md border border-border p-3">
    <legend className="px-1 text-sm font-semibold">Stack filmstrip placement</legend>
    <div className="flex flex-col gap-2 text-xs">
      <label className="flex items-center gap-2"><input type="radio" name="stack-filmstrip-layout" checked={!fixed}
        onChange={() => useStore.getState().set("stackFilmstripAtBottom", false)} />Classic stack layout</label>
      <label className="flex items-center gap-2"><input type="radio" name="stack-filmstrip-layout" checked={fixed}
        onChange={() => useStore.getState().set("stackFilmstripAtBottom", true)} />Keep normal filmstrip placement</label>
    </div>
    <p className="text-xs text-muted-foreground">Keep the active stack's frames in the normal full-width bottom filmstrip, with the same height and resize control as Filmstrip view. The scene overview stays above it. Classic preserves the original layout.</p>
  </fieldset>;
}
