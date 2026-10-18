<a id="readme-top"></a>

# Culltivate

Private, fast photo culling for photographers.

[Download](https://github.com/wispdevon/OpenCull/releases/latest) ·
[Run from source](#try-this-fork) ·
[How it works](docs/HOW-IT-WORKS.md) ·
[License](LICENSE) ·
[Original project](https://github.com/NatePhotos/OpenCull)

Culltivate is an offline desktop app for reviewing RAW and JPEG shoots. It opens
camera previews without importing or decoding the RAW files, helps compare
frames, and saves ratings and crops in formats photo editors can read.
Photo analysis stays on your computer. The optional MobileCLIP model is
downloaded only when you request it; photos are never uploaded.

This repository is Wisp's fork of [OpenCull by NatePhotos](https://github.com/NatePhotos/OpenCull).
The combined development version is on `dev`; the upstream releases contain
the original application, not this fork's additions.

[Workspace screenshot](docs/images/screenshot.jpg) ·
[Annotated overview](docs/images/screenshot-annotated.png)

## What's new in 0.7.1.1 — Smooth-scrolling hotfix

- Fix blank filmstrip thumbnails after reference comparison by handling each
  wheel event once. High-resolution smooth scrolling retains fractional input.
- Reduce image tile corruption on Linux/NVIDIA by painting tiles on the CPU
  while keeping GPU compositing enabled. Some residual artifacting has been
  reported; this release does not claim to eliminate it entirely.
- Keep linked comparison zoom, ratings, keyboard navigation and source files
  unchanged. See the [changelog](CHANGELOG.md).

Release tag: `v0.7.1.1`. The internal package version is `0.7.1+1` to meet
Rust/Tauri semantic-version requirements. The release provides Linux x86_64
installers; macOS and Windows were not tested for this hotfix.

### Reference comparison from 0.7.1

- Press **Shift+R** or use the toolbar comparison button to pin a reference
  beside the current photo, then browse and mark candidates normally.
- Zoom and pan in either pane move both photos together. Keyboard, face,
  wheel/pinch and box zoom use the same linked view.
- Choose **Use as reference** to pin a new candidate, or press **Escape** to
  return to the previous workspace. See the [comparison guide](docs/features/REFERENCE_COMPARISON.md).

### Performance features from 0.7.0

- **Settings → Performance** measures photo workflows, identifies slow stages,
  and explains average scores, sample counts, failures and potential fixes.
- Supported NVIDIA/CUDA systems benchmark GPU inference and show the GPU model,
  with accurate CPU fallback reporting. Photos stay local; report submission is
  optional and requires approval.
- Fixed system and GPU specification ratings use a documented hardware-only
  formula and bundled manufacturer specifications, independently of benchmark timings.
  See the [public speeds database](benchmarks/README.md) for hardware, run counts
  and how to contribute reviewed results.
- Faster portrait rotation, simpler panel sizing, and a clearer Layout settings
  page. See the [changelog](CHANGELOG.md) and [benchmark guide](docs/features/PERFORMANCE.md).

## Try this fork

### Requirements

- [Rust stable](https://rustup.rs)
- Node.js 22.12+, 24, or 26+ and npm 11 or newer. Node 20, 23 and 25 are
  unsupported. The repository pins Node 22.23.3 and npm 11.21.1.
- [Tauri's platform prerequisites](https://v2.tauri.app/start/prerequisites/)
- A fast JPEG library build: on macOS, install Xcode Command Line Tools and run
  `brew install jpeg-turbo pkgconf`; on Linux and Windows, install CMake and
  NASM (NASM is needed on Intel/AMD).

Clone this fork and start the desktop app:

```sh
git clone https://github.com/wispdevon/OpenCull.git
cd OpenCull
nvm install
nvm use
npm install --global npm@11.21.1
npm ci
npm run desktop
```

If Node and npm are already installed, use any versions that meet the
requirements and skip the `nvm` commands. The first run compiles the native
app and may take several minutes. Keep the terminal open; stop the app with
Ctrl+C. Frontend edits reload automatically and Rust edits rebuild the app.

### Desktop commands

- **Run the desktop app:** `npm run desktop`
- **Preview the browser demo:** `npm run dev` — sample data only.
- **Build the app and installers:** `npm run build:desktop`

CUDA is detected automatically on supported Linux x86_64 systems. macOS and
Windows use CPU AI. Rendering and AI acceleration are independent.

<details>
<summary>CUDA and Linux rendering options</summary>

- **Force CUDA AI:** `npm run desktop -- --cuda`
- **Force CPU AI:** `npm run desktop -- --cpu`
- **NVIDIA rendering:** `npm run desktop -- --nvidia`
- **Compatibility rendering:** `npm run desktop -- --compatibility`
- **Software rendering:** `npm run desktop -- --software`
- **Build with CUDA:** `npm run build:desktop -- --cuda`
- **Build without installers:** `npm run build:desktop -- --debug --no-bundle`

CUDA requires an NVIDIA GPU and driver, CUDA 13.x runtime libraries and
compatible cuDNN 9.x. The app falls back to CPU if initialization fails.
See [CUDA setup](docs/CUDA-TRIAL.md) and [benchmarks](docs/CUDA-BENCHMARK.md).

</details>

<details>
<summary>Development server and port 1420</summary>

- The desktop command starts Vite and the native app together.
- An existing Culltivate Vite server on port 1420 is reused.
- Another app using that port produces an error before the native build starts.

</details>

## Features

<details>
<summary>Culling and sessions</summary>

- Review folders or memory cards before choosing which photos to copy.
- Combine card sources and select individual card subfolders.
- Compare RAW/JPEG pairs in filmstrip, grid or stack views.
- Review video clips with local first-frame previews and native playback.
- Set ratings, flags, colour labels and crops; resume recent sessions.
- Reviewing a card leaves its originals untouched.

</details>

<details>
<summary>Local AI and grouping</summary>

- Compare faces for sharpness, expressions, closed eyes and gaze.
- Choose the original YuNet finder by turning **Advanced AI** off, or use the
  YOLO26n finder with **Advanced AI** on; it also uses YuNet to place eyes and
  handles turned faces.
- In development builds, **Settings → AI → Face finder · Experimental** can
  use YuNet or YOLO26n for either AI rules mode. YOLO still uses YuNet to place
  eyes.
- [Group visually similar photos with MobileCLIP](docs/features/MOBILECLIP_GROUPING.md).
- [Detect motion blur](docs/features/MOTION_BLUR.md), with optional one-star and Reject marking.
- [Reuse cached analysis](docs/features/AI_CACHE.md) across sessions.
- Analysis runs locally; downloading the optional model does not upload photos.

</details>

<details>
<summary>Appearance and workspace</summary>

- Choose Dark, Light, 18% grey or Wisp themes, plus your font and interface scale.
- Select the home layout and optional featured image.
- Resize panels and filmstrips, and choose which panels are visible.
- Enable experimental native-aspect filmstrips, transitions and face overlays.

</details>

<details>
<summary>Shortcuts and saved preferences</summary>

- Customize shortcuts in **Settings → Keyboard**.
- Follow the first-launch overview for common keys and the culling workflow.
- [Import or export settings](docs/features/SETTINGS_TRANSFER.md) without photos or session history.

</details>

- [Feature guides](docs/features/) — options and experimental limitations.
- [How it works](docs/HOW-IT-WORKS.md) — previews, analysis and measured performance.

## Fork changes maintained ahead of upstream

This fork follows upstream OpenCull while maintaining its own changes on
`dev`. Several earlier Culltivate additions have since landed upstream; these
are the changes still specific to this fork:

- **Reference comparison.** Pin a reference beside the current photo with
  linked zoom and pan, then browse and mark candidates. See the
  [comparison guide](docs/features/REFERENCE_COMPARISON.md).
- **Culltivate identity.** This repository gives the fork its own name and
  release identity while retaining OpenCull as its upstream base.
- **Experimental face-finder choice.** Development builds let you choose
  YuNet or YOLO26n in either AI rules mode. YOLO26n continues to use YuNet to
  place eyes. See [How it works](docs/HOW-IT-WORKS.md).
- **YOLO CUDA fallback.** On supported Linux NVIDIA builds, YOLO can run its
  supported graph operations on CUDA and place unsupported operations on the
  CPU. See the [CUDA guide](docs/CUDA-TRIAL.md).
- **Motion-blur analysis.** An optional local check can lower streaked frames
  in group rankings and, when enabled, mark unrated detections one star and
  Reject. See [motion-blur details](docs/features/MOTION_BLUR.md).
- **Performance log.** Settings → AI shows recent YuNet/YOLO analysis chunk
  times, MobileCLIP grouping times, and full-size preview orientation times.
  Entries are kept in memory for the current session, up to 500.
- **Benchmarks and diagnostics.** [Settings → Performance](docs/features/PERFORMANCE.md)
  measures isolated photo workflows, ranks costly stages, and suggests
  investigations. Optional session recording and preview-approved webhook/ntfy
  reports share aggregate diagnostics without uploading photos.

## Keyboard basics

<details>
<summary>Common keyboard shortcuts</summary>

| Key | Action |
|---|---|
| `←` / `→` | Previous / next photo |
| `↑` / `↓` | Previous / next group |
| `P` / `X` / `U` | Pick / reject / clear flag |
| `1`–`5` / `0` | Set star rating / no stars |
| `Space` | Zoom to a face, then back out |
| `Z` | Zoom to the centre, then back out |
| `G` / `F` | Grid view / toggle filmstrip |
| `H` / `.` | Histogram and EXIF / face panel |
| `Caps Lock` | Toggle speed culling |
| `R` | Crop and straighten |
| `Shift+R` | Pin or close reference comparison |

[Keyboard settings screenshot](docs/images/shortcuts.png)

</details>

## Built with

[![Tauri][Tauri-badge]][Tauri-url]
[![Rust][Rust-badge]][Rust-url]
[![React][React-badge]][React-url]
[![TypeScript][TypeScript-badge]][TypeScript-url]
[![Tailwind CSS][Tailwind-badge]][Tailwind-url]
[![ONNX Runtime][ONNX-badge]][ONNX-url]

The optional Linux CUDA build also uses [NVIDIA CUDA][CUDA-url] and
[cuDNN][cuDNN-url]. Third-party software and model licenses are listed in
[`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md).

## Development and checks

For explicitly requested idea bundles and their prerequisites, see
[Pulling complete ideas](docs/IDEA-BUNDLES.md). Earlier feature branch tips
are preserved as [archive tags](docs/BRANCH_ARCHIVE.md).

Run these from the repository root with the requirements above installed:

```sh
npm run test:web
npm run test:rust
npm run build:web
npm run check
```

`npm run check` runs the frontend and Rust tests plus the frontend production
build. `npm run build:desktop` creates the native app and installer packages.
For a read-only native check against a folder of photos, see
[Checking it works](docs/HOW-IT-WORKS.md#checking-it-works).

Development in this fork happens directly on `dev`; `main` is the release
branch. Earlier work branch tips are preserved as
[archive tags](docs/BRANCH_ARCHIVE.md). Contributions to this fork should
target `dev`. To contribute to the original project, use
[NatePhotos/OpenCull](https://github.com/NatePhotos/OpenCull).

## License and contact

Copyright © 2026 The OpenCull authors. Culltivate is distributed under the
[GNU General Public License, version 3 or later](LICENSE), without warranty.
See [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md) for dependencies,
model credits and their licenses.

Original project and maintainer: [NatePhotos](https://github.com/NatePhotos/OpenCull)
· [Instagram](https://www.instagram.com/natephotos.ny) ·
[email](mailto:natephotos.ny@gmail.com). For issues and feature requests in
this fork, use [wispdevon/OpenCull issues][issues-url].

<p align="right"><a href="#readme-top">Back to top</a></p>

[issues-url]: https://github.com/wispdevon/OpenCull/issues
[Tauri-badge]: https://img.shields.io/badge/Tauri-24C8D8?style=for-the-badge&logo=tauri&logoColor=white
[Tauri-url]: https://tauri.app
[Rust-badge]: https://img.shields.io/badge/Rust-000000?style=for-the-badge&logo=rust&logoColor=white
[Rust-url]: https://www.rust-lang.org
[React-badge]: https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB
[React-url]: https://react.dev
[TypeScript-badge]: https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white
[TypeScript-url]: https://www.typescriptlang.org
[Tailwind-badge]: https://img.shields.io/badge/Tailwind_CSS-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white
[Tailwind-url]: https://tailwindcss.com
[ONNX-badge]: https://img.shields.io/badge/ONNX_Runtime-005CED?style=for-the-badge&logo=onnx&logoColor=white
[ONNX-url]: https://onnxruntime.ai
[CUDA-url]: https://developer.nvidia.com/cuda-toolkit
[cuDNN-url]: https://developer.nvidia.com/cudnn
