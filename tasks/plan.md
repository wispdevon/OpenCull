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

## Published independent drafts

All four branches use upstream main `a8c7f32` as their common ancestor; none contains another contribution's commits.

| Draft | Branch | Scope |
| --- | --- | --- |
| [#4](https://github.com/NatePhotos/OpenCull/pull/4) | `contribution/gpu-runtime` | Linux CUDA/runtime/rendering |
| [#5](https://github.com/NatePhotos/OpenCull/pull/5) | `contribution/card-review-sessions` | Card review, video and saved sessions |
| [#6](https://github.com/NatePhotos/OpenCull/pull/6) | `contribution/ai-grouping` | Cached visual grouping and optional blur tools |
| [#7](https://github.com/NatePhotos/OpenCull/pull/7) | `contribution/workspace-settings` | Optional theme, workspace and settings |

The combined draft #3 stays open with a reference notice linking these replacements. All six pairwise merges and all 24 complete merge orders are conflict-free and produce the same final tree. Hook placement, command registration and independent store reset hunks were adjusted to avoid preventable shared-file conflicts. No force pushes were used.

## Validation in progress

- GPU: 276 CPU tests; CUDA suite 277 passed with two hardware tests run separately; Linux/macOS/Windows build run [38936925054](https://github.com/wispdevon/OpenCull/actions/runs/38936925054) passed. Linux CUDA desktop build passed.
- Ingest: 43 frontend and 286 native tests; Linux CPU desktop build passed. Final cross-platform run [38938953302](https://github.com/wispdevon/OpenCull/actions/runs/38938953302).
- AI: 42 frontend and 283 native tests; real model on CPU; Linux CPU desktop build passed. Final cross-platform run [38938948219](https://github.com/wispdevon/OpenCull/actions/runs/38938948219).
- Interface: 73 frontend and 274 native tests; responsive browser smoke passed. Final cross-platform run [38939359447](https://github.com/wispdevon/OpenCull/actions/runs/38939359447).
- Final combined behavioral tests, native CUDA runtime and policy/ref audit are required before closing the goal.
