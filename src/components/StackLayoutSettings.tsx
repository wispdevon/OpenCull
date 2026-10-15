import { useStore } from "@/lib/store";
export function StackLayoutSettings() {
  const fixed = useStore((s) => s.stackFilmstripAtBottom);
  return <fieldset className="space-y-2 rounded-md border border-border p-3">
    <legend className="px-1 text-sm font-semibold">Stack filmstrip placement</legend>
    <div className="flex flex-col gap-2 text-xs">
      <label className="flex items-center gap-2"><input type="radio" name="stack-filmstrip-layout" checked={!fixed}
        onChange={() => useStore.getState().set("stackFilmstripAtBottom", false)} />Classic stack layout (default)</label>
      <label className="flex items-center gap-2"><input type="radio" name="stack-filmstrip-layout" checked={fixed}
        onChange={() => useStore.getState().set("stackFilmstripAtBottom", true)} />Keep normal filmstrip placement</label>
    </div>
    <p className="text-xs text-muted-foreground">Classic keeps both rows below the photo. Keep normal filmstrip placement puts the group overview across the full-width bottom row; the active stack’s frames stay above it, beneath the photo. Both rows can be resized and hidden.</p>
  </fieldset>;
}
