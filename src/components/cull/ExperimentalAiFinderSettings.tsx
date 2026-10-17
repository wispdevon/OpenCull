import { inTauri, type AiFinderChoice } from "@/lib/api";
import { useStore } from "@/lib/store";

const choices: { value: AiFinderChoice; label: string; detail: string }[] = [
  { value: "mode", label: "Follow AI mode", detail: "YuNet for Basic · YOLO26n for Advanced" },
  { value: "yunet", label: "YuNet for both", detail: "Use YuNet as the full-photo face finder" },
  { value: "yolo", label: "YOLO26n for both", detail: "Use YOLO26n as the full-photo face finder" },
];

export function ExperimentalAiFinderSettings() {
  const selected = useStore((s) => s.experimentalAiFinder);
  if (!import.meta.env.DEV || !inTauri) return null;

  return <fieldset className="experimental-section space-y-3 rounded-lg border p-4">
    <legend className="px-1 text-sm font-semibold">Face finder · Experimental · Dev build</legend>
    <p id="experimental-ai-finder-help" className="setting-hint text-muted-foreground">
      Choose which model searches the full photo in either AI mode. YOLO26n still uses YuNet on face crops to place eyes. Each rules-and-finder combination has its own cache; switching to one without saved results reanalyses the folder.
    </p>
    <div className="grid gap-2" role="radiogroup" aria-label="Experimental full-photo face finder" aria-describedby="experimental-ai-finder-help">
      {choices.map((choice) => <label key={choice.value} className={`flex min-h-12 cursor-pointer items-start gap-2 rounded-md border px-3 py-2 ${selected === choice.value ? "border-primary bg-primary/10" : "border-input bg-background"}`}>
        <input
          className="mt-1 accent-[var(--primary)]"
          type="radio"
          name="experimental-ai-finder"
          value={choice.value}
          checked={selected === choice.value}
          onChange={() => useStore.getState().set("experimentalAiFinder", choice.value)}
        />
        <span>
          <span className="block text-sm font-medium">{choice.label}</span>
          <span className="block text-xs text-muted-foreground">{choice.detail}</span>
        </span>
      </label>)}
    </div>
  </fieldset>;
}
