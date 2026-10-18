# Compare with a reference

Pin the current still photo on the left while browsing other photos on the
right. This is useful for choosing between similar expressions or checking a
new candidate against a keeper.

- Click **Compare with reference** in the toolbar, or press **Shift+R**.
  The current photo initially appears in both panes. Browse with the arrow
  keys, filmstrip, or group shortcuts to choose a different candidate.
- **Reference** stays pinned, including when a filter hides it from the
  filmstrip. **Current** follows normal navigation.
- Rating, flag, colour and zoom shortcuts, the face panel and EXIF panel
  continue to act on **Current**. Existing selection-based menu actions
  retain their normal behaviour.
- Click either image to zoom; drag a zoomed image to pan. Zoom and pan are
  independent. Crops, rotation and mirrors use the same preview canvas as
  the ordinary loupe. Face detection is not required.
- The reference's **Zoom** button also toggles between fit and zoomed views
  and is reachable with Tab. Keyboard zoom shortcuts target Current.
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

This feature is limited to one reference beside one current photo, with
independent zoom and pan. Linked zoom, four-photo layouts, face matching,
manual grouping and editor integration are separate work.
