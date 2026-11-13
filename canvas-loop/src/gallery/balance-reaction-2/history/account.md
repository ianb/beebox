# Balance reaction 2: account

## What a learner sees and does

The learner picks one of five reactions from a menu at the top right: water, burning methane, ammonia, rust, burning propane. A one-line story under the title says what the reaction is ("Iron slowly reacts with oxygen in the air to make rust."). The equation is written out large, with a yellow-ringed number box in front of each substance. The learner types a whole number from 1 to 12 in each box. For a three-substance reaction, a greyed box with a diagonal stroke sits at the right of the equation, labelled "4th box not used: this reaction has only 3 substances".

Below the equation, "Start with" and "End with" panels draw each substance as space-filling atoms in the usual colours (white H, dark-grey C, blue N, red O, orange Fe), repeated by its number. "2 × H₂O" is two water molecules. All molecules on the page share one scale, so an atom is the same size wherever it appears. Each side's width is split so the most crowded substance still gets room. Twelve H₂ molecules fit in a 4×3 grid.

The "Count the atoms on each side" card has one row per element. Each row has a "left" bar and a "right" bar built from one-atom segments, with the count at the end. A matching pair is green with a tick and "4 = 4 matches". A mismatched pair is red with a cross, "2 ≠ 4 more on the right", and a hint naming the molecules that contain that element ("H is in H₂, H₂O"). The shorter bar shows its shortfall as a red outline. The page shows which element is off and which molecules to look at, but it does not say which number to change. When the learner points at a row, that element's atoms get a yellow halo in the picture and every other atom fades. Clicking the row keeps the highlight ("(kept lit)"), and clicking again releases it.

The banner at the bottom says what is wrong in words ("Not balanced yet: carbon and oxygen do not match. Change one number at a time and watch the counts."). When every row matches, the banner turns green: "Balanced! Every atom you start with is still there at the end." Both arrows turn green, the molecules bob gently for about 2.5 seconds, and coloured sparkle stars burst from the arrow behind the molecules and fade over 1.5 seconds. If the answer balances but is not in lowest terms (2, 6, 4 for ammonia), the banner adds "Tip: every number divides by 2; chemists use the smallest whole numbers."

The scripted session (900 frames) solves water by pointing, pinning and typing, then methane, propane (including a wrong 8 for H₂O), rust and ammonia (a non-simplest answer, then 12 H₂).

## What was easy

- `control: "field"` params plus `v.control(name, box)` put the coefficient boxes inside the equation. Not placing `c4` hides it, and the stand-in shows the layout headless. The reaction select works the same way.
- Shared layout constants in `layout-tea.ts` made the hover and click hit-tests exact on the first try. The transcript verdicts (`point-at-O`, `pin-H`, `unpin-H`) confirmed that every pointer event landed.
- Putting each style in the call made per-state colour (red/green, dimmed/lit) a spread of a const.
- `v.text` with `w`/`h` wrapped the long balanced-plus-tip banner without help. `textWidth` let me draw real subscripts for the formulas, which reads better than Unicode subscript glyphs.
- `paperTexture` and one `marker` brush stroke under the title gave the page a painted touch for little cost (about 6 ms per frame on average).
- `--zoom` settled a small layering question (the halo order on O₂) in one look.

## What fought me

- The headless stand-in for the select shows a tofu box for "₈" in "C₃H₈". The headless font lacks U+2088, though ₂, ₃ and ₄ render. A browser's native select would show it, but the frames look broken. I left the option text alone and did not patch the library.
- There is no dashed stroke in `Style`. My "unused" slot uses a grey box with a slash where a dashed outline would have been the obvious mark.
- `paperTexture(amount)` textures everything drawn so far. At first I called it last, as BRUSHES.md suggests, and it speckled the white cards. Calling it right after `background` confines it to the page margin. The docs could mention that use.
- `v.clip` takes polygons and paths, but not a rect, so clipping to a card needs a four-point array (I dropped that clip once the sparkles moved behind the molecules).
- The render-and-read loop itself went smoothly: each 900-frame run took a few seconds, and the event-plus-snapshot capture policy gave about 33 frames per run, which I read selectively. One cycle went to my own script bug. A coefficient carried over from the previous reaction left methane unbalanced at a snapshot labelled "balanced". The page was right; reading the frame caught it. An assertion in the events file, such as "expect balanced at frame 450", would catch this kind of mistake without reading a picture.

## Cycles and why I stopped

I used 7 of 16 render cycles. Reason for stopping: **satisfied**. The final frames are clear for the target age, every interaction engages, and eslint and typecheck pass for the sketch files.

## What I would want from the library

1. A fallback font, or a glyph-coverage warning, for headless control stand-ins, or a per-option display label for selects (`options: [{ value, label }]`), so a value can stay ASCII.
2. A `dash` style key.
3. Rects (and round rects) as clip shapes.
4. Expectations in the events file (`{ "frame": 450, "type": "expect", "log": "balanced" }` or a model predicate), so a scripted session can fail on a wrong state without a frame being read.
5. `paperTexture` with a region or "under content only" option, or a doc line on calling it right after `background`.
