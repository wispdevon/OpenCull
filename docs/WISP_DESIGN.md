# Wisp design guidelines

Select Wisp under Settings → Design → Interface design. Wisp applies the
[included preset](../src/lib/presets/wisp.json): a RapidRAW-style welcome layout,
18% grey photographic surround, Space Grotesk, 125% interface scale and the
saved culling options captured for this fork. These include classic home action
placement, native-aspect strips, smooth click zoom, Advanced AI, background
faces and always-on Speed Cull. No source paths or session history are included.

Selecting Wisp or Restore Wisp preset applies those defaults. Later changes
remain saved across launches; they are not reset at startup. Export the current
configuration or import the included JSON through Settings → Storage. Dark and
Light modes remain available after choosing the preset. The photographic
surround stays neutral; theme colours never alter photo pixels or rating colours.

- Use semantic foreground, muted-foreground, background, card, border and primary
  tokens. Never dim an entire readable row with opacity or hard-code grey text.
- Maintain at least 4.5:1 contrast for labels, values and help text against their
  actual surfaces, and 3:1 for meaningful icons and control boundaries.
- Group related metadata in bordered sections with a distinct surface. Use a
  visible divider beneath the section heading, with 1rem internal padding and
  1rem between sections. Avoid faint dividers on an undifferentiated grey panel.
- Metadata headings use 0.875rem semibold, labels 0.8125rem, and values 0.875rem,
  all with 1.5 line height. Use sentence case and brighter headings rather than
  tiny uppercase text. Keep values monospaced for numbers and filenames.
- Use primary-coloured icons as navigation cues alongside text. A label remains
  understandable without its icon or colour.
- Settings options use 1.25rem padding and visible card boundaries. Keep controls
  separate from help text, wrap long labels and values, and let content scroll
  without losing the dialog heading or tabs.
- Support interface scaling through relative units, not CSS transforms. Check
  long camera/lens names and file paths, narrow panels, keyboard focus and all
  three appearance modes. Respect forced colours and native font rendering.

The EXIF panel applies this hierarchy to Exposure, Equipment, Date & Time and
File Details. Other themes retain their existing metadata styling.
