# Working on OpenCull

OpenCull is an offline photo-culling desktop application: React/TypeScript in `src/`, Rust/Tauri in `src-tauri/src/`. Read `README.md` and `docs/HOW-IT-WORKS.md` before changing behavior.

## Branches and review

- Implement one feature per short-lived `feature/<description>` branch. Use `fix/`, `docs/`, or `chore/` for other work. Never implement directly on `main`.
- Independent features start from current `upstream/main` so the original maintainer can select them independently. Default PR target is `wispdevon/OpenCull:main`; submit upstream only when requested.
- Fetch before choosing a base. Keep upstream synchronization in a separate PR. Do not bundle other feature commits into a standalone feature branch.
- Combine features only on a separate `integration/` branch. Document integration-only fixes there, including conflict resolutions.
- Inspect Git status first. Preserve unrelated edits and use separate worktrees when another branch is dirty or work runs concurrently. Never reset or stash someone else's work.
- Keep commits and PRs focused; separate unrelated refactoring, formatting, dependency changes, and lockfile changes. Review staged diffs before committing.
- Do not force-push shared branches. Resolve conflicts deliberately and rerun affected checks. Merge only when requested; remove merged feature branches after completion.

## Verification

- `npm ci` installs the locked dependencies. Use Node 22.12+ (CI uses Node 22).
- `npm run test:web` runs frontend tests; `npm run test:rust` runs Rust library tests; `npm test` runs both.
- `npm run build` checks TypeScript and builds the frontend. There is no lint script: do not claim one passed.
- For desktop changes, also run `npm run tauri build -- --debug --no-bundle` and relevant runtime checks. Linux requires GTK/WebKitGTK and the Tauri prerequisites; see the README and CI.
- Add focused regression tests for behavior, using existing Vitest and inline Rust test conventions. Do not weaken checks to make a branch pass.
- Documentation-only work needs diff/link review, not an application rebuild.
- PR descriptions explain the problem, resulting behavior, validation, platform limitations, and any prerequisites. Report blocked checks honestly.

## Product boundaries

- Keep photos private: processing stays local; no remote font or media requests.
- Preserve original files. Card review, rejecting, and copying must never delete sources. Source deletion must be a distinct explicitly confirmed action.
- Preserve sidecar compatibility, RAW/JPEG associations, keyboard navigation, and existing normal-folder behavior.
- Settings belong behind the shared preferences interface. Retain existing defaults in upstream-facing features; personal defaults belong in local configuration.
- Support Linux without introducing macOS/Windows regressions. Test on available platforms and state what was not tested.
- Keep browser demo and native Tauri paths working. Use semantic theme tokens, accessible labels, and the existing UI component system.
