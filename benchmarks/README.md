# Typical speeds database

`typical-speeds.json` is an optional, bundled comparison dataset for the local benchmark. The app reads this file locally and does not fetch updates. Sending an approved diagnostic report through the separate notification settings is an independent, explicit action; it does not publish a row to this dataset.

The initial references are maintainer seeds, not fleet-wide or statistically representative “typical computer” results. Collected 2026-10-18, they comprise three debug and three release Thorough runs on one AMD Ryzen 5 7500F desktop with an NVIDIA GeForce RTX 3060 Ti, 12 logical cores, and 31,616 MiB RAM. Both exact build cohorts used Linux x86_64, turbo JPEG, CUDA, app version 0.7.0, and fixture `4-6000x4000-texture-gpu-ai`. All six runs completed 30 stages with 32 CUDA calls and no whole-model CPU or fallback calls. Generated fixtures were used; no user's photo library was touched.

No compiler or test process was intentionally active during timed runs, but the desktop session remained active and spot-checked GPU use varied from 11% to 30%; treat these as one machine's reference measurements, not a fully idle-device baseline. Each run used unique XDG cache, config, data, and state directories. “Cold” means an app-cache miss; OS filesystem cache was not controlled. Release timings came from the Ubuntu 24 release binary run on the Linux host after its provider libraries were copied byte-identically out of the isolated build root. Two earlier release attempts with no completed CUDA inference were excluded. The workload does not measure physical-card throughput, camera sensor decoding, or all hardware. The seed's `method` and hardware/build fields describe what was actually measured; later additions must be explicitly reviewed and must not silently move the frozen reference anchors. Published system rows report each stage's mean per-run average, median, minimum, maximum, and run count. These are measurements from the listed systems, not claims about the wider Culltivate user population.

| Build profile | Runs | System index¹ | GPU-assisted AI index¹ | Basic warm average² | Advanced warm average² |
|---|---:|---:|---:|---:|---:|
| Debug · turbo JPEG · CUDA | 3 | 1002 | 998 | 4.835 ms | 8.852 ms |
| Release · turbo JPEG · CUDA | 3 | 1063 | 986 | 6.064 ms | 10.278 ms |

¹ Median of the three run indices. Each build has its own frozen reference;
compare only matching build, platform and fixture cohorts.
² Median across the three per-run arithmetic averages. Each run samples the
same face photo five times for basic AI and three times for advanced AI.

## What is compared

The cohort key is the exact operating system, architecture, build string, and fixture version. App version and hardware are public descriptive fields, not part of the cohort key. A reference is created from the median of each scored stage's per-run arithmetic mean across at least three completed Thorough runs. For each score, the dimensionless index is `1000 × exp(Σ weight × ln(referenceMeanMs / measuredMeanMs))`; higher is faster, and 1000 is the frozen reference. The system index weights are `preview-thumbnail-cold` 0.15, `preview-fit-cold` 0.25, `image-decode` 0.20, `portrait-orientation` 0.20, `scan-pairing` 0.10, and `ingest-copy` 0.10. The CUDA-assisted AI index weights `face-analysis-warm` and `advanced-face-warm` equally at 0.5 each. It measures the full AI workflow, including CPU setup and pre/post-processing, and may include CPU operators inside YOLO graphs. A GPU score requires typed evidence for all four model stages, CUDA calls in both weighted warm stages, and zero whole-model CPU or fallback calls across the report. Missing or mixed inference evidence leaves that score unavailable.

Public hardware-row scores are medians of individual run indices. Because the frozen reference combines component medians, its source system’s median run score need not equal exactly 1000.

Public system rows contain only aggregate stage means, spread, run count, installation count, app/build/hardware descriptors, and recomputed scores. Run identifiers, installation aliases, timestamps, file paths, filenames, image metadata, raw samples, stage details, errors, and submitted score values are not written. Hardware descriptors should be checked for privacy before publication because model names can identify a narrow class of devices.

## Maintainer import

Use Node 22.12 or newer. Give the importer at least three exported reports from the same machine profile and exact Thorough cohort. It accepts either a native raw benchmark export (schema 1) or the aggregate diagnostic export (schema 3). The importer runs offline and only writes when `--publish-approved` is present.

Preview a new cohort without changing the dataset. Place report paths directly after the options:

```sh
node --experimental-strip-types benchmarks/import-typical-speeds.mjs \
  --create-reference --source-commit 5d4a8b07b3fea3176477d90ce8b356092c02d7d7 \
  --collected-at 2026-10-18 --method maintainer-reviewed \
  /private/benchmark-1.json /private/benchmark-2.json /private/benchmark-3.json
```

Review the sanitized preview. Publish only after confirming the reports, build, workload, provenance, and public hardware descriptors:

```sh
node --experimental-strip-types benchmarks/import-typical-speeds.mjs \
  --create-reference --publish-approved \
  --source-commit 5d4a8b07b3fea3176477d90ce8b356092c02d7d7 \
  --collected-at 2026-10-18 --method maintainer-reviewed \
  /private/benchmark-1.json /private/benchmark-2.json /private/benchmark-3.json
```

For an additional hardware profile in an existing cohort, omit `--create-reference`. The importer rejects unmatched cohorts, changed frozen references, duplicate runs or aggregate measurements, incomplete workloads, failed runs, unsupported builds/fixtures, and inconsistent profiles. The preview displays the next dataset version; an approved addition increments its patch number. Set `--installation-count` only when the reviewed reports establish that many distinct installations; installation aliases are used only for validation and are never published. The default database is this directory's `typical-speeds.json`; `--db PATH` selects another file for review or testing.

The required explicit `--publish-approved` flag is a maintainer publication gate, not an application upload setting. The importer makes no network requests and has no automatic submission path.
