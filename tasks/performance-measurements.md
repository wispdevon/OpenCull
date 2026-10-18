# Performance measurements

## Recent-session resume selection

`latestSession` used to copy and sort the full saved-card array to find its most
recent entry. It now scans once, retaining the first card on equal timestamps
and ignoring non-finite card timestamps. Equal card and folder timestamps still
prefer the card. The focused tests cover these rules and verify input order is
unchanged.

### Method

Measured on 2026-10-18 with Node v22.23.3 and npm 11.21.1 on Linux x86_64,
kernel 7.2.9, AMD Ryzen 5 7500F (6 cores / 12 threads). Inputs were synthetic
arrays of 24, 100, 1,000, and 10,000 sessions. Timestamps were unique finite
integers. The sorted workload matched the descending order returned by the
session-list APIs; the shuffled workload used a deterministic Fisher–Yates
shuffle (LCG seed `0x5eed`). Input creation was outside the timed loop, and a
valid folder timestamp below every card forced the card-selection path.

The one-off harness, `/tmp/verify-session-history.mjs`, compared the current
function with a local copy of its previous sort-based implementation in the
same Node process. It warmed each case four times, then collected nine samples
per case, alternating implementation order. Each sample made 20,000 calls at
24 entries, 5,000 at 100, 500 at 1,000, and 50 at 10,000. Values below are
median microseconds per call with the full observed min–max range.

```sh
PATH=/home/wisp/.npm/_npx/e609a7c1edf98e65/node_modules/.bin:$PATH \
  node --experimental-strip-types /tmp/verify-session-history.mjs
```

### Results

| Sessions | Input order | Previous sort | Linear scan | Change |
|---:|---|---:|---:|---:|
| 24 | Sorted | 0.341 µs (0.332–0.354) | 0.056 µs (0.053–0.063) | 83.7% lower |
| 24 | Shuffled | 0.815 µs (0.788–0.862) | 0.055 µs (0.054–0.061) | 93.2% lower |
| 100 | Sorted | 1.204 µs (1.184–1.309) | 0.194 µs (0.190–0.200) | 83.9% lower |
| 100 | Shuffled | 5.203 µs (5.056–5.404) | 0.192 µs (0.184–0.211) | 96.3% lower |
| 1,000 | Sorted | 11.541 µs (11.258–13.191) | 1.784 µs (1.765–1.859) | 84.5% lower |
| 1,000 | Shuffled | 82.236 µs (79.245–83.859) | 1.793 µs (1.771–1.821) | 97.8% lower |
| 10,000 | Sorted | 115.943 µs (111.539–119.604) | 17.979 µs (17.780–19.150) | 84.5% lower |
| 10,000 | Shuffled | 1,432.697 µs (1,390.857–1,645.586) | 18.727 µs (18.285–20.724) | 98.7% lower |

The app currently exposes at most 24 recent card sessions, and the sorted
24-entry workload is the closest synthetic match to normal use. It saves about
0.285 microseconds per call in this environment. That is a measurable
algorithmic reduction, but this microbenchmark does not establish a noticeable
end-user speedup. On shuffled arrays, larger inputs show the scan scaling
linearly while the old sort grows substantially faster; sorted inputs also
show a lower constant cost. These results are machine- and runtime-specific;
they do not include React rendering or real user timing.

Validation: `PATH=/home/wisp/.npm/_npx/e609a7c1edf98e65/node_modules/.bin:$PATH npm exec vitest -- run src/lib/session-history.test.ts` passed (5 tests).

## Native fixture baseline before portrait optimization

A full isolated Thorough run on 2026-10-18 completed all 27 then-available native
stages without failures in 7.696 seconds. Environment: Culltivate 0.6.1,
`debug turbo-jpeg`, Linux x86_64, AMD Ryzen 5 7500F, 12 logical cores, 31,616 MB
RAM; NVIDIA device detected. AI deliberately used the isolated CPU policy.
Suite: `2-6000x4000-texture`; native preview fixtures are deterministic 24 MP
textured images, with orientation 6 for the portrait case. OS caches were not
flushed. The generated RAW wrapper is not a camera compatibility corpus.

Command (choose an unused report filename):

```sh
cargo run --manifest-path src-tauri/Cargo.toml --features turbo \
  --example benchmark_app -- thorough /tmp/culltivate-benchmark-thorough.json
```

| Stage | Samples | Median | Total |
|---|---:|---:|---:|
| Portrait upright decode | 24 | 145.259 ms | 3,456.80 ms |
| Landscape full decode | 24 | 50.344 ms | 1,212.82 ms |
| Cold fit preview | 24 | 40.766 ms | 986.68 ms |
| Cold screen preview | 24 | 26.640 ms | 645.14 ms |
| Cold thumbnail | 24 | 22.343 ms | 536.00 ms |
| Warm advanced face analysis | 3 | 40.730 ms | 122.55 ms |
| Warm basic face analysis | 5 | 8.355 ms | 41.29 ms |
| Ingest copy | 24 | 1.122 ms | 28.10 ms |
| Warm fit preview | 24 | 0.026 ms | 0.72 ms |

The strongest measured candidate is portrait pixel orientation, rather than
cached preview retrieval or folder scanning. Assigned to the portrait agent for
an exact-output optimization and comparable before/after checks. AI sample
counts are capped and too small for p95. These values describe these fixtures on
this build and machine, not universal production latency.

## Preview worker lifecycle

Sol reproduced a resource leak: after the last preview-pool handle was dropped,
worker-owned shared state was still retained after a two-second deadline. The
new handle-owner lifecycle signals shutdown without joining on the calling
thread; active work completes and queued/future requests receive an error.
Six new regression cases verify shared-state release, clone safety, shutdown,
final drop from a worker callback, reentrant/panicking cancellation callbacks,
and waiter isolation. All 16 pool tests and the full Rust suite passed.

## Browser and delivery checks

Local Chromium verified Settings → Performance at 1440×1000 and 960×600:
Quick completion, Thorough p95 visibility, ranked results, a recording surviving
Settings closure, stopped-recording results, diagnostic preview, and no
horizontal dialog overflow at the native minimum viewport. There were no page
errors or outbound non-local requests. Screenshots and the temporary harness
remain outside the repository. The in-app browser runtime returned no available
browser instances, so this check used local Chromium; native WebKit behavior is
covered separately by the desktop build and native runner checks.

Ten native delivery tests passed using local mock HTTP servers: payloads,
authentication, consent replacement/revocation, redirect refusal, independent
failures, UTF-8 limits, field/privacy validation, and exact preview. No real
webhook or ntfy topic was contacted during development.

## Recording overhead sanity check

A nine-round Node 22 microbenchmark compared a trivial fixed-Promise backend
with its recording wrapper, after warmup. With recording disabled, 200,000
calls per round measured a median 0.048 µs per wrapped call (range 0.043–0.052)
versus 0.006 µs direct. With recording active, 500 awaited calls per round
measured median 0.309 µs (range 0.184–1.515), including Promise bookkeeping.
The disabled path preserves the original Promise and does not start timers.
These are synthetic call-overhead checks, not a prediction of application
latency. The active wrapper is bounded to 500 timing samples per operation;
there is no unbounded session log.

## Portrait rotation optimization

The portrait agent isolated the orientation-6 pixel transpose from JPEG decode.
The existing kernel already used 64×64 tiles. The new orientation-6 path keeps
that tile size and reads each source row contiguously inside a tile, preserving
the output mapping, dimensions and ICC profile. Other EXIF transformations keep
their existing path.

A controlled pinned-core comparison using the same Rust `opt-level=1` and
6000×4000 RGB input collected 40 samples per run. Three baseline run medians
were 99.06, 99.66 and 99.77 ms; candidate medians were 85.95, 84.06 and 80.34 ms.
Baseline p90s were 101–104 ms and candidate p90s 85–95 ms. Output checksums
matched. Separate O3 checks found no observed regression, but were variable;
these numbers do not establish an equivalent release-build or end-to-end gain.
Temporary harnesses are under `/tmp/culltivate-orient-paired-*` in this session.

Regression tests compare all eight EXIF orientations on nonuniform 5×3 RGB,
and orientation 6 on 65×67 and 67×131 images spanning full and partial tiles.
The complete Rust suite passed after integration: 357 passed, one optional
MobileCLIP reference-photo test ignored.

## Final native runtime validation

The final native debug no-bundle build passed. The existing native `--selftest`
then passed with twelve disposable JPEG fixtures and an isolated XDG profile,
using `OPENCULL_GRAPHICS=compatibility GDK_BACKEND=x11 OPENCULL_AI=cpu`.
It exercised WebKit preview display/decode, portrait orientation, copy/ingest
safety, sidecars, metadata ordering, AI analysis/cache reuse, histogram, keyboard
navigation, local configuration, card-review state and theme/settings behavior.
Native video playback was skipped because no video fixture was supplied.

Direct Wayland with the software profile hit the already documented protocol
error 71; the X11 compatibility run succeeded. A first X11 run using the normal
profile inherited a RAW-only file preference and saw no JPEG fixtures, so the
successful check used an isolated default profile. No user preferences or
original photos were changed. macOS/Windows and GPU inference were not tested.

The first final Thorough run overlapped native compilation and had materially
distorted timings (for example a 334 ms portrait median). It passed functionally
but is excluded from performance comparisons. Subsequent runs use the built
example directly after compilation has stopped. Suite
`3-6000x4000-texture-ai-cache` has 30 native stages; the Settings runner also adds
four measured frontend-logic stages. These stages separately identify pure
logic, API/pipeline time and manual rendering/device checks.

Final repeated native runs, without compiler work (24 samples per listed stage):

| Run | Elapsed | Cold fit median | Fit under active background | Warm fit median | Landscape decode | Portrait decode | AI result-cache hit |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 2 | 17.592 s | 43.956 ms | 43.663 ms | 0.029 ms | 53.119 ms | 140.276 ms | 0.014 ms |
| 3 | 17.562 s | 43.090 ms | 42.729 ms | 0.025 ms | 57.561 ms | 138.575 ms | 0.019 ms |
| 4 | 17.495 s | 42.414 ms | 43.225 ms | 0.028 ms | 53.838 ms | 141.520 ms | 0.017 ms |

Each run completed all 30 native stages with zero failures and zero skipped
stages. Manual feature/device coverage remains labeled separately. Contention
setup waits outside the foreground timer until an Idle worker is observed
running; its deliberate quiet-window waits explain the longer overall runtime
than the earlier 27-stage suite. Foreground medians were comparable to quiet fit
requests in these runs. The cache and scan results do not justify speculative
limits/concurrency changes.

Portrait decode remains the largest stage. These repeated whole-pipeline
medians versus the single earlier 145.259 ms result are insufficient to promise
a general end-to-end improvement; the controlled paired rotation-only check is
the evidence for the narrow traversal change. All input/output pixel checks
passed. Run 2 briefly overlapped browser-QA startup; repeat runs 3 and 4 were taken
after that check finished.

Final checks: 136 frontend tests plus 11 launcher tests; 357 Rust tests passed,
one existing optional-model test ignored; frontend production build; native
Linux debug no-bundle build; isolated native self-test; Chromium Quick/Thorough,
p95, recording persistence, exact-preview flow, minimum-viewport layout and
zero non-local requests with reporting disabled. The local fixture resource
checksum matches its provenance file. No lint script exists.

## Isolated NVIDIA benchmark validation — 2026-10-18

Fixture `4-6000x4000-texture-gpu-ai`, Linux x86_64, `debug turbo-jpeg cuda`,
NVIDIA GeForce RTX 3060 Ti (driver 615.78.08). One Thorough run completed all
30 native stages without failures. The provider reported
`CUDA (YOLO may use CPU operators)` with 32 successful private CUDA model calls.
These measurements use one reused 512 × 512 astronaut image and include the
whole analysis stage, rather than only GPU kernel time.

| AI stage | Runs | Average score |
|---|---:|---:|
| Basic, first model use | 1 | 580.51 ms |
| Basic, warm models | 5 | 4.79 ms |
| Advanced, first use | 1 | 320.69 ms |
| Advanced, warm models | 3 | 10.01 ms |

The explicit hardware test compared isolated CUDA and CPU model outputs and
verified that the global fallback state stayed unchanged. Separate fresh
Quick processes with `CUDA_VISIBLE_DEVICES=` and `OPENCULL_AI=cuda`, and with
`OPENCULL_AI=cpu`, also completed all native stages without failures. The former
reported CPU fallback and skipped accelerated coverage; the latter reported
CPU inference and CUDA not requested. Neither claimed measured GPU inference.
These are functional checks on one system, not general hardware benchmarks.
Core ML GPU contexts and macOS/Windows runtime behavior were not verified here.


## 0.7.0 score references — 2026-10-18

The public dataset in `benchmarks/typical-speeds.json` uses three separate
Thorough runs for each of `debug turbo-jpeg cuda` and `release turbo-jpeg cuda`,
from benchmark code commit `5d4a8b07b3fea3176477d90ce8b356092c02d7d7`.
All six completed all 30 native stages, recorded 32 CUDA session calls per run,
and recorded zero whole-model CPU/fallback calls. The machine was Linux x86_64,
AMD Ryzen 5 7500F (12 logical cores), NVIDIA GeForce RTX 3060 Ti, 31,616 MiB RAM,
app 0.7.0, fixture `4-6000x4000-texture-gpu-ai`.

| Cohort | Elapsed seconds, three runs | Basic warm mean ms, across-run median | Advanced warm mean ms, across-run median |
|---|---|---:|---:|
| Debug | 18.938 / 18.133 / 18.357 | 4.835 | 8.852 |
| Release | 20.762 / 19.381 / 20.726 | 6.064 | 10.278 |

These are compiler-idle desktop measurements. Other desktop applications were
left running; GPU activity was spot-checked at 11–30%, and OS filesystem cache
was uncontrolled. They establish one seed system, not fleet typical speeds or a
debug-versus-release performance claim. Public rows contain per-stage means,
medians and min/max across runs. Frozen component reference medians define the
index; hardware-row scores are medians of individual run indices.

The debug example initially reproduced undefined hidden LLVM-symbol linker
errors. `CARGO_INCREMENTAL=0 cargo build --manifest-path src-tauri/Cargo.toml
--features turbo,cuda --example benchmark_app` linked successfully. The dev
profile now disables incremental compilation so ordinary desktop development
uses the verified configuration.

Release examples were compiled inside the isolated Ubuntu 24.04 build root.
Two initial host executions fell back to CPU because provider-library symlinks
pointed inside the namespace; those runs were excluded. Replacing only the
example's two provider symlinks with byte-identical library copies restored
CUDA. Packaged libraries are checked separately. No photo library or normal
app cache/configuration was used for the reference runs.
