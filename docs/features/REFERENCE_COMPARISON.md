# Compare with a reference

Pin the current still photo on the left while browsing other photos on the
right. This is useful for choosing between similar expressions or checking a
new candidate against a keeper.

- Click **Compare with reference** in the toolbar, or press **Shift+R**.
  The current photo initially appears in both panes. Browse with the arrow
  keys, filmstrip, or group shortcuts to choose a different candidate.
- **Reference** stays pinned, including when a filter hides it from the
  filmstrip. **Current** follows normal navigation.
- Rating, flag and colour shortcuts, the face panel and EXIF panel
  continue to act on **Current**. Zoom shortcuts and face zoom move both panes. Existing selection-based menu actions
  retain their normal behaviour.
- Click either image to zoom; drag a zoomed image to pan. Zoom and pan are
  linked, including keyboard zoom, wheel/pinch zoom and box zoom. Crops, rotation and mirrors use the same preview canvas as
  the ordinary loupe. Face detection is not required.
- The reference's **Zoom** button toggles both panes between fit and zoomed
  views and is reachable with Tab.
- Click **Use as reference** above Current to replace the pinned photo.
- Click **Close comparison**, press **Escape**, or press **Shift+R** again
  to return to the previous loupe, scene or grid workspace at the current
  photo. Choosing a workspace explicitly also closes comparison.

The comparison shortcut can be changed in **Settings → Keyboard**. It does
not replace any existing default shortcut.

The reference cannot be edited from its pane. To mark it, navigate to that
photo in Current. Starting a crop exits comparison and uses the normal crop
workspace. Videos can be browsed in Current but cannot be pinned as a reference.
Removing the reference from the session or closing/reopening the folder clears
comparison. The pin is temporary and is not stored in preferences or sidecars.

Comparison itself writes no photo metadata. During card review, decisions
remain local under the existing review rules; in normal folders, marks retain
the existing sidecar and optional embedded-JPEG behaviour.

## Scope

This feature is limited to one reference beside one current photo, with linked
zoom and pan. Enlargement relative to Fit and the relative position within each displayed
photo are shared, accounting for crop, orientation and pane size. Pixel
percentage badges can differ for different crops or resolutions. The existing
fit and maximum zoom limits still apply. New candidates and replacement
references inherit the shared view. Closing comparison discards that view.
Four-photo layouts, face matching, manual grouping and editor integration are
separate work.

## Native scrolling regression check

The strips consume wheel input through a non-passive native listener. This
prevents browser wheel handling from competing with the application's sideways
mapping. Pixel deltas retain a fractional remainder, horizontal input keeps its
axis, and line/page input is normalized. Alt, Ctrl and Meta wheel gestures stay
available to the browser. Scrollbar dragging still updates virtual cell coverage.

On the affected Linux/NVIDIA setup, physical high-resolution mouse testing
confirmed this removes blank thumbnails after comparison. The NVIDIA renderer
profile also defaults to CPU tile painting while retaining GPU compositing.
Physical mouse testing found substantially reduced artifacting, with some
residual corruption still reported. `WEBKIT_SKIA_ENABLE_CPU_RENDERING=0` opts
back into GPU tile painting for troubleshooting; other profiles are unchanged. Isolated viewport stacking contexts
bound oversized graphics layers, but neither isolation nor the layer check below
establishes that native painting is correct. Disabling WebKit's DMA-BUF image
atlas also failed to prevent the reported corruption.

For a native check, start a debug app with a local inspector endpoint:

```sh
WEBKIT_INSPECTOR_HTTP_SERVER=127.0.0.1:9223 npm run desktop
```

Open a folder with faces, show the face panel, and use a high-resolution wheel
to scroll quickly before, during and after comparison. Include Scene View's
two rows, zooming, hover effects and a scaled interface. Check actual painted
thumbnails; DOM presence and successful image loads alone do not catch this
failure. Then, with the strip visible:

```sh
node scripts/check-native-strips.mjs http://127.0.0.1:9223
```

This read-only check uses WebKit's layer tree to reject an independently
composited content row wider than its viewport. It requires native WebKitGTK
and complements the existing self-test for virtual cell coverage. It does
not replace visual testing with the affected mouse and graphics driver.
