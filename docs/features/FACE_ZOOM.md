# Face zoom target

Settings → Zoom → Space zooms to the highest-scoring face is opt-in. Space still toggles back to fit, and rebinding the centre-zoom action carries the preference with it. Clicking a photo and the separate remembered-spot zoom keep their existing behaviour.

The existing per-face numeric score is sharpness. The target is the highest scored visible subject, falling back to a scored background face if necessary. Unknown scores, invalid geometry and faces whose centres are outside the crop are excluded. With AI off, no analysed faces or missing dimensions, the usual centre target is used immediately; finishing analysis never moves the view by itself.

This preference is saved and included in Settings import/export.
