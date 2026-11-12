# Pendulum lab: notes

## Cycle 1
Intent: first full build. Stage with planet backdrop (cached), lab stand and metre rule; RK4 pendulum; stopwatch that stops after 10 returns to the release side; graph (period vs length, theory curves, √L option, hover tooltip); results table; scripted 10-trial session (1940 frames).
Seen: physics correct (L=1, 10° gives 2.010 s vs 2.006 small-angle; 25° gives 2.030 s). Problems: result banner text overflowed its pill and sat on the beam; "Clear results" button covered the "Period T" header; legend sat inside the plot; theory labels collided with L=2 dots; rule labels unreadable on the post; planet label unreadable on Jupiter's clouds; "+N earlier" note collided with the button.

## Cycle 2
Intent: fix the layout collisions: banner as a two-line box at the stage's top right, table header lower and 8 rows, plot top lowered and right edge pulled in, rule ticks on the right edge with bold labels on the left, planet label in a dark pill.
Seen: all fixed. New: planet pill at bottom right covered the bob at L=2; empty-graph hint overlapped the theory line after clearing; angle label crowded the string at 10°.

## Cycle 3
Intent: pill to top right, hint to the plot's top-left, angle label outside the string, hint "click the ball to let go" in a light pill.
Seen: fixed on Earth. On the Moon the angle arc, its label, the rest line and the string are dark on a dark sky.

## Cycle 4
Intent: light guide marks and string on dark skies (Moon, Jupiter).
Seen: readable. Zoom on a 16× swing shows the motion ghosts working; the faint angle arc kept during a swing reads as a stray tick mark.

## Cycle 5
Intent: draw the angle arc only while the bob is held.
Seen: clean. Stopped: satisfied.
