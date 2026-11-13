# Balance reaction 2: cycle notes

## Cycle 1
Intent: first full build. Header with reaction select placed by `v.control`; equation row with four coefficient fields (`control: "field"`) and drawn formulas with real subscripts; a greyed "4th box not used" slot for three-species reactions; molecules as space-filling atoms (one shared scale across the picture so atom sizes compare); per-element tally with paired left/right bars made of unit segments, red/green, a red outline for the shortfall; hover/click on a tally row lights that element's atoms; green banner plus atom confetti on balance. Scripted session walks all five reactions (900 frames).
Seen: layout reads cleanly. Problems: (1) molecules small, cap of 24 px/unit too low; (2) propane C3H8 cramped because each side split 50/50 while 8 H2O needed room; (3) the "H is in C3H8, H2O" hint uses plain digits, and the select's headless stand-in shows a tofu box for "₈" (U+2088 missing from the headless font; library stand-in, not mine); (4) tally footer hint collides with the third row; (5) confetti flies over the tally text, cluttered.

## Cycle 2
Intent: cap 34 px/unit; split each side's width to maximise the smaller molecule scale; holder hint drawn with real subscripts; hint moved to the tally title line; confetti now bursts from the picture's arrow, clipped to the picture card, using the reaction's own elements.
Seen: molecules larger and propane's side gets a fair share. Hint row and holder subscripts fixed. New problem: the atom confetti now floats over the molecules, and loose atoms appearing at the moment of balance contradict the lesson (atoms are conserved). Propane's H atoms crowd each other.

## Cycle 3
Intent: replace atom confetti with coloured sparkle stars drawn behind the molecules; spread propane's skeleton (C-C 1.3 units).
Seen: sparkles read as celebration without implying new atoms; propane cleaner; 12 x H2 fits in a 4x3 grid; "divides by 2" tip shows for 2,6,4. Problems: NH3's side H atoms hide behind N; a focused atom's yellow halo is painted over its neighbour (halo drawn per atom, not per molecule); page is flat, no painted touch.

## Cycle 4
Intent: halos for a molecule drawn before its atoms; NH3 H atoms moved out; a marker-brush highlight under the title and paperTexture(0.35) over the page; check draw time with --timing.
Seen: NH3 now shows all three H; marker highlight under the title looks hand-drawn. The paper texture over everything speckles the white cards and bars; it reads as dirt and costs clarity. Draw time avg 5.9 ms/frame.

## Cycle 5
Intent: apply the paper texture to the page background only (call it right after `background`), so cards stay clean.
Seen: cards clean again; zoom on the lit O2 shows both halos behind both atoms. The page margin texture at 0.45 is coarse and brownish, louder than the content.

## Cycle 6
Intent: paper texture down to 0.22; final look across the session.
Seen: texture now a quiet margin. Reading the methane frames found a script bug, not a sketch bug: c3 stayed at 2 from the water answer, so the "methane balanced" snapshot showed carbon 1 vs 2 (the page correctly said not balanced).

## Cycle 7
Intent: events set c3 to 1 at frame 405 so the methane answer 1,2,1,2 is reached; confirm the balanced methane frame.
Seen: methane balances at 1,2,1,2; all three rows green, arrows green, banner green, sparkles behind the molecules. Every scripted interaction has the verdict I expected (point-at-O, point-at-H, pin-H, unpin-H). eslint clean, typecheck clean. Stopping: satisfied.
