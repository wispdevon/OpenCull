# Linux feature integration validation

The seven feature branches start independently at upstream release 0.4.1. Each has its own fork PR; none requires the others. `integration/linux-features` combines them and resolves their overlapping settings, session, and ingest interfaces. General Node/toolchain fixes are committed directly to fork `main` and merged into integration.

## Review units

| Change | Branch | Fork PR |
|---|---|---|
| Agent workflow | `docs/agent-workflow` | [#1](https://github.com/wispdevon/OpenCull/pull/1) |
| Workspace controls | `feature/configurable-ui` | [#2](https://github.com/wispdevon/OpenCull/pull/2) |
| Offline fonts | `feature/font-selection` | [#3](https://github.com/wispdevon/OpenCull/pull/3) |
| Dark/light/18% grey | `feature/appearance-modes` | [#4](https://github.com/wispdevon/OpenCull/pull/4) |
| XDG configuration | `feature/xdg-config` | [#5](https://github.com/wispdevon/OpenCull/pull/5) |
| Cull before import | `feature/cull-before-ingest` | [#6](https://github.com/wispdevon/OpenCull/pull/6) |
| Multi-card sources | `feature/multi-card-session` | [#7](https://github.com/wispdevon/OpenCull/pull/7) |
| Video playback | `feature/video-culling` | [#8](https://github.com/wispdevon/OpenCull/pull/8) |
| RapidRAW inspired design | `feature/rapidraw-theme` | [#10](https://github.com/wispdevon/OpenCull/pull/10) |
| Precise card subfolders | `feature/ingest-subfolders` | [#11](https://github.com/wispdevon/OpenCull/pull/11) |
| Larger headings and review guidance | `feature/ui-changes` | [#12](https://github.com/wispdevon/OpenCull/pull/12) |

The design and subfolder branches also start directly from upstream. The UI
branch starts from `feature/cull-before-ingest`, because its instruction text
describes that workflow; its PR targets that branch to isolate the UI diff.

## Additional welcome, folder, and heading checks

The latest integration passes 48 frontend tests and a Linux debug desktop
build. Standalone design/subfolder/UI branches pass their frontend tests and
TypeScript/Vite builds. No Rust logic changed in these additions.

The in-app browser remained unavailable, so a separate headless Chromium
instance checked the rendered screens. No existing user browser was controlled.
Theme checks covered selection, reload persistence, offline font application,
font opt-out, restoration of the default design, and 1440px/600px layouts without
horizontal overflow or JavaScript errors. Combined light/dark/grey modes keep
the expected native colour scheme and grey's `#767676` photo canvas.

Folder checks observed no photo scan when navigating CARD or DCIM, a scan of
only `DCIM/100CANON` after selecting it, and an explicit parent selection with
**Use this folder**. Combined multi-source selection retained earlier sources.
Heading checks verified a 24px ingest heading, 14px instruction immediately
below it, no duplicate sidebar instruction, and 20px shared dialog titles.

The updated executable opened successfully in the user's Wayland session with
`WEBKIT_DISABLE_DMABUF_RENDERER=1`. An unmodified launch previously exited with
a Wayland protocol error. The previous app window was left running so its
pending card selection was preserved.

## Verified locally

- Toolchain: Node 22.23.3, npm 11.21.1. Clean `npm ci`, then `npm run check`: 46 frontend tests, frontend production build, and 283 Rust library tests pass on the combined branch. Fork main separately passes its 31 frontend tests, production build, and 268 Rust tests.
- Desktop: `npm run build:desktop -- --debug --no-bundle` succeeds on Linux with libjpeg-turbo enabled.
- Native self-test: opens files, loads previews, transfers without changing originals, and exercises the new features through real Tauri IPC and the existing store.
- Separate synthetic RAW/JPEG cards pair into shared entries. Local marks survive save/load; reviewing creates no source sidecars. Selected-only copying includes companions, and import in place retains only selected members and their marks.
- MP4 metadata, playback, pause, and seeking work on Linux. WebKitGTK cannot play the custom `asset:` scheme directly, even with a working H.264 decoder. The Linux feature uses a bounded, token-protected loopback HTTP stream, with range/authorization tests. Other systems retain Tauri's scoped asset protocol.
- Offline Space Grotesk loads. Theme controls change the actual root theme; dark/light/grey appearances and layout controls render. Native screenshots were inspected outside the repository.
- A malformed config remains byte-for-byte intact and displays a recovery banner while the app remains usable. An unwritable config root creates no partial file and displays the same recovery path.
- SHA-256 hashes and file membership of all nine synthetic source files remain unchanged after native checks. Test photos, videos, snapshots, and session data are outside the repository.

## Reproducing native feature checks

Use an isolated XDG config/data/cache directory. The combined native `--selftest <photo-folder>` runs baseline checks and the additional integration checks. Supply two or more still images; include a playable MP4 to test video. An optional `selfTestSources` array in the temporary config can point at separate RAW and JPEG source folders to verify cross-card pairing. This option is read only by the integration self-test, not normal application flows.

The browser plugin reported `Browser is not available: iab`; rendered validation used the real Linux GTK/WebKit application under a private X display instead. No external browser or existing user browser session was controlled.

These fixtures validate session, pairing, copying, persistence, and media delivery. They are synthetic previews with RAW filenames, not real sensor-data captures. Original RAW parsing retains its existing Rust tests. Physical card-reader behavior and macOS/Windows runtime behavior still need reports from those systems; the fork's cross-platform build is separate from local Linux validation.

## Personal configuration

`$XDG_CONFIG_HOME/opencull/config.json` (normally `~/.config/opencull/config.json`):

```json
{
  "theme": "grey",
  "font": { "choice": "space-grotesk", "family": "" },
  "ignoreVideos": true
}
```

Existing panel defaults remain unchanged. These are personal values; standalone feature branches preserve the original first-run defaults.
