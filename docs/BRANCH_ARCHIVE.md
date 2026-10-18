# Archived work branches

Active development continues directly on `dev`; `main` remains the release branch.
No new feature branches are created unless explicitly requested.

On 2026-10-16, 63 work branches were preserved as annotated tags before their
branch names were removed locally and from origin. Tags retain the complete
history, including commits not merged into `dev`. Upstream refs were untouched.

Those 63 work-branch tags are accompanied by the separately preserved
`archive/2026-10-16/release-v0.5.0-first-build` tag. There are therefore 64 tags
under that date prefix; the branch table below covers the 63 work branches.

Later on the same date, all 43 `feature/*` branches were restored locally and on origin at their exact archived tips. The remaining 20 work branches stay available through archive tags. All 63 archive tags remain intact.

On 2026-10-17, all 43 restored `feature/*` branch names were closed again locally and on origin. Every local and remote tip was verified against its existing published `archive/2026-10-16/feature/*` annotated tag before deletion. Those tags retain the complete history. Other branches and upstream refs were preserved.

## Contribution branches closed on 2026-10-17

The four split upstream contributions were verified as merged: [GPU runtime #4](https://github.com/NatePhotos/OpenCull/pull/4), [card review #5](https://github.com/NatePhotos/OpenCull/pull/5), [AI grouping #6](https://github.com/NatePhotos/OpenCull/pull/6), and [workspace settings #7](https://github.com/NatePhotos/OpenCull/pull/7). The older combined [PR #3](https://github.com/NatePhotos/OpenCull/pull/3) was closed without merging and superseded by that split set.

All five `contribution/*` branch names were removed locally and from origin after seven annotated archive tags were published and their peeled commits verified. The two distinct older local tips were archived separately. Other branches and upstream refs were untouched.

| Archived branch tip | Commit | Published archive tag |
|---|---|---|
| `contribution/ai-grouping` | `1ee4b971a33c` | `archive/2026-10-17/contribution/ai-grouping` |
| `contribution/card-review-sessions` | `c50413c8e4b0` | `archive/2026-10-17/contribution/card-review-sessions` |
| `contribution/gpu-runtime` | `3aa61f0b3351` | `archive/2026-10-17/contribution/gpu-runtime` |
| `contribution/upstream-improvements` | `de5d787afa23` | `archive/2026-10-17/contribution/upstream-improvements` |
| `contribution/workspace-settings` | `2bc315afd1aa` | `archive/2026-10-17/contribution/workspace-settings` |
| `local/contribution/ai-grouping` | `67b0fa48e70d` | `archive/2026-10-17/local/contribution/ai-grouping` |
| `local/contribution/workspace-settings` | `c0470341ce24` | `archive/2026-10-17/local/contribution/workspace-settings` |

## Earlier work branch archives

For curated, cumulative branches that avoid unrelated integration history, see [Idea bundles](IDEA-BUNDLES.md).

Inspect an archive without creating a branch:

```sh
git show archive/2026-10-16/feature/mobileclip-grouping
git log archive/2026-10-16/feature/mobileclip-grouping
```

| Former branch | Archived tip | Tag |
|---|---|---|
| `chore/workspace-and-scripts` | `2ea2bd95ff0c` | `archive/2026-10-16/chore/workspace-and-scripts` |
| `demo/rapidraw-welcome` | `b79936698cb7` | `archive/2026-10-16/demo/rapidraw-welcome` |
| `docs/agent-workflow` | `56d4eba1ea00` | `archive/2026-10-16/docs/agent-workflow` |
| `docs/wisp-and-onboarding` | `3a37ed55beb1` | `archive/2026-10-16/docs/wisp-and-onboarding` |
| `feature/appearance-modes` | `7f90224d8301` | `archive/2026-10-16/feature/appearance-modes` |
| `feature/automatic-cuda` | `18c02b7d3404` | `archive/2026-10-16/feature/automatic-cuda` |
| `feature/configurable-ui` | `a4263b7f6481` | `archive/2026-10-16/feature/configurable-ui` |
| `feature/crop-scroll-and-filmstrip` | `c64c2fea1ddf` | `archive/2026-10-16/feature/crop-scroll-and-filmstrip` |
| `feature/cuda-inference` | `ae472cdf3d3e` | `archive/2026-10-16/feature/cuda-inference` |
| `feature/cull-before-ingest` | `5fad15b759ee` | `archive/2026-10-16/feature/cull-before-ingest` |
| `feature/experimental-filmstrip-aspect` | `8c811957d49b` | `archive/2026-10-16/feature/experimental-filmstrip-aspect` |
| `feature/experimental-smooth-zoom` | `bc4da6c40e56` | `archive/2026-10-16/feature/experimental-smooth-zoom` |
| `feature/experimental-ui-transitions` | `83dc060aacb2` | `archive/2026-10-16/feature/experimental-ui-transitions` |
| `feature/face-outlines-and-spotlight` | `f23276948258` | `archive/2026-10-16/feature/face-outlines-and-spotlight` |
| `feature/first-launch-overview` | `35e169ee377b` | `archive/2026-10-16/feature/first-launch-overview` |
| `feature/font-selection` | `c3b2fad384a5` | `archive/2026-10-16/feature/font-selection` |
| `feature/home-layouts` | `d8f86131d512` | `archive/2026-10-16/feature/home-layouts` |
| `feature/home-theme-menu` | `5c43cefc84cf` | `archive/2026-10-16/feature/home-theme-menu` |
| `feature/ingest-subfolders` | `a9ae3c975dff` | `archive/2026-10-16/feature/ingest-subfolders` |
| `feature/inline-keyboard-settings` | `7318ebd02648` | `archive/2026-10-16/feature/inline-keyboard-settings` |
| `feature/interface-scale` | `14bec6c8d4a5` | `archive/2026-10-16/feature/interface-scale` |
| `feature/mobileclip-grouping` | `6b50dcde9c17` | `archive/2026-10-16/feature/mobileclip-grouping` |
| `feature/mobileclip-grouping-strength` | `818d56a56478` | `archive/2026-10-16/feature/mobileclip-grouping-strength` |
| `feature/motion-blur-auto-reject` | `f09fd60b7c5d` | `archive/2026-10-16/feature/motion-blur-auto-reject` |
| `feature/motion-blur-ranking` | `b652d032373e` | `archive/2026-10-16/feature/motion-blur-ranking` |
| `feature/multi-card-session` | `aacac1a3d1bd` | `archive/2026-10-16/feature/multi-card-session` |
| `feature/nvidia-gpu-acceleration` | `c53903a526b4` | `archive/2026-10-16/feature/nvidia-gpu-acceleration` |
| `feature/ranking-palette-and-decision-badges` | `59da3687130b` | `archive/2026-10-16/feature/ranking-palette-and-decision-badges` |
| `feature/rapidraw-theme` | `032e7e77703c` | `archive/2026-10-16/feature/rapidraw-theme` |
| `feature/recent-sessions` | `c5403eaf76e7` | `archive/2026-10-16/feature/recent-sessions` |
| `feature/resizable-stack-filmstrips` | `1d3c534412fa` | `archive/2026-10-16/feature/resizable-stack-filmstrips` |
| `feature/settings-design-tab` | `49c18f65dcfb` | `archive/2026-10-16/feature/settings-design-tab` |
| `feature/settings-import-export` | `e84f837db633` | `archive/2026-10-16/feature/settings-import-export` |
| `feature/settings-panel-icons` | `26522fdb887c` | `archive/2026-10-16/feature/settings-panel-icons` |
| `feature/settings-spacing` | `05575e4d3178` | `archive/2026-10-16/feature/settings-spacing` |
| `feature/simplify-crop-presets` | `8b4555e03b15` | `archive/2026-10-16/feature/simplify-crop-presets` |
| `feature/space-face-zoom` | `c45022ab002b` | `archive/2026-10-16/feature/space-face-zoom` |
| `feature/stack-filmstrip-layout` | `e5ba0b645c19` | `archive/2026-10-16/feature/stack-filmstrip-layout` |
| `feature/stack-overview-bottom` | `57cdbc4ecc92` | `archive/2026-10-16/feature/stack-overview-bottom` |
| `feature/theme-home-preferences` | `18c02b7d3404` | `archive/2026-10-16/feature/theme-home-preferences` |
| `feature/ui-changes` | `4fa2a5c3ac62` | `archive/2026-10-16/feature/ui-changes` |
| `feature/video-culling` | `06fce9244865` | `archive/2026-10-16/feature/video-culling` |
| `feature/view-mode-preferences` | `812567d8d294` | `archive/2026-10-16/feature/view-mode-preferences` |
| `feature/wisp-metadata-contrast` | `5d152759ead4` | `archive/2026-10-16/feature/wisp-metadata-contrast` |
| `feature/wisp-preset` | `04390b861389` | `archive/2026-10-16/feature/wisp-preset` |
| `feature/wisp-theme` | `63553daa26e1` | `archive/2026-10-16/feature/wisp-theme` |
| `feature/xdg-config` | `d2e125990a42` | `archive/2026-10-16/feature/xdg-config` |
| `fix/desktop-existing-frontend` | `aad55c5b0b87` | `archive/2026-10-16/fix/desktop-existing-frontend` |
| `fix/face-zoom-composition` | `be10db606c25` | `archive/2026-10-16/fix/face-zoom-composition` |
| `fix/linux-auto-nvidia-profile` | `dbaaf37db5e3` | `archive/2026-10-16/fix/linux-auto-nvidia-profile` |
| `fix/linux-renderer-flicker` | `c845b36a68f6` | `archive/2026-10-16/fix/linux-renderer-flicker` |
| `fix/mobileclip-preview-cache-tiers` | `2d0d0231e308` | `archive/2026-10-16/fix/mobileclip-preview-cache-tiers` |
| `fix/persistent-ai-session-cache` | `51c4e5dd6cad` | `archive/2026-10-16/fix/persistent-ai-session-cache` |
| `fix/rejected-scene-badge` | `25d63cd47dd9` | `archive/2026-10-16/fix/rejected-scene-badge` |
| `fix/settings-experimental-sections` | `041f12d84f7a` | `archive/2026-10-16/fix/settings-experimental-sections` |
| `fix/settings-nested-spacing` | `b49620737d7d` | `archive/2026-10-16/fix/settings-nested-spacing` |
| `fix/settings-type-hierarchy` | `993bcc50089d` | `archive/2026-10-16/fix/settings-type-hierarchy` |
| `fix/stack-layout-default` | `c4ff81e6d6ae` | `archive/2026-10-16/fix/stack-layout-default` |
| `fix/tighter-time-grouping` | `136ef9c9e7e5` | `archive/2026-10-16/fix/tighter-time-grouping` |
| `fix/webview-renderer-label` | `7d61c0c9d205` | `archive/2026-10-16/fix/webview-renderer-label` |
| `fix/zoom-image-handoff` | `8c97d3f570db` | `archive/2026-10-16/fix/zoom-image-handoff` |
| `fix/zoom-shortcut-targets` | `f3124350f293` | `archive/2026-10-16/fix/zoom-shortcut-targets` |
| `integration/linux-features` | `790b38beb9bf` | `archive/2026-10-16/integration/linux-features` |
