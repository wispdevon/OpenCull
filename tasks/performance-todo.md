# Performance and reliability

Work directly on `dev`. This checklist is independent of the upstream contribution tasks.
See [measurements](performance-measurements.md) and the [feature guide](../docs/features/PERFORMANCE.md).

## Implemented and verified

- [x] Compact results — Two timing columns, concise workload labels, one-column coverage with expandable reasons, and a rendered message preview with optional raw JSON. Discord/ntfy share a summary capped at three stages and one short suggestion. Portrait decoding and AI cache suggestions no longer get misclassified as inference.
- [x] Benchmark interpretation — Per-stage photo/record/pair workloads and repeated-input counts, explicit throughput units, fixture-specific average investigation budgets and tentative/tail/failure explanations. Locally bundled Lospec500 function colors with distinct swatches for the known benchmark and recording catalogs. Reporting endpoints are read-only and enforced by the native boundary.
- [x] Timing overview follow-up — Horizontal function colors, cumulative duration/share legend and expandable **etc** for functions below one second each. Separate benchmark/log ntfy topics, random readable installation ID, locally encoded webhook preferences and Discord-compatible delivery. Threshold, identity/storage, routing, preview and local mock delivery regressions cover the change.
- [x] P0 — Typed stage measurements, aggregate reports, rankings and evidence-linked suggestions. Owner: coordinator. Privacy tests exclude unknown fields, samples and raw stage details from delivery.
- [x] P0 — Isolated Quick/Thorough native runner. Owner: native agent. Thirty native stages, generated 24 MP fixtures, private caches and sessions, active background-load observation, real bundled face inference, bounded runs, cancellation and cleanup. Native integration and repeated runtime runs pass.
- [x] P0 — Settings → Performance. Owner: UI agent. Run/cancel/progress, average Score/median Typical rankings, p95 only with 20+ samples, coverage, suggestions, recording, export and reporting preview. Frontend build/tests and Chromium interaction checks pass.
- [x] P0 — Approved webhook/ntfy reporting. Owner: reporting agent. Exact payload preview, per-session approval, native-managed fixed destinations, aggregate JSON/compact summary, bounded requests and independent results. Local mock-server tests pass; no real diagnostic destination was contacted.
- [x] P1 — Bounded opt-in workflow recording. Owner: coordinator. Fixed operation names, at most 500 completed request timings per operation, no arguments or raw errors. Delivery is asynchronous; empty recordings stay local. Consent changes invalidate queued sends and stale completion updates.

- [x] NVIDIA benchmark inference — Independent CUDA sessions, actual logical-device model name, observed per-stage provider usage, and benchmark-local fallback. RTX 3060 Ti Thorough, CPU-only and forced GPU-unavailable runs passed; CUDA/CPU output equivalence passed.

- [x] System analytics in reports — Include app version/build, OS/architecture, CPU/cores, GPU, RAM, AI provider and fixture version alongside elapsed/measured totals in bounded notification summaries and approval previews.

## Measurement-led work completed

- [x] Investigate preview/cache latency. Native cold/warm and foreground-under-active-background stages are implemented. Warm preview reads were below 0.1 ms on the measured machine; no cache-limit change is justified by these fixtures.
- [x] Investigate scanning, metadata and ingest. Local fixture stages complete well below the major decode costs. Retain current behavior; these measurements do not establish physical-card performance.
- [x] Investigate AI initialization and cache reuse. Measure bundled YuNet/YOLO cold/warm model use and private result-cache writes/hits. Avoid changing rules, accuracy thresholds or live acceleration policy from this small fixture corpus.
- [x] Fix portrait orientation traversal. Owner: portrait agent. A source-contiguous orientation-6 tile kernel improved controlled paired measurements with matching pixel checksums. Exact RGB tests cover all eight orientations, ICC preservation and partial tiles. Whole-pipeline/release gains are not asserted from that microbenchmark.
- [x] Fix recent-session lookup. Owner: frontend agent. Replace a sort with a finite-timestamp maximum scan; preserve ties and input ordering. The realistic 24-session gain is sub-microsecond and is documented without claiming a visible speedup.
- [x] Fix preview-worker retention. Owner: Sol. Final-handle drop/shutdown releases worker state without blocking callers; queued/future work fails safely. Six new lifecycle regressions and existing priority/dedup tests pass.
- [x] Review cancellation and reporting recovery. Owners: Sol/coordinator/reporting agent. Correct sample units, native progress recovery, stale-result isolation, consent revocation between requests and nonblocking report saving. Active-run concurrency/cancel/fixture-cleanup checks pass.
- [x] Check frontend logic and recording overhead. Pure review/scene/resume/crop fixtures are measured; disabled instrumentation preserves original Promises. Synthetic wrapper overhead is documented; no general rendering-speed claim is made.

## Evidence-dependent follow-ups

- [ ] Profile full grid/filmstrip/loupe rendering and input-to-paint latency with a representative local workload. Owner: frontend agent, Sol for complex coordination. Accept only changes with repeatable interaction improvement and unchanged navigation/crop behavior.
- [ ] Add isolated installed MobileCLIP benchmarks and verify GPU benchmarks on additional supported platforms. Owner: Sol. NVIDIA/CUDA bundled-model benchmarks now have independent contexts; preserve live provider fallback state and caches, avoid downloads, and compare identical analysis outputs.
- [ ] Validate broader face/grouping workloads with a suitably licensed corpus. Owner: AI agent. One astronaut portrait cannot establish expression accuracy, crowded-scene scaling or camera coverage.
- [ ] Run physical-card, camera-format, native video/editor/trash and cold-process startup checks when appropriate fixtures/hardware are available. These remain explicit manual/skipped coverage rather than fabricated timings.
- [ ] Verify macOS and Windows native behavior, plus additional Linux graphics stacks. This session verified Linux through X11 compatibility; direct Wayland hit the previously documented protocol error 71.

## Final gates

- [x] Frontend tests: 167 passed, plus 11 launcher tests. CUDA-feature Rust suite: 373 passed, five optional/hardware tests ignored; isolated CUDA/CPU equivalence also passed explicitly on the RTX 3060 Ti.
- [x] Frontend production build and native debug no-bundle build pass. No lint script exists and none was claimed.
- [x] Linux native self-test passes with a disposable photo set and isolated XDG profile; browser flow passes at 1440×1000 and 960×600 with no page errors or outbound non-local requests.
- [x] Report privacy/consent, disabled networking, credentials and synthetic-fixture limits reviewed. Documentation links and fixture checksum verified.
- [x] Baseline and final fixture/build/hardware evidence recorded. Compiler-contended timing run excluded from performance comparisons.
- [x] Commit the final benchmark/reporting feature after the final repeated-run evidence review. Focused session, pool and portrait fixes are already committed on `dev`.

## 0.7.0 system scoring and public typical speeds

- [x] Define a versioned, reproducible GPU-assisted AI pipeline score and overall system score. Higher is faster; fixed workloads and a public reference define the scale.
- [x] Keep debug/release builds, fixture versions, providers, failures and incomplete runs distinguishable; never score CPU fallback as GPU performance.
- [x] Seed a public, versioned typical-speeds database from verified aggregate runs; include app/build, OS/architecture, CPU/cores, GPU, RAM, provider, fixture, run counts and provenance without photos or private identifiers.
- [x] Bundle the reference for offline scoring, link to its public source, show score eligibility and reference version, and include scores in exports/submissions.
- [x] Provide validated, deduplicated ingestion of explicitly approved benchmark contributions; document how published typical values are calculated and how sparse data is labeled.
- [x] Verify score math/edge cases, data privacy, UI and native delivery; prepare verified 0.7.0 sources for the explicitly authorized draft-tag update.
- [ ] Finish installer verification and publication. GitHub Actions currently rejects dispatch with “Actions has been disabled for this user”; Linux AppImage, Debian and RPM packages were built in Ubuntu 24.04 and verified; the extracted AppImage passes generated-fixture checks with CUDA and no global fallback. macOS/Windows installers and the publication choice remain pending.

## Fixed hardware specification ratings — user correction

- [x] Replace primary benchmark-derived system/GPU numbers with a transparent, versioned specification formula. Identical supported CPU/GPU/installed-RAM inputs always receive identical ratings.
- [x] Use reviewed manufacturer physical core counts, base clocks and GPU shader counts; never local timings, boost clocks, usable/free RAM, available threads, app build or AI provider as rating inputs.
- [x] Detect installed memory and GPU identity independently of benchmark/provider settings. Missing/ambiguous specifications remain explicitly unknown.
- [x] Show ratings before running a benchmark, preserve measured milliseconds and historical benchmark indices separately, and export schema-v4 ratings with provenance.
- [ ] Publish formula/specification sources and matching fixed ratings for both existing hardware rows; benchmark ingestion cannot move those ratings.
- [ ] Verify deterministic math, aliases/unknowns, privacy/consent, native discovery, report compatibility and UI; refresh the unpublished 0.7.0 draft after verification.
