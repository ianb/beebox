# balance-reaction: account

## What a learner sees and does

The page is titled "Balance the equation". Under the title is one plain sentence about the reaction ("Methane (natural gas) burns"). The learner picks one of five reactions from the `reaction` select: water, methane, ammonia, rust or propane. They then type whole numbers 1–12 into four fields named A, B, C and D.

- **Equation.** The equation is written large, with each coefficient in a box labelled "box A", "box B" and so on. The labels match the field names. Formulas have real subscripts. The box last typed into glows yellow for about 0.75 s, so the learner can see which number they changed.
- **Unused box.** For a three-species reaction (water, ammonia, rust), a greyed, struck-out box at the top right reads "box D (4): not used / this reaction has only 3 boxes". It shows the value the learner typed, so a leftover number does not look like it is doing something.
- **Picture.** Two cards, "Before: reactants" and "After: products", with an arrow between them. Each species has its own cell, captioned "3 × O₂". It shows that many molecules, drawn as shaded balls in the usual element colours: white H, dark grey C, blue N, red O, orange-brown Fe. They are laid out in a grid as large as the cell allows.
- **Atom count.** One row per element. Each side shows one dot per atom, mirrored around a centre chip (= or ≠). Both sides use the same dot spacing, so a longer row really means more atoms. Each row shows the count at both ends and states "matches", "more on the left" or "more on the right". A matching row is tinted green. A mismatched row is tinted red, and every atom of that element in the picture gets a soft red halo.
- **Status bar.** When the equation is not balanced, it reads "Not balanced yet: hydrogen and oxygen do not match." It also gives one standing rule: "Change the big numbers in the boxes. The small numbers inside a formula stay the same."
- **Balanced.** The bar turns green and reads "Balanced!", with a hand-drawn white tick. A green strip appears behind the equation. Stars pop out at its two ends one after another and then twinkle. The molecules bob gently. If every coefficient shares a factor (2, 4, 2, 4), the bar says "Every box can be divided by 2. Can you find smaller numbers that also work?". Otherwise it says "Every atom on the left is still there on the right. Nothing appears or disappears."

The scripted session (`events.json`, 360 frames) works through four reactions:

- **Water:** all ones, then box A = 2, then balanced.
- **Methane:** it opens with the numbers left over from water. The learner goes to 1, 1, 1, 1, then D = 2, then overshoots with B = 3, then balances. A doubled solution then shows the smaller-numbers tip.
- **Rust:** box D is unused. Fe and O are both off, then balanced at 4, 3, 2.
- **Propane:** C and H are fixed first. Then B = 12 (24 O against 10), then B = 5 to balance.

## Design choices for teaching

- **Three views of one quantity.** The written number, a count of drawn molecules, and a count of atoms all change together when a box changes. The learner can see that "2 H₂O" means two whole water molecules, and that the coefficient multiplies every atom in the formula.
- **Diagnose without solving.** The page names which elements are off and which side has more. It never says which box to change or to what value. With several species containing oxygen, "more on the left" still leaves the reasoning to the learner.
- **The subscript misconception.** Changing subscripts is the classic mistake. The input model rules it out (only coefficients are typed), and the standing hint says so in words.
- **Halos in the picture.** The halos link the tally row to the actual atoms, so the learner can count them in the picture.
- **Smallest whole numbers.** A balanced set with a common factor is praised as balanced, and the bar adds a follow-up question about smaller numbers. It is not marked wrong.
- **Celebration.** It stays out of the way of the numbers that earned it. Confetti in cycles 1–3 fell across the equation, so it was replaced with stars in the margins.

## What fought me

- **Text measurement.** `View` has `text` but no `textWidth`. Writing subscripts and centring a mixed-size equation needs widths. I set `v.ctx.font` to the string the painter builds (`${style} ${size}px ${family}`) and called `measureText`. That copies an engine detail that could change without warning.
- **Layout by hand.** No layout help exists. Every overlap (the count numbers running into element names, the green strip cutting the subtitle, the tip sentence running under the tick) was found by rendering and fixed by moving constants. Three of my seven cycles went to this.
- **Overlapping atoms.** Space-filling molecules overlap. Per-atom outlines (cycle 2) tangled into double rings. A halo drawn behind all atoms first, then the atoms, worked.
- **Paper texture.** `paperTexture(0.35)` greyed and speckled the cream cards. 0.12 was right for a UI-like page. The 0.3–0.6 range in BRUSHES.md suits paintings, not a page like this.
- **Small lint frictions.** `(SLOTS as readonly string[]).includes(name)` is banned (no `as`). The replacement `.some(s => s === name)` is banned by `prefer-includes`. I ended with `SLOTS.find(...)` returning `Slot | undefined`.

## What the library lacked

The lacks below matter most for educational interactives and input controls.

- **`textWidth(str)`.** Also missing: a rich-text or subscript helper. Chemistry, maths and physics figures all need subscripts and superscripts.
- **Rounded rectangles.** I built `roundRect` from `path` quads. `rect(x, y, w, h, r)` as in p5 would remove that.
- **Field labels and order.** I could not tell how the browser panel labels the A–D fields, or whether a declaration could give them a human label ("box A (first species)"). A `label` and a `hint` on a param declaration would let the panel and the canvas use the same words. I named the params A–D so the canvas could refer to them.
- **Relevant or disabled params.** I found no way to mark a param as not relevant right now. Box D stays editable for three-species reactions. I could only say on the canvas that it is ignored. A `disabled`/`hidden` flag derived from other params (or from the model) would fix that at the source.
- **Reading the typed value.** Only valid, in-range values reach the sketch. A learner who types "13" or "1.5" sees nothing change on the canvas and gets no message from the sketch. Some way for the sketch to learn about rejected input, or a panel message for it, would help learners.
- **Resetting params.** No way to reset params when the `reaction` select changes. Numbers carry over between reactions. It is honest, but a learner may expect fresh ones. A sketch cannot set params (by design), so a "reset these params on change" option in the declaration would cover it.
- **Headless renders.** They show only the canvas, not the generated controls. I could not check what the field panel looks like next to the picture.

## Per-frame timing

Final render (cycle 7): 360 frames, `--timing`.

- Draw: average 2.43 ms, p95 5.28 ms, worst 11.48 ms.
- Update: average 0.01 ms.
- Frame 0: 123.7 ms (builds the cached background, with its paper texture and the ink-brush arrow).

Earlier cycles averaged 2.1–3.1 ms. The only brushed marks are the cached arrow and the tick in the "Balanced!" bar; everything else is plain fills and gradients. The page is well inside a 60 fps budget. Seven of eight render cycles were used. Cycles 6 and 7 are byte-identical.
