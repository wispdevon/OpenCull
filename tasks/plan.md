# Independent upstream contributions

Prepare four focused upstream draft PRs from the same upstream main base. Preserve main/dev, published feature/idea refs, archive tags and combined PR #3. No stacked/cumulative PR may be described as independent.

## Decisions

- Use isolated temporary source exports rather than changing the running checkout or creating project worktrees.
- Preserve upstream defaults, versions, updater endpoints/signing keys, release policy and README branding.
- GPU contains runtime/rendering/build infrastructure; Ingest contains review/session/video workflows; AI contains cache/grouping/motion logic; Interface contains the optional workspace/settings experience.
- Shared foundation may be extracted into a smaller prerequisite if it cannot reasonably be separated. Document that explicitly and submit prerequisite first.
- Common settings code must have identical contracts wherever genuinely required; avoid dragging unrelated interface code into ingest or AI.
- Verify independent diffs, test/build each candidate, then test pairwise/cumulative compatibility. Resolve actual overlaps before publishing.
- Open focused draft PRs only after validation; retain #3 as reference and mark it superseded when replacements exist.

## Steps

1. Record upstream base and preserved refs; inspect minimal independent scopes.
2. Prepare GPU/runtime slice and validation.
3. Prepare Ingest/session slice and validation.
4. Prepare AI/grouping slice and validation; retain CPU path if CUDA prerequisite isn't merged.
5. Prepare Interface/workspace slice and validation; don't require new AI models for baseline face interaction.
6. Resolve shared contracts and merge compatibility; verify all intended behavior remains represented.
7. Native builds/runtime checks; draft descriptions with exact scope and limits.
8. Publish scoped refs and upstream draft PRs, update #3 with replacement links; final audit.

## Risks

The combined store/native command files mix workflows. Whole-file copying is not proof of dependency. Agents must adapt changes to upstream contracts and show build/test evidence. Four groups may require a small prerequisite if a genuine shared contract cannot be cleanly separated; do not silently weaken scope to finish.

## Shared ONNX contract

GPU and AI use the same minimal `ai/file_backend.rs` provider registry. AI works on CPU with no provider; GPU registers its bounded CUDA file-model runner at native startup. The provider returns original tensors for CPU retry after failure. This prevents a dependency on CUDA while retaining acceleration when both PRs merge. Native preferences belong to Interface; Ingest can use upstream preferences unchanged.

## Audit findings

- Upstream already caches per-photo face-analysis records. The AI PR must describe cache/session-restoration improvements accurately rather than claiming all face caching is new.
- Ingest has no required dependency on fonts/themes/native preferences or GPU. Its review/session persistence is separate from Interface preferences.
- Interface face interactions can use upstream face data; its settings page must not expose unavailable MobileCLIP, motion-blur or GPU controls.
- Upstream workflow supports pull requests and manual dispatch, allowing independent cross-platform checks on scoped branches.

## Published independent drafts (historical)

All four branches use upstream main `a8c7f32` as their common ancestor; none contains another contribution's commits.

| Draft | Branch | Scope |
| --- | --- | --- |
| [#4](https://github.com/NatePhotos/OpenCull/pull/4) | `contribution/gpu-runtime` | Linux CUDA/runtime/rendering |
| [#5](https://github.com/NatePhotos/OpenCull/pull/5) | `contribution/card-review-sessions` | Card review, video and saved sessions |
| [#6](https://github.com/NatePhotos/OpenCull/pull/6) | `contribution/ai-grouping` | Cached visual grouping and optional blur tools |
| [#7](https://github.com/NatePhotos/OpenCull/pull/7) | `contribution/workspace-settings` | Optional theme, workspace and settings |

At publication, combined draft #3 remained open with a reference notice linking these replacements. It has since closed without merging; #4–#7 merged and their tips were archived (see [branch archive](../docs/BRANCH_ARCHIVE.md)). The original compatibility checks found all six pairwise merges and all 24 complete merge orders conflict-free with the same final tree. Hook placement, command registration and independent store reset hunks were adjusted to avoid preventable shared-file conflicts. No force pushes were used.

## Recorded historical validation

- GPU: 276 CPU tests; CUDA suite 277 passed with two hardware tests run separately; Linux/macOS/Windows build run [38936925054](https://github.com/wispdevon/OpenCull/actions/runs/38936925054) passed. Linux CUDA desktop build passed.
- Ingest: 43 frontend and 286 native tests; Linux CPU desktop build passed. Final cross-platform run [38938953302](https://github.com/wispdevon/OpenCull/actions/runs/38938953302).
- AI: 42 frontend and 283 native tests; real model on CPU; Linux CPU desktop build passed. Final cross-platform run [38938948219](https://github.com/wispdevon/OpenCull/actions/runs/38938948219).
- Interface: 73 frontend and 274 native tests; responsive browser smoke passed. Final cross-platform run [38939359447](https://github.com/wispdevon/OpenCull/actions/runs/38939359447).
- Final combined behavioral tests, native CUDA runtime and policy/ref audit are required before closing the goal.

## Historical audit: 2026-10-18

- GitHub confirms upstream PRs #4–#7 merged and #3 closed unmerged. All seven published `archive/2026-10-17` contribution tags peel to the exact tips in the branch archive; distinct older local AI/workspace tips are preserved. Origin has `dev`, `main` and the four existing `ideas/*` branches, with no remaining feature/contribution branch names. No refs were changed by this audit.
- Exact-head cross-platform evidence: GPU [38939875441](https://github.com/wispdevon/OpenCull/actions/runs/38939875441) succeeded at `3aa61f0`; Ingest [38938953302](https://github.com/wispdevon/OpenCull/actions/runs/38938953302) succeeded at `c50413c`. The old combined [38933806816](https://github.com/wispdevon/OpenCull/actions/runs/38933806816) succeeded at `de5d787` but is superseded.
- **Coverage still open:** AI [38938948219](https://github.com/wispdevon/OpenCull/actions/runs/38938948219) succeeded at local archived tip `67b0fa4`, not final PR tip `1ee4b97`. Workspace [38939359447](https://github.com/wispdevon/OpenCull/actions/runs/38939359447) succeeded at local tip `c047034`, not final PR tip `2bc315a`. The final PRs expose no status checks establishing exact-head cross-platform coverage. Do not treat these runs as final-head validation.
- **Policy discrepancy still open:** final workspace contribution #7 changes fresh `showExif` from false to true and adds native `maximized: true`, despite its claim to preserve upstream panel defaults. Versions, repository/product identity, updater endpoint and signing key otherwise retain the upstream values in the scoped contribution tips. This audit does not change historical commits or current preferences.
- **Native/runtime evidence remains limited:** historical records mention Linux GPU/CPU desktop builds, CUDA/model checks and browser checks, but do not establish every final tip's exact no-bundle build/runtime gate. Installer CI does not prove native macOS/Windows card, video or editor workflows. Physical card tests and AI model-download/runtime coverage remain limited as recorded in the PRs. Current `dev` checks below are separate evidence.
- The 2026-10-16 branch table lists 63 archived work branches; there is also an extra preserved release-build tag, documented separately in the branch archive.

## Approved follow-up: 2026-10-18

Reconcile the historical checklist against exact PR, archive and CI evidence before closing it. Preserve earlier results as historical validation rather than claiming current platform runtime coverage.

Then implement two focused changes directly on `dev`:

1. Preserve Finish Review's successful destination mappings when a later source or RAW/JPEG companion disappears. Report per-item failures without losing prior results; keep setup errors, source containment and cancellation protections. Existing session persistence must remember successes before showing errors. Metadata-write retry recovery remains a separate follow-up.
2. Make the histogram reflect committed framing using the existing upright thumbnail. Carry framing and full-resolution dimensions in an optional histogram view argument; omitted framing preserves whole-frame behavior. Reuse framing geometry for crops, turns and mirrors, refresh on committed changes, and retain the navigation debounce/stale-response protection. Keep native and browser demo contracts aligned.

Regression checks cover partial-copy retry without duplicates or source changes, missing companions, cancellation and containment; histogram checks cover whole-frame parity, excluded tones, angled/turned/mirrored crops and stale responses. Run frontend/Rust suites, frontend production build, Linux native debug no-bundle build and relevant native runtime checks. Record unavailable platform checks explicitly. Agents coordinate edits to shared backend files; no branches, worktrees, publication or release changes.

The user's next requested TODO is an error-reporting/logging overhaul: audit failure points, record errors consistently, show actionable error popups without warning popups, export local logs, and prepare a user-reviewed issue submission template. Track its implementation separately in `tasks/todo.md`; no automatic uploads or submissions.
