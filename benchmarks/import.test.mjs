import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import typicalDatabase from "./typical-speeds.json" with { type: "json" };
import {
  ImportError,
  prepareImport,
} from "./import-typical-speeds.mjs";
import {
  FRONTEND_STAGE_SAMPLES,
  FRONTEND_STAGE_UNITS,
  SCORE_FIXTURE_VERSION,
  THOROUGH_STAGE_SAMPLES,
  THOROUGH_STAGE_UNITS,
  scoreReport,
} from "../src/lib/performance-scores.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE_OPTIONS = {
  sourceCommit: "5d4a8b07b3fea3176477d90ce8b356092c02d7d7",
  collectedAt: "2026-10-18",
  installationCount: 1,
  method: "maintainer-reviewed",
  createReference: true,
  publishApproved: false,
};
const SOURCE_URL = "https://github.com/wispdevon/OpenCull/blob/main/benchmarks/typical-speeds.json";

function emptyDatabase() {
  return {
    schemaVersion: 1,
    scoringVersion: 1,
    version: "1.0.0",
    sourceUrl: SOURCE_URL,
    references: [],
    systems: [],
  };
}

function makeReport(run, options = {}) {
  const gpu = options.gpu ?? false;
  const cpu = options.cpu ?? "Intel(R) Core(TM) i5-12500 CPU @ 2.50GHz";
  const report = {
    schemaVersion: 1,
    id: options.id ?? `benchmark-${run}-1770000000000`,
    kind: "benchmark",
    mode: "thorough",
    outcome: "completed",
    startedAtMs: 1_770_000_000_000 + run * 100_000,
    finishedAtMs: 1_770_000_060_000 + run * 100_000,
    environment: {
      appVersion: options.appVersion ?? "0.7.0",
      build: options.build ?? (gpu ? "release turbo-jpeg cuda" : "release turbo-jpeg"),
      os: "linux",
      arch: "x86_64",
      cpu,
      logicalCores: 16,
      memoryMb: 32_768,
      gpu: options.gpuModel ?? (gpu ? "NVIDIA GeForce RTX 4070" : "Intel UHD Graphics"),
      aiProvider: gpu ? "CUDA (YOLO may use CPU operators)" : "CPU benchmark inference",
      fixtureVersion: SCORE_FIXTURE_VERSION,
      ...(options.hardwareSpecs ? { hardwareSpecs: options.hardwareSpecs } : {}),
    },
    stages: [],
    coverage: [{ id: "native-runtime", label: "Native runtime", status: "measured", reason: null }],
    recommendations: [{
      stageId: "preview-thumbnail-cold",
      priority: "medium",
      evidence: "Private evidence: /Users/alex/Pictures/IMG_1001.RAW",
      action: "Private action detail that must not enter the public database",
    }],
  };

  let index = 0;
  const allSamples = { ...THOROUGH_STAGE_SAMPLES, ...(options.frontend ?? {}) };
  const allUnits = { ...THOROUGH_STAGE_UNITS, ...FRONTEND_STAGE_UNITS };
  for (const [id, count] of Object.entries(allSamples)) {
    const isAi = id.startsWith("face-analysis-") || id.startsWith("advanced-face-");
    const zeroFrontend = options.zeroFrontend && id.startsWith("frontend.");
    const value = options.tinyStage === id ? 0.0000001 : zeroFrontend ? 0 : (4 + index + run * 0.25) * (options.timingScale ?? 1);
    const inference = isAi
      ? gpu
        ? { cudaCalls: id.endsWith("-warm") ? 2 : 1, cpuCalls: 0, cpuFallbackCalls: 0 }
        : { cudaCalls: 0, cpuCalls: 1, cpuFallbackCalls: 0 }
      : undefined;
    report.stages.push({
      id,
      label: id.startsWith("frontend.") ? `Frontend ${id.slice(9)}` : `Benchmark ${id}`,
      category: id.startsWith("frontend.") ? "frontend" : isAi ? "ai" : "preview",
      cache: id.endsWith("-cold") ? "cold" : id.endsWith("-warm") ? "warm" : "none",
      samplesMs: Array.from({ length: count }, (_, sample) => options.tinyStage === id || zeroFrontend ? value : value + sample * 0.001),
      units: count * allUnits[id],
      bytes: 1024,
      failures: 0,
      status: "passed",
      detail: "Private path: /home/alex/photos/IMG_1001.RAW; EXIF serial 123456",
      ...(inference ? { inference } : {}),
    });
    index += 1;
  }
  if (options.systemId !== undefined) report.systemId = options.systemId;
  return report;
}

function makeDiagnosticReport(raw, options = {}) {
  const report = structuredClone(raw);
  report.schemaVersion = options.schemaVersion ?? 3;
  report.systemId ??= "amber-wren-123456";
  report.stages = report.stages.map((stage) => {
    const samples = stage.samplesMs.toSorted((left, right) => left - right);
    const totalMs = samples.reduce((sum, value) => sum + value, 0);
    const count = samples.length;
    return {
      id: stage.id,
      label: stage.label,
      category: stage.category,
      cache: stage.cache,
      status: stage.status,
      count,
      totalMs,
      medianMs: count ? (samples[Math.floor((count - 1) / 2)] + samples[Math.floor(count / 2)]) / 2 : 0,
      maxMs: samples.at(-1) ?? 0,
      p95Ms: count >= 20 ? samples[Math.ceil(count * 0.95) - 1] : null,
      units: stage.units,
      bytes: stage.bytes,
      failures: stage.failures,
      throughputPerSecond: totalMs > 0 ? stage.units * 1000 / totalMs : null,
      ...(stage.inference ? { inference: stage.inference } : {}),
    };
  });
  report.performanceScores = {
    scoringVersion: 1,
    databaseVersion: "attacker-controlled-version",
    cohortId: "attacker-controlled-reference",
    system: { value: 999_999, reason: null, referenceId: "attacker-controlled-reference" },
    gpu: { value: 999_999, reason: null, referenceId: "attacker-controlled-reference" },
  };
  if (report.schemaVersion === 4) {
    report.hardwareRatings = options.hardwareRatings ?? {
      formulaVersion: 1,
      catalogueVersion: "1.0.0",
      profile: { cpuId: "fabricated-cpu", gpuId: "fabricated-gpu", installedMemoryMb: 12_345 },
      system: { value: 987_654, reason: null },
      gpu: { value: 987_654, reason: null },
      components: {
        cpu: { physicalCores: 6, baseClockMHz: 2_500, points: 15_000, sourceId: "fabricated-cpu" },
        gpu: { shaderCores: 2_000, baseClockMHz: 1_500, vramGiB: 8, points: 24_000_000, sourceId: "fabricated-gpu" },
        ram: { installedGiB: 12, points: 12 },
      },
    };
  } else {
    delete report.hardwareRatings;
  }
  if (options.partialFrontend) report.stages = report.stages.filter((stage) => stage.id !== "frontend.crop");
  return report;
}

function reports(options = {}) {
  return [0, 1, 2].map((run) => makeReport(run, options));
}

test("bundled database has frozen debug and release cohorts and scores both", () => {
  assert.equal(typicalDatabase.version, "1.1.0");
  assert.equal(typicalDatabase.references.length, 2);
  assert.equal(typicalDatabase.systems.length, 2);
  assert.deepEqual(
    typicalDatabase.references.map((reference) => reference.cohort.build).sort(),
    ["debug turbo-jpeg cuda", "release turbo-jpeg cuda"],
  );
  assert.ok(typicalDatabase.references.every((reference) => reference.runCount === 3 && reference.installationCount === 1));
  assert.ok(typicalDatabase.references.every((reference) => reference.gpu !== null));
  assert.ok(typicalDatabase.systems.every((system) => system.hardwareRatings.system.value === 2063
    && system.hardwareRatings.gpu.value === 1372 && system.hardwareSpecs.installedMemoryMb === 32_768));
  assert.deepEqual(typicalDatabase.systems[0].hardwareRatings, typicalDatabase.systems[1].hardwareRatings);

  for (const build of ["debug turbo-jpeg cuda", "release turbo-jpeg cuda"]) {
    const report = makeReport(1, { gpu: true, build, cpu: "AMD Ryzen 5 7500F 6-Core Processor" });
    const score = scoreReport(report, typicalDatabase);
    assert.ok(score.system.value !== null);
    assert.ok(score.gpu.value !== null);
    assert.equal(score.cohortId, typicalDatabase.references.find((reference) => reference.cohort.build === build).id);
  }
  const serialized = JSON.stringify(typicalDatabase);
  assert.ok(!serialized.includes("bench-179230"));
  assert.ok(!serialized.includes("seed-debug"));
  assert.ok(!serialized.includes("seed-release"));
});

async function expectImportError(run, code) {
  await assert.rejects(run, (error) => error instanceof ImportError && error.code === code);
}

test("creates frozen median-of-run-means references and recomputes scores", async () => {
  const inputs = reports();
  const result = await prepareImport({ reportValues: inputs, database: emptyDatabase(), options: BASE_OPTIONS });
  const stageValues = inputs.map((report) => report.stages.find((stage) => stage.id === "scan-pairing").samplesMs
    .reduce((sum, value) => sum + value, 0) / THOROUGH_STAGE_SAMPLES["scan-pairing"]);
  const ordered = [...stageValues].sort((left, right) => left - right);

  assert.equal(result.addedReference.runCount, 3);
  assert.equal(result.addedReference.installationCount, 1);
  assert.equal(result.addedReference.system["scan-pairing"], ordered[1]);
  assert.equal(result.addedSystem.runCount, 3);
  assert.equal(result.addedSystem.stages["scan-pairing"].runCount, 3);
  assert.equal(result.scores[1].system.value, 1000);
  assert.ok(result.scores.every((score) => score.system.value !== null));
  assert.ok(result.scores.every((score) => score.gpu.value === null && score.gpu.reason === "gpu-not-measured"));
  assert.equal(scoreReport(inputs[0], result.database).system.value, result.scores[0].system.value);
  assert.equal(result.publishApproved, false);
  assert.equal(emptyDatabase().references.length, 0);
});

test("accepts aggregate schema v3, ignores supplied scores, and strips run-private fields", async () => {
  const diagnostic = reports().map((report) => makeDiagnosticReport(report));
  const result = await prepareImport({ reportValues: diagnostic, database: emptyDatabase(), options: BASE_OPTIONS });
  const serialized = JSON.stringify(result.database);

  assert.equal(result.scores[1].system.value, 1000);
  assert.ok(result.scores.every((score) => score.system.referenceId === result.addedReference.id));
  assert.ok(!serialized.includes("attacker-controlled"));
  assert.ok(!serialized.includes("amber-wren-123456"));
  assert.ok(!serialized.includes("benchmark-0-1770000000000"));
  assert.ok(!serialized.includes("/home/alex"));
  assert.ok(!serialized.includes("/Users/alex"));
  assert.ok(!serialized.includes("EXIF serial"));
  assert.ok(!serialized.includes("Private action detail"));
});

test("recomputes hardware ratings from fixed specifications, independent of measured speed", async () => {
  const hardwareSpecs = {
    cpuModel: "AMD Ryzen 5 7500F 6-Core Processor",
    gpuModel: "NVIDIA GeForce RTX 3060 Ti",
    installedMemoryMb: 32_768,
  };
  const debugReports = reports({
    hardwareSpecs,
    build: "debug turbo-jpeg cuda",
    cpu: "AMD Ryzen 5 7500F 6-Core Processor",
    gpuModel: "NVIDIA GeForce RTX 3060 Ti",
    gpu: true,
    appVersion: "0.7.0",
    timingScale: 1,
  }).map((report) => makeDiagnosticReport(report, { schemaVersion: 4 }));
  const debug = await prepareImport({ reportValues: debugReports, database: emptyDatabase(), options: BASE_OPTIONS });

  assert.deepEqual(debug.addedSystem.hardwareSpecs, hardwareSpecs);
  assert.equal(debug.addedSystem.hardwareRatings.formulaVersion, 1);
  assert.equal(debug.addedSystem.hardwareRatings.catalogueVersion, "1.0.0");
  assert.equal(debug.addedSystem.hardwareRatings.system.value, 2063);
  assert.equal(debug.addedSystem.hardwareRatings.gpu.value, 1372);
  assert.notEqual(debug.addedSystem.hardwareRatings.system.value, 987_654);
  assert.equal(debug.addedSystem.hardwareRatings.profile.installedMemoryMb, 32_768);

  const releaseReports = reports({
    hardwareSpecs,
    build: "release turbo-jpeg cuda",
    cpu: "AMD Ryzen 5 7500F 6-Core Processor",
    gpuModel: "NVIDIA GeForce RTX 3060 Ti",
    gpu: true,
    appVersion: "0.8.0",
    timingScale: 3,
  }).map((report) => makeDiagnosticReport(report, { schemaVersion: 4 }));
  const release = await prepareImport({
    reportValues: releaseReports,
    database: debug.database,
    options: BASE_OPTIONS,
  });
  assert.deepEqual(release.addedSystem.hardwareRatings, debug.addedSystem.hardwareRatings);
  assert.notEqual(release.addedSystem.stages["preview-thumbnail-cold"].meanAverageMs,
    debug.addedSystem.stages["preview-thumbnail-cold"].meanAverageMs);
  assert.notEqual(release.addedSystem.appVersion, debug.addedSystem.appVersion);
  assert.notEqual(release.addedSystem.cohort.build, debug.addedSystem.cohort.build);
});

test("v4 hardware ratings are required but never published without a verified identity", async () => {
  const missingRatings = reports().map((report) => makeDiagnosticReport(report, { schemaVersion: 4 }));
  delete missingRatings[0].hardwareRatings;
  await expectImportError(
    prepareImport({ reportValues: missingRatings, database: emptyDatabase(), options: BASE_OPTIONS }),
    "invalid_report",
  );

  const unknownIdentity = reports().map((report) => makeDiagnosticReport(report, { schemaVersion: 4 }));
  const result = await prepareImport({ reportValues: unknownIdentity, database: emptyDatabase(), options: BASE_OPTIONS });
  assert.equal(Object.hasOwn(result.addedSystem, "hardwareSpecs"), false);
  assert.equal(Object.hasOwn(result.addedSystem, "hardwareRatings"), false);

  const extraHardwareField = reports({ hardwareSpecs: {
    cpuModel: "AMD Ryzen 5 7500F 6-Core Processor",
    gpuModel: "NVIDIA GeForce RTX 3060 Ti",
    installedMemoryMb: 32_768,
  } }).map((report) => makeDiagnosticReport(report, { schemaVersion: 4 }));
  extraHardwareField[0].environment.hardwareSpecs.serialNumber = "private-device-id";
  await expectImportError(
    prepareImport({ reportValues: extraHardwareField, database: emptyDatabase(), options: BASE_OPTIONS }),
    "invalid_hardware_profile",
  );
});

test("rejects aggregate summaries with impossible or zero native percentiles", async () => {
  const impossible = reports().map((report) => makeDiagnosticReport(report));
  const stage = impossible[0].stages.find((entry) => entry.id === "histogram");
  stage.totalMs = 12;
  stage.medianMs = 1;
  stage.maxMs = 1;
  stage.p95Ms = 1;
  stage.throughputPerSecond = stage.units * 1000 / 12;
  await expectImportError(
    prepareImport({ reportValues: impossible, database: emptyDatabase(), options: BASE_OPTIONS }),
    "invalid_measurements",
  );

  const exactBoundary = reports().map((report) => makeDiagnosticReport(report));
  const boundaryStage = exactBoundary[0].stages.find((entry) => entry.id === "histogram");
  boundaryStage.totalMs = 13;
  boundaryStage.medianMs = 1;
  boundaryStage.maxMs = 1;
  boundaryStage.p95Ms = 1;
  boundaryStage.throughputPerSecond = boundaryStage.units * 1000 / 13;
  await prepareImport({ reportValues: exactBoundary, database: emptyDatabase(), options: BASE_OPTIONS });

  const zeroNativeMedian = reports().map((report) => makeDiagnosticReport(report));
  zeroNativeMedian[0].stages.find((entry) => entry.id === "histogram").medianMs = 0;
  await expectImportError(
    prepareImport({ reportValues: zeroNativeMedian, database: emptyDatabase(), options: BASE_OPTIONS }),
    "invalid_measurements",
  );
});

test("rejects partial optional frontend coverage and accepts the complete supplement", async () => {
  const partial = reports({ frontend: { "frontend.review": 20, "frontend.scene": 20, "frontend.resume": 20, "frontend.crop": 20 } })
    .map((report) => makeDiagnosticReport(report, { partialFrontend: true }));
  await expectImportError(
    prepareImport({ reportValues: partial, database: emptyDatabase(), options: BASE_OPTIONS }),
    "incomplete_stages",
  );

  const complete = reports({ frontend: FRONTEND_STAGE_SAMPLES })
    .map((report) => makeDiagnosticReport(report));
  const result = await prepareImport({ reportValues: complete, database: emptyDatabase(), options: BASE_OPTIONS });
  for (const id of Object.keys(FRONTEND_STAGE_SAMPLES)) assert.ok(result.addedSystem.stages[id]);

  const damagedDatabase = structuredClone(result.database);
  delete damagedDatabase.systems[0].stages["frontend.crop"];
  await expectImportError(
    prepareImport({
      reportValues: complete,
      database: damagedDatabase,
      options: { ...BASE_OPTIONS, createReference: false },
    }),
    "invalid_database",
  );
});

test("accepts zero-duration frontend samples without rounding positive native timings to zero", async () => {
  const input = reports({
    frontend: FRONTEND_STAGE_SAMPLES,
    tinyStage: "scan-pairing",
    zeroFrontend: true,
  }).map((report) => makeDiagnosticReport(report));
  const result = await prepareImport({ reportValues: input, database: emptyDatabase(), options: BASE_OPTIONS });

  assert.equal(result.addedSystem.stages["frontend.review"].meanAverageMs, 0);
  assert.ok(result.addedSystem.stages["scan-pairing"].meanAverageMs > 0);
});

test("requires distinct report content and never overwrites an existing frozen reference", async () => {
  const duplicateContent = reports();
  duplicateContent[1].stages = structuredClone(duplicateContent[0].stages);
  duplicateContent[2].stages = structuredClone(duplicateContent[0].stages);
  await expectImportError(
    prepareImport({ reportValues: duplicateContent, database: emptyDatabase(), options: BASE_OPTIONS }),
    "duplicate_aggregate",
  );

  const first = await prepareImport({ reportValues: reports(), database: emptyDatabase(), options: BASE_OPTIONS });
  await expectImportError(
    prepareImport({
      reportValues: reports({ cpu: "AMD Ryzen 9 5900X" }),
      database: first.database,
      options: { ...BASE_OPTIONS, createReference: true },
    }),
    "reference_is_frozen",
  );
});

test("rejects unsupported, incomplete, duplicate, or fabricated workloads", async (t) => {
  await t.test("quick reports", async () => {
    const input = reports();
    for (const report of input) report.mode = "quick";
    await expectImportError(prepareImport({ reportValues: input, database: emptyDatabase(), options: BASE_OPTIONS }), "unsupported_report");
  });

  await t.test("non-completed outcomes", async () => {
    const input = reports();
    input[1].outcome = "cancelled";
    await expectImportError(prepareImport({ reportValues: input, database: emptyDatabase(), options: BASE_OPTIONS }), "unsupported_report");
  });

  await t.test("missing required stage", async () => {
    const input = reports();
    for (const report of input) report.stages = report.stages.filter((stage) => stage.id !== "histogram");
    await expectImportError(prepareImport({ reportValues: input, database: emptyDatabase(), options: BASE_OPTIONS }), "incomplete_stages");
  });

  await t.test("wrong sample count", async () => {
    const input = reports();
    for (const report of input) report.stages.find((stage) => stage.id === "scan-pairing").samplesMs.pop();
    await expectImportError(prepareImport({ reportValues: input, database: emptyDatabase(), options: BASE_OPTIONS }), "invalid_sample_count");
  });

  await t.test("wrong units", async () => {
    const input = reports();
    for (const report of input) report.stages.find((stage) => stage.id === "scan-pairing").units -= 1;
    await expectImportError(prepareImport({ reportValues: input, database: emptyDatabase(), options: BASE_OPTIONS }), "invalid_workload");
  });

  await t.test("impossible inference fallback counters", async () => {
    const input = reports({ gpu: true });
    input[0].stages.find((stage) => stage.id === "face-analysis-warm").inference.cpuFallbackCalls = 1;
    await expectImportError(prepareImport({ reportValues: input, database: emptyDatabase(), options: BASE_OPTIONS }), "invalid_report");
  });

  await t.test("unknown field", async () => {
    const input = reports();
    input[0].unexpected = "untrusted";
    await expectImportError(prepareImport({ reportValues: input, database: emptyDatabase(), options: BASE_OPTIONS }), "invalid_report");
  });

  await t.test("non-array stage collection", async () => {
    const input = reports();
    input[0].stages = { unexpected: true };
    await expectImportError(prepareImport({ reportValues: input, database: emptyDatabase(), options: BASE_OPTIONS }), "incomplete_stages");
  });

  await t.test("duplicate run ID", async () => {
    const input = reports();
    input[2].id = input[0].id;
    await expectImportError(prepareImport({ reportValues: input, database: emptyDatabase(), options: BASE_OPTIONS }), "duplicate_run");
  });

  await t.test("mixed build cohorts", async () => {
    const input = reports();
    input[2].environment.build = "debug turbo-jpeg";
    await expectImportError(prepareImport({ reportValues: input, database: emptyDatabase(), options: BASE_OPTIONS }), "mixed_system_profile");
  });
});

test("only records a GPU score with complete typed CUDA evidence and a known CUDA provider", async () => {
  const input = reports({ gpu: true }).map((report) => ({
    ...report,
    environment: { ...report.environment, cpu: "AMD Ryzen 9 5900X" },
  }));
  const gpuReference = await prepareImport({ reportValues: input, database: emptyDatabase(), options: BASE_OPTIONS });
  assert.equal(gpuReference.scores[1].gpu.value, 1000);
  assert.ok(gpuReference.scores.every((score) => score.gpu.value !== null));

  const missingColdEvidence = reports({ gpu: true, cpu: "AMD Ryzen 9 5900X" }).map((report) => {
    report.stages.find((stage) => stage.id === "face-analysis-cold").inference = undefined;
    return report;
  });
  const withoutWholeRunEvidence = await prepareImport({ reportValues: missingColdEvidence, database: emptyDatabase(), options: BASE_OPTIONS });
  assert.equal(withoutWholeRunEvidence.addedReference.gpu, null);
  assert.ok(withoutWholeRunEvidence.scores.every((score) => score.gpu.value === null && score.gpu.reason === "gpu-not-measured"));

  const existingDatabase = gpuReference.database;
  const cpuInput = reports({ gpu: true, cpu: "AMD Ryzen 9 5900X" }).map((report) => {
    const next = structuredClone(report);
    next.environment.aiProvider = "unknown runtime provider text";
    next.stages.filter((stage) => stage.inference).forEach((stage) => {
      stage.inference.cpuCalls = 1;
      stage.inference.cudaCalls = stage.id.endsWith("-warm") ? 2 : 0;
    });
    return next;
  });
  const competitor = await prepareImport({
    reportValues: cpuInput,
    database: existingDatabase,
    options: { ...BASE_OPTIONS, createReference: false },
  });
  assert.ok(competitor.scores.every((score) => score.system.value !== null));
  assert.ok(competitor.scores.every((score) => score.gpu.value === null && score.gpu.reason === "gpu-not-measured"));
  assert.equal(competitor.addedSystem.aiProvider, null);

  const unknownProvider = reports({ gpu: true, cpu: "Apple M2" }).map((report) => {
    report.environment.aiProvider = "unknown runtime provider text";
    return report;
  });
  const unknown = await prepareImport({ reportValues: unknownProvider, database: emptyDatabase(), options: BASE_OPTIONS });
  assert.ok(unknown.scores.every((score) => score.system.value !== null));
  assert.equal(unknown.scores[1].system.value, 1000);
  assert.ok(unknown.scores.every((score) => score.gpu.value === null && score.gpu.reason === "gpu-not-measured"));
});

test("installation aliases are checked for count but never appear in public data", async () => {
  const database = await prepareImport({ reportValues: reports(), database: emptyDatabase(), options: BASE_OPTIONS });
  const inputs = reports({ cpu: "AMD Ryzen 9 5900X" }).map((report, index) => ({
    ...report,
    systemId: `amber-wren-${123456 + index}`,
  }));
  await expectImportError(
    prepareImport({
      reportValues: inputs,
      database: database.database,
      options: { ...BASE_OPTIONS, createReference: false, installationCount: 2 },
    }),
    "mixed_installations",
  );

  const valid = await prepareImport({
    reportValues: inputs,
    database: database.database,
    options: { ...BASE_OPTIONS, createReference: false, installationCount: 3 },
  });
  assert.equal(valid.addedSystem.installationCount, 3);
  assert.ok(!JSON.stringify(valid.database).includes("amber-wren-123456"));
});

test("CLI previews without writes and writes only with explicit publication approval", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "culltivate-import-test-"));
  try {
    const databasePath = path.join(temporaryRoot, "typical-speeds.json");
    const reportPaths = [];
    await writeFile(databasePath, `${JSON.stringify(emptyDatabase(), null, 2)}\n`);
    const originalDatabase = await readFile(databasePath, "utf8");
    for (const report of reports()) {
      const reportPath = path.join(temporaryRoot, `${report.id}.json`);
      await writeFile(reportPath, JSON.stringify(report));
      reportPaths.push(reportPath);
    }
    const scriptPath = path.join(ROOT, "benchmarks", "import-typical-speeds.mjs");
    const commonArgs = [
      "--experimental-strip-types", scriptPath,
      "--db", databasePath,
      "--source-commit", BASE_OPTIONS.sourceCommit,
      "--collected-at", BASE_OPTIONS.collectedAt,
      "--method", BASE_OPTIONS.method,
      "--create-reference",
      ...reportPaths,
    ];

    const preview = spawnSync(process.execPath, commonArgs, { cwd: ROOT, encoding: "utf8" });
    assert.equal(preview.status, 0, preview.stderr);
    assert.match(preview.stderr, /Preview only; no database file was changed/u);
    assert.equal(await readFile(databasePath, "utf8"), originalDatabase);
    assert.ok(!preview.stdout.includes("/home/alex"));

    const publish = spawnSync(process.execPath, [...commonArgs.slice(0, 2), "--publish-approved", ...commonArgs.slice(2)], {
      cwd: ROOT,
      encoding: "utf8",
    });
    assert.equal(publish.status, 0, publish.stderr);
    assert.match(publish.stdout, /"written": true/u);
    const written = JSON.parse(await readFile(databasePath, "utf8"));
    assert.equal(written.references.length, 1);
    assert.equal(written.systems.length, 1);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
