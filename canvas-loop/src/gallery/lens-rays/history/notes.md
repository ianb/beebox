# lens-rays: cycle notes

## Cycle 1
Intent: first full layout. Header with the lens select and the focal-length field placed by `v.control`; a white diagram box on a faint 5 cm grid (lens at x=520, axis at y=250, 7 px/cm fixed); F, F′, 2F, 2F′ marks; draggable object (shaft = move, tip = move + height); three coloured principal rays with direction chevrons, dashed back-extensions to a virtual image; u / v dimension lines; three cards below (measurements, thin-lens equation drawn with stacked fractions, image character chips + the textbook case sentence). Script: drag through 2F, to 15 cm, onto F, inside F, raise the tip, back to 30 cm, type f = 20 and 15, switch to diverging, f = 5, back to converging.
Seen: the structure reads like a textbook figure; physics and numbers check out (u=25, f=10 → v=16.7, m=−0.67; u=6 → v=−15, m=2.5; object at F → "NO IMAGE", rays parallel). Faults: the ◀ ▶ grip glyphs render as empty boxes; ray chevrons and rays cover the F′ / 2F′ labels; the tip handle hides the arrowhead; the u label collides with the lens bottom when u is short; the object label sits in the dashed lines in the virtual case; at f=20 the "off the diagram" note runs off the right edge and the image (at the edge) is not drawn; legend wording for the missing ray 3 is odd.

## Cycle 2
Intent: `tag()` helper (text on a white backing) for every diagram label; grip arrows drawn as triangles; tip handle as an outline ring; lens shorter (140) so the dimension lines (now y 404 / 424) clear it; short dimension puts its label outside; foci labels drawn after the rays and moved above the axis when an inverted image arrow is there; "the rays leave parallel: they never meet" note when the object is on F.
Seen: labels readable; the at-F frame now says what is happening in the picture. Still: object label crosses the dashed construction lines near the lens; the off-diagram note covers the meeting point of the rays; at f=5 the image label lands on the axis among F labels.

## Cycle 3
Intent: object label under the grip (below the axis on the object's side, where no real image can be); image drawn up to 2 px from the box edge; off-diagram note offset from the meeting point; short images get their label above / below the tip.
Seen: virtual case clean. f=20, u=30: the image arrow now shows at the right edge but its label is off-canvas (placed on the side away from the lens).

## Cycle 4
Intent: put the image label on the lens side when there is no room on the far side.
Seen: f=20 label fits. Tip drag (frame 210): the yellow hover fill sits over the arrowhead and the ray starts. f=5 converging: short-image label placed above the tip, which is on the axis, covering F′.

## Cycle 5
Intent: tip ring drawn under the arrow; short-image label on the far side of the tip from the axis.
Seen: tip drag reads well. f=5: label now below the tip but on the 2F′ label row.

## Cycle 6
Intent: short-image label pushed clear of the F/2F label row; first `--zoom` on the lens region.
Seen: zoom at 2× confirms f=5 converging and diverging are crowded but each label is legible. Lint clean; typecheck found three errors (a `none` boolean does not narrow the `Image` union) — fixed by narrowing to `img`.

## Cycle 7
Intent: no visual change; confirmation render with `--timing` after the typecheck fix.
Seen: frames byte-identical to cycle 6. Draw avg 2.1 ms. In a 4× crop of frame 0, the white backings of the F′ and 2F′ labels cut a gap in ray 3 where it passes just below the axis: a label must never hide a ray.

## Cycle 8
Intent: draw F labels and the image label before the rays, so rays pass over the label backings.
Seen: rays unbroken in all frames. Ray chevrons still land on F′ labels (frame 0, orange) and under the image arrow.

## Cycle 9
Intent: chevrons placed at the segment middle, or the nearest of a few positions that is not on an F / 2F label near the axis.
Seen: frame 0 lost visible chevrons on rays 1 and 3: every candidate on the short outgoing span was near F′ or under the image arrow, so the fallback put them there.

## Cycle 10
Intent: image x added to the avoid list, more candidate positions, longer span for outgoing rays.
Seen: every ray shows a direction chevron clear of labels and the image in all scripted frames (2F, F, inside F, diverging, f=5). Lint and typecheck clean. Remaining weaknesses: at f=5 the figure is small near the lens (fixed 7 px/cm); rays cross label text (by design now). Stopped: satisfied.
