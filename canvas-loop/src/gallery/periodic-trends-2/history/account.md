# Periodic trends explorer: account

## What a learner sees and does

A 980×620 figure. Along the top are three controls placed in the drawing: **Property** (atomic radius,
electronegativity, first ionization energy), **Line chart** (across the period / down the group) and a
**Show trend arrows** checkbox.

On the left is the main-group periodic table: groups 1, 2 and 13-18, periods 1-6, with a narrow grey
"transition metals (not shown)" stub where the d-block sits. Each cell shows symbol, atomic number and
value, and is shaded on a light-to-dark ramp (darker = larger), with a legend bar underneath. Noble gases
with no Pauling value are grey with a dash. Cells whose value breaks the simple trend carry a small
orange dot ("note: hover to read"): B, Al, O, S for ionization energy (the p-subshell and pairing drops),
Ga for all three properties (d-block contraction), Tl and Bi for ionization energy, and the noble gases'
odd covalent radii.

On the right is a line chart of the property across the selected element's period or down its group,
drawn on a fixed axis per property so periods and groups can be compared. The other periods/groups are
faint grey lines behind it. Points are coloured with the same ramp as the table.

Hovering a cell or a chart point outlines it in orange in both views and fills the readout panel: name,
Z, group, period, value with unit, and either the exception note or its neighbours ("In period 3, before
it: Si 787; after it: S 1000"). Clicking selects an element (thick dark outline and chart ring) and
moves the chart to its period or group; the arrow keys move the selection. The trend arrows, when on,
show the direction in which the property increases across and down.

Data: covalent radii from Cordero et al. 2008 (chosen because it gives the noble gases values), Pauling
electronegativity from the CRC Handbook values, first ionization energy from NIST/CRC. The source line is
at the bottom of the figure and in `elements-tea.ts`. Values were written from memory of those tables,
not fetched; a spot check against the references before publishing is advisable.

The scripted session (events.json, 721 frames): start on radius / period 3 (Na selected), hover Cs,
click Cl, switch to "down the group", switch to electronegativity, hover F, hover Ga (note), switch to
ionization energy and across, click N, hover O's point in the chart (note), turn on trend arrows,
ArrowDown to P, back to atomic radius.

## What was easy

- The layout came out right on the first render. Because the frame-N guarantee makes positions a
  calculation, every scripted click and hover was computed from the sketch's own `colX`/`rowY`/`slotX`
  math and all engaged; the engagement verdicts (`hover Cs`, `select Cl`) in the transcript confirmed
  each one without looking at a picture.
- Per-call styles suited a chart: a handful of `const` styles and text options, spread to vary.
- `v.text` with `align`/`valign` about a point, and with a box plus `fit: true` for the notes, covered
  all labelling. Rotated axis labels were one `v.at({ rotate })`.
- `v.control` stand-ins render as plausible native widgets, so the header layout could be judged
  headless.
- `linearGradient` made the legend bar one call.
- `--zoom` was a quick way to check that small cell text was legible.
- Determinism made the final no-visual-change refactor verifiable: all frames byte-identical with
  `cmp`.

## What fought me

- The render-and-read loop itself was light: one command, then `Read` on the PNGs. The transcript's
  inline images did not render when I read `transcript.md` (I got the markdown text), so I read the
  frame PNGs directly. That is one extra call per frame, not a problem.
- `run` does not typecheck, and the package tsconfig has `noUncheckedIndexedAccess`, so 28
  "possibly undefined" errors (every `ELEMENTS[i]`, the colour ramp lookup) appeared only at the end.
  An `element(i)` accessor fixed them. Running `tsc` from cycle 1 would have avoided it.
- `pnpm --dir canvas-loop typecheck` reports errors in other packages' files, so checking "no errors in
  my files" means grepping its output.
- Lint `--fix` rewrote `forEach` and `< 0` index checks; harmless, but the edit hook reported them before
  I had finished writing.
- Placement collisions (an arrow over a rotated label, a key over a tick label, a legend item touching
  another) were all found by eye, one per cycle. Nothing in the library reports overlapping text.

## Cycles and why I stopped

5 render cycles of 16. Cycles 1-4 changed the picture; cycle 5 only fixed types and confirmed identical
pixels. Stopped: **satisfied**.

## What I would want from the library

- Text-overlap warnings: `v.text` already returns bounds; an opt-in transcript warning when two text
  bounds (or text and a filled shape drawn later) overlap would have caught three of my four layout bugs
  without a render-read cycle.
- A typecheck option on `run` (or a note at the end of the transcript when the sketch has type errors).
- A `typecheck` script scoped to a path, or output filtered to the sketch folder.
- Small chart helpers would save the most code: a linear scale with "nice" ticks, and an axis drawer.
  About a quarter of this sketch is hand-written axes, ticks and legend.
- A colour-ramp helper (interpolate between stops, plus a contrast-aware text colour pick).
- For the browser figure: a way for `v.control` to place a label beside a checkbox as part of the
  control, so clicking the words toggles it.
