# Home layouts

The home page defaults to Spacious: identity above a row of actions, a 2rem
gap between those rows and a shared responsive gutter for the header and recent
items. Existing live recent-folder previews are preserved.

The Layouts button switches to Classic, placing actions at the upper right
beside the OpenCull heading when there is room. Actions wrap on smaller windows
rather than clipping. The `homeLayout` preference is stored through shared
preferences, independently of the design theme and colour mode. Invalid or
missing values use Spacious. macOS window-control clearance is preserved.
