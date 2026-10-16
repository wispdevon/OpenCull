<a id="readme-top"></a>

<!-- PROJECT SHIELDS -->
[![Release][release-shield]][release-url]
[![Build][build-shield]][build-url]
[![Stargazers][stars-shield]][stars-url]
[![Issues][issues-shield]][issues-url]
[![GPL-3.0][license-shield]][license-url]
[![Instagram][instagram-shield]][instagram-url]

<!-- PROJECT LOGO -->
<br />
<div align="center">
  <a href="https://github.com/NatePhotos/OpenCull">
    <img src="docs/images/logo.png" alt="OpenCull" width="96" height="96">
  </a>

<h3 align="center">OpenCull</h3>

  <p align="center">
    Photo culling for photographers: fast, private and free.
    <br />
    For macOS, Windows and Linux.
    <br />
    <a href="docs/HOW-IT-WORKS.md"><strong>How it works »</strong></a>
    <br />
    <br />
    <a href="https://github.com/NatePhotos/OpenCull/releases">Download</a>
    &middot;
    <a href="https://github.com/wispdevon/OpenCull/issues/new?labels=bug">Report Bug</a>
    &middot;
    <a href="https://github.com/wispdevon/OpenCull/issues/new?labels=enhancement">Request Feature</a>
  </p>
</div>

## Run this fork with all features

The `dev` branch combines the approved features in this fork for testing on macOS, Linux and Windows.
No manual merging or cherry-picking is needed. Individual feature branches
remain available for selective upstream review; approved work is also merged into fork `main`.

Install [Rust stable](https://rustup.rs) and the
[native Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) first:

- **macOS:** install Xcode Command Line Tools (`xcode-select --install`), then
  `brew install jpeg-turbo pkgconf`. Tauri automatically uses the macOS
  `turbo-system` configuration.
- **Linux:** install GTK/WebKitGTK prerequisites plus CMake and NASM (NASM is
  needed on Intel/AMD). Tauri uses the Linux `turbo` configuration.
- **Windows:** install the Visual Studio C++ and WebView2 prerequisites plus
  CMake and NASM. Tauri uses the Windows `turbo` configuration.

Then, using nvm (or your platform's Node version manager):

```sh
git clone --branch dev --single-branch https://github.com/wispdevon/OpenCull.git
cd OpenCull
nvm install
nvm use
npm install --global npm@11.21.1
npm ci
npm run desktop
```

Without nvm, install Node 22.23.3 and npm 11.21.1 using your preferred version
manager, or run the last two commands through the pinned runtime:

```sh
npx --yes --package=node@22.23.3 --package=npm@11.21.1 --call 'npm ci && npm run desktop'
```

The desktop development command starts the frontend and native backend
together, with live frontend reloads and incremental Rust recompilation.
It does not create a production bundle or installers. The initial native
compile can take several minutes. macOS needs no Linux rendering flags or CUDA libraries.

All features are included: cull-before-import sessions, multiple card sources,
specific card subfolders, configurable panels, video inclusion/playback,
appearance modes, offline fonts, the optional RapidRAW inspired design,
larger UI headings, XDG configuration, remembered/default view modes, Wisp contrast,
saved interface scaling, recent session deletion, resizable stack strips,
experimental native-aspect strips and eased zoom, optional NVIDIA rendering profiles,
and an opt-in Linux CUDA AI trial.
**Settings → Design** selects OpenCull, RapidRAW or Wisp interface
design and switches between Spacious and Classic action placement.
Colour mode, font and interface scale are under **Settings → Design**;
view/panel controls remain under **Settings → Layout**.
Keyboard shortcuts are edited directly in **Settings → Keyboard**.
Back up or transfer preferences through **Settings → Storage → Settings backup**;
imports can be reviewed before applying and reloading. Photos and history are excluded.
Wisp applies the included RapidRAW inspired preset: 18% grey photo surround,
contrasting controls, Space Grotesk, 125% scale, and the saved culling options.
New profiles receive a quick workflow and keyboard overview; reopen it from
**Settings → Keyboard → Quick overview**.
Optional [face-target Space zoom](docs/features/FACE_ZOOM.md) is under **Settings → Zoom**.
[Experimental face outlines and hover spotlight](docs/features/FACE_OVERLAYS.md) are under **Settings → AI**; hover highlights without moving the photo, and clicking still zooms.
AI results are [cached across sessions](docs/features/AI_CACHE.md), including reopening the same photos through a card or subfolder. The toolbar distinguishes cached results from new analysis.
Optional [interface transitions](docs/features/INTERFACE_MOTION.md) and [crop workspace controls](docs/features/CROP_WORKSPACE.md) are available in Design and Zoom settings.
Experimental [motion-blur detection](docs/features/MOTION_BLUR.md) adds a filterable label, reduces grouping rank, and can give unrated photos one star and Reject while preserving existing ratings and explicit picks.
Settings → Design → Appearance includes **Ranking colours**: keep blue–grey–red or choose red–green (green is best). Pick and Reject thumbnail badges match the green tick/red cross in group previews.
See the [settings layout guidelines](docs/SETTINGS_DESIGN.md) and
[Wisp design guidelines](docs/WISP_DESIGN.md) for spacing and contrast rules.
Linux settings are created in `$XDG_CONFIG_HOME/opencull/config.json`, normally
`~/.config/opencull/config.json`. No personal configuration file is required.
macOS and Windows use Tauri's native application-config directory instead.
The Linux video streaming workaround is compiled only on Linux; macOS keeps
native asset-protocol playback. `desktop` automatically selects the tested NVIDIA workaround on Linux when NVIDIA drives the primary display and X11 is available. Other platforms retain native defaults.

For a Mac tester, use the [macOS trial guide](docs/TRY-ON-MACOS.md).
NVIDIA rendering profiles and CUDA AI are Linux-only; macOS uses its native webview
and CPU AI automatically. CUDA is excluded from macOS builds, even when the Cargo
feature is requested.

### Desktop commands

Use one checkout and switch branches with Git when needed. Feature branches remain available without separate project folders. Run `npm ci` after switching if dependencies changed. `npm run` lists the compact command set; desktop profiles are flags on one command. If `npm run dev` is already serving OpenCull, `npm run desktop` reuses that frontend. A different app on port 1420 produces a clear error before the native build starts.

| Command | Purpose | Platforms |
|---|---|---|
| `npm run desktop` | Native desktop development with CPU AI | macOS, Linux, Windows |
| `npm run desktop -- --nvidia` | NVIDIA webview compositing profile; CPU AI | Linux |
| `npm run desktop -- --cuda` | Experimental NVIDIA AI inference | Linux x86_64 |
| `npm run desktop -- --nvidia --cuda` | NVIDIA rendering profile plus CUDA AI | Linux x86_64 |
| `npm run desktop -- --compatibility` | WebKit compatibility fallback | Linux |
| `npm run desktop -- --software` | Force software webview rendering | Linux |
| `npm run dev` | Browser UI with demo data; no native file access | All |
| `npm run build:web` | Type-check and build the frontend | All |
| `npm run build:desktop` | Build desktop installers | All, with native prerequisites |
| `npm run check` | Frontend tests/build and Rust tests | All, with native prerequisites |

CUDA AI requires an NVIDIA GPU, a compatible driver, **CUDA 13.x** runtime
libraries and **cuDNN 9.x** compatible with CUDA 13. CUDA/cuDNN are optional and
are not needed on macOS or for normal CPU launches. See [CUDA setup and
verification](docs/CUDA-TRIAL.md) and the [measured memory
tradeoff](docs/CUDA-BENCHMARK.md). Rendering acceleration and AI acceleration
are independent; CUDA does not move JPEG decoding to the GPU.

For a desktop executable without installer packaging, run
`npm run build:desktop -- --debug --no-bundle`. For a CUDA executable on Linux
x86_64, add `--features cuda`; launch it with `OPENCULL_AI=cuda` to opt in.
The default desktop build retains CPU AI.

Run `npm run check` for automated checks. See the
[feature and validation map](docs/features/VALIDATION.md) for individual PRs
and platform limitations.

<!-- TABLE OF CONTENTS -->
<details>
  <summary>Table of Contents</summary>
  <ol>
    <li>
      <a href="#about-the-project">About The Project</a>
      <ul>
        <li><a href="#built-with">Built With</a></li>
      </ul>
    </li>
    <li>
      <a href="#getting-started">Getting Started</a>
      <ul>
        <li><a href="#download">Download</a></li>
        <li><a href="#build-from-source">Build From Source</a></li>
      </ul>
    </li>
    <li><a href="#usage">Usage</a></li>
    <li><a href="#contributing">Contributing</a></li>
    <li><a href="#license">License</a></li>
    <li><a href="#contact">Contact</a></li>
    <li><a href="#acknowledgments">Acknowledgments</a></li>
  </ol>
</details>

<!-- ABOUT THE PROJECT -->
## About The Project

[![OpenCull, with a photo open: the camera's settings on the left, the photo in the middle, each face cut out large on the right, and the filmstrip below][product-screenshot]](docs/images/screenshot.jpg)

Culling is the first job after a shoot: going through every frame and
deciding what to keep. OpenCull is built to make that fast.

* **Opens a shoot at once.** A folder of RAWs opens in a fraction of a second,
  straight from the previews the camera already wrote into each file. No
  import, no catalogue, nothing to wait for.
* **RAW, JPEG or both.** Shoot both and each pair is culled as one photo.
  Or choose to see only the RAWs, or only the JPEGs.
* **Marks you can take anywhere.** Stars, flags and colour labels are written
  as standard sidecar files that Lightroom, Capture One and the rest read.
  Turn on **Write ratings and crops into JPEGs** in Settings to also write a
  JPEG's stars, colour label and crop into the file itself, where those
  programs look for them. It is off by default.
* **Crop and straighten, for your editor to pick up.** Crop with a locked or
  free shape, straighten with a slider or by drawing a line along the
  horizon, rotate and flip. Nothing is done to the photo: the crop is saved
  beside it the way Lightroom and Camera Raw save theirs, so they open it
  already cropped and you can still change it there. A photo cropped in
  those programs shows cropped here too.
* **Looks at the faces for you.** It finds the faces in every photo and shows
  whose eyes are shut, who is looking away and how sharp each one is. Turn on
  **Advanced AI** in Settings to try the newer way of judging them, which is
  still being worked on: it tells a blink from someone looking down, laughing
  or closing their eyes in a hug, and stops marking a photo down for those.
  Where everyone's eyes are open it lets the sharper frame come first, and in
  a posed group it points out someone who may be looking just off the camera.
* **Compares a person with themselves.** It follows each person through a
  burst, or through a pose shot again, and ranks the frames, so the one with
  everyone's eyes open is the one it puts first.
* **Keeps your photos yours.** Everything runs on your own computer. Nothing
  is uploaded, and there is no account. The one thing it uses the internet
  for is asking whether a newer version of itself is out, which sends nothing
  about you or your photos and can be turned off in Settings.
* **Keeps itself up to date.** When a new version is out, OpenCull says so
  when it opens and installs it for you if you want it.
* **Start to finish.** Copy photos off a card, cull them, and hand the keepers
  to your editing program.

**Status: early.** It is used daily on a Mac, and has been tested and
confirmed working on Windows and Linux. If something goes wrong on your
system, reports are very welcome.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

### Built With

* [![Tauri][Tauri-badge]][Tauri-url]
* [![Rust][Rust-badge]][Rust-url]
* [![React][React-badge]][React-url]
* [![TypeScript][TypeScript-badge]][TypeScript-url]
* [![Tailwind CSS][Tailwind-badge]][Tailwind-url]
* [![ONNX Runtime][ONNX-badge]][ONNX-url]

**Optional NVIDIA AI acceleration — Linux x86_64 only:**

[![CUDA][CUDA-badge]][CUDA-url] [![cuDNN][cuDNN-badge]][cuDNN-url]

CUDA 13.x and cuDNN 9.x are used only by the opt-in CUDA trial. macOS and
normal CPU builds do not require them. See the [trial setup](docs/CUDA-TRIAL.md).

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- GETTING STARTED -->
## Getting Started

### Download

For this fork's combined features, use the source instructions above or the
installer artifacts attached to a successful `main` run of the
[fork's Build workflow](https://github.com/wispdevon/OpenCull/actions/workflows/build.yml).
The [upstream releases page][release-url] contains the original application's
releases, which do not include this fork's added features.

| System | File |
|---|---|
| macOS, Apple silicon (M1 and later) | `.dmg` |
| Windows 10 and 11 | `-setup.exe` |
| Linux (Ubuntu 24.04, Fedora 40, Debian 13 or newer) | `.AppImage`, `.deb` or `.rpm` |

They are not signed with a paid developer certificate, so each system asks
before running them the first time:

* **macOS** — open the `.dmg` and drag OpenCull to Applications. The first
  time you open it macOS will refuse. Go to System Settings → Privacy &
  Security, scroll down, and choose **Open Anyway**.
* **Windows** — SmartScreen shows "Windows protected your PC". Choose **More
  info**, then **Run anyway**.
* **Linux** — for the AppImage, make it executable (`chmod +x`) and run it.

That is the only time you need this page. From then on OpenCull offers each
new version itself, and installing it keeps your settings. If an update
cannot be installed where the app lives, it says so and brings you back here.

### Build From Source

You need [Rust](https://rustup.rs) and [Node](https://nodejs.org) 22.12+ LTS, 24, or 26+ (Node 22.23.3 and npm 11.21.1 are pinned for CI), and one
thing for the JPEG library: `brew install jpeg-turbo pkgconf` on macOS, or CMake
(plus NASM on Intel and AMD machines) on Windows and Linux. Windows and Linux
also need the system packages on
[Tauri's list](https://tauri.app/start/prerequisites/).

1. Clone the repo
   ```sh
   git clone --branch dev --single-branch https://github.com/wispdevon/OpenCull.git
   cd OpenCull
   ```
2. Install the packages
   ```sh
   npm ci
   ```
3. Run it
   ```sh
   npm run desktop
   ```
4. Or build the app itself
   ```sh
   npm run build:desktop
   ```

### Experimental visual grouping

In **Settings → AI → MobileCLIP grouping**, download the 45.5 MB model once,
then enable **Group by visual similarity**. It splits different compositions
using local image embeddings, reuses cached previews and analysis, and can be
switched off to restore time/face-position grouping. The preference is included
in Storage settings import/export. See [processing order and model details](docs/features/MOBILECLIP_GROUPING.md).

### Experimental NVIDIA AI (Linux x86_64)

The opt-in CUDA trial requires an NVIDIA driver, **CUDA 13.x** runtime and
**cuDNN 9.x** compatible with CUDA 13, in addition to the normal prerequisites.
Run `npm run desktop -- --cuda` to compile and launch it. Normal launches keep
CPU inference. macOS does not build, load or expose CUDA.

See the [CUDA trial guide](docs/CUDA-TRIAL.md) for installation links, exact
commands, verification and CPU fallback, and the
[memory experiment](docs/CUDA-BENCHMARK.md) for measured results.

More on building, including how to build without the JPEG library, is in
[How it works](docs/HOW-IT-WORKS.md#building-the-fast-jpeg-library).

`npm run desktop` opens the real desktop app with the Vite development
server and Rust file watcher. It starts the frontend automatically; do not
start `npm run dev` separately on the same port. Frontend edits reload live;
Rust edits rebuild and restart the backend. No production frontend build or
installer packaging is required. The first run still compiles the native Rust
app and its dependencies; later runs reuse Cargo's cache. Stop with Ctrl+C.
The existing `npm run tauri dev` command remains available.

`npm run dev` alone runs the browser UI with sample data, not native card access
or file copying. `npm test` runs automated frontend and Rust library tests.

On Linux with NVIDIA, try `npm run desktop -- --nvidia` for the tested accelerated
webview profile. `npm run desktop -- --compatibility` retains the broad DMA-BUF
workaround; `npm run desktop -- --software` explicitly uses software rendering.
These commands are Linux-only. Native GTK/WebKitGTK and the other
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) are still needed.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- USAGE EXAMPLES -->
## Usage

Open a folder, or choose **Ingest from Card** to copy a card first. Then go
through the shoot from the keyboard:

| Key | What it does |
|---|---|
| `←` `→` | Previous and next photo |
| `↑` `↓` | Previous and next group (a burst, or a pose shot again) |
| `P` `X` `U` | Pick, reject, clear the flag |
| `1`–`5`, `0` | Star rating, and none |
| `6` `7` `8` `9` `N` | Red, yellow, green, blue and purple labels |
| `Space` | Zoom to a detected face, and back out (centre if no face) |
| `Z` | Zoom to the centre of the photo, and back out |
| `G` | Grid view |
| `.` | Face panel |
| `F` `H` `I` | Filmstrip, histogram and EXIF, info overlay |
| `Caps Lock` | Speed cull: move on to the next photo after each mark |
| `R` | Crop and straighten. Inside it: `Enter` keeps the crop, `Esc` leaves the photo as it was, `X` swaps tall and wide, `A` holds or frees the shape, `O` steps through the guides |
| `⌘[` `⌘]` / `Ctrl+[` `Ctrl+]` | Rotate left and right |
| `⌘C` `⌘V` / `Ctrl+C` `Ctrl+V` | Copy a photo's crop, and paste it onto the selected photos |
| `⌘E` / `Ctrl+E` | Ship: open the keepers in your editor, or copy or move them |
| `⌘Z` / `Ctrl+Z` | Undo |

Every shortcut can be changed in Settings.

<div align="center">
  <img src="docs/images/shortcuts.png" alt="The Keyboard Shortcuts window, listing every shortcut and the key it is on" width="520">
</div>

The face panel on the right shows each face in the photo, cut out large
enough to judge. The top square on each is its eyes (green for open, through
to red for shut); the bottom one is its sharpness out of ten. Point at them
for the words. The coloured bar under each thumbnail is the photo's rank
among the frames it was shot with, with **1** the one to look at first.

Drag the edge of either side panel, or the top of the filmstrip, to make it
larger or smaller. The sizes are remembered.

_For how any of this works, and how well, see
[How it works](docs/HOW-IT-WORKS.md)._

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- CONTRIBUTING -->
## Contributing

Contributions are welcome, most of all from anyone who can run OpenCull on
Windows or Linux and say what happened.

If you have a suggestion, open an issue with the tag "enhancement", or fork
the repo and open a pull request:

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

Use `nvm install && nvm use`, then `npm install --global npm@11.21.1` (or another version manager that reads `.node-version`) before installing packages. Node 20 is unsupported by the current test runner. If no version manager is installed, run commands through the pinned runtime, for example `npx --yes --package=node@22.23.3 --package=npm@11.21.1 --call 'npm ci && npm run check'`.

`npm run check` runs frontend tests, the TypeScript/production frontend build, and Rust library tests. `npm test` runs both unit test suites; `npm run test:web` and `npm run test:rust` run them separately. `npm run build` / `npm run build:web` build only the frontend; `npm run build:desktop` builds the desktop app and installers (requiring the native prerequisites above).

`npm test` runs the unit tests. The app can also run itself against a folder
of your own photos with no window on screen and without touching them; see
[Checking it works](docs/HOW-IT-WORKS.md#checking-it-works).

Please do not attach other people's photographs to an issue.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- LICENSE -->
## License

Copyright © 2026 The OpenCull authors.

Distributed under the GNU General Public License, version 3 or (at your
option) any later version. It comes with no warranty. See [`LICENSE`](LICENSE)
for the full text, and [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md) for
what OpenCull is built on and the licences those come under.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- CONTACT -->
## Contact

NatePhotos - [@natephotos.ny](https://www.instagram.com/natephotos.ny) - natephotos.ny@gmail.com

Project Link: [https://github.com/NatePhotos/OpenCull](https://github.com/NatePhotos/OpenCull)

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- ACKNOWLEDGMENTS -->
## Acknowledgments

* [Tauri](https://tauri.app)
* [ONNX Runtime](https://onnxruntime.ai) and the [ort](https://ort.pyke.io) crate
* [YuNet](https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet), the face finder
* [libjpeg-turbo](https://libjpeg-turbo.org)
* [shadcn/ui](https://ui.shadcn.com), [Radix UI](https://www.radix-ui.com) and [Lucide](https://lucide.dev)
* [Best-README-Template](https://github.com/othneildrew/Best-README-Template)
* [Shields.io](https://shields.io)

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- MARKDOWN LINKS & IMAGES -->
[product-screenshot]: docs/images/screenshot.jpg
[release-shield]: https://img.shields.io/github/v/release/NatePhotos/OpenCull?include_prereleases&style=for-the-badge
[release-url]: https://github.com/NatePhotos/OpenCull/releases
[build-shield]: https://img.shields.io/github/actions/workflow/status/wispdevon/OpenCull/build.yml?branch=main&style=for-the-badge
[build-url]: https://github.com/wispdevon/OpenCull/actions/workflows/build.yml
[stars-shield]: https://img.shields.io/github/stars/NatePhotos/OpenCull.svg?style=for-the-badge
[stars-url]: https://github.com/NatePhotos/OpenCull/stargazers
[issues-shield]: https://img.shields.io/github/issues/NatePhotos/OpenCull.svg?style=for-the-badge
[issues-url]: https://github.com/NatePhotos/OpenCull/issues
[license-shield]: https://img.shields.io/badge/license-GPL--3.0--or--later-blue?style=for-the-badge
[license-url]: https://github.com/NatePhotos/OpenCull/blob/main/LICENSE
[instagram-shield]: https://img.shields.io/badge/-Instagram-black.svg?style=for-the-badge&logo=instagram&colorB=555
[instagram-url]: https://www.instagram.com/natephotos.ny
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

[CUDA-badge]: https://img.shields.io/badge/CUDA-76B900?style=for-the-badge&logo=nvidia&logoColor=white
[CUDA-url]: https://developer.nvidia.com/cuda-toolkit
[cuDNN-badge]: https://img.shields.io/badge/cuDNN-76B900?style=for-the-badge&logo=nvidia&logoColor=white
[cuDNN-url]: https://developer.nvidia.com/cudnn
