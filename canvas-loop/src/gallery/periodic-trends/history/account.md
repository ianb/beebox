# Periodic trends explorer: canvas-loop account

## What a learner sees and does

A 1000×660 figure in two halves. On the left, the main-group elements (groups 1, 2 and 13–18, periods 1–6) in periodic-table layout, each cell shaded on a light-to-dark blue scale by the chosen property, with a grey band where groups 3–12 would sit and a colour key below. On the right, a line chart of the same property across one period or down one group, on a fixed axis per property, with the other periods (or groups) drawn as faint grey lines numbered at their right-hand end for comparison.

- **Property** (a select): atomic radius, electronegativity or first ionization energy. The title and a one-line rule ("Grows down a group, shrinks across a period.") change with it, and a short "why" paragraph sits under the chart.
- **Choosing the line**: click a period number (left of the table) or a group number (above it); the chosen header turns into a dark tab and its cells get a dark outline. Clicking an element moves the line to that element's period or group, keeping the direction.
- **Hover** an element in the table or near its column on the chart: an orange ring on its cell, an orange dot with the value on the chart, an orange marker on the colour key, and a panel with name, atomic number, period, group, value and rank ("5th lowest of the 42 elements with a value here"). **Click** pins it; clicking again unpins it.
- **Show values** prints each value in its cell. **Mark exceptions** circles points on the chart whose step goes against the usual trend (and dots those cells in the table) and names them: B and O across period 2 for ionization energy, Ga and Tl down group 13, Bi and Po across period 6 for electronegativity.
- Elements without a value (He, Ne, Ar, Rn electronegativity) say "no value" in the cell and on the chart axis, and the line breaks there.

Data: covalent radii from Cordero et al. 2008; Pauling electronegativity from the CRC Handbook; first ionization energies (kJ/mol) from NIST/CRC. Values are embedded in `elements-tea.ts` with the sources in its header and in the figure's footer. One caveat a teacher should know: covalent radii put the noble gases slightly above the halogens (Ar 106 vs Cl 102), which the chart shows as an uptick at the end of each period.

The scripted session (`events.json`, 25 entries) hovers Na and Cl, clicks the group 1 header, hovers Cs on the chart, switches to electronegativity and period 2, turns on exceptions, switches to ionization energy, pins O, shows values, picks period 3 then group 13, back to radius, then electronegativity across period 6, and unpins O.

## What was easy

- The TEA split fit the problem. The model is three fields (hover, pinned element, chosen line); everything else is derived from params in `draw`. Hit-testing lives in a shared `layout-tea.ts` used by both `update` and `draw`, so a click and the box it lands on cannot drift apart.
- Scripting clicks was arithmetic: cell centres come straight from the layout constants, and every click landed first time.
- The transcript's engagement verdicts (`pin O`, `unpin O`, `group 13`, `period 6`, `Δmodel` for hover) worked as a test of the interaction script with no extra code. A wrong verdict ("select O" on an unpin) was visible in the transcript before I looked at a frame.
- Param changes and labelled snapshots made each frame of the session identifiable at a glance.
- Lint caught real things early (mutating `sort`, `forEach`, an impossible null check after `findLast`).

## What fought me

- **No text measurement in `View`.** Wrapping the explanation and the exceptions sentence uses a character-count guess; the value label beside a point and the ghost-line numbers are placed by fixed offsets rather than by measured width. `v.ctx.measureText` exists as an escape hatch, but I stayed off `ctx`.
- **Text-state leakage.** `textAlign` persists across helpers; one caption came out right-aligned and ran into the table because the axis-label code set `right` just before. I ended up setting alignment before nearly every label.
- **Charting is all by hand.** Axis ticks, scales, line breaks at missing values, label de-overlap and the colour ramp are each ~10–30 lines I wrote. None was hard, but a chart library would have them.
- **The render-and-read loop.** Each cycle is one command, ~20 frames, and I read 2–3 frames as images. It caught everything that mattered (label collisions, the leaked alignment, an edit of mine that silently did not apply because my replacement text did not match the source). The cost is that judging a figure means reading full 1000-px frames; small text is legible but near the limit, and `--zoom` was the right tool for the one tight spot. My first run failed because the output's parent directory did not exist; the CLI does not create it.
- **Hover in the headless run is synthetic.** I can show that hover highlights, but not how it feels to sweep the pointer; header hover has no feedback beyond the pointer cursor on elements.

## Cycles

7 of 8 (plus one run that failed before rendering because the output directory was missing).

## What I would want from the library

1. `v.textWidth(s)` (and ideally a `textWrap(s, width)` helper), so labels can be placed and wrapped by measurement.
2. A way to scope text state, or `text` options per call (`v.text(s, x, y, { align, baseline, size, color })`), so alignment cannot leak between helpers.
3. Small chart helpers: a linear scale with nice ticks, and a sequential colour ramp (`v.ramp(stops)(t)`). They are the parts every chart sketch rewrites.
4. The CLI creating the `--out` directory's parents.
5. Hover-region support for browser figures (cursor and highlight for declared hit boxes), since `debugBox` already names the same rectangles.
