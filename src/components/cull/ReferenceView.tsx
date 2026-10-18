import { useState } from "react";
import { Pin, X, ZoomIn } from "lucide-react";

import { Button } from "@/components/ui/button";
import { isVideo } from "@/lib/media";
import { useStore, type ZoomCommand } from "@/lib/store";
import { Loupe, StillCanvas } from "./Loupe";

/** A fixed reference beside the normal current-photo loupe. */
export function ReferenceView() {
  const [zoomRequest, setZoomRequest] = useState<ZoomCommand>({ kind: "toggle", nonce: 0 });
  const reference = useStore((s) => s.referenceIndex === null ? undefined : s.photos[s.referenceIndex]);
  const current = useStore((s) => s.photos[s.current]);
  if (!reference) return <Loupe />;

  return (
    <div className="flex size-full flex-col bg-canvas">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-1 border-b border-border bg-panel px-2 py-1">
        <span className="text-xs text-muted-foreground">Browse and mark the current photo. Zoom each photo independently.</span>
        <Button type="button" variant="ghost" size="sm" onClick={() => useStore.getState().closeComparison()}>
          <X aria-hidden="true" /> Close comparison
        </Button>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-2 divide-x divide-border">
        <section aria-label="Reference photo" className="flex min-h-0 min-w-0 flex-col">
          <div className="flex min-h-9 shrink-0 items-center gap-2 border-b border-border bg-panel px-2 text-xs">
            <Pin aria-hidden="true" className="size-3 shrink-0" />
            <span className="shrink-0 font-medium">Reference</span>
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{reference.name}</span>
            <Button type="button" variant="ghost" size="xs" aria-label="Toggle reference zoom"
              onClick={() => setZoomRequest((previous) => ({ kind: "toggle", nonce: previous.nonce + 1 }))}>
              <ZoomIn aria-hidden="true" /> Zoom
            </Button>
          </div>
          <div className="min-h-0 flex-1">
            <StillCanvas key={reference.path} photo={reference} reference zoomRequest={zoomRequest} />
          </div>
        </section>
        <section aria-label="Current photo" className="flex min-h-0 min-w-0 flex-col">
          <div className="flex min-h-9 shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-border bg-panel px-2 py-1 text-xs">
            <span className="shrink-0 font-medium text-brand">Current</span>
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{current?.name ?? "No image selected"}</span>
            <Button type="button" variant="ghost" size="xs"
              disabled={!current || isVideo(current.path) || current.index === reference.index}
              onClick={() => useStore.getState().pinReference()}>
              <Pin aria-hidden="true" /> Use as reference
            </Button>
          </div>
          <div className="min-h-0 flex-1">
            <Loupe compact />
          </div>
        </section>
      </div>
    </div>
  );
}
