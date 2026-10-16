# Pulling complete ideas

Every original `feature/*` branch has been restored at its archived tip. Those tips retain their original ancestry: `feature/mobileclip-grouping`, for example, has 197 commits beyond upstream 0.4.1, including unrelated changes inherited from development. The initial MobileCLIP implementation itself was two commits. Restoring a branch does not remove its ancestry.

The `ideas/*` branches reorganize the final application into a cumulative stack rooted at upstream OpenCull 0.4.1 (`a8c7f32`). They keep shared changes together and avoid importing the old integration history. Each branch has a `BUNDLE.md` with source commits, scope, platform limits and validation. Original feature branches and archive tags are unchanged.

| Branch | Additional idea | Commits beyond upstream | Prerequisite |
|---|---|---:|---|
| `ideas/gpu-performance` | NVIDIA rendering, stable compositor, automatic CUDA, shared ONNX worker, desktop/build commands and provider packaging | 1 | Upstream 0.4.1 |
| `ideas/ingest-sessions` | Card review, multi-card/subfolders, resumable imports, saved sessions, video review and the shared settings foundation | 2 | GPU & performance |
| `ideas/ai-grouping` | Cached AI, motion blur, MobileCLIP, grouping strengths, cached JPEG reuse and VRAM errors | 3 | Ingest & sessions |
| `ideas/interface-workspace` | Complete Wisp interface, home/settings, panels, filmstrips, face interaction, crop and transitions | 4 | AI & grouping |

These branches are cumulative. Merging AI brings its GPU and session prerequisites; merging Interface brings all four. They are not independent patches. The session store and native scan protocol tie ratings, AI cancellation, video handling, card review and session restoration together. The final interface controls those APIs. Extracting a smaller independent patch requires further refactoring and validation.

The Interface bundle reproduces the application snapshot at `a1aa61c`; only its bundle guide differs. The intermediate bundles deliberately use the earlier interface foundation, so they do not reproduce every screen from the final application.

## Try a bundle

```sh
git clone --branch ideas/ai-grouping --single-branch https://github.com/wispdevon/OpenCull.git
cd OpenCull
npm ci
npm run desktop
```

Replace the branch with the idea you want. Use a supported Node version (see `.nvmrc`) and the Tauri prerequisites from the README. Linux NVIDIA CUDA detection is automatic when the required driver, CUDA 13 and cuDNN 9 libraries exist. `npm run desktop -- --cpu` forces CPU inference. macOS and Windows use their normal native renderer and CPU inference.

## Merge into an upstream checkout

```sh
git remote add wisp https://github.com/wispdevon/OpenCull.git
git fetch wisp
git merge wisp/ideas/ai-grouping
```

If the remote already exists, skip `remote add`. Start from a clean checkout. The bundles share upstream 0.4.1 ancestry; later upstream changes can require conflict resolution and retesting. Do not cherry-pick only the AI commit without its listed prerequisites.

For separate review, merge GPU, then Ingest, then AI, then Interface. Each step adds one curated commit. For all changes in one pull, merge Interface. These are pull/contribution snapshots; everyday work stays on `dev`, and `main` remains the release branch.

## Validation

All four snapshots passed TypeScript and production frontend builds on Linux. GPU passed 31 frontend tests and 275 native tests; Ingest passed 69 and 296; AI passed 87 and 312; the full Interface passed 98 frontend tests and shares the validated AI native source. Each passed 11 desktop launcher checks. The AI subset also passed real NVIDIA CUDA/CPU-equivalence and MobileCLIP disk-cache tests. CUDA compilation used `--features turbo,cuda`.

The curated intermediate subsets have not had macOS/Windows desktop runtime tests. Full-release cross-platform CI is separate; inspect the [release workflow](https://github.com/wispdevon/OpenCull/actions/workflows/build.yml) for its current status. See each branch's `BUNDLE.md` for detailed scope and test limits.
