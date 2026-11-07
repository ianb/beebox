---
title: "Select boxes have no visible edge on light themes, and their arrow and menu follow a dark theme's scheme"
workstream: theme-colors
area: beebox
labels: [themes, contrast, forms]
resolution: implemented
filed-by: agent
discovered-by: Ian
discovered-in: "boxholder report, 2026-11-06"
---

**Closed.** Resolved by 91e412cbc and 8fa9aed47. The shared field keeps its
white field on every theme, so its own contrasts do not depend on the theme;
its border is now warm-700 (6.38:1 on the field), it sets
`color-scheme: light` so the native arrow and menu match the field, and focus
darkens the border inside the gold ring. Text inputs share the change. The
camera overlay's selects have a 5.8:1 border and a dark color scheme. The
theme studio's Settings panel has a select, and `bin/theme-check` scores
every select in view: its value on its field at 4.5:1 and its edge against
the surrounding pixels at 3:1. `--all` reports no select misses. Not
checked: the native option menu itself, which screenshots do not capture,
and browsers other than Chromium.

The first fix missed the selects in embedded figures; the boxholder saw
light-on-light text there. canvas-loop's `figure.css` colors a figure's
controls by the operating system's dark mode, and the select has no colors
of its own, so on a dark-mode Mac a light card showed the select's text,
the control labels and the number readout at about 1.2 to 1.3:1, and on a
light-mode Mac a dark card showed them dark on dark. Fixed in beebox's own
`themes/figure-controls.css`: unpainted figure text takes the material's
ink, and buttons and the select are the app's white field with the 6.4:1
border, whatever the OS mode. The theme studio's reading card now mounts a
real canvas-loop figure, so theme-check measures its controls.

The boxholder's report: select boxes are not good in some themes; their
text does not contrast and/or their border is missing, and any select box
should look clearly like one.

Survey of the theme studio (every catalog theme, desktop and phone width),
before the fix:

- Every select in the app outside the camera overlay comes from the shared field style
  (`src/frontend/src/components/ui/fields/shell.tsx`). It paints a white
  field with `text-warm-900` and a `border-warm-400` border. The border is
  1.55:1 on the white field. On light card themes (paper, post-it, goldfish,
  doodlebit, posy, veil, rose-trellis, bloom, ribbon, letter-set) the field
  sits on a near-white panel, so nothing marks the box: it reads as loose
  text with an arrow.
- On dark card themes (deck, night-atlas, gold-thread, phosphor, tempest,
  gilt) the white field shows, but the card's `color-scheme: dark` reaches
  the select, so the browser draws the native arrow and the option menu for a
  dark field.
- The gold focus ring is 2.1:1 on the white field.
- Text inputs share the same style and the same faint border.
- The camera overlay's two selects (`DeviceSettings.tsx`) had a 1.9:1 border
  on their dark field, and a light color scheme that drew a dark arrow on it.
- The theme studio's own floating controls (dev only) had selects with a
  1.34:1 border.
- `bin/theme-check` did not measure selects: a select's shown value is not a
  text node, and the studio had no select.
