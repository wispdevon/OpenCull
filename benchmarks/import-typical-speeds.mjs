#!/usr/bin/env node
/**
 * Maintainer-only, local importer for the bundled offline performance dataset.
 * It never opens a network connection. Input reports are projected into a
 * strict aggregate allowlist before anything can be written to the database.
 */

import { createHash } from "node:crypto";
import { readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
export const DEFAULT_DATABASE_PATH = path.join(HERE, "typical-speeds.json");
export const DATABASE_SCHEMA_VERSION = 1;
export const MAX_REPORTS = 100;
const MAX_INPUT_FILE_BYTES = 10 * 1024 * 1024;
const MAX_STAGE_COUNT = 100;
const MAX_COVERAGE_COUNT = 100;
const MAX_MEASUREMENT_MS = 1e12;
const RAW_SCHEMA_VERSION = 1;
const LEGACY_DIAGNOSTIC_SCHEMA_VERSION = 3;
const DIAGNOSTIC_SCHEMA_VERSION = 4;
const EXPECTED_BUILD = /^(debug|release) (turbo-jpeg|rust-jpeg)( cuda)?$/;
const KNOWN_OS = new Set(["linux", "macos", "windows"]);
const KNOWN_ARCH = new Set(["x86_64", "aarch64", "x86", "arm", "armv7"]);
const KNOWN_CACHE = new Set(["cold", "warm", "none"]);
const KNOWN_STATUS = new Set(["passed", "failed", "skipped"]);
const KNOWN_COVERAGE_STATUS = new Set(["measured", "skipped", "manual"]);
const EXPECTED_TOP_LEVEL = [
  "schemaVersion", "id", "kind", "mode", "outcome", "startedAtMs", "finishedAtMs",
  "environment", "stages", "coverage", "systemId", "recommendations", "performanceScores",
];
const HARDWARE_REPORT_TOP_LEVEL = [...EXPECTED_TOP_LEVEL, "hardwareRatings"];
const ENVIRONMENT_KEYS = [
  "appVersion", "build", "os", "arch", "cpu", "logicalCores", "memoryMb", "gpu", "aiProvider", "fixtureVersion", "hardwareSpecs",
];
const HARDWARE_SPEC_KEYS = ["cpuModel", "gpuModel", "installedMemoryMb"];
const HARDWARE_RATING_REASONS = new Set([
  "unknown-cpu", "unknown-gpu", "unknown-memory", "invalid-memory", "invalid-catalogue", "ambiguous-cpu", "ambiguous-gpu",
]);
const RAW_STAGE_KEYS = [
  "id", "label", "category", "cache", "samplesMs", "units", "bytes", "failures", "status", "detail", "inference",
];
const SUMMARY_STAGE_KEYS = [
  "id", "label", "category", "cache", "status", "count", "totalMs", "medianMs", "maxMs", "p95Ms",
  "units", "bytes", "failures", "throughputPerSecond", "inference",
];
const COVERAGE_KEYS = ["id", "label", "status", "reason"];
const RECOMMENDATION_KEYS = ["stageId", "priority", "evidence", "action"];
const INFERENCE_KEYS = ["cudaCalls", "cpuCalls", "cpuFallbackCalls"];
const PROVENANCE_METHODS = new Set(["maintainer-reviewed", "self-reported"]);

export class ImportError extends Error {
  constructor(code) {
    super(code);
    this.name = "ImportError";
    this.code = code;
  }
}

function fail(code) {
  throw new ImportError(code);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, allowed, required, errorCode = "invalid_report") {
  if (!isObject(value)) fail(errorCode);
  const allowedSet = new Set(allowed);
  if (Object.keys(value).some((key) => !allowedSet.has(key))) fail(errorCode);
  if (required.some((key) => !Object.hasOwn(value, key))) fail(errorCode);
}

function boundedString(value, { max = 200, allowEmpty = false } = {}) {
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > max || (!allowEmpty && !value.trim())) {
    fail("invalid_report");
  }
  if ([...value].some((character) => /[\u0000-\u001f\u007f]/u.test(character))) fail("invalid_report");
  return value;
}

function finiteNumber(value, min = 0, max = MAX_MEASUREMENT_MS, errorCode = "invalid_report") {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) fail(errorCode);
  return value;
}

function safeInteger(value, min = 0, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail("invalid_report");
  return value;
}

function isIdentifier(value, max = 128) {
  return typeof value === "string" && value.length > 0 && value.length <= max
    && /^[A-Za-z0-9][A-Za-z0-9_.-]*$/u.test(value)
    && !value.includes("..") && !/\.(?:jpe?g|png|heic|raw|arw|cr2|cr3|nef|raf|rw2|dng|orf|pef|srw|xmp|mp4|mov|mkv|avi)$/iu.test(value);
}

function hasPrivatePathText(value) {
  const lower = value.toLowerCase();
  return value.startsWith("/") || value.startsWith("~") || value.includes("\\")
    || value.includes("://") || value.includes("//") || /\b[A-Za-z]:[^\s]/u.test(value)
    || ["/home/", "/users/", "/pictures/", "/photos/", "/dcim/", "/documents/", "/desktop/", "/mnt/", "/media/", "/volumes/"]
      .some((fragment) => lower.includes(fragment));
}

function safeHardwareName(value) {
  if (value === null) return null;
  boundedString(value, { max: 120 });
  if (!/^[A-Za-z0-9 ()+.,/@_-]+$/u.test(value) || hasPrivatePathText(value)
    || /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/u.test(value)
    || /\b\d{4}:\d{2}:\d{2}\b/u.test(value)
    || /\.(?:jpe?g|png|heic|raw|arw|cr2|cr3|nef|raf|rw2|dng|orf|pef|srw|xmp|mp4|mov|mkv|avi)\b/iu.test(value)) {
    fail("invalid_hardware_profile");
  }
  return value.trim();
}

function validateHardwareSpecs(value) {
  if (value === undefined || value === null) return null;
  exactKeys(value, HARDWARE_SPEC_KEYS, HARDWARE_SPEC_KEYS, "invalid_hardware_profile");
  const cpuModel = value.cpuModel === null ? null : safeHardwareName(value.cpuModel);
  const gpuModel = value.gpuModel === null ? null : safeHardwareName(value.gpuModel);
  const installedMemoryMb = value.installedMemoryMb === null
    ? null : safeInteger(value.installedMemoryMb, 1, 16_777_216);
  if (cpuModel === null && gpuModel === null && installedMemoryMb === null) return null;
  return { cpuModel, gpuModel, installedMemoryMb };
}

function validateHardwareRatingResult(value) {
  exactKeys(value, ["value", "reason"], ["value", "reason"], "invalid_hardware_ratings");
  if (value.value !== null && !Number.isSafeInteger(value.value)) fail("invalid_hardware_ratings");
  if (value.value !== null) finiteNumber(value.value, 0, Number.MAX_SAFE_INTEGER, "invalid_hardware_ratings");
  if (value.reason !== null && !HARDWARE_RATING_REASONS.has(value.reason)) fail("invalid_hardware_ratings");
  if ((value.value === null) === (value.reason === null)) fail("invalid_hardware_ratings");
}

function validateHardwareRatings(value) {
  exactKeys(value, ["formulaVersion", "catalogueVersion", "profile", "system", "gpu", "components"],
    ["formulaVersion", "catalogueVersion", "profile", "system", "gpu", "components"], "invalid_hardware_ratings");
  if (value.formulaVersion !== 1 || typeof value.catalogueVersion !== "string"
    || !/^\d+\.\d+\.\d+$/u.test(value.catalogueVersion)) fail("invalid_hardware_ratings");
  exactKeys(value.profile, ["cpuId", "gpuId", "installedMemoryMb"], ["cpuId", "gpuId", "installedMemoryMb"], "invalid_hardware_ratings");
  for (const id of [value.profile.cpuId, value.profile.gpuId]) {
    if (id !== null && !isIdentifier(id, 100)) fail("invalid_hardware_ratings");
  }
  if (value.profile.installedMemoryMb !== null) safeInteger(value.profile.installedMemoryMb, 1, 16_777_216);
  validateHardwareRatingResult(value.system);
  validateHardwareRatingResult(value.gpu);
  exactKeys(value.components, ["cpu", "gpu", "ram"], ["cpu", "gpu", "ram"], "invalid_hardware_ratings");
  if (value.components.cpu !== null) {
    exactKeys(value.components.cpu, ["physicalCores", "baseClockMHz", "points", "sourceId"],
      ["physicalCores", "baseClockMHz", "points", "sourceId"], "invalid_hardware_ratings");
    finiteNumber(value.components.cpu.physicalCores, Number.MIN_VALUE, Number.MAX_SAFE_INTEGER, "invalid_hardware_ratings");
    finiteNumber(value.components.cpu.baseClockMHz, Number.MIN_VALUE, Number.MAX_SAFE_INTEGER, "invalid_hardware_ratings");
    finiteNumber(value.components.cpu.points, Number.MIN_VALUE, Number.MAX_SAFE_INTEGER, "invalid_hardware_ratings");
    if (!isIdentifier(value.components.cpu.sourceId, 100)) fail("invalid_hardware_ratings");
  }
  if (value.components.gpu !== null) {
    exactKeys(value.components.gpu, ["shaderCores", "baseClockMHz", "vramGiB", "points", "sourceId"],
      ["shaderCores", "baseClockMHz", "vramGiB", "points", "sourceId"], "invalid_hardware_ratings");
    finiteNumber(value.components.gpu.shaderCores, Number.MIN_VALUE, Number.MAX_SAFE_INTEGER, "invalid_hardware_ratings");
    finiteNumber(value.components.gpu.baseClockMHz, Number.MIN_VALUE, Number.MAX_SAFE_INTEGER, "invalid_hardware_ratings");
    finiteNumber(value.components.gpu.vramGiB, Number.MIN_VALUE, Number.MAX_SAFE_INTEGER, "invalid_hardware_ratings");
    finiteNumber(value.components.gpu.points, Number.MIN_VALUE, Number.MAX_SAFE_INTEGER, "invalid_hardware_ratings");
    if (!isIdentifier(value.components.gpu.sourceId, 100)) fail("invalid_hardware_ratings");
  }
  if (value.components.ram !== null) {
    exactKeys(value.components.ram, ["installedGiB", "points"], ["installedGiB", "points"], "invalid_hardware_ratings");
    finiteNumber(value.components.ram.installedGiB, Number.MIN_VALUE, Number.MAX_SAFE_INTEGER, "invalid_hardware_ratings");
    finiteNumber(value.components.ram.points, Number.MIN_VALUE, Number.MAX_SAFE_INTEGER, "invalid_hardware_ratings");
  }
}

function normalizeProvider(value) {
  if (value === null) return null;
  boundedString(value, { max: 120 });
  // Unknown provider text is deliberately not published and is never treated
  // as evidence for a GPU score. The typed stage counters are checked below.
  const known = new Set([
    "CPU", "CPU benchmark inference", "Core ML or CPU fallback available",
    "CUDA (YOLO may use CPU operators)", "CUDA selected; no CUDA inference completed",
    "CUDA active; CPU fallback available", "CPU active; CUDA build available",
    "CUDA + CPU fallback (runtime)", "CPU fallback after CUDA runtime failure",
  ]);
  return known.has(value) ? value : null;
}

function validateEnvironment(environment, scoreFixtureVersion) {
  exactKeys(environment, ENVIRONMENT_KEYS, ENVIRONMENT_KEYS.filter((key) => key !== "hardwareSpecs"));
  const appVersion = boundedString(environment.appVersion, { max: 80 });
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.test(appVersion)) fail("invalid_hardware_profile");
  const build = boundedString(environment.build, { max: 80 });
  if (!EXPECTED_BUILD.test(build)) fail("unsupported_build");
  const os = boundedString(environment.os, { max: 20 });
  if (!KNOWN_OS.has(os)) fail("unsupported_environment");
  const arch = boundedString(environment.arch, { max: 20 });
  if (!KNOWN_ARCH.has(arch)) fail("unsupported_environment");
  const fixtureVersion = boundedString(environment.fixtureVersion, { max: 80 });
  if (fixtureVersion !== scoreFixtureVersion) fail("unsupported_fixture");
  const logicalCores = safeInteger(environment.logicalCores, 1, 512);
  const memoryMb = environment.memoryMb === null ? null : safeInteger(environment.memoryMb, 1, 16_777_216);
  const cpu = safeHardwareName(environment.cpu);
  const gpu = safeHardwareName(environment.gpu);
  const aiProvider = normalizeProvider(environment.aiProvider);
  const normalized = { appVersion, build, os, arch, fixtureVersion, logicalCores, memoryMb, cpu, gpu, aiProvider, providerKnown: aiProvider !== null };
  const hardwareSpecs = validateHardwareSpecs(environment.hardwareSpecs);
  if (hardwareSpecs !== null) normalized.hardwareSpecs = hardwareSpecs;
  return normalized;
}

function cohortFor(environment) {
  return {
    os: environment.os,
    arch: environment.arch,
    build: environment.build,
    fixtureVersion: environment.fixtureVersion,
  };
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function roundMs(value) {
  // Preserve sub-microsecond stage means instead of fabricating a zero.
  return Math.round(value * 1_000_000_000) / 1_000_000_000;
}

function median(values) {
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

function validateInference(inference) {
  if (inference === undefined || inference === null) return null;
  exactKeys(inference, INFERENCE_KEYS, INFERENCE_KEYS);
  const result = {
    cudaCalls: safeInteger(inference.cudaCalls, 0, 1_000_000),
    cpuCalls: safeInteger(inference.cpuCalls, 0, 1_000_000),
    cpuFallbackCalls: safeInteger(inference.cpuFallbackCalls, 0, 1_000_000),
  };
  if (result.cpuFallbackCalls > result.cpuCalls) fail("invalid_report");
  return result;
}

function validateCoverage(coverage) {
  if (!Array.isArray(coverage) || coverage.length > MAX_COVERAGE_COUNT) fail("invalid_report");
  for (const entry of coverage) {
    exactKeys(entry, COVERAGE_KEYS, COVERAGE_KEYS);
    if (!isIdentifier(entry.id) || !KNOWN_COVERAGE_STATUS.has(entry.status)) fail("invalid_report");
    boundedString(entry.label, { max: 160 });
    if (entry.reason !== null) boundedString(entry.reason, { max: 2_000 });
  }
}

function validateRecommendations(recommendations) {
  if (recommendations === undefined) return;
  if (!Array.isArray(recommendations) || recommendations.length > 100) fail("invalid_report");
  for (const recommendation of recommendations) {
    exactKeys(recommendation, RECOMMENDATION_KEYS, RECOMMENDATION_KEYS);
    if (!isIdentifier(recommendation.stageId) || !["high", "medium", "low"].includes(recommendation.priority)) fail("invalid_report");
    boundedString(recommendation.evidence, { max: 2_000 });
    boundedString(recommendation.action, { max: 2_000 });
  }
}

function validateInputScores(scores) {
  if (scores === undefined) return;
  exactKeys(scores, ["scoringVersion", "databaseVersion", "cohortId", "system", "gpu"],
    ["scoringVersion", "databaseVersion", "cohortId", "system", "gpu"]);
  if (scores.scoringVersion !== 1) fail("invalid_report");
  boundedString(scores.databaseVersion, { max: 40 });
  if (scores.cohortId !== null) boundedString(scores.cohortId, { max: 128 });
  for (const result of [scores.system, scores.gpu]) {
    exactKeys(result, ["value", "reason", "referenceId"], ["value", "reason", "referenceId"]);
    if (result.value !== null) finiteNumber(result.value, 0, 1_000_000_000);
    if (result.reason !== null && !["unsupported-report", "incomplete-report", "invalid-measurements", "unmatched-cohort", "invalid-reference", "gpu-not-measured", "gpu-fallback"].includes(result.reason)) fail("invalid_report");
    if (result.referenceId !== null) boundedString(result.referenceId, { max: 128 });
  }
}

function normalizeStage(stage, expectedSamples, expectedUnitsPerSample, allowZeroTiming) {
  const isRaw = Object.hasOwn(stage ?? {}, "samplesMs");
  exactKeys(stage, isRaw ? RAW_STAGE_KEYS : SUMMARY_STAGE_KEYS,
    isRaw ? ["id", "label", "category", "cache", "samplesMs", "units", "bytes", "failures", "status"]
      : ["id", "label", "category", "cache", "status", "count", "totalMs", "medianMs", "maxMs", "p95Ms", "units", "bytes", "failures", "throughputPerSecond"]);
  if (!isIdentifier(stage.id, 100) || !KNOWN_CACHE.has(stage.cache) || !KNOWN_STATUS.has(stage.status)) fail("invalid_report");
  boundedString(stage.label, { max: 160 });
  boundedString(stage.category, { max: 60 });
  if (stage.status !== "passed") fail("incomplete_run");
  if (safeInteger(stage.failures, 0, 0) !== 0) fail("incomplete_run");
  const units = safeInteger(stage.units, 0, 1_000_000_000);
  if (units !== expectedUnitsPerSample * expectedSamples) fail("invalid_workload");
  safeInteger(stage.bytes, 0, Number.MAX_SAFE_INTEGER);
  const inference = validateInference(stage.inference);

  let count;
  let totalMs;
  if (isRaw) {
    if (!Array.isArray(stage.samplesMs) || stage.samplesMs.length !== expectedSamples) fail("invalid_sample_count");
    const samples = stage.samplesMs.map((sample) => finiteNumber(sample, allowZeroTiming ? 0 : Number.MIN_VALUE, MAX_MEASUREMENT_MS, "invalid_measurements"));
    count = samples.length;
    totalMs = samples.reduce((sum, sample) => sum + sample, 0);
    if (!Number.isFinite(totalMs) || totalMs > MAX_MEASUREMENT_MS) fail("invalid_measurements");
    if (stage.detail !== undefined && stage.detail !== null) boundedString(stage.detail, { max: 4_000, allowEmpty: true });
  } else {
    count = safeInteger(stage.count, 0, 10_000_000);
    const timingMinimum = allowZeroTiming ? 0 : Number.MIN_VALUE;
    totalMs = finiteNumber(stage.totalMs, timingMinimum, MAX_MEASUREMENT_MS, "invalid_measurements");
    const medianMs = finiteNumber(stage.medianMs, timingMinimum, MAX_MEASUREMENT_MS, "invalid_measurements");
    const maxMs = finiteNumber(stage.maxMs, timingMinimum, MAX_MEASUREMENT_MS, "invalid_measurements");
    if (count !== expectedSamples || count < 1 || totalMs < maxMs || medianMs > maxMs) fail("invalid_measurements");
    if ((count >= 20) !== (stage.p95Ms !== null)) fail("invalid_measurements");
    let p95Ms = null;
    if (stage.p95Ms !== null) {
      p95Ms = finiteNumber(stage.p95Ms, timingMinimum, MAX_MEASUREMENT_MS, "invalid_measurements");
      if (count < 20 || p95Ms < medianMs || p95Ms > maxMs) fail("invalid_measurements");
    }
    const tolerance = (minimumTotal) => Math.max(
      Number.MIN_VALUE * 16,
      Number.EPSILON * Math.max(Math.abs(totalMs), Math.abs(minimumTotal)) * 16,
    );
    // Bound the total using the sorted positions implied by the median,
    // percentile, and max. The percentile bound includes the observations
    // between the median and p95, so checking each statistic separately would
    // miss impossible combinations.
    const medianStart = Math.floor((count + 1) / 2);
    if (p95Ms !== null) {
      const p95Rank = Math.ceil(count * 0.95);
      const medianCount = Math.max(0, p95Rank - medianStart);
      const p95Count = count - p95Rank;
      const minimumTotal = medianCount * medianMs + p95Count * p95Ms + maxMs;
      if (totalMs + tolerance(minimumTotal) < minimumTotal) fail("invalid_measurements");
    } else {
      const medianCount = count - medianStart;
      const minimumTotal = medianCount * medianMs + maxMs;
      if (totalMs + tolerance(minimumTotal) < minimumTotal) fail("invalid_measurements");
    }
    if (totalMs === 0 || units === 0) {
      if (stage.throughputPerSecond !== null) fail("invalid_measurements");
    } else {
      const throughput = finiteNumber(stage.throughputPerSecond, 0, 1e15, "invalid_measurements");
      const expectedThroughput = units * 1000 / totalMs;
      if (!Number.isFinite(expectedThroughput) || expectedThroughput > 1e15) fail("invalid_measurements");
      if (Math.abs(throughput - expectedThroughput) > Math.max(1e-9, expectedThroughput * 1e-8)) fail("invalid_measurements");
    }
  }
  if (count !== expectedSamples || count < 1) fail("invalid_sample_count");
  return { id: stage.id, meanMs: totalMs / count, count, inference };
}

function normalizeReport(report, expectedSamples, expectedUnits, optionalSamples, scoreFixtureVersion, gpuWeightIds, hardwareContract) {
  const schemaVersion = report?.schemaVersion;
  const isHardwareDiagnostic = schemaVersion === DIAGNOSTIC_SCHEMA_VERSION;
  exactKeys(report, isHardwareDiagnostic ? HARDWARE_REPORT_TOP_LEVEL : EXPECTED_TOP_LEVEL,
    ["schemaVersion", "id", "kind", "mode", "outcome", "startedAtMs", "finishedAtMs", "environment", "stages", "coverage",
      ...(isHardwareDiagnostic ? ["hardwareRatings"] : [])]);
  if (!Array.isArray(report.stages)) fail("incomplete_stages");
  const representations = new Set(report.stages.map((stage) =>
    isObject(stage) && Object.hasOwn(stage, "samplesMs") ? "raw" : "summary"));
  if (representations.size > 1) fail("unsupported_report");
  const aggregateShape = representations.has("summary");
  const validSchemaVersion = aggregateShape
    ? [LEGACY_DIAGNOSTIC_SCHEMA_VERSION, DIAGNOSTIC_SCHEMA_VERSION].includes(schemaVersion)
    : schemaVersion === RAW_SCHEMA_VERSION;
  if (!validSchemaVersion || (isHardwareDiagnostic && !aggregateShape)
    || report.kind !== "benchmark" || report.mode !== "thorough" || report.outcome !== "completed") {
    fail("unsupported_report");
  }
  if (isHardwareDiagnostic) validateHardwareRatings(report.hardwareRatings);
  if (!isIdentifier(report.id)) fail("invalid_report");
  safeInteger(report.startedAtMs, 1, Number.MAX_SAFE_INTEGER);
  safeInteger(report.finishedAtMs, report.startedAtMs + 1, Number.MAX_SAFE_INTEGER);
  if (report.finishedAtMs - report.startedAtMs > 6 * 60 * 60 * 1_000) fail("invalid_report");
  if (report.systemId !== undefined && (typeof report.systemId !== "string" || !/^[a-z]+-[a-z]+-\d{6}$/u.test(report.systemId))) {
    fail("invalid_report");
  }
  const environment = validateEnvironment(report.environment, scoreFixtureVersion);
  const hardwareIdentity = environment.hardwareSpecs ?? { cpuModel: null, gpuModel: null, installedMemoryMb: null };
  const hardwareRatings = hardwareContract.rateHardware(hardwareIdentity, hardwareContract.catalogue);
  if (environment.fixtureVersion !== scoreFixtureVersion) fail("unsupported_fixture");
  if (report.stages.length < Object.keys(expectedSamples).length
    || report.stages.length > Object.keys(expectedSamples).length + Object.keys(optionalSamples).length || report.stages.length > MAX_STAGE_COUNT) {
    fail("incomplete_stages");
  }
  validateCoverage(report.coverage);
  validateRecommendations(report.recommendations);
  validateInputScores(report.performanceScores);

  const stageStats = new Map();
  const originalStages = new Map();
  for (const stage of report.stages) {
    const native = Object.hasOwn(expectedSamples, stage?.id);
    const optional = Object.hasOwn(optionalSamples, stage?.id);
    if ((!native && !optional) || stageStats.has(stage.id)) fail("incomplete_stages");
    const sampleCounts = native ? expectedSamples : optionalSamples;
    const expectedUnitsForStage = expectedUnits[stage.id];
    if (!Number.isSafeInteger(expectedUnitsForStage)) fail("invalid_scoring_contract");
    stageStats.set(stage.id, normalizeStage(stage, sampleCounts[stage.id], expectedUnitsForStage, optional));
    originalStages.set(stage.id, stage);
  }
  if (Object.keys(expectedSamples).some((id) => !stageStats.has(id))) fail("incomplete_stages");
  const optionalStageIds = Object.keys(optionalSamples);
  const presentOptionalStageCount = optionalStageIds.filter((id) => stageStats.has(id)).length;
  if (presentOptionalStageCount !== 0 && presentOptionalStageCount !== optionalStageIds.length) fail("incomplete_stages");

  const canonicalAggregate = {
    environment,
    cohort: cohortFor(environment),
    stages: Object.fromEntries([...stageStats].sort(([left], [right]) => left.localeCompare(right)).map(([id, stage]) => [id, {
      count: stage.count,
      meanMs: roundMs(stage.meanMs),
    }])),
  };
  return {
    raw: report,
    id: report.id,
    systemId: report.systemId ?? null,
    environment,
    hardwareSpecs: environment.hardwareSpecs ?? null,
    hardwareRatings,
    cohort: cohortFor(environment),
    stages: stageStats,
    originalStages,
    aggregateHash: sha256(stableJson(canonicalAggregate)),
    gpuEligible: hasCudaEvidence(
      environment,
      originalStages,
      gpuWeightIds,
      Object.keys(expectedSamples).filter((id) => id.startsWith("face-analysis-") || id.startsWith("advanced-face-")),
    ),
  };
}

function hasCudaEvidence(environment, originalStages, gpuWeightIds, aiStageIds) {
  if (environment.os !== "linux" || environment.arch !== "x86_64" || !environment.build.endsWith(" cuda")
    || environment.aiProvider !== "CUDA (YOLO may use CPU operators)" || !environment.providerKnown) return false;
  const usage = [...originalStages.values()].map((stage) => stage.inference).filter((value) => value !== null && value !== undefined);
  if (usage.length === 0 || usage.some((item) => item.cpuCalls !== 0 || item.cpuFallbackCalls !== 0)) return false;
  if (aiStageIds.some((id) => !originalStages.get(id)?.inference)) return false;
  return gpuWeightIds.every((id) => {
    const stage = originalStages.get(id);
    return stage?.inference && Number.isSafeInteger(stage.inference.cudaCalls) && stage.inference.cudaCalls > 0;
  });
}

function sameCohort(left, right) {
  return stableJson(left) === stableJson(right);
}

function sameProfile(left, right) {
  return stableJson(left) === stableJson(right);
}

function publicProfile(report) {
  const profile = {
    cohort: report.cohort,
    appVersion: report.environment.appVersion,
    cpu: report.environment.cpu,
    logicalCores: report.environment.logicalCores,
    memoryMb: report.environment.memoryMb,
    gpu: report.environment.gpu,
    aiProvider: report.environment.aiProvider,
  };
  if (report.hardwareSpecs !== null) profile.hardwareSpecs = report.hardwareSpecs;
  return profile;
}

function cohortId(cohort) {
  return `reference-${sha256(stableJson(cohort)).slice(0, 16)}`;
}

function profileId(profile) {
  // This is a hash of public build/hardware descriptors, not an installation
  // alias or a hash of any raw report field.
  return `system-${sha256(stableJson(profile)).slice(0, 16)}`;
}

function aggregateStageStats(reports, ids) {
  return Object.fromEntries(ids.map((id) => {
    const means = reports.map((report) => report.stages.get(id).meanMs);
    return [id, median(means)];
  }));
}

function makeReference(reports, options, scoring) {
  const cohort = reports[0].cohort;
  const systemAnchors = aggregateStageStats(reports, Object.keys(scoring.SYSTEM_WEIGHTS));
  const allGpuMeasured = reports.every((report) => report.gpuEligible);
  const gpuAnchors = allGpuMeasured ? aggregateStageStats(reports, Object.keys(scoring.GPU_WEIGHTS)) : null;
  return {
    id: cohortId(cohort),
    cohort,
    runCount: reports.length,
    installationCount: options.installationCount,
    system: systemAnchors,
    gpu: gpuAnchors,
    provenance: {
      sourceCommit: options.sourceCommit,
      collectedAt: options.collectedAt,
      method: options.method,
    },
  };
}

function publicStageStats(reports) {
  const ids = [...reports[0].stages.keys()].sort();
  return Object.fromEntries(ids.map((id) => {
    const means = reports.map((report) => report.stages.get(id).meanMs);
    const minimum = Math.min(...means);
    const maximum = Math.max(...means);
    return [id, {
      meanAverageMs: roundMs(means.reduce((sum, value) => sum + value, 0) / means.length),
      medianAverageMs: roundMs(median(means)),
      minAverageMs: roundMs(minimum),
      maxAverageMs: roundMs(maximum),
      runCount: means.length,
    }];
  }));
}

function medianScore(values) {
  if (values.some((value) => typeof value !== "number" || !Number.isFinite(value))) return null;
  return roundMs(median(values));
}

function validateDatabase(database, scoring, hardwareContract) {
  exactKeys(database, ["schemaVersion", "scoringVersion", "version", "sourceUrl", "references", "systems"],
    ["schemaVersion", "scoringVersion", "version", "sourceUrl", "references", "systems"], "invalid_database");
  if (database.schemaVersion !== DATABASE_SCHEMA_VERSION || database.scoringVersion !== scoring.SCORING_VERSION) fail("invalid_database");
  boundedString(database.version, { max: 40 });
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.test(database.version)
    || database.version.split(".").some((part) => !Number.isSafeInteger(Number(part)))) fail("invalid_database");
  let source;
  try { source = new URL(database.sourceUrl); } catch { fail("invalid_database"); }
  if (source.protocol !== "https:" || source.hostname !== "github.com"
    || database.sourceUrl !== "https://github.com/wispdevon/OpenCull/blob/main/benchmarks/typical-speeds.json") fail("invalid_database");
  if (!Array.isArray(database.references) || !Array.isArray(database.systems)) fail("invalid_database");
  const referenceIds = new Set();
  const referenceCohorts = new Set();
  for (const reference of database.references) {
    exactKeys(reference, ["id", "cohort", "runCount", "installationCount", "system", "gpu", "provenance"],
      ["id", "cohort", "runCount", "installationCount", "system", "gpu", "provenance"], "invalid_database");
    validateCohort(reference.cohort, scoring.SCORE_FIXTURE_VERSION);
    if (!isIdentifier(reference.id) || referenceIds.has(reference.id) || referenceCohorts.has(stableJson(reference.cohort))) fail("invalid_database");
    referenceIds.add(reference.id);
    referenceCohorts.add(stableJson(reference.cohort));
    safeInteger(reference.runCount, 3, MAX_REPORTS);
    safeInteger(reference.installationCount, 1, 100_000);
    if (reference.installationCount > reference.runCount || reference.id !== cohortId(reference.cohort)) fail("invalid_database");
    validateAnchorMap(reference.system, Object.keys(scoring.SYSTEM_WEIGHTS));
    if (reference.gpu !== null) validateAnchorMap(reference.gpu, Object.keys(scoring.GPU_WEIGHTS));
    validateProvenance(reference.provenance);
  }
  const systemIds = new Set();
  for (const system of database.systems) {
    exactKeys(system, ["id", "cohort", "appVersion", "cpu", "logicalCores", "memoryMb", "gpu", "aiProvider", "runCount", "installationCount", "stages", "systemScore", "gpuScore", "hardwareSpecs", "hardwareRatings"],
      ["id", "cohort", "appVersion", "cpu", "logicalCores", "memoryMb", "gpu", "aiProvider", "runCount", "installationCount", "stages", "systemScore", "gpuScore"], "invalid_database");
    validateCohort(system.cohort, scoring.SCORE_FIXTURE_VERSION);
    if (!isIdentifier(system.id) || systemIds.has(system.id)) fail("invalid_database");
    systemIds.add(system.id);
    boundedString(system.appVersion, { max: 80 });
    safeHardwareName(system.cpu);
    safeInteger(system.logicalCores, 1, 512);
    if (system.memoryMb !== null) safeInteger(system.memoryMb, 1, 16_777_216);
    safeHardwareName(system.gpu);
    if (system.aiProvider !== null) boundedString(system.aiProvider, { max: 120 });
    safeInteger(system.runCount, 3, MAX_REPORTS);
    safeInteger(system.installationCount, 1, 100_000);
    if (system.installationCount > system.runCount) fail("invalid_database");
    const profile = { cohort: system.cohort, appVersion: system.appVersion, cpu: system.cpu, logicalCores: system.logicalCores, memoryMb: system.memoryMb, gpu: system.gpu, aiProvider: system.aiProvider };
    const hasHardwareSpecs = Object.hasOwn(system, "hardwareSpecs");
    const hasHardwareRatings = Object.hasOwn(system, "hardwareRatings");
    if (hasHardwareSpecs !== hasHardwareRatings) fail("invalid_database");
    if (hasHardwareSpecs) {
      const hardwareSpecs = validateHardwareSpecs(system.hardwareSpecs);
      if (hardwareSpecs === null) fail("invalid_database");
      validateHardwareRatings(system.hardwareRatings);
      const expectedRatings = hardwareContract.rateHardware(hardwareSpecs, hardwareContract.catalogue);
      if (stableJson(expectedRatings) !== stableJson(system.hardwareRatings)) fail("invalid_database");
      profile.hardwareSpecs = hardwareSpecs;
    }
    if (system.id !== profileId(profile)) fail("invalid_database");
    validateStageStatisticMap(system.stages, scoring.THOROUGH_STAGE_SAMPLES, scoring.FRONTEND_STAGE_SAMPLES, system.runCount);
    validateScoreValue(system.systemScore);
    validateScoreValue(system.gpuScore);
  }
  return { referenceIds, referenceCohorts, systemIds };
}

function validateCohort(cohort, scoreFixtureVersion) {
  exactKeys(cohort, ["os", "arch", "build", "fixtureVersion"], ["os", "arch", "build", "fixtureVersion"], "invalid_database");
  if (!KNOWN_OS.has(cohort.os) || !KNOWN_ARCH.has(cohort.arch) || !EXPECTED_BUILD.test(cohort.build)
    || cohort.fixtureVersion !== scoreFixtureVersion) fail("invalid_database");
}

function validateAnchorMap(value, expectedIds) {
  if (!isObject(value) || Object.keys(value).length !== expectedIds.length
    || Object.keys(value).some((key) => !expectedIds.includes(key))) fail("invalid_database");
  for (const anchor of Object.values(value)) finiteNumber(anchor, Number.MIN_VALUE, MAX_MEASUREMENT_MS);
}

function validateStageStatisticMap(value, requiredSamples, optionalSamples, expectedRunCount) {
  if (!isObject(value)) fail("invalid_database");
  const keys = Object.keys(value);
  if (keys.length < Object.keys(requiredSamples).length || keys.length > Object.keys(requiredSamples).length + Object.keys(optionalSamples).length
    || Object.keys(requiredSamples).some((key) => !Object.hasOwn(value, key))
    || keys.some((key) => !Object.hasOwn(requiredSamples, key) && !Object.hasOwn(optionalSamples, key))) fail("invalid_database");
  const optionalIds = Object.keys(optionalSamples);
  const optionalCount = optionalIds.filter((id) => Object.hasOwn(value, id)).length;
  if (optionalCount !== 0 && optionalCount !== optionalIds.length) fail("invalid_database");
  for (const [id, statistics] of Object.entries(value)) {
    exactKeys(statistics, ["meanAverageMs", "medianAverageMs", "minAverageMs", "maxAverageMs", "runCount"],
      ["meanAverageMs", "medianAverageMs", "minAverageMs", "maxAverageMs", "runCount"], "invalid_database");
    const allowZero = Object.hasOwn(optionalSamples, id);
    const mean = finiteNumber(statistics.meanAverageMs, allowZero ? 0 : Number.MIN_VALUE);
    const medianValue = finiteNumber(statistics.medianAverageMs, allowZero ? 0 : Number.MIN_VALUE);
    const minimum = finiteNumber(statistics.minAverageMs, allowZero ? 0 : Number.MIN_VALUE);
    const maximum = finiteNumber(statistics.maxAverageMs, allowZero ? 0 : Number.MIN_VALUE);
    if (minimum > medianValue || medianValue > maximum || mean < minimum || mean > maximum) fail("invalid_database");
    if (safeInteger(statistics.runCount, 3, MAX_REPORTS) !== expectedRunCount) fail("invalid_database");
    if (!Object.hasOwn(requiredSamples, id) && !Object.hasOwn(optionalSamples, id)) fail("invalid_database");
  }
}

function validateScoreValue(value) {
  if (value !== null && (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1_000_000)) fail("invalid_database");
}

function validateProvenance(value) {
  exactKeys(value, ["sourceCommit", "collectedAt", "method"], ["sourceCommit", "collectedAt", "method"], "invalid_database");
  if (!/^[0-9a-f]{7,40}$/iu.test(value.sourceCommit)) fail("invalid_database");
  if (!isValidDate(value.collectedAt)) fail("invalid_database");
  if (!PROVENANCE_METHODS.has(value.method)) fail("invalid_database");
}

function validateOptions(options) {
  if (!/^[0-9a-f]{7,40}$/iu.test(options.sourceCommit ?? "")) fail("source_commit_required");
  if (!isValidDate(options.collectedAt ?? "")) fail("collected_date_required");
  if (!PROVENANCE_METHODS.has(options.method)) fail("invalid_provenance_method");
  safeInteger(options.installationCount, 1, 100_000);
}

async function loadHardwareContract() {
  try {
    const ratings = await import("../src/lib/hardware-ratings.ts");
    const catalogue = JSON.parse(await readFile(new URL("./hardware-specifications.json", import.meta.url), "utf8"));
    if (typeof ratings.rateHardware !== "function" || !isObject(catalogue)
      || catalogue.schemaVersion !== 1 || catalogue.formulaVersion !== 1
      || typeof catalogue.version !== "string" || !/^\d+\.\d+\.\d+$/u.test(catalogue.version)) {
      fail("hardware_ratings_unavailable");
    }
    const rateHardware = ratings.rateHardware;
    const probe = rateHardware({ cpuModel: null, gpuModel: null, installedMemoryMb: null }, catalogue);
    validateHardwareRatings(probe);
    if (probe.system.reason === "invalid-catalogue" || probe.gpu.reason === "invalid-catalogue"
      || probe.catalogueVersion !== catalogue.version) fail("hardware_ratings_unavailable");
    return { rateHardware, catalogue };
  } catch (error) {
    if (error instanceof ImportError) throw error;
    fail("hardware_ratings_unavailable");
  }
}

function isValidDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function nextDatabaseVersion(version) {
  const [major, minor, patch] = version.split(".").map(Number);
  if (![major, minor, patch].every(Number.isSafeInteger) || patch === Number.MAX_SAFE_INTEGER) fail("database_version_exhausted");
  return `${major}.${minor}.${patch + 1}`;
}

/**
 * Validate and prepare a maintainer-reviewed dataset update. `publishApproved`
 * is deliberately required for any write; without it, the result is preview
 * data only and the caller must not mutate a file.
 */
export async function prepareImport({ reportValues, database, options }) {
  const scoring = await import("../src/lib/performance-scores.ts");
  if (typeof scoring.scoreReport !== "function" || typeof scoring.SCORING_VERSION !== "number"
    || typeof scoring.SCORE_FIXTURE_VERSION !== "string" || !isObject(scoring.THOROUGH_STAGE_SAMPLES)
    || !isObject(scoring.THOROUGH_STAGE_UNITS) || !isObject(scoring.FRONTEND_STAGE_SAMPLES)
    || !isObject(scoring.FRONTEND_STAGE_UNITS) || !isObject(scoring.SYSTEM_WEIGHTS) || !isObject(scoring.GPU_WEIGHTS)) {
    fail("scoring_contract_unavailable");
  }
  const hardwareContract = await loadHardwareContract();
  if (!Array.isArray(reportValues) || reportValues.length < 3 || reportValues.length > MAX_REPORTS) fail("three_runs_required");
  validateOptions(options);
  const units = { ...scoring.THOROUGH_STAGE_UNITS, ...scoring.FRONTEND_STAGE_UNITS };
  const reports = reportValues.map((report) => normalizeReport(
    report,
    scoring.THOROUGH_STAGE_SAMPLES,
    units,
    scoring.FRONTEND_STAGE_SAMPLES,
    scoring.SCORE_FIXTURE_VERSION,
    Object.keys(scoring.GPU_WEIGHTS),
    hardwareContract,
  ));
  const ids = new Set();
  const aggregateHashes = new Set();
  for (const report of reports) {
    if (ids.has(report.id)) fail("duplicate_run");
    if (aggregateHashes.has(report.aggregateHash)) fail("duplicate_aggregate");
    ids.add(report.id);
    aggregateHashes.add(report.aggregateHash);
  }
  const first = reports[0];
  if (reports.some((report) => !sameCohort(report.cohort, first.cohort)
    || !sameProfile(publicProfile(report), publicProfile(first))
    || !sameProfile([...report.stages.keys()].sort(), [...first.stages.keys()].sort()))) fail("mixed_system_profile");
  const suppliedSystemIds = reports.map((report) => report.systemId).filter((value) => value !== null);
  if (suppliedSystemIds.length !== 0 && suppliedSystemIds.length !== reports.length) fail("mixed_installations");
  const distinctSystemIds = new Set(suppliedSystemIds);
  if (options.installationCount === 1 && suppliedSystemIds.length > 0 && distinctSystemIds.size !== 1) fail("mixed_installations");
  if (options.installationCount > 1
    && (suppliedSystemIds.length !== reports.length || distinctSystemIds.size !== options.installationCount)) fail("mixed_installations");
  if (first.cohort.fixtureVersion !== scoring.SCORE_FIXTURE_VERSION) fail("unsupported_fixture");

  const knownDb = validateDatabase(database, scoring, hardwareContract);
  const cohortRecordExists = knownDb.referenceCohorts.has(stableJson(first.cohort));
  let newReference = null;
  if (options.createReference) {
    if (cohortRecordExists) fail("reference_is_frozen");
    if (options.installationCount !== 1) fail("reference_requires_one_installation");
    newReference = makeReference(reports, options, scoring);
  } else if (!cohortRecordExists) {
    fail("unmatched_cohort_use_create_reference");
  }

  const candidateReferences = newReference ? [...database.references, newReference] : database.references;
  const candidateDatabase = { ...database, version: nextDatabaseVersion(database.version), references: candidateReferences };
  const profile = publicProfile(first);
  const id = profileId(profile);
  if (knownDb.systemIds.has(id)) fail("duplicate_system_profile");

  const requiredNativeIds = new Set(Object.keys(scoring.THOROUGH_STAGE_SAMPLES));
  const scores = reports.map((report) => {
    // Optional frontend timings do not contribute to the public system score.
    const scoreInput = { ...report.raw, stages: report.raw.stages.filter((stage) => requiredNativeIds.has(stage.id)) };
    const computed = scoring.scoreReport(scoreInput, candidateDatabase);
    if (report.gpuEligible) return computed;
    // Provider text alone is not evidence. The database can still publish a
    // CPU/system score, but this run cannot contribute a CUDA score.
    return { ...computed, gpu: { value: null, reason: "gpu-not-measured", referenceId: null } };
  });
  if (scores.some((score) => score.system?.value === null || score.system?.reason !== null)) fail("score_unavailable");
  const normalizedSystemScore = medianScore(scores.map((score) => score.system.value));
  const gpuScores = scores.map((score) => score.gpu?.value ?? null);
  const normalizedGpuScore = gpuScores.every((score) => score !== null) ? medianScore(gpuScores) : null;

  const system = {
    id,
    cohort: first.cohort,
    appVersion: first.environment.appVersion,
    cpu: first.environment.cpu,
    logicalCores: first.environment.logicalCores,
    memoryMb: first.environment.memoryMb,
    gpu: first.environment.gpu,
    aiProvider: first.environment.aiProvider,
    runCount: reports.length,
    installationCount: options.installationCount,
    stages: publicStageStats(reports),
    systemScore: normalizedSystemScore,
    gpuScore: normalizedGpuScore,
  };
  if (first.hardwareSpecs !== null) {
    system.hardwareSpecs = first.hardwareSpecs;
    system.hardwareRatings = first.hardwareRatings;
  }
  candidateDatabase.systems = [...database.systems, system];
  validateDatabase(candidateDatabase, scoring, hardwareContract);

  return {
    database: candidateDatabase,
    addedReference: newReference,
    addedSystem: system,
    scores,
    publishApproved: options.publishApproved === true,
  };
}

export async function readReportFiles(filePaths) {
  return Promise.all(filePaths.map(async (filePath) => {
    try {
      if ((await stat(filePath)).size > MAX_INPUT_FILE_BYTES) fail("input_file_too_large");
      return JSON.parse(await readFile(filePath, "utf8"));
    } catch (error) {
      if (error instanceof ImportError) throw error;
      fail("could_not_read_report");
    }
  }));
}

export async function readDatabase(filePath = DEFAULT_DATABASE_PATH) {
  try {
    if ((await stat(filePath)).size > MAX_INPUT_FILE_BYTES) fail("input_file_too_large");
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error instanceof ImportError) throw error;
    fail("could_not_read_database");
  }
}

export async function writeDatabaseAtomically(filePath, database) {
  const destination = path.resolve(filePath);
  const temporary = `${destination}.tmp-${process.pid}`;
  try {
    await writeFile(temporary, `${JSON.stringify(database, null, 2)}\n`, { flag: "wx", mode: 0o644 });
    await rename(temporary, destination);
  } catch {
    try { await (await import("node:fs/promises")).unlink(temporary); } catch { /* no temporary file to remove */ }
    fail("could_not_write_database");
  }
}

function parseArgs(args) {
  const options = {
    reportPaths: [], databasePath: DEFAULT_DATABASE_PATH, publishApproved: false, createReference: false,
    sourceCommit: null, collectedAt: null, installationCount: 1, method: null, help: false,
  };
  const valueOptions = new Set(["--db", "--source-commit", "--collected-at", "--installation-count", "--method"]);
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") options.help = true;
    else if (argument === "--publish-approved") options.publishApproved = true;
    else if (argument === "--create-reference") options.createReference = true;
    else if (valueOptions.has(argument)) {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) fail("invalid_cli_arguments");
      index += 1;
      if (argument === "--db") options.databasePath = path.resolve(value);
      if (argument === "--source-commit") options.sourceCommit = value;
      if (argument === "--collected-at") options.collectedAt = value;
      if (argument === "--installation-count") {
        if (!/^\d+$/u.test(value)) fail("invalid_cli_arguments");
        options.installationCount = Number(value);
      }
      if (argument === "--method") options.method = value;
    } else if (argument.startsWith("-")) fail("invalid_cli_arguments");
    else options.reportPaths.push(path.resolve(argument));
  }
  return options;
}

export function usage() {
  return [
    "Usage:",
    "  node --experimental-strip-types benchmarks/import-typical-speeds.mjs [options] report1.json report2.json report3.json [...]",
    "",
    "Options:",
    "  --db PATH                  Dataset path (default: benchmarks/typical-speeds.json)",
    "  --create-reference         Add a new frozen reference for this exact cohort",
    "  --publish-approved         Write the validated dataset update (otherwise preview only)",
    "  --source-commit HASH       Benchmark code commit (7-40 hex characters)",
    "  --collected-at YYYY-MM-DD  Public collection date; raw report timestamps are discarded",
    "  --installation-count N     Verified installation count (default: 1; IDs are never stored)",
    "  --method VALUE             maintainer-reviewed or self-reported",
  ].join("\n");
}

export async function main(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  if (options.help) {
    console.log(usage());
    return 0;
  }
  if (options.reportPaths.length < 3) fail("three_runs_required");
  validateOptions(options);
  const reportValues = await readReportFiles(options.reportPaths);
  const database = await readDatabase(options.databasePath);
  const result = await prepareImport({ reportValues, database, options });
  const preview = {
    mode: result.addedReference ? "new-reference" : "new-system",
    cohort: result.addedSystem.cohort,
    installationCount: result.addedSystem.installationCount,
    runCount: result.addedSystem.runCount,
    referenceId: result.addedReference?.id ?? result.scores[0]?.system?.referenceId ?? null,
    system: result.addedSystem,
    scoresByRun: result.scores.map((score) => ({ system: score.system, gpu: score.gpu })),
    writeAuthorized: options.publishApproved,
  };
  if (!options.publishApproved) {
    console.log(JSON.stringify(preview, null, 2));
    console.error("Preview only; no database file was changed. Re-run with --publish-approved to write.");
    return 0;
  }
  await writeDatabaseAtomically(options.databasePath, result.database);
  console.log(JSON.stringify({ ...preview, written: true }, null, 2));
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    const code = error instanceof ImportError ? error.code : "import_failed";
    console.error(`Import refused: ${code}`);
    process.exitCode = 1;
  });
}
