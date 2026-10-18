# Changelog

## 0.7.0 — The Performance

### Added

- Run thorough workflow benchmarks from Settings, with local results or explicit
  submission to fixed diagnostic destinations after approval.
- See a colored timing breakdown, average Score and median Typical time, clear
  photo/sample counts, stage-specific guidance, failures and measured suggestions.
- Benchmark bundled AI on supported NVIDIA/CUDA systems using private model
  sessions; show the selected GPU and accurately label CPU fallback.
- Record optional work-session timings, export reports, and preview concise
  aggregate diagnostics before enabling reporting. Photos, filenames and EXIF
  stay on the device.
- Include app version/build, CPU, GPU, RAM, OS, AI provider and fixture version
  alongside elapsed and measured timing totals in notification summaries.
- Compare systems with versioned overall and GPU-assisted AI scores, backed by
  a public reference database bundled for offline use. References distinguish
  debug and release builds and expose their sample counts and hardware.

### Changed

- Group panel sizes with icons and 10-pixel steps, move Zoom into Layout, and
  give scrolling settings room around controls and the scrollbar.
- Show Good in green, Watch in amber, and Alarming/Failed in red, using the
  bundled Lospec500 palette.

### Fixed

- Disable incremental debug compilation after reproducing missing hidden LLVM
  symbol linker failures and verifying a clean non-incremental build.
- Improve portrait orientation traversal, avoid sorting recent-session history
  for a single lookup, and release discarded preview workers.
- Preserve explicit benchmark submission through temporary progress errors,
  while cancellation and revoked approval keep results local.
- Keep successful Finish Review copies recorded when a later source file or
  RAW/JPEG companion disappears, so retrying does not duplicate earlier copies.
- Count histogram tones inside the committed crop, including turned and
  mirrored photos, using the existing thumbnail without rendering the RAW.

## 0.6.1

- Rebrand the fork as Culltivate while keeping OpenCull configuration and
  settings formats compatible.
- Include upstream OpenCull improvements: portrait analysis runs about three
  times faster, and newer Panasonic RAW files can provide full-size previews.
- Add an experimental YuNet/YOLO26n face-finder choice for either AI rules
  mode in development builds. YOLO continues to use YuNet to place eyes.
- Allow supported YOLO graph operations to run on CUDA while unsupported
  operations fall back to CPU.
- Show YuNet/YOLO chunk timings, MobileCLIP grouping timings, and full-size
  preview orientation timings in Settings → AI. Recent entries stay in memory
  for the current session, up to 500.

## 0.5.1

- Fix Linux CUDA AppImages placing ONNX Runtime provider libraries outside the path used at runtime.
- Keep CPU fallback available when CUDA initialization fails.

## 0.5.0

### Review and grouping

- Review cards before importing, combine card sources, and resume saved sessions.
- Add optional local MobileCLIP visual grouping, with Loose (>0.70), Normal
  (>0.80, default) and Tight (>0.90) presets.
- Reuse cached preview JPEGs and embeddings; changing grouping strength does
  not run inference again.
- Tighten time grouping to avoid long chains of unrelated compositions.
- Add experimental motion-blur detection, filtering and optional one-star/Reject
  marking while preserving existing ratings and explicit picks.
- Cache AI results across sessions and improve face zoom, outlines and spotlight.

### Interface

- Add Wisp alongside Dark, Light and 18% grey themes, with independent home
  artwork, font and interface scale controls.
- Add compact panel visibility controls, resizable filmstrips, native-aspect
  thumbnails and experimental transitions/crop workspace options.
- Use consistent Pick/Reject badges and selectable ranking palettes.
- Add a first-launch overview, editable shortcuts and settings import/export.

### Performance and compatibility

- Automatically detect CUDA for desktop development and builds on compatible
  Linux x86_64 systems; retain CPU fallback and a CPU override.
- Include CUDA support in Linux release installers. CUDA inference requires
  compatible NVIDIA drivers, CUDA 13.x and cuDNN 9.x; macOS and Windows use CPU AI.
- Share CUDA model sessions and report inference failures, including low VRAM.
- Automatically select the stable Linux NVIDIA renderer and fix interaction
  flicker; renderer selection remains independent of AI acceleration.
- Simplify desktop commands and reuse an existing OpenCull development server.

### Installation

- Download the installer for your platform from this fork's GitHub release.
- macOS installers are not notarized; Windows installers are not code-signed.
- Install updates manually. Signed automatic updates are not configured for this fork.
