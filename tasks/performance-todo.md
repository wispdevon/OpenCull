# Performance and reliability

Work directly on `dev`. This checklist is independent of the upstream contribution tasks.
See [measurements](performance-measurements.md) and the [feature guide](../docs/features/PERFORMANCE.md).

## Implemented and verified

- [x] P0 — Typed stage measurements, aggregate reports, rankings and evidence-linked suggestions. Owner: coordinator. Privacy tests exclude unknown fields, samples and raw stage details from delivery.
- [x] P0 — Isolated Quick/Thorough native runner. Owner: native agent. Thirty native stages, generated 24 MP fixtures, private caches and sessions, active background-load observation, real bundled face inference, bounded runs, cancellation and cleanup. Native integration and repeated runtime runs pass.
- [x] P0 — Settings → Performance. Owner: UI agent. Run/cancel/progress, median/total rankings, p95 only with 20+ samples, coverage, suggestions, recording, export and reporting preview. Frontend build/tests and Chromium interaction checks pass.
- [x] P0 — Approved webhook/ntfy reporting. Owner: reporting agent. Exact payload preview, per-session field/destination approval, memory-only credentials, aggregate JSON/compact summary, bounded requests and independent results. Ten local mock-server tests pass; no real diagnostic destination was contacted.
- [x] P1 — Bounded opt-in workflow recording. Owner: coordinator. Fixed operation names, at most 500 completed request timings per operation, no arguments or raw errors. Delivery is asynchronous; empty recordings stay local. Consent changes invalidate queued sends and stale completion updates.

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
- [ ] Add subprocess or independently owned GPU/model contexts for isolated GPU and installed MobileCLIP benchmarks. Owner: Sol. Must preserve live provider fallback state and caches, avoid downloads, and compare identical analysis outputs.
- [ ] Validate broader face/grouping workloads with a suitably licensed corpus. Owner: AI agent. One astronaut portrait cannot establish expression accuracy, crowded-scene scaling or camera coverage.
- [ ] Run physical-card, camera-format, native video/editor/trash and cold-process startup checks when appropriate fixtures/hardware are available. These remain explicit manual/skipped coverage rather than fabricated timings.
- [ ] Verify macOS and Windows native behavior, plus additional Linux graphics stacks. This session verified Linux through X11 compatibility; direct Wayland hit the previously documented protocol error 71.

## Final gates

- [x] Frontend tests: 136 passed, plus 11 launcher tests. Full Rust suite: 357 passed, one existing optional-model test ignored.
- [x] Frontend production build and native debug no-bundle build pass. No lint script exists and none was claimed.
- [x] Linux native self-test passes with a disposable photo set and isolated XDG profile; browser flow passes at 1440×1000 and 960×600 with no page errors or outbound non-local requests.
- [x] Report privacy/consent, disabled networking, credentials and synthetic-fixture limits reviewed. Documentation links and fixture checksum verified.
- [x] Baseline and final fixture/build/hardware evidence recorded. Compiler-contended timing run excluded from performance comparisons.
- [x] Commit the final benchmark/reporting feature after the final repeated-run evidence review. Focused session, pool and portrait fixes are already committed on `dev`.
