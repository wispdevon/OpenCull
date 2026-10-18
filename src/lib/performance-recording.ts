import type { BenchmarkReport, PerformanceEnvironment, StageMeasurement } from "./performance";

const MAX_SAMPLES = 500;
// A fixed catalog avoids recording arguments, file paths, or raw exception text.
const OPERATIONS: Readonly<Record<string, string>> = {
  openFolder: "Open folder request", closeFolder: "Close folder", loadMetadata: "Read metadata request",
  prefetch: "Prefetch previews", warm: "Prepare previews", setMarks: "Save marks", flushMarks: "Flush marks",
  setFraming: "Save crop and orientation", moveToTrash: "Move to trash request", histogram: "Histogram request",
  transferPhotos: "Transfer photos", shipConflicts: "Check Ship conflicts", ship: "Ship photos",
  aiScan: "Face analysis request", aiCompare: "Compare and group frames", mobileClipStatus: "Read visual grouping status",
  aiCacheUsage: "Inspect analysis cache", aiClearCache: "Clear analysis cache", cacheUsage: "Inspect preview cache",
  trimCache: "Trim preview cache", ingestVolumes: "Find cards", ingestBrowse: "Browse ingest source",
  ingestScan: "Scan ingest source", ingestSources: "Scan card sources", ingestDetails: "Read ingest metadata",
  ingestCopy: "Copy from card", ingestConflicts: "Check ingest conflicts", reviewCopy: "Copy reviewed photos",
};
let active: { startedAtMs: number; epoch: number; stages: Map<string, StageMeasurement> } | null = null;
let epoch = 0;
export const recordingActive = () => active !== null;
export function beginRecording(): void {
  if (active) throw new Error("A recording is already running.");
  active = { startedAtMs: Date.now(), epoch: ++epoch, stages: new Map() };
}
export function finishRecording(environment: PerformanceEnvironment): BenchmarkReport {
  if (!active) throw new Error("No recording is running.");
  const recording = active;
  active = null;
  return {
    schemaVersion: 1, id: `recording-${recording.startedAtMs}-${recording.epoch}`, kind: "recording", mode: null,
    startedAtMs: recording.startedAtMs, finishedAtMs: Date.now(), environment,
    stages: [...recording.stages.values()], coverage: Object.entries(OPERATIONS).map(([id, label]) => ({
      id, label, status: recording.stages.has(id) ? "measured" : "skipped",
      reason: recording.stages.has(id) ? null : "Operation was not completed during this recording.",
    })),
  };
}

/** Wrap only selected asynchronous API calls. The disabled path allocates no timer. */
export function instrumentBackend<T extends object>(backend: T): T {
  const wrappers = new Map<PropertyKey, unknown>();
  return new Proxy(backend, {
    get(target, key, receiver) {
      const value: unknown = Reflect.get(target, key, receiver);
      if (typeof key !== "string" || !Object.hasOwn(OPERATIONS, key) || typeof value !== "function") return value;
      if (!wrappers.has(key)) wrappers.set(key, (...args: unknown[]) => {
        const recording = active;
        if (!recording) return Reflect.apply(value, target, args);
        const started = performance.now();
        const record = (failed: boolean) => {
          if (active !== recording) return;
          let stage = recording.stages.get(key);
          if (!stage) {
            stage = { id: key, label: OPERATIONS[key], category: "request", cache: "none", samplesMs: [], units: 0, bytes: 0,
              failures: 0, status: "passed", detail: "API request wall time; overlapping requests are not additive workflow time. At most 500 samples per operation." };
            recording.stages.set(key, stage);
          }
          if (stage.samplesMs.length >= MAX_SAMPLES) return;
          stage.units++;
          stage.samplesMs.push(performance.now() - started);
          if (failed) { stage.failures++; stage.status = "failed"; }
        };
        try {
          const result: unknown = Reflect.apply(value, target, args);
          return Promise.resolve(result).then((reply) => { record(false); return reply; }, (error: unknown) => { record(true); throw error; });
        } catch (error) { record(true); throw error; }
      });
      return wrappers.get(key);
    },
  });
}
