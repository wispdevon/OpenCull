# Settings layout guidelines

Use the same spacing rules in every theme; themes change colours, not the form's
geometry. All sizes below use rems so the saved interface scale applies.

- Dialog: cap width at 48rem, keep 1rem clear of each viewport edge, use 1rem
  outer padding on narrow windows and 1.5rem on desktop. Keep the heading and
  tabs visible; scroll the content area.
- Cards: give each independent option or related group one boundary with
  1.25rem padding. Leave 1rem between cards. Do not add a second padded card
  inside a card. Nested fieldsets retain their legend and radio-group semantics
  with zero padding, zero border and no separate background.
- Within a group: use 0.5rem between a group label and its controls, 0.75rem
  between related rows and 0.375rem between a setting title and its explanation.
  Avoid spacer elements, fixed row heights or margins added to both neighbours.
- Typography: section headings 1rem semibold, labels 0.9375rem medium,
  descriptions and controls 0.875rem with 1.5 line height. Use the shared
  foreground and muted-foreground tokens rather than opacity.
- Controls: align switches with the setting title and reserve their width.
  Text inputs and selects have a 2.5rem minimum height. Radio options wrap as
  complete label/control pairs. Long explanations wrap within the card.
- Check the rendered result in all themes, on short and narrow windows and at
  larger interface scales. No horizontal clipping, compounded nested padding,
  lost focus indicators or inaccessible controls.

View mode demonstrates this structure: one outer card, a compact semantic group
for the three opening-view radios, then the Remember last view checkbox and its
description. The inner group adds no extra inset.

Keyboard shortcuts are edited directly in the Keyboard tab. Home and workspace
keyboard buttons open that same tab. Use responsive section cards, preserve
key-conflict handling, cancel capture with Escape, and stop capture when leaving
the tab or closing Settings. Do not open another modal for the editor.
