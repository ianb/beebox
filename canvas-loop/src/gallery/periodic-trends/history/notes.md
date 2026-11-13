# periodic-trends — notes

## Cycle 1
Intent: first full layout. Table (groups 1, 2, 13–18; gap for 3–12) shaded on a light-to-dark blue ramp; line chart on the right with faint lines for the other periods/groups; info panel; clickable period/group headers; `property`, `show values`, `mark exceptions` params. Scripted session: hover Na, Cl; click group 1; hover Cs on chart; switch to EN; click period 2; mark exceptions; switch to IE; click O; show values; group 13; radius.
Seen: every verdict engaged as intended. Layout reads well. Exceptions found correctly (B, O across period 2 IE; Ga, Tl down group 13 IE). Problems: period 1 faint line runs straight from H to He across the empty middle; grey lines unlabelled, so a learner can't tell which is which; "Rank 7 of 42 shown" is clumsy; the "click a header" hint only shows when nothing is focused.

## Cycle 2
Intent: lines break at empty slots (one entry per x slot); grey lines get small dots and a number at their right end, de-overlapped; caption under the chart title; persistent usage hint top right; ordinal rank wording.
Seen: line breaks work (period 1 is two dots). Bug: the grey-lines caption came out right-aligned and ran into the table (textAlign left over from the axis labels). End numbers collide with the main line's last point (Tl ring covers "5").

## Cycle 3
Intent: fix caption alignment; reserve a right margin in the chart for the end numbers.
Seen: caption and end numbers read cleanly; numbers stack without overlap (17/18/15/14/16 down group 13). The empty-state info text is still the old two lines (my replacement text did not match the source, so it never applied). "38th highest" radius for O is an awkward way to say "small".

## Cycle 4
Intent: apply the empty-state text for real; rank says "Nth lowest" when nearer the bottom; exceptions also dotted in the table; wrap the exceptions sentence.
Seen: table dots on Ga and Tl match the chart rings; sentence wraps inside the column; empty state is one line. Noble gases with no electronegativity are a pale grey that is close to the palest blue (Li, Na), so "no value" is not obvious in the table.

## Cycle 5
Intent: "no value" written in cells without a value; script two more steps (electronegativity across period 6, click O again to unpin).
Seen: noble-gas cells now say "no value" and read as missing, not as low. Period 6 electronegativity shows Bi and Po against the trend (after Pb's 2.33), dotted in the table and circled on the chart. Rank line reads "2nd highest of the 38 elements with a value". Unpin works (panel returns to the prompt) but the transcript verdict still says "select O" for the unpin click.

## Cycle 6
Intent: name the unpin click "unpin O" in the transcript; pointer cursor over an element in a browser figure.
Seen: every scripted input reads as intended in the transcript (pin O, unpin O, period/group headers). Two leftovers: Cs's "244 pm" label sits on the grey-lines caption at the top of the plot; "1st highest" for Cs.

## Cycle 7
Intent: value label goes beside the point when the point is near the top of the plot; rank 1 reads "The highest". Rendered with `--zoom` on the top of the chart to check the label.
Seen: "244 pm" sits left of the Cs point, clear of the caption; panel says "The highest of the 42 elements with a value here." No new problems in the other frames. Stopped here (7 of 8 cycles).
