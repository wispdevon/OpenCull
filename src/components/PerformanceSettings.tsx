import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, Download, RotateCcw, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { inTauri } from "@/lib/api";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { load, save } from "@/lib/prefs";
import {
  diagnosticReport,
  rankedStages,
  recommendations,
  type BenchmarkMode,
  type BenchmarkReport,
  type BenchmarkStatus,
  type CoverageEntry,
  type DeliveryResult,
  type Recommendation,
  type StageSummary,
} from "@/lib/performance";
import {
  getLatestReport,
  performanceApi,
  subscribePerformance,
} from "@/lib/performance-api";

let sessionWebhookToken = "";
let sessionNtfyToken = "";

const EMPTY_STATUS: BenchmarkStatus = {
  runId: null,
  state: "idle",
  completed: 0,
  total: 0,
  current: null,
  report: null,
  error: null,
};

export function PerformanceSettings() {
  const [status, setStatus] = useState(EMPTY_STATUS);
  const statusRef = useRef(status);
  const refreshInFlight = useRef(false);
  const [report, setReport] = useState<BenchmarkReport | null>(() => getLatestReport());
  const [rankBy, setRankBy] = useState<"total" | "latency">("total");
  const [recording, setRecording] = useState(() => performanceApi.isRecording());
  const [reporting, setReporting] = useState(() => performanceApi.reportingState());
  const [webhookUrl, setWebhookUrl] = useState(() => load("performanceWebhookUrl", ""));
  const [ntfyUrl, setNtfyUrl] = useState(() => load("performanceNtfyUrl", ""));
  const [webhookToken, setWebhookToken] = useState(sessionWebhookToken);
  const [ntfyToken, setNtfyToken] = useState(sessionNtfyToken);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewReport, setPreviewReport] = useState<BenchmarkReport | null>(null);
  const [previewPayload, setPreviewPayload] = useState<{ webhookJson: string; ntfyMessage: string } | null>(null);
  const [approval, setApproval] = useState("");

  const refresh = useCallback(async () => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    try {
      const next = await performanceApi.status();
      statusRef.current = next;
      setStatus(next);
      const latest = getLatestReport();
      if (next.state === "cancelled" || next.state === "failed") setReport(next.report ?? latest);
      else setReport(latest ?? next.report);
      setRecording(performanceApi.isRecording());
      setReporting(performanceApi.reportingState());
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      refreshInFlight.current = false;
    }
  }, []);

  useEffect(() => {
    performanceApi.setReportingTokens(sessionWebhookToken, sessionNtfyToken);
    void refresh();
    return subscribePerformance(() => void refresh());
  }, [refresh]);

  // Poll only while a benchmark runs. Each request schedules the next one
  // after it resolves, so a slow backend cannot accumulate overlapping calls.
  useEffect(() => {
    if (status.state !== "running") return;
    let active = true;
    let timer: number | undefined;
    const poll = async () => {
      await refresh();
      if (active && statusRef.current.state === "running") {
        timer = window.setTimeout(() => void poll(), 700);
      }
    };
    timer = window.setTimeout(() => void poll(), 700);
    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [status.state, status.runId, refresh]);

  const run = async (mode: BenchmarkMode) => {
    setBusy(true);
    setError(null);
    try {
      const runId = await performanceApi.start(mode);
      statusRef.current = { ...EMPTY_STATUS, runId, state: "running" };
      setStatus(statusRef.current);
      await refresh();
    } catch (cause) {
      setError(readableError(cause));
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!status.runId) return;
    setBusy(true);
    try {
      await performanceApi.cancel(status.runId);
      await refresh();
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setBusy(false);
    }
  };

  const stopRecording = async () => {
    setBusy(true);
    try {
      const stopped = await performanceApi.stopRecording();
      setReport(stopped);
      await refresh();
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setBusy(false);
    }
  };

  const invalidateApproval = () => {
    if (approval || performanceApi.reportingState().approved || busy) {
      setApproval("");
      void performanceApi.disableReporting().then(() => setReporting(performanceApi.reportingState()), (cause: unknown) => setError(readableError(cause)));
    }
  };

  const changeDestination = (kind: "webhook" | "ntfy", value: string) => {
    invalidateApproval();
    if (kind === "webhook") {
      setWebhookUrl(value);
      save("performanceWebhookUrl", value);
    } else {
      setNtfyUrl(value);
      save("performanceNtfyUrl", value);
    }
  };

  const reviewDestinations = async () => {
    setPreviewLoading(true);
    setError(null);
    try {
      const example = getLatestReport() ?? await performanceApi.previewReport();
      setPreviewReport(example);
      setPreviewPayload(await performanceApi.previewPayload(diagnosticReport(example)));
      setPreviewOpen(true);
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setPreviewLoading(false);
    }
  };

  const approveDestinations = async () => {
    setBusy(true);
    setError(null);
    try {
      const token = await performanceApi.approve(webhookUrl.trim(), ntfyUrl.trim());
      setApproval(token);
      setPreviewOpen(false);
      await refresh();
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setBusy(false);
    }
  };

  const disableReporting = async () => {
    try {
      await performanceApi.disableReporting();
      setApproval("");
      setReporting(performanceApi.reportingState());
    } catch (cause) {
      setError(readableError(cause));
    }
  };

  const retryDelivery = async () => {
    setBusy(true);
    setError(null);
    try {
      await performanceApi.retryReport();
      setReporting(performanceApi.reportingState());
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setBusy(false);
    }
  };

  const exportReport = () => {
    if (!report) return;
    // Keep useful numeric samples in the local export while excluding any
    // implementation detail a stage might attach to its in-memory result.
    const exportable = {
      ...report,
      stages: report.stages.map((stage) => ({ ...stage, detail: null })),
    };
    const blob = new Blob([JSON.stringify(exportable, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `culltivate-performance-${safeFilePart(report.id)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const previewDiagnostic = previewReport ? diagnosticReport(previewReport) : null;
  const activeReport = report ?? status.report;
  const ranked = activeReport ? rankedStages(activeReport, rankBy) : [];
  const showP95 = ranked.some((stage) => stage.p95Ms !== null);
  const suggestions = activeReport ? recommendations(activeReport) : [];
  const isRunning = status.state === "running";
  const hasDestination = Boolean(webhookUrl.trim() || ntfyUrl.trim());
  const canStartBenchmark = !isRunning && !recording && !busy;

  return (
    <div className="space-y-4 pb-2">
      <section className="rounded-lg border border-border bg-muted/20 p-4" aria-labelledby="performance-benchmark-heading">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-xl">
            <h2 id="performance-benchmark-heading" className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Activity aria-hidden="true" className="size-4" />
              Benchmark this app
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {inTauri
                ? "Measure photo workflows with disposable fixtures. Your current folder and photos are left alone. Quick runs take about a minute; Thorough runs repeat more work."
                : "Browser demo mode measures frontend tasks only. Native photo scanning, RAW handling, ingest, and AI are unavailable and will be marked as skipped."}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button size="sm" variant="outline" disabled={!canStartBenchmark} onClick={() => void run("quick")}>
              Run Quick
            </Button>
            <Button size="sm" disabled={!canStartBenchmark} onClick={() => void run("thorough")}>
              Run Thorough
            </Button>
          </div>
        </div>

        {isRunning && (
          <div className="mt-4 space-y-2" aria-live="polite">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span>{status.current ?? "Preparing benchmark…"}</span>
              <span className="tabular-nums text-muted-foreground">
                {status.total > 0 ? `${status.completed} of ${status.total}` : "Working"}
              </span>
            </div>
            <progress
              aria-label="Benchmark progress"
              className="h-2 w-full accent-primary"
              max={status.total > 0 ? status.total : 1}
              value={status.total > 0 ? Math.min(status.completed, status.total) : undefined}
            />
            <div className="flex justify-end">
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void cancel()}>Cancel benchmark</Button>
            </div>
          </div>
        )}

        {status.state === "cancelled" && <p role="status" className="mt-3 text-xs text-muted-foreground">Benchmark cancelled. Completed measurements are shown below when available.</p>}
        {status.state === "failed" && status.error && <p role="alert" className="mt-3 text-xs text-destructive">{status.error}</p>}
      </section>

      <section className="rounded-lg border border-border p-4" aria-labelledby="performance-recording-heading">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 id="performance-recording-heading" className="text-sm font-semibold text-foreground">Record a work session</h2>
            <p className="mt-1 max-w-xl text-xs leading-relaxed text-muted-foreground">
              Optional, in-memory timings and categorized failures from normal workflows. Recording stops when you stop it or quit the app; it never stores filenames, photo paths, EXIF or images.
            </p>
          </div>
          {recording ? (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void stopRecording()}>Stop and save report</Button>
          ) : (
            <Button size="sm" variant="outline" disabled={isRunning || busy} onClick={() => {
              try {
                performanceApi.startRecording();
                setRecording(performanceApi.isRecording());
              } catch (cause) {
                setError(readableError(cause));
              }
            }}>Start recording</Button>
          )}
        </div>
        <p className="mt-2 text-xs" role="status">
          {recording
            ? <span className="text-foreground">Recording is on for this app session. Stop recording before starting a benchmark.</span>
            : isRunning
              ? <span className="text-muted-foreground">Recording can start after the benchmark finishes.</span>
              : <span className="text-muted-foreground">Recording is off.</span>}
        </p>
      </section>

      <ReportingSection
        webhookUrl={webhookUrl}
        ntfyUrl={ntfyUrl}
        webhookToken={webhookToken}
        ntfyToken={ntfyToken}
        reporting={reporting}
        canReview={hasDestination}
        isDesktop={inTauri}
        previewLoading={previewLoading}
        busy={busy}
        onWebhookUrl={(value) => changeDestination("webhook", value)}
        onNtfyUrl={(value) => changeDestination("ntfy", value)}
        onWebhookToken={(value) => {
          sessionWebhookToken = value;
          setWebhookToken(value);
          performanceApi.setReportingTokens(value, sessionNtfyToken);
        }}
        onNtfyToken={(value) => {
          sessionNtfyToken = value;
          setNtfyToken(value);
          performanceApi.setReportingTokens(sessionWebhookToken, value);
        }}
        onReview={() => void reviewDestinations()}
        onDisable={() => void disableReporting()}
        onRetry={() => void retryDelivery()}
      />

      {error && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">{error}</p>}

      {activeReport && (
        <ReportResults
          report={activeReport}
          ranked={ranked}
          rankBy={rankBy}
          showP95={showP95}
          suggestions={suggestions}
          onRankBy={setRankBy}
          onExport={exportReport}
        />
      )}

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] flex-col overflow-hidden sm:max-w-3xl">
          <DialogHeader className="shrink-0">
            <DialogTitle>Review diagnostic reporting</DialogTitle>
            <DialogDescription>
              This preview shows the fields sent after a benchmark completes or you stop a recording. Approval applies to these destinations and this payload version.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1 text-xs">
            <p className="rounded-md border border-border bg-muted/30 p-3 leading-relaxed">
              Included: app/build, OS and hardware availability, aggregate stage timings and failure counts, coverage, and measured recommendations. No photos, filenames, photo paths, EXIF, raw error text, endpoints, or bearer credentials are included in the report payload.
            </p>
            {previewDiagnostic && previewPayload && webhookUrl.trim() && (
              <PreviewBlock title={`Webhook JSON · ${webhookUrl.trim()}`} value={previewPayload.webhookJson} />
            )}
            {previewDiagnostic && previewPayload && ntfyUrl.trim() && (
              <PreviewBlock title={`ntfy message · ${ntfyUrl.trim()}`} value={previewPayload.ntfyMessage} />
            )}
          </div>
          <DialogFooter className="shrink-0">
            <Button variant="outline" disabled={busy} onClick={() => setPreviewOpen(false)}>Cancel</Button>
            <Button disabled={busy || !hasDestination || !inTauri} onClick={() => void approveDestinations()}>
              <ShieldCheck aria-hidden="true" />
              Approve and enable
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ReportingSection({
  webhookUrl,
  ntfyUrl,
  webhookToken,
  ntfyToken,
  reporting,
  canReview,
  isDesktop,
  previewLoading,
  busy,
  onWebhookUrl,
  onNtfyUrl,
  onWebhookToken,
  onNtfyToken,
  onReview,
  onDisable,
  onRetry,
}: {
  webhookUrl: string;
  ntfyUrl: string;
  webhookToken: string;
  ntfyToken: string;
  reporting: ReturnType<typeof performanceApi.reportingState>;
  canReview: boolean;
  isDesktop: boolean;
  previewLoading: boolean;
  busy: boolean;
  onWebhookUrl: (value: string) => void;
  onNtfyUrl: (value: string) => void;
  onWebhookToken: (value: string) => void;
  onNtfyToken: (value: string) => void;
  onReview: () => void;
  onDisable: () => void;
  onRetry: () => void;
}) {
  const result = reporting.result;
  const failed = Boolean(reporting.error || (result && (result.webhook.status === "failed" || result.ntfy.status === "failed")));
  return (
    <section className="rounded-lg border border-border p-4" aria-labelledby="performance-reporting-heading">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-xl">
          <h2 id="performance-reporting-heading" className="text-sm font-semibold text-foreground">Optional diagnostic reporting</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Reports stay on this device unless you configure and approve a destination. Webhook gets aggregate JSON; ntfy gets a compact summary. Each destination reports its own delivery status.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {reporting.approved ? (
            <Button size="sm" variant="outline" disabled={busy} onClick={onDisable}>Disable reporting</Button>
          ) : (
            <Button size="sm" variant="outline" disabled={!canReview || previewLoading || busy} onClick={onReview}>
              {previewLoading ? "Preparing preview…" : "Preview and approve"}
            </Button>
          )}
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="space-y-1.5 text-xs font-medium text-foreground">
          <span>Webhook URL</span>
          <input className="h-8 w-full min-w-0 rounded-md border border-input bg-background px-2.5 py-1 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50" type="url" autoComplete="url" placeholder="https://example.com/diagnostics" value={webhookUrl} onChange={(event) => onWebhookUrl(event.currentTarget.value)} />
          <span className="block font-normal leading-relaxed text-muted-foreground">Receives the structured aggregate report.</span>
        </label>
        <label className="space-y-1.5 text-xs font-medium text-foreground">
          <span>ntfy topic URL</span>
          <input className="h-8 w-full min-w-0 rounded-md border border-input bg-background px-2.5 py-1 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50" type="url" autoComplete="url" placeholder="https://ntfy.sh/my-topic" value={ntfyUrl} onChange={(event) => onNtfyUrl(event.currentTarget.value)} />
          <span className="block font-normal leading-relaxed text-muted-foreground">Receives a short status and the slowest measured stages.</span>
        </label>
        <label className="space-y-1.5 text-xs font-medium text-foreground">
          <span>Webhook bearer token <span className="font-normal text-muted-foreground">(optional)</span></span>
          <input className="h-8 w-full min-w-0 rounded-md border border-input bg-background px-2.5 py-1 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50" type="password" autoComplete="new-password" placeholder="Kept in memory for this app session" value={webhookToken} onChange={(event) => onWebhookToken(event.currentTarget.value)} />
        </label>
        <label className="space-y-1.5 text-xs font-medium text-foreground">
          <span>ntfy bearer token <span className="font-normal text-muted-foreground">(optional)</span></span>
          <input className="h-8 w-full min-w-0 rounded-md border border-input bg-background px-2.5 py-1 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50" type="password" autoComplete="new-password" placeholder="Kept in memory for this app session" value={ntfyToken} onChange={(event) => onNtfyToken(event.currentTarget.value)} />
        </label>
      </div>

      {!isDesktop && <p className="mt-3 rounded-md border border-border bg-muted/30 p-2.5 text-xs text-muted-foreground">Diagnostic delivery requires the desktop app. The browser demo can show frontend benchmark results only.</p>}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-3">
        <div className="min-w-0 flex-1" aria-live="polite">
          {reporting.approved ? (
            <p className="text-xs text-foreground">Approved for {destinationNames(reporting.webhookUrl, reporting.ntfyUrl)}{reporting.sending ? " · sending…" : ""}</p>
          ) : (
            <p className="text-xs text-muted-foreground">Automatic delivery is off until you review the payload and approve a destination.</p>
          )}
          {reporting.error && <p className="mt-1 text-xs text-destructive">{reporting.error}</p>}
          {reporting.reportId && <p className="mt-1 break-all text-[11px] text-muted-foreground">Latest report: {reporting.reportId}</p>}
        </div>
        {result && <DeliverySummary result={result} />}
        {failed && reporting.approved && <Button size="sm" variant="outline" disabled={busy || reporting.sending} onClick={onRetry}><RotateCcw aria-hidden="true" />Retry delivery</Button>}
      </div>
    </section>
  );
}

function ReportResults({
  report,
  ranked,
  rankBy,
  showP95,
  suggestions,
  onRankBy,
  onExport,
}: {
  report: BenchmarkReport;
  ranked: StageSummary[];
  rankBy: "total" | "latency";
  showP95: boolean;
  suggestions: Recommendation[];
  onRankBy: (by: "total" | "latency") => void;
  onExport: () => void;
}) {
  const durationMs = Math.max(0, report.finishedAtMs - report.startedAtMs);
  const failedStages = report.stages.filter((stage) => stage.status === "failed" || stage.failures > 0).length;
  return (
    <section className="space-y-3" aria-labelledby="performance-results-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="performance-results-heading" className="text-sm font-semibold text-foreground">{report.kind === "recording" ? "Work session report" : "Benchmark results"}</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {report.kind === "benchmark" ? `${report.mode ?? ""} · ` : ""}{formatDuration(durationMs)} total · {failedStages} stage{failedStages === 1 ? "" : "s"} with failures
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={onExport}><Download aria-hidden="true" />Export JSON</Button>
      </div>

      <EnvironmentSummary report={report} />

      <div className="rounded-lg border border-border p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-xs font-semibold">Measured stages</h3>
            <p className="mt-0.5 text-[11px] text-muted-foreground">Total cost ranks cumulative time. Typical latency ranks median sample time. Nested workflow totals are reported separately from stages.</p>
          </div>
          <div className="flex gap-1" role="group" aria-label="Rank stages by">
            <Button size="sm" variant={rankBy === "total" ? "secondary" : "ghost"} aria-pressed={rankBy === "total"} onClick={() => onRankBy("total")}>Total cost</Button>
            <Button size="sm" variant={rankBy === "latency" ? "secondary" : "ghost"} aria-pressed={rankBy === "latency"} onClick={() => onRankBy("latency")}>Typical latency</Button>
          </div>
        </div>
        {ranked.length ? (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-left text-xs">
              <thead className="text-[11px] text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="py-2 pr-3 font-medium">Stage</th>
                  <th className="px-2 py-2 font-medium">Cache</th>
                  <th className="px-2 py-2 text-right font-medium">Samples</th>
                  <th className="px-2 py-2 text-right font-medium">Total</th>
                  <th className="px-2 py-2 text-right font-medium">Median</th>
                  <th className="px-2 py-2 text-right font-medium">Max</th>
                  {showP95 && <th className="px-2 py-2 text-right font-medium" title="Shown only when there are at least 20 samples">P95</th>}
                  <th className="px-2 py-2 text-right font-medium">Throughput</th>
                  <th className="pl-2 py-2 text-right font-medium">Failures</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((stage, index) => <StageRow key={`${stage.id}-${index}`} stage={stage} detail={report.stages.find((entry) => entry.id === stage.id)?.detail ?? null} rank={index + 1} showP95={showP95} />)}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-3 text-xs text-muted-foreground">No completed stage measurements are available in this report.</p>
        )}
      </div>

      <CoverageResults coverage={report.coverage} />
      <RecommendationsResults recommendations={suggestions} />
    </section>
  );
}

function StageRow({ stage, detail, rank, showP95 }: { stage: StageSummary; detail: string | null; rank: number; showP95: boolean }) {
  return (
    <tr id={`performance-stage-${stage.id}`} className="border-b border-border/60 last:border-0">
      <th scope="row" className="max-w-[20rem] py-2 pr-3 font-medium">
        <span className="mr-2 text-muted-foreground">{rank}.</span>{stage.label}
        <span className="mt-0.5 block font-normal text-muted-foreground">{stage.category} · {stage.status}</span>
        {detail && <span className="mt-0.5 block font-normal leading-relaxed text-muted-foreground">{detail}</span>}
      </th>
      <td className="px-2 py-2 text-muted-foreground">{stage.cache}</td>
      <td className="px-2 py-2 text-right tabular-nums">{stage.count}</td>
      <td className="px-2 py-2 text-right tabular-nums">{formatMs(stage.totalMs)}</td>
      <td className="px-2 py-2 text-right tabular-nums">{formatMs(stage.medianMs)}</td>
      <td className="px-2 py-2 text-right tabular-nums">{formatMs(stage.maxMs)}</td>
      {showP95 && <td className="px-2 py-2 text-right tabular-nums">{stage.p95Ms === null ? "—" : formatMs(stage.p95Ms)}</td>}
      <td className="px-2 py-2 text-right tabular-nums">{stage.throughputPerSecond === null ? "—" : `${stage.throughputPerSecond.toFixed(1)}/s`}</td>
      <td className={`pl-2 py-2 text-right tabular-nums ${stage.failures ? "text-destructive" : "text-muted-foreground"}`}>{stage.failures}</td>
    </tr>
  );
}

function EnvironmentSummary({ report }: { report: BenchmarkReport }) {
  const environment = report.environment;
  const items = [
    ["App", `${environment.appVersion} · ${environment.build}`],
    ["System", `${environment.os} / ${environment.arch}`],
    ["CPU", environment.cpu ?? "Unavailable"],
    ["Cores and memory", `${environment.logicalCores} cores · ${environment.memoryMb === null ? "memory unavailable" : `${environment.memoryMb} MB`}`],
    ["GPU", environment.gpu ?? "Unavailable"],
    ["AI provider", environment.aiProvider ?? "Unavailable"],
    ["Fixtures", environment.fixtureVersion],
  ];
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border border-border bg-muted/20 p-3 text-xs sm:grid-cols-3">
      {items.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-[11px] text-muted-foreground">{label}</dt>
          <dd className="mt-0.5 break-words text-foreground">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function CoverageResults({ coverage }: { coverage: CoverageEntry[] }) {
  const measured = coverage.filter((entry) => entry.status === "measured");
  const skipped = coverage.filter((entry) => entry.status === "skipped");
  const manual = coverage.filter((entry) => entry.status === "manual");
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <CoverageGroup title="Measured" entries={measured} tone="text-foreground" />
      <CoverageGroup title="Skipped" entries={skipped} tone="text-muted-foreground" />
      <CoverageGroup title="Manual checks" entries={manual} tone="text-muted-foreground" />
    </div>
  );
}

function CoverageGroup({ title, entries, tone }: { title: string; entries: CoverageEntry[]; tone: string }) {
  return (
    <section className="rounded-lg border border-border p-3">
      <h3 className="text-xs font-semibold">{title} <span className="font-normal text-muted-foreground">({entries.length})</span></h3>
      {entries.length ? (
        <ul className="mt-2 space-y-2 text-xs">
          {entries.map((entry) => (
            <li key={entry.id} className={tone}>
              <span className="font-medium">{entry.label}</span>
              {entry.reason && <span className="mt-0.5 block leading-relaxed text-muted-foreground">{entry.reason}</span>}
            </li>
          ))}
        </ul>
      ) : <p className="mt-2 text-xs text-muted-foreground">None reported.</p>}
    </section>
  );
}

function RecommendationsResults({ recommendations: items }: { recommendations: Recommendation[] }) {
  return (
    <section className="rounded-lg border border-border p-3" aria-labelledby="performance-recommendations-heading">
      <h3 id="performance-recommendations-heading" className="text-xs font-semibold">Suggestions from this run</h3>
      {items.length ? (
        <ol className="mt-2 space-y-2">
          {items.map((recommendation, index) => (
            <li key={`${recommendation.stageId}-${index}`} className="rounded-md bg-muted/30 p-2.5 text-xs">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <span className="font-medium text-foreground">{recommendation.action}</span>
                <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-secondary-foreground">{recommendation.priority} priority</span>
              </div>
              <p className="text-muted-foreground">Evidence: {recommendation.evidence}</p>
              <a className="mt-1 inline-block text-[11px] text-primary underline-offset-2 hover:underline" href={`#performance-stage-${encodeURIComponent(recommendation.stageId)}`}>
                View measured stage
              </a>
            </li>
          ))}
        </ol>
      ) : <p className="mt-2 text-xs leading-relaxed text-muted-foreground">No optimization suggestion was supported by this run’s measurements. Repeat runs with the same mode before comparing changes.</p>}
    </section>
  );
}

function DeliverySummary({ result }: { result: DeliveryResult }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px]" aria-live="polite">
      <span>Webhook: <DeliveryStatus status={result.webhook.status} />{result.webhook.error && <span className="ml-1 text-destructive" title={result.webhook.error}>({clip(result.webhook.error)})</span>}</span>
      <span>ntfy: <DeliveryStatus status={result.ntfy.status} />{result.ntfy.error && <span className="ml-1 text-destructive" title={result.ntfy.error}>({clip(result.ntfy.error)})</span>}</span>
    </div>
  );
}

function DeliveryStatus({ status }: { status: DeliveryResult["webhook"]["status"] }) {
  const tone = status === "sent" ? "text-foreground" : status === "failed" ? "text-destructive" : "text-muted-foreground";
  return <span className={tone}>{status}</span>;
}

function PreviewBlock({ title, value }: { title: string; value: string }) {
  return (
    <section>
      <h3 className="mb-1 font-semibold">{title}</h3>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted/30 p-3 font-mono text-[11px] leading-relaxed">{value}</pre>
    </section>
  );
}

function destinationNames(webhook: string, ntfy: string): string {
  const destinations = [webhook && "webhook", ntfy && "ntfy"].filter(Boolean);
  return destinations.length ? destinations.join(" and ") : "no destinations";
}

function formatMs(value: number): string {
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })} ms`;
}

function formatDuration(value: number): string {
  if (value < 1_000) return formatMs(value);
  const seconds = value / 1_000;
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} min ${Math.round(seconds % 60)} s`;
}

function readableError(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function safeFilePart(value: string): string {
  return value.replace(/[^a-z0-9_-]/gi, "-").slice(0, 64) || "report";
}

function clip(value: string): string {
  return value.length > 72 ? `${value.slice(0, 69)}…` : value;
}
