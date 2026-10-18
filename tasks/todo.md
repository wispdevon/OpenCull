# Independent upstream PR checklist

- [x] Record base and preserved remote refs (`a8c7f32`; `/tmp/opencull-independent-preserved-refs.txt`).
- [x] GPU builds/tests from upstream with no other idea prerequisite (frontend + CPU/CUDA library suites + real GPU file-model check; final desktop/CI gate below).
- [x] Ingest builds/tests from upstream with no unrelated GPU/AI/interface code.
- [x] AI builds/tests from upstream; CPU mode independent of GPU PR.
- [x] Interface builds/tests from upstream without session/AI changes being assumed.
- [x] Shared contracts and pairwise/cumulative merge compatibility verified.
- [ ] Native no-bundle builds and relevant runtime checks passed; platform limitations recorded.
- [ ] Diff scopes, defaults, updater/version/repository policy verified.
- [x] Scoped draft PRs opened upstream; combined PR #3 retained and marked reference/superseded.
- [ ] Final remote refs/PR state/coverage audit passed.

Historical audit on 2026-10-18: PR/ref checks passed; the three boxes above remain open because final-head native/cross-platform evidence is incomplete and the workspace contribution changed two defaults. See [audit evidence and exact commit/run links](plan.md#historical-audit-2026-10-18). These are historical contribution gaps, not claims that current `dev` is failing.

- [ ] Establish or explicitly waive exact-final-head CI/native coverage for archived AI `1ee4b97` and workspace `2bc315a`; existing green CI runs cover different archived local tips.
- [ ] Resolve/document workspace #7's historical `showExif: true` and `maximized: true` default changes against its upstream-default claim.
- [ ] Obtain missing native platform/physical-card/editor/model-download runtime evidence where required; do not infer it from installer builds.

## Approved follow-up: 2026-10-18

- [x] Reconcile the historical audit with exact evidence and retain platform limitations.
- [x] Preserve completed review copies after per-item source failures, with retry/cancellation/containment regressions.
- [x] Make histogram requests and pixel counts follow committed crops, turns and mirrors; keep browser demo compatibility.
- [x] Run frontend/Rust suites, frontend build, Linux native build and relevant runtime checks; review and commit focused changes on `dev`. See [validation and shared-checkout limits](plan.md#follow-up-validation-2026-10-18).

Deferred idea: retry destination metadata writes without copying the already-landed image again. Keep separate from source-disconnection recovery.

Deferred idea: recover an individual RAW/JPEG pair when transfer places the RAW
but its JPEG fails after the initial source checks. Current retries can create
a renamed pair while leaving the first RAW at the destination. Preserve source
files and add a mid-transfer companion-failure regression before changing this
behavior; the implemented recovery preserves earlier fully completed items.

## Requested follow-up: error reporting and logging

- [ ] Audit likely failure points across opening/scanning, previews, AI/models, card copying, session persistence, settings, sidecars and updates; identify errors currently swallowed or reported only to the console.
- [ ] Rework logging around consistent error records with operation/context, timestamp and actionable detail. Add errors to the local logs; avoid photo contents and redact sensitive paths in shareable output.
- [ ] Show actionable errors in accessible popups with recovery details. Do not show warning popups; avoid repeated popup storms and retain errors in logs after dismissal.
- [ ] Add local log exports with a reviewable, privacy-conscious format and explicit export failures.
- [ ] Add an **Issue submission template** button that prepares app/platform details, reproduction steps, expected/actual results and selected error details. Let the user review and submit; do not automatically upload logs or photos. Verify the issue destination supports submissions before enabling a link.
- [ ] Test error capture, popup dismissal/deduplication, absence of warning popups, export contents/redaction/failures, and issue-template generation in native and browser-demo paths.
