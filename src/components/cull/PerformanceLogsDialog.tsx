import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, type TimingLogEntry } from "@/lib/api";

export function PerformanceLogsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [entries, setEntries] = useState<TimingLogEntry[]>([]);
  const [error, setError] = useState(false);
  const [clearing, setClearing] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setEntries(await api.timingLogs());
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), 1000);
    return () => window.clearInterval(timer);
  }, [open, refresh]);

  const clear = async () => {
    setClearing(true);
    try {
      await api.clearTimingLogs();
      await refresh();
    } catch {
      setError(true);
    } finally {
      setClearing(false);
    }
  };

  const ordered = [...entries].reverse();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] flex-col overflow-hidden sm:max-w-3xl sm:p-6">
        <DialogHeader className="shrink-0">
          <DialogTitle>Performance log</DialogTitle>
          <DialogDescription>
            Recent AI chunk, MobileCLIP grouping, and full-size preview timings. Kept in memory for this session, up to 500 entries.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-auto rounded-md border bg-muted/30 p-3">
          {error ? (
            <p className="text-sm text-destructive">Could not load the performance log.</p>
          ) : ordered.length === 0 ? (
            <p className="text-sm text-muted-foreground">No timing entries yet. Run AI analysis, group photos with MobileCLIP, or open a full-size preview.</p>
          ) : (
            <ol className="space-y-3">
              {ordered.map((entry) => (
                <li key={entry.id} className="border-b border-border/60 pb-3 last:border-0 last:pb-0">
                  <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                    <time dateTime={new Date(entry.timestampMs).toISOString()}>
                      {new Date(entry.timestampMs).toLocaleString()}
                    </time>
                    <span className="rounded bg-secondary px-1.5 py-0.5 text-secondary-foreground">{entry.category}</span>
                  </div>
                  <pre className="whitespace-pre-wrap break-words font-mono text-xs text-foreground">{entry.message}</pre>
                </li>
              ))}
            </ol>
          )}
        </div>
        <div className="flex shrink-0 justify-end">
          <Button variant="outline" size="sm" disabled={clearing || entries.length === 0} onClick={() => void clear()}>
            {clearing ? "Clearing…" : "Clear log"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
