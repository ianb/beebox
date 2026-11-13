# Periodic trends explorer: cycle notes

## Cycle 1
Intent: first full build. Main-group table (groups 1, 2, 13-18; periods 1-6) with a grey stub where the
transition metals go, each cell shaded on a yellow-green-blue ramp; line chart of the selected element's
period or group on a fixed per-property axis, with the other periods/groups as faint grey lines; a readout
panel for the hovered or selected element with notes on exceptions. Controls (property, chart direction,
trend arrows) placed in the header with `v.control`. Scripted a 12-step session.
Seen: layout worked first time; every scripted input engaged (no "(unhandled)"). Hover outline and chart
ring link the two views. Problems: the vertical "increases" arrow ran over the rotated "period" label;
the faint grey lines in the chart had no key; the readout was mostly empty when there was no note.

## Cycle 2
Intent: move the down-arrow to the right of the table, add an "other periods/groups" key, and fill the
readout with the element's neighbours in its period or group.
Seen: arrow fixed. The key collided with the top tick label (250 / 2500). "Before it in period 6:
nothing." read badly.

## Cycle 3
Intent: push the plot down to make room for the key; drop the missing neighbour from the sentence; add an
orange dot on cells that have an exception note, with a legend entry ("note: hover to read").
Seen: key clear; dots make the exceptions findable (B, Al, O, S, Ga, Tl, Bi for ionization energy).
The dot legend touched the "no value" swatch. Thallium's electronegativity note explained nothing
(its value is on-trend).

## Cycle 4
Intent: space the legend, darken atomic numbers on light cells, remove the Tl electronegativity note,
re-aim the chart hover event at O's moved point. Zoomed crop of the table corner to check cell text.
Seen: legend spaced; cell text legible at 3x. Satisfied with the picture.

## Cycle 5
Intent: no visual change. Fix typecheck errors (noUncheckedIndexedAccess on `ELEMENTS[i]` and the ramp)
with an `element(i)` accessor; re-render to confirm.
Seen: all 12 captured frames byte-identical to cycle 4. Lint and typecheck clean for this folder. Stopped.
