# Home layouts

The home page defaults to Spacious: identity above a row of actions, a 2rem
gap between those rows and a shared responsive gutter for the header and recent
items. Existing live recent-folder previews are preserved.

Settings → Design switches to Classic, placing actions at the upper right
beside the OpenCull heading when there is room. Actions wrap on smaller windows
rather than clipping. The `homeLayout` preference is stored through shared
preferences, independently of the design theme and colour mode. Invalid or
missing values use Spacious. macOS window-control clearance is preserved.

Interface design selects: OpenCull, RapidRAW inspired or Wisp.
RapidRAW's included-font checkbox is available there as well. These reuse the
existing visual-theme preferences; no migration is required. Design settings retain appearance mode, interface font and scale as separate controls.
Theme and home-layout choices are shown directly in Design settings, including while culling.
