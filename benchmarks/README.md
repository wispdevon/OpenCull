# Typical speeds database

`typical-speeds.json` is an optional, bundled comparison dataset for the local benchmark and hardware profile. The app reads this file locally and does not fetch updates. Sending an approved diagnostic report through the separate notification settings is an independent, explicit action; it does not publish a row to this dataset.

The initial references are maintainer seeds, not fleet-wide or statistically representative “typical computer” results. Collected 2026-10-18, they comprise three debug and three release Thorough runs on one AMD Ryzen 5 7500F desktop with an NVIDIA GeForce RTX 3060 Ti and 12 logical cores. The benchmark environment reported 31,616 MiB OS-usable memory; the separately verified installed capacity is 32,768 MiB. Both exact build cohorts used Linux x86_64, turbo JPEG, CUDA, app version 0.7.0, and fixture `4-6000x4000-texture-gpu-ai`. All six runs completed 30 stages with 32 CUDA calls and no whole-model CPU or fallback calls. Generated fixtures were used; no user's photo library was touched.

| Hardware profile | System hardware rating | GPU capacity rating | CPU points | GPU points | RAM points |
|---|---:|---:|---:|---:|---:|
| Ryzen 5 7500F · RTX 3060 Ti · 32 GiB installed | 2063 | 1372 | 2220 | 1371.648 | 3200 |

These fixed specification ratings are identical for both builds. The timing-based rows below remain historical measurements of this system running two different app builds.

No compiler or test process was intentionally active during timed runs, but the desktop session remained active and spot-checked GPU use varied from 11% to 30%; treat these as one machine's reference measurements, not a fully idle-device baseline. Each run used unique XDG cache, config, data, and state directories. “Cold” means an app-cache miss; OS filesystem cache was not controlled. Release timings came from the Ubuntu 24 release binary run on the Linux host after its provider libraries were copied byte-identically out of the isolated build root. Two earlier release attempts with no completed CUDA inference were excluded. The workload does not measure physical-card throughput, camera sensor decoding, or all hardware. The seed's `method` and hardware/build fields describe what was actually measured; later additions must be explicitly reviewed and must not silently move the frozen reference anchors. Published system rows report each stage's mean per-run average, median, minimum, maximum, and run count. These are measurements from the listed systems, not claims about the wider Culltivate user population.

| Build profile | Runs | Historical system-speed index¹ | Historical GPU-workflow-speed index¹ | Basic warm average² | Advanced warm average² |
|---|---:|---:|---:|---:|---:|
| Debug · turbo JPEG · CUDA | 3 | 1002 | 998 | 4.835 ms | 8.852 ms |
| Release · turbo JPEG · CUDA | 3 | 1063 | 986 | 6.064 ms | 10.278 ms |

¹ These are the existing timing-based comparison fields (`systemScore` and
`gpuScore`), not hardware ratings. They are the median of the three run
indices. Each build has its own frozen reference; compare only matching
build, platform and fixture cohorts.
² Median across the three per-run arithmetic averages. Each run samples the
same face photo five times for basic AI and three times for advanced AI.

## What is compared

The cohort key is the exact operating system, architecture, build string, and fixture version. App version and hardware are public descriptive fields, not part of the cohort key. A reference is created from the median of each scored stage's per-run arithmetic mean across at least three completed Thorough runs. For each score, the dimensionless index is `1000 × exp(Σ weight × ln(referenceMeanMs / measuredMeanMs))`; higher is faster, and 1000 is the frozen reference. The system index weights are `preview-thumbnail-cold` 0.15, `preview-fit-cold` 0.25, `image-decode` 0.20, `portrait-orientation` 0.20, `scan-pairing` 0.10, and `ingest-copy` 0.10. The CUDA-assisted AI index weights `face-analysis-warm` and `advanced-face-warm` equally at 0.5 each. It measures the full AI workflow, including CPU setup and pre/post-processing, and may include CPU operators inside YOLO graphs. A GPU score requires typed evidence for all four model stages, CUDA calls in both weighted warm stages, and zero whole-model CPU or fallback calls across the report. Missing or mixed inference evidence leaves that score unavailable.

Public hardware-row scores are medians of individual run indices. Because the frozen reference combines component medians, its source system’s median run score need not equal exactly 1000.

Public system rows retain aggregate stage means, spread, run count, installation count, app/build descriptors, and the recomputed historical speed indices. These measurements describe observed app performance on that specific setup; they do not produce the hardware ratings below. Run identifiers, installation aliases, timestamps, file paths, filenames, image metadata, raw samples, stage details, errors, and submitted score values are not written.

## Hardware specification ratings

Hardware ratings are fixed capacity heuristics from published specifications. They do not use benchmark timings, app version/build, current or boost clocks, thread availability, provider, or workload settings, and they do not claim to predict application speed or architecture efficiency. Unknown or ambiguous model names leave the relevant rating unavailable. The app reports installed memory from hardware metadata separately from the OS-usable memory field; do not substitute `memoryMb` for `installedMemoryMb`.

The formula uses catalogued reference specifications in [`hardware-specifications.json`](./hardware-specifications.json): CPU points = physical cores × reference base MHz ÷ 10; GPU points = shader cores × reference base MHz × 2 ÷ 10,000; RAM points = installed GiB × 100. The system rating is `round(0.6 × CPU points + 0.3 × GPU points + 0.1 × RAM points)`. The GPU rating is `round(GPU points)`. Component points remain unrounded until the final displayed rating. The catalogue links the [AMD Ryzen 5 7500F specifications](https://www.amd.com/en/products/processors/desktops/ryzen/7000-series/amd-ryzen-5-7500F.html) and [NVIDIA RTX 30 Series reference specifications](https://www.nvidia.com/en-us/geforce/graphics-cards/compare/).

The seed hardware profile is an AMD Ryzen 5 7500F (6 cores, 3,700 MHz reference base), NVIDIA GeForce RTX 3060 Ti (4,864 shaders, 1,410 MHz reference base, 8 GiB VRAM), and 32 GiB installed RAM. Its system hardware rating is 2063 and GPU capacity rating is 1372. Debug and release rows have the same ratings because their hardware is identical; their historical speed indices differ because they are measured app timings. The source catalogue and formula are versioned independently from the timing reference data.

## Maintainer import

Use Node 22.12 or newer. Give the importer at least three exported reports from the same machine profile and exact Thorough cohort. It accepts a native raw benchmark export (schema 1), a legacy aggregate diagnostic export (schema 3), or a current aggregate diagnostic export (schema 4). Schema 4 hardware ratings are checked for shape but never trusted: the importer recomputes them from the allowlisted `environment.hardwareSpecs` and the bundled catalogue. Older reports may omit hardware identity; their timing data remains eligible, and the importer omits hardware rating fields for those rows. The importer runs offline and only writes when `--publish-approved` is present.

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

For an additional hardware profile in an existing cohort, omit `--create-reference`. The importer rejects unmatched cohorts, changed frozen references, duplicate runs or aggregate measurements, incomplete workloads, failed runs, unsupported builds/fixtures, and inconsistent profiles. The preview displays the next dataset version; an approved addition increments its patch number. Set `--installation-count` only when the reviewed reports establish that many distinct installations; installation aliases are used only for validation and are never published. The default database is this directory's `typical-speeds.json`; `--db PATH` selects another file for review or testing. A reported hardware identity is included only as the three allowlisted CPU model, GPU model, and installed-memory fields; submitted rating numbers never enter the public dataset.

The required explicit `--publish-approved` flag is a maintainer publication gate, not an application upload setting. The importer makes no network requests and has no automatic submission path.
