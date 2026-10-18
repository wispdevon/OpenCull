import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, ChevronDown, Download, RotateCcw, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { inTauri } from "@/lib/api";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  diagnosticReport,
  rankedStages,
  stageScoreMs,
  recommendations,
  type BenchmarkMode,
  type BenchmarkReport,
  type BenchmarkStatus,
  type CoverageEntry,
  type DeliveryResult,
  type PerformanceEnvironment,
  type Recommendation,
  type StageSummary,
} from "@/lib/performance";
import {
  scoreReport,
  type TypicalDatabase,
} from "@/lib/performance-scores";
import {
  rateHardware,
  type HardwareCatalogue,
  type HardwareIdentity,
  type HardwareRatings,
} from "@/lib/hardware-ratings";
import { getSystemId, DEFAULT_LOGS_NTFY_URL, DEFAULT_PERF_NTFY_URL } from "@/lib/performance-preferences";
import {
  getLatestReport,
  performanceApi,
  subscribePerformance,
  type ReportingConfiguration,
} from "@/lib/performance-api";
import { colorForStage, ETC_THRESHOLD_MS, timingBreakdown } from "@/lib/performance-breakdown";
import { compactWorkload, interpretStage } from "@/lib/performance-interpretation";
import typicalSpeeds from "../../benchmarks/typical-speeds.json";
import hardwareSpecifications from "../../benchmarks/hardware-specifications.json";

const HARDWARE_REFERENCE_URL = "https://github.com/wispdevon/OpenCull/blob/main/benchmarks/README.md";
const HARDWARE_CATALOGUE = hardwareSpecifications as HardwareCatalogue;
const UNKNOWN_HARDWARE: HardwareIdentity = { cpuModel: null, gpuModel: null, installedMemoryMb: null };

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
  const [rankBy, setRankBy] = useState<"score" | "latency">("score");
  const [recording, setRecording] = useState(() => performanceApi.isRecording());
  const [reporting, setReporting] = useState(() => performanceApi.reportingState());
  const [hardwareEnvironment, setHardwareEnvironment] = useState<PerformanceEnvironment | null>(null);
  const [hardwareEnvironmentLoading, setHardwareEnvironmentLoading] = useState(true);
  const [hardwareEnvironmentError, setHardwareEnvironmentError] = useState<string | null>(null);
  const [systemId] = useState(() => getSystemId());
  const [reportingConfiguration, setReportingConfiguration] = useState<ReportingConfiguration | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewReport, setPreviewReport] = useState<BenchmarkReport | null>(null);
  const [previewPayload, setPreviewPayload] = useState<{ webhookJson: string; ntfyMessage: string } | null>(null);
  const [previewWebhookConfigured, setPreviewWebhookConfigured] = useState(false);
  const [submitAfterApproval, setSubmitAfterApproval] = useState(false);
  const previewRevision = useRef(0);

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
    void refresh();
    return subscribePerformance(() => void refresh());
  }, [refresh]);

  useEffect(() => {
    let active = true;
    void performanceApi.configuration().then((configuration) => {
      if (active) setReportingConfiguration(configuration);
    }).catch(() => {
      if (active) setReportingConfiguration(null);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    void performanceApi.getEnvironment().then((environment) => {
      if (active) setHardwareEnvironment(environment);
    }).catch((cause) => {
      if (active) setHardwareEnvironmentError(readableError(cause));
    }).finally(() => {
      if (active) setHardwareEnvironmentLoading(false);
    });
    return () => { active = false; };
  }, []);

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

  const run = async (mode: BenchmarkMode, submit = false) => {
    setBusy(true);
    setError(null);
    try {
      const runId = await performanceApi.start(mode, submit);
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

  const previewReporting = async (): Promise<boolean> => {
    const revision = ++previewRevision.current;
    setPreviewLoading(true);
    setError(null);
    try {
      const configurationPromise = performanceApi.configuration();
      const latest = getLatestReport() ?? await performanceApi.previewReport();
      const configuration = await configurationPromise;
      const payload = await performanceApi.previewPayload(diagnosticReport(latest));
      if (revision !== previewRevision.current) return false;
      setReportingConfiguration(configuration);
      setPreviewWebhookConfigured(configuration.webhookConfigured);
      setPreviewReport(latest);
      setPreviewPayload(payload);
      setPreviewOpen(true);
      return true;
    } catch (cause) {
      setError(readableError(cause));
      return false;
    } finally {
      if (revision === previewRevision.current) setPreviewLoading(false);
    }
  };

  const runAndSubmit = async () => {
    if (!inTauri) return;
    if (reporting.approved) {
      await run("thorough", true);
      return;
    }
    setSubmitAfterApproval(true);
    if (!(await previewReporting())) setSubmitAfterApproval(false);
  };

  const approveReporting = async () => {
    if (!previewReport || !previewPayload) return;
    const shouldRunAndSubmit = submitAfterApproval;
    let launchBenchmark = false;
    setBusy(true);
    setError(null);
    try {
      await performanceApi.approve();
      setPreviewOpen(false);
      setSubmitAfterApproval(false);
      await refresh();
      launchBenchmark = shouldRunAndSubmit;
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setBusy(false);
    }
    if (launchBenchmark) await run("thorough", true);
  };

  const disableReporting = async () => {
    try {
      await performanceApi.disableReporting();
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

  const openHardwareReference = async () => {
    try {
      await openUrl(HARDWARE_REFERENCE_URL);
    } catch (cause) {
      setError(readableError(cause));
    }
  };

  const exportReport = () => {
    if (!report) return;
    // Keep useful numeric samples in the local export while excluding any
    // implementation detail a stage might attach to its in-memory result.
    const exportable = {
      ...report,
      performanceScores: scoreReport(report, typicalSpeeds as TypicalDatabase),
      hardwareRatings: rateHardware(report.environment.hardwareSpecs ?? UNKNOWN_HARDWARE, HARDWARE_CATALOGUE),
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
  const totalRanked = activeReport ? rankedStages(activeReport, "total") : [];
  const suggestions = activeReport ? recommendations(activeReport) : [];
  const isRunning = status.state === "running";
  const canStartBenchmark = !isRunning && !recording && !busy;
  const currentHardwareIdentity = hardwareEnvironment?.hardwareSpecs ?? UNKNOWN_HARDWARE;
  const currentHardwareRatings = hardwareEnvironment
    ? rateHardware(currentHardwareIdentity, HARDWARE_CATALOGUE)
    : null;

  return (
    <div className="space-y-4 pb-2">
      <HardwareRatingsPanel
        environment={hardwareEnvironment}
        ratings={currentHardwareRatings}
        loading={hardwareEnvironmentLoading}
        error={hardwareEnvironmentError}
        onOpenReference={() => void openHardwareReference()}
      />

      <section className="rounded-lg border border-border bg-muted/20 p-4" aria-labelledby="performance-benchmark-heading">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-xl">
            <h2 id="performance-benchmark-heading" className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Activity aria-hidden="true" className="size-4" />
              Benchmark this app
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {inTauri
                ? "Thorough tests use disposable fixtures. Your photos stay untouched."
                : "Browser demo: frontend tests only. Submission requires the desktop app."}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button size="sm" variant="outline" disabled={!canStartBenchmark} onClick={() => void run("thorough", false)}>
              Run benchmark
            </Button>
            <Button size="sm" disabled={!canStartBenchmark || !inTauri} onClick={() => void runAndSubmit()}>
              Run and submit
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
        webhookConfigured={reportingConfiguration?.webhookConfigured ?? null}
        performanceTopic={topicName(reportingConfiguration?.ntfyUrl, DEFAULT_PERF_NTFY_URL)}
        logsTopic={topicName(reportingConfiguration?.logsUrl, DEFAULT_LOGS_NTFY_URL)}
        systemId={systemId}
        ntfyLabel={reporting.reportKind === "recording" ? "Logs topic" : "Performance topic"}
        reporting={reporting}
        isDesktop={inTauri}
        previewLoading={previewLoading}
        busy={busy}
        onReview={() => void previewReporting()}
        onDisable={() => void disableReporting()}
        onRetry={() => void retryDelivery()}
      />

      {error && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">{error}</p>}

      {activeReport && (
        <ReportResults
          report={activeReport}
          ranked={ranked}
          totalRanked={totalRanked}
          rankBy={rankBy}
          suggestions={suggestions}
          onRankBy={setRankBy}
          onExport={exportReport}
        />
      )}

      <Dialog open={previewOpen} onOpenChange={(open) => {
        if (!open) {
          previewRevision.current++;
          setSubmitAfterApproval(false);
        }
        setPreviewOpen(open);
      }}>
        <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] flex-col overflow-hidden sm:max-w-3xl">
          <DialogHeader className="shrink-0">
            <DialogTitle>Review diagnostic reporting</DialogTitle>
            <DialogDescription>
              {submitAfterApproval
                ? <>Approve these destinations, then the thorough benchmark starts and its aggregate report is submitted automatically. <span className="mt-1 block">Values shown below are a preview; the completed run supplies its own measurements.</span></>
                : "Approve these destinations for automatic delivery after work-session recording. Benchmarks stay local unless you choose Run and submit."}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1 text-xs">
            <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
              <li>System ID, app/build, OS and architecture, CPU and GPU models, installed RAM and hardware specification ratings, AI provider and fixture version, measured timings, failures and suggestions.</li>
              <li>Photos and filenames stay on this device.</li>
              <li>Benchmarks → culltivate-perf · session logs → culltivate-logs{previewWebhookConfigured ? " · webhook included" : ""}.</li>
            </ul>
            {previewDiagnostic && previewPayload && <ReportPreview webhookJson={previewWebhookConfigured ? previewPayload.webhookJson : null} message={previewPayload.ntfyMessage} />}
          </div>
          <DialogFooter className="shrink-0">
            <Button variant="outline" disabled={busy} onClick={() => { previewRevision.current++; setPreviewOpen(false); setSubmitAfterApproval(false); }}>Cancel</Button>
            <Button disabled={busy || !inTauri} onClick={() => void approveReporting()}>
              <ShieldCheck aria-hidden="true" />
              {submitAfterApproval ? "Approve and run benchmark" : "Approve and enable"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ReportingSection({
  webhookConfigured,
  performanceTopic,
  logsTopic,
  systemId,
  ntfyLabel,
  reporting,
  isDesktop,
  previewLoading,
  busy,
  onReview,
  onDisable,
  onRetry,
}: {
  webhookConfigured: boolean | null;
  performanceTopic: string;
  logsTopic: string;
  systemId: string;
  ntfyLabel: string;
  reporting: ReturnType<typeof performanceApi.reportingState>;
  isDesktop: boolean;
  previewLoading: boolean;
  busy: boolean;
  onReview: () => void;
  onDisable: () => void;
  onRetry: () => void;
}) {
  const result = reporting.result;
  const failed = Boolean(reporting.error || (result && (result.webhook.status === "failed" || result.ntfy.status === "failed")));
  const webhookStatus = webhookConfigured === null ? "Checking configuration…" : webhookConfigured ? "Configured" : "Not configured";
  return (
    <section className="rounded-lg border border-border p-4" aria-labelledby="performance-reporting-heading">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-xl">
          <h2 id="performance-reporting-heading" className="text-sm font-semibold text-foreground">Optional diagnostic reporting</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Reports stay on this device unless you approve delivery. Destinations are fixed: benchmarks are sent only when you choose Run and submit; work-session recordings send automatically after you stop and save while reporting is approved. An existing webhook receives aggregate reports when configured.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {reporting.approved ? (
            <Button size="sm" variant="outline" disabled={busy} onClick={onDisable}>Disable reporting</Button>
          ) : (
            <Button size="sm" variant="outline" disabled={previewLoading || busy} onClick={onReview}>
              {previewLoading ? "Preparing preview…" : "Preview and approve"}
            </Button>
          )}
        </div>
      </div>

      <dl className="mt-3 flex flex-wrap items-baseline gap-x-2 text-xs">
        <dt className="text-muted-foreground">System ID</dt>
        <dd className="font-mono font-medium text-foreground" title="Random installation identifier; it contains no hardware or hostname information.">{systemId}</dd>
      </dl>

      <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-3">
        <div className="rounded-md border border-border/70 bg-muted/20 p-2.5">
          <dt className="text-[11px] text-muted-foreground">Webhook</dt>
          <dd className="mt-1 font-medium text-foreground">{webhookStatus}</dd>
          <dd className="mt-1 text-[11px] leading-relaxed text-muted-foreground">Webhook configuration is read-only here. No URL or credential is displayed.</dd>
        </div>
        <div className="rounded-md border border-border/70 bg-muted/20 p-2.5">
          <dt className="text-[11px] text-muted-foreground">Benchmark summaries</dt>
          <dd className="mt-1 font-medium text-foreground">{performanceTopic}</dd>
          <dd className="mt-1 text-[11px] leading-relaxed text-muted-foreground">Fixed ntfy topic for benchmark reports.</dd>
        </div>
        <div className="rounded-md border border-border/70 bg-muted/20 p-2.5">
          <dt className="text-[11px] text-muted-foreground">Work-session logs</dt>
          <dd className="mt-1 font-medium text-foreground">{logsTopic}</dd>
          <dd className="mt-1 text-[11px] leading-relaxed text-muted-foreground">Fixed ntfy topic for bounded timing summaries.</dd>
        </div>
      </dl>

      {!isDesktop && (
        <p className="mt-3 rounded-md border border-border bg-muted/30 p-2.5 text-xs text-muted-foreground">
          Diagnostic delivery and approval require the desktop app. The browser demo can show frontend benchmark results only.
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-3">
        <div className="min-w-0 flex-1" aria-live="polite">
          {reporting.approved ? (
            <p className="text-xs text-foreground">
              Approved: benchmarks → {performanceTopic}; work-session logs → {logsTopic}{webhookConfigured ? "; configured webhook included" : ""}{reporting.sending ? " · sending…" : ""}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">Automatic delivery is off until you preview the payload and approve the fixed destinations.</p>
          )}
          {reporting.error && <p className="mt-1 text-xs text-destructive">{reporting.error}</p>}
          {reporting.reportId && <p className="mt-1 break-all text-[11px] text-muted-foreground">Latest report: {reporting.reportId}</p>}
        </div>
        {result && <DeliverySummary result={result} ntfyLabel={ntfyLabel} />}
        {failed && reporting.approved && <Button size="sm" variant="outline" disabled={busy || reporting.sending} onClick={onRetry}><RotateCcw aria-hidden="true" />Retry latest report</Button>}
      </div>
    </section>
  );
}

function HardwareRatingsPanel({
  environment,
  ratings,
  loading,
  error,
  onOpenReference,
}: {
  environment: PerformanceEnvironment | null;
  ratings: HardwareRatings | null;
  loading: boolean;
  error: string | null;
  onOpenReference: () => void;
}) {
  const hardware = environment?.hardwareSpecs ?? UNKNOWN_HARDWARE;
  const sourceTitle = (sourceId: string) => HARDWARE_CATALOGUE.sources[sourceId]?.title ?? sourceId;
  const cpu = ratings?.components.cpu;
  const gpu = ratings?.components.gpu;
  const ram = ratings?.components.ram;
  const systemDetails = [
    cpu ? `CPU ${formatHardwarePoints(cpu.points)}` : null,
    gpu ? `GPU ${formatHardwarePoints(gpu.points)}` : null,
    ram ? `RAM ${formatHardwarePoints(ram.points)}` : null,
  ].filter(Boolean).join(" · ") || "No matched hardware components";
  const gpuDetails = gpu
    ? `${gpu.shaderCores.toLocaleString()} shader cores · ${gpu.baseClockMHz.toLocaleString()} MHz base clock · ${gpu.vramGiB.toLocaleString()} GiB VRAM`
    : "GPU specifications not matched";

  return (
    <section className="@container rounded-lg border border-border bg-muted/20 p-4" aria-labelledby="hardware-ratings-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="hardware-ratings-heading" className="text-sm font-semibold text-foreground">Hardware specification ratings</h2>
          <p className="mt-1 text-xs text-muted-foreground">Current hardware · higher ratings indicate stronger listed specifications; fixed formula, independent of benchmark timings.</p>
          <p className="mt-1 text-[11px] text-muted-foreground">System: CPU 60% · GPU 30% · installed RAM 10% · GPU rating: shader cores and base clock.</p>
          <p className="mt-1 text-[11px] text-muted-foreground">Formula v{HARDWARE_CATALOGUE.formulaVersion} · catalogue {HARDWARE_CATALOGUE.version}</p>
        </div>
        <a className="text-[11px] text-muted-foreground underline underline-offset-4 hover:text-foreground"
          href={HARDWARE_REFERENCE_URL} target="_blank" rel="noreferrer"
          onClick={inTauri ? (event) => { event.preventDefault(); onOpenReference(); } : undefined}>
          Formula and component sources
        </a>
      </div>

      <ul className="mt-3 grid gap-2 @md:grid-cols-2">
        <li>
          <HardwareRatingCard
            title="System rating"
            result={ratings?.system ?? { value: null, reason: "unknown-cpu" }}
            detail={systemDetails}
            identity={hardware}
            loading={loading}
          />
        </li>
        <li>
          <HardwareRatingCard
            title="GPU rating"
            result={ratings?.gpu ?? { value: null, reason: "unknown-gpu" }}
            detail={gpuDetails}
            identity={hardware}
            loading={loading}
          />
        </li>
      </ul>

      <dl className="mt-3 grid gap-x-4 gap-y-2 text-xs sm:grid-cols-3">
        <div className="min-w-0"><dt className="text-[11px] text-muted-foreground">CPU model</dt><dd className="mt-0.5 break-words text-foreground">{hardware.cpuModel ?? "Unavailable"}</dd></div>
        <div className="min-w-0"><dt className="text-[11px] text-muted-foreground">GPU model</dt><dd className="mt-0.5 break-words text-foreground">{hardware.gpuModel ?? "Unavailable"}</dd></div>
        <div className="min-w-0"><dt className="text-[11px] text-muted-foreground">Installed RAM</dt><dd className="mt-0.5 text-foreground">{installedMemoryLabel(hardware.installedMemoryMb)}</dd></div>
      </dl>

      <details className="mt-3 text-[11px] text-muted-foreground">
        <summary className="w-fit cursor-pointer">Rating formula and matched components</summary>
        <p className="mt-1 leading-relaxed">
          System = round(60% CPU + 30% GPU + 10% installed RAM). CPU points = physical cores × base clock ÷ 10; GPU points = shader cores × base clock × 2 ÷ 10,000; RAM points = installed GiB × 100. Higher ratings describe listed specification capacity, not measured speed.
        </p>
        <ul className="mt-2 space-y-1">
          <li>{cpu ? `CPU: ${cpu.physicalCores} physical cores · ${cpu.baseClockMHz.toLocaleString()} MHz · source ${sourceTitle(cpu.sourceId)}` : "CPU: no catalogue match"}</li>
          <li>{gpu ? `GPU: ${gpu.shaderCores.toLocaleString()} shader cores · ${gpu.baseClockMHz.toLocaleString()} MHz · ${gpu.vramGiB.toLocaleString()} GiB VRAM · source ${sourceTitle(gpu.sourceId)}` : "GPU: no catalogue match"}</li>
          <li>{ram ? `RAM: ${ram.installedGiB.toLocaleString()} GiB installed` : "RAM: installed capacity unavailable"}</li>
        </ul>
      </details>
      {loading && <p className="mt-2 text-[11px] text-muted-foreground" role="status">Reading current hardware specifications…</p>}
      {error && <p className="mt-2 text-[11px] text-destructive" role="alert">Hardware specifications could not be read: {error}</p>}
    </section>
  );
}

function HardwareRatingCard({
  title,
  result,
  detail,
  identity,
  loading,
}: {
  title: string;
  result: HardwareRatings["system"];
  detail: string;
  identity: HardwareIdentity;
  loading: boolean;
}) {
  return (
    <div className="h-full rounded-md border border-border/70 bg-background/60 p-3">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-xs font-medium text-foreground">{title}</h3>
        {loading
          ? <span className="shrink-0 text-xs font-medium text-muted-foreground">Checking…</span>
          : result.value === null
            ? <span className="shrink-0 text-xs font-medium text-muted-foreground">Unavailable</span>
          : <span className="shrink-0 font-mono text-lg font-semibold tabular-nums text-foreground">{result.value.toLocaleString()} <span className="font-sans text-[10px] font-normal text-muted-foreground">points</span></span>}
      </div>
      <p className="mt-1 break-words text-[11px] leading-relaxed text-muted-foreground">
        {loading ? "Reading current hardware specifications…" : result.value === null ? hardwareRatingUnavailableText(result.reason, identity) : detail}
      </p>
    </div>
  );
}

function hardwareRatingUnavailableText(reason: HardwareRatings["system"]["reason"], identity: HardwareIdentity): string {
  switch (reason) {
    case "unknown-cpu": return identity.cpuModel ? "CPU model is not listed in the hardware catalogue." : "CPU model was not reported.";
    case "unknown-gpu": return identity.gpuModel ? "GPU model is not listed in the hardware catalogue." : "GPU model was not reported.";
    case "unknown-memory": return "Installed RAM capacity is unavailable.";
    case "invalid-memory": return "Installed RAM capacity is invalid.";
    case "invalid-catalogue": return "The bundled hardware catalogue is invalid.";
    case "ambiguous-cpu": return "CPU model matches more than one catalogue entry.";
    case "ambiguous-gpu": return "GPU model matches more than one catalogue entry.";
    case null: return "This hardware rating is unavailable.";
  }
}

function formatHardwarePoints(points: number): string {
  return points.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function installedMemoryLabel(memoryMb: number | null): string {
  if (memoryMb === null) return "Unavailable";
  if (!Number.isFinite(memoryMb) || memoryMb <= 0) return "Invalid capacity";
  return `${(memoryMb / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 })} GiB (${Math.round(memoryMb).toLocaleString()} MiB)`;
}

function ReportResults({
  report,
  ranked,
  totalRanked,
  rankBy,
  suggestions,
  onRankBy,
  onExport,
}: {
  report: BenchmarkReport;
  ranked: StageSummary[];
  totalRanked: StageSummary[];
  rankBy: "score" | "latency";
  suggestions: Recommendation[];
  onRankBy: (by: "score" | "latency") => void;
  onExport: () => void;
}) {
  const durationMs = Math.max(0, report.finishedAtMs - report.startedAtMs);
  const failedStages = report.stages.filter((stage) => stage.status === "failed" || stage.failures > 0).length;
  const majorStages = ranked.filter((stage) => stage.totalMs >= ETC_THRESHOLD_MS);
  const minorStages = ranked.filter((stage) => stage.totalMs < ETC_THRESHOLD_MS);
  const minorTotalMs = minorStages.reduce((sum, stage) => sum + stage.totalMs, 0);
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

      <TimingOverview reportId={report.id} stages={totalRanked} elapsedMs={durationMs} />

      <div className="rounded-lg border border-border p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-xs font-semibold">Measured stages</h3>
            <p className="mt-0.5 text-[11px] text-muted-foreground">Typical: median · Score: average ms per run. Lower is faster.</p>
          </div>
          <div className="flex gap-1" role="group" aria-label="Rank stages by">
            <Button size="sm" variant={rankBy === "score" ? "secondary" : "ghost"} aria-pressed={rankBy === "score"} onClick={() => onRankBy("score")}>Score</Button>
            <Button size="sm" variant={rankBy === "latency" ? "secondary" : "ghost"} aria-pressed={rankBy === "latency"} onClick={() => onRankBy("latency")}>Typical latency</Button>
          </div>
        </div>
        <InterpretationGuide report={report} />
        {ranked.length ? (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[360px] border-collapse text-left text-xs">
              <caption className="sr-only">Measured function stages and their timing and reliability data</caption>
              <StageTableHead />
              <tbody>
                {majorStages.map((stage) => <StageRow key={stage.id} stage={stage} report={report} detail={report.stages.find((entry) => entry.id === stage.id)?.detail ?? null} rank={ranked.indexOf(stage) + 1} />)}
                {minorStages.length > 0 && (
                  <tr>
                    <td colSpan={3} className="py-2">
                      <details className="group rounded-md border border-border/70 bg-muted/20 px-2 py-1.5">
                        <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 [&::-webkit-details-marker]:hidden">
                          <span className="font-medium">etc</span>
                          <span className="text-muted-foreground">· {minorStages.length} stages with totals under 1 second each</span>
                          <span className="ml-auto tabular-nums text-muted-foreground">{formatDuration(minorTotalMs)} combined</span>
                          <ChevronDown aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
                        </summary>
                        <div className="mt-2 overflow-x-auto border-t border-border/70 pt-1">
                          <table className="w-full min-w-[360px] border-collapse text-left text-xs">
                            <caption className="sr-only">Individual stages grouped under etc, each below one second</caption>
                            <StageTableHead />
                            <tbody>
                              {minorStages.map((stage) => <StageRow key={stage.id} stage={stage} report={report} detail={report.stages.find((entry) => entry.id === stage.id)?.detail ?? null} rank={ranked.indexOf(stage) + 1} />)}
                            </tbody>
                          </table>
                        </div>
                      </details>
                    </td>
                  </tr>
                )}
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

function StageTableHead() {
  return (
    <thead className="text-[11px] text-muted-foreground">
      <tr className="border-b border-border">
        <th scope="col" className="py-2 pr-3 font-medium">Stage</th>
        <th scope="col" className="px-2 py-2 text-right font-medium" title="Median time for one run">Typical</th>
        <th scope="col" className="pl-2 py-2 text-right font-medium" title="Average milliseconds per run: sum of sample times divided by sample count">Score</th>
      </tr>
    </thead>
  );
}

function TimingOverview({ reportId, stages, elapsedMs }: { reportId: string; stages: StageSummary[]; elapsedMs: number }) {
  const breakdown = timingBreakdown(stages);
  if (!breakdown.totalMs) {
    return (
      <section className="rounded-lg border border-border p-3" aria-labelledby="performance-timing-heading">
        <h3 id="performance-timing-heading" className="text-xs font-semibold">Where measured time went</h3>
        <p className="mt-2 text-xs text-muted-foreground">No completed function timings are available for this report.</p>
      </section>
    );
  }

  const barSegments = [...breakdown.functions, ...(breakdown.etc ? [breakdown.etc] : [])];
  const listId = `performance-timing-legend-${safeFilePart(reportId)}`;
  const etcLabel = breakdown.minorFunctions.length === 1 ? "function" : "functions";
  return (
    <section className="rounded-lg border border-border p-3" aria-labelledby="performance-timing-heading">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div>
          <h3 id="performance-timing-heading" className="text-xs font-semibold">Where measured time went</h3>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            Share of measured time. Functions under 1 second total are grouped as “etc.”
          </p>
        </div>
        <dl className="flex gap-4 text-xs tabular-nums">
          <div><dt className="text-[11px] text-muted-foreground">Measured</dt><dd className="font-medium text-foreground">{formatDuration(breakdown.totalMs)}</dd></div>
          <div><dt className="text-[11px] text-muted-foreground">Elapsed</dt><dd className="font-medium text-foreground">{formatDuration(elapsedMs)}</dd></div>
        </dl>
      </div>

      <figure className="mt-3">
        <div
          className="flex h-6 w-full overflow-hidden rounded-md border border-border bg-muted/40"
          role="img"
          aria-label={`Horizontal time breakdown: ${breakdown.functions.length} functions with cumulative totals of at least one second and ${breakdown.minorFunctions.length} shorter functions grouped as etc.`}
          aria-describedby={listId}
        >
          {barSegments.map((segment) => (
            <span
              key={segment.id}
              className="h-full min-w-0 border-r border-background/70 last:border-r-0"
              style={{ width: `${segment.sharePercent}%`, backgroundColor: segment.color }}
              title={`${segment.label}: ${formatDuration(segment.totalMs)} (${segment.sharePercent.toFixed(1)}%)`}
              aria-hidden="true"
            />
          ))}
        </div>
        <figcaption className="mt-1.5 text-[11px] text-muted-foreground">
          The bar covers {formatDuration(breakdown.totalMs)} of recorded stage time across {stages.length} measured functions.
        </figcaption>
      </figure>

      <ul id={listId} className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
        {breakdown.functions.map((segment) => (
          <li key={segment.id} className="flex min-w-0 items-center gap-2">
            <span className="size-2.5 shrink-0 rounded-sm border border-foreground/15" style={{ backgroundColor: segment.color }} aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate" title={segment.label}>{segment.label}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">{formatDuration(segment.totalMs)} · {segment.sharePercent.toFixed(1)}%</span>
          </li>
        ))}
        {breakdown.etc && (
          <li className="sm:col-span-2">
            <details className="group rounded-md border border-border/70 bg-muted/20 px-2 py-1.5">
              <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 [&::-webkit-details-marker]:hidden">
                <span className="size-2.5 shrink-0 rounded-sm border border-foreground/15" style={{ backgroundColor: breakdown.etc.color }} aria-hidden="true" />
                <span className="font-medium">etc</span>
                <span className="text-muted-foreground">· {breakdown.minorFunctions.length} {etcLabel} under 1 second each</span>
                <span className="ml-auto tabular-nums text-muted-foreground">{formatDuration(breakdown.etc.totalMs)} · {breakdown.etc.sharePercent.toFixed(1)}%</span>
                <ChevronDown aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
              </summary>
              <ul className="mt-2 grid gap-2 border-t border-border/70 pt-2 text-[11px] sm:grid-cols-2">
                {breakdown.minorFunctions.map((segment) => (
                  <li key={segment.id} className="flex min-w-0 items-center gap-2">
                    <span className="size-2.5 shrink-0 rounded-sm border border-foreground/15" style={{ backgroundColor: segment.color }} aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate" title={segment.label}>{segment.label}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">{formatDuration(segment.totalMs)} · {segment.sharePercent.toFixed(1)}%</span>
                  </li>
                ))}
              </ul>
            </details>
          </li>
        )}
      </ul>
    </section>
  );
}

function InterpretationGuide({ report }: { report: BenchmarkReport }) {
  const hasNativeFixture = report.kind === "benchmark" && ["2-6000x4000-texture", "3-6000x4000-texture-ai-cache", "4-6000x4000-texture-gpu-ai"].includes(report.environment.fixtureVersion);
  return (
    <details className="mt-2 text-[11px] text-muted-foreground">
      <summary className="w-fit cursor-pointer">About these numbers</summary>
      <p className="mt-1 leading-relaxed">Runs reuse the same inputs. Targets are rough guides for this workload; hardware and system load affect results.</p>
      {hasNativeFixture && <p className="mt-1 leading-relaxed">Scans: {report.mode === "thorough" ? "50 photo entries / 98 files" : "14 photo entries / 26 files"}. Previews: one 24 MP texture. Face analysis: one 512 × 512 photo.</p>}
    </details>
  );
}

function StageRow({ stage, report, detail, rank }: { stage: StageSummary; report: BenchmarkReport; detail: string | null; rank: number }) {
  const interpretation = interpretStage(stage, report);
  const assessmentLabels = { good: "Good", watch: "Watch", alarming: "Alarming", failed: "Failed", unrated: "Unrated" };
  const ratingStyles = {
    good: "bg-performance-good/10 text-performance-good",
    watch: "bg-performance-watch/10 text-performance-watch",
    alarming: "bg-performance-bad/10 text-performance-bad",
    failed: "bg-performance-bad/10 text-performance-bad",
    unrated: "bg-muted text-muted-foreground",
  };
  const score = stageScoreMs(stage);
  return (
    <tr id={`performance-stage-${stage.id}`} className="border-b border-border/60 align-top last:border-0">
      <th scope="row" className="w-full py-3 pr-3 font-medium">
        <span className="mr-2 text-muted-foreground">{rank}.</span>
        <span className="mr-1.5 inline-block size-2.5 rounded-sm border border-foreground/15 align-middle" style={{ backgroundColor: colorForStage(stage.id) }} aria-hidden="true" />
        {stage.label}
        <span className="mt-1 block font-normal text-muted-foreground">{compactWorkload(stage, report)}</span>
        <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-normal">
          <span className={`rounded px-1.5 py-0.5 font-medium ${ratingStyles[interpretation.assessment]}`}>{assessmentLabels[interpretation.assessment]}</span>
          {interpretation.guidance && <span className="text-muted-foreground">Target ≤ {formatDuration(interpretation.guidance.goodMs)} · investigate ≥ {formatDuration(interpretation.guidance.alarmingMs)}</span>}
          {stage.failures > 0 && <span className="text-destructive">{stage.failures} failed</span>}
        </span>
        <details className="group/stage mt-1.5 text-[11px] font-normal text-muted-foreground">
          <summary className="flex w-fit cursor-pointer list-none items-center gap-1 [&::-webkit-details-marker]:hidden">
            Details<ChevronDown aria-hidden="true" className="size-3 transition-transform group-open/stage:rotate-180" />
          </summary>
          <div className="mt-2 space-y-2 leading-relaxed">
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-3">
              <div><dt>Samples</dt><dd>{stage.count}</dd></div>
              <div><dt>Cache</dt><dd>{stage.cache}</dd></div>
              <div><dt>Slowest</dt><dd>{formatDuration(stage.maxMs)}</dd></div>
              {stage.p95Ms !== null && <div><dt>P95</dt><dd>{formatDuration(stage.p95Ms)}</dd></div>}
              {stage.throughputPerSecond !== null && <div><dt>Throughput</dt><dd>{stage.throughputPerSecond.toFixed(1)} {interpretation.throughputUnit}/s</dd></div>}
              <div><dt>Failures</dt><dd>{stage.failures}</dd></div>
            </dl>
            <p>{interpretation.workload}</p>
            <p>{interpretation.explanation}</p>
            {detail && <p>{detail}</p>}
          </div>
        </details>
      </th>
      <td className="whitespace-nowrap px-2 py-3 text-right tabular-nums">{formatMs(stage.medianMs)}</td>
      <td className="whitespace-nowrap pl-2 py-3 text-right tabular-nums">{score === null ? "—" : formatMs(score)}</td>
    </tr>
  );
}

function EnvironmentSummary({ report }: { report: BenchmarkReport }) {
  const environment = report.environment;
  const items = [
    ["App", `${environment.appVersion} · ${environment.build}`],
    ["System", `${environment.os} / ${environment.arch}`],
    ["CPU", environment.cpu ?? "Unavailable"],
    ["Logical cores", `${environment.logicalCores} cores`],
    ["Available memory", environment.memoryMb === null ? "Unavailable" : `${environment.memoryMb} MB`],
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
  const labels = { measured: "Measured", skipped: "Skipped", manual: "Manual" };
  return (
    <section className="rounded-lg border border-border p-3" aria-labelledby="performance-coverage-heading">
      <h3 id="performance-coverage-heading" className="text-xs font-semibold">Coverage <span className="font-normal text-muted-foreground">· {coverage.filter((entry) => entry.status === "measured").length} measured · {coverage.filter((entry) => entry.status === "skipped").length} skipped · {coverage.filter((entry) => entry.status === "manual").length} manual</span></h3>
      {coverage.length ? <ul className="mt-2 divide-y divide-border/60 text-xs">
        {coverage.map((entry) => <li key={entry.id} className="py-1.5">
          {entry.reason ? <details>
            <summary className="flex cursor-pointer list-none items-baseline justify-between gap-3 [&::-webkit-details-marker]:hidden">
              <span>{entry.label}</span><span className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">{labels[entry.status]}<ChevronDown aria-hidden="true" className="size-3" /></span>
            </summary>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{entry.reason}</p>
          </details> : <div className="flex items-baseline justify-between gap-3"><span>{entry.label}</span><span className="shrink-0 text-[11px] text-muted-foreground">{labels[entry.status]}</span></div>}
        </li>)}
      </ul> : <p className="mt-2 text-xs text-muted-foreground">No coverage reported.</p>}
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

function DeliverySummary({ result, ntfyLabel }: { result: DeliveryResult; ntfyLabel: string }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px]" aria-live="polite">
      <span>Webhook: <DeliveryStatus status={result.webhook.status} />{result.webhook.error && <span className="ml-1 text-destructive" title={result.webhook.error}>({clip(result.webhook.error)})</span>}</span>
      <span>{ntfyLabel}: <DeliveryStatus status={result.ntfy.status} />{result.ntfy.error && <span className="ml-1 text-destructive" title={result.ntfy.error}>({clip(result.ntfy.error)})</span>}</span>
    </div>
  );
}

function DeliveryStatus({ status }: { status: DeliveryResult["webhook"]["status"] }) {
  const tone = status === "sent" ? "text-foreground" : status === "failed" ? "text-destructive" : "text-muted-foreground";
  return <span className={tone}>{status}</span>;
}

function ReportPreview({ webhookJson, message }: { webhookJson: string | null; message: string }) {
  let formattedJson = webhookJson;
  let readableMessage = message;
  if (webhookJson) {
    try {
      const payload: unknown = JSON.parse(webhookJson);
      formattedJson = JSON.stringify(payload, null, 2);
      if (payload && typeof payload === "object" && "content" in payload && typeof payload.content === "string") readableMessage = payload.content;
    } catch { /* The notification text remains available if JSON is malformed. */ }
  }
  const [title, ...lines] = readableMessage.split("\n").filter((line) => line.trim());
  return (
    <section className="rounded-md border border-border bg-muted/20 p-3" aria-label="Message preview">
      <h3 className="text-sm font-medium">{title || "Report summary"}</h3>
      <ul className="mt-2 list-disc space-y-1.5 pl-4 text-xs text-muted-foreground">
        {lines.map((line, index) => <li key={index}>{line.replace(/^[-•]\s*/, "")}</li>)}
      </ul>
      {formattedJson && <details className="mt-3 border-t border-border/70 pt-2 text-[11px] text-muted-foreground">
        <summary className="w-fit cursor-pointer">Raw JSON</summary>
        <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono">{formattedJson}</pre>
      </details>}
    </section>
  );
}

function topicName(configuredUrl: string | undefined, fallbackUrl: string): string {
  const extract = (value: string): string | null => {
    try {
      const parts = new URL(value).pathname.split("/").filter(Boolean);
      return parts.at(-1) ?? null;
    } catch {
      return null;
    }
  };
  return (configuredUrl && extract(configuredUrl)) || extract(fallbackUrl) || "ntfy topic";
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
