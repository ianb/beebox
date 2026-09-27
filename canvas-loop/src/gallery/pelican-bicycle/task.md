# Task

> Reconstructed (see `reconstructed: true` in `meta.yaml`) — the design issue
> gives the literal task idea ("pelican on a bicycle") and the honesty
> requirement, but not the full prompt text. This reconstruction follows the
> recorded description and the delivered sketch/events closely. Run in
> parallel with a fjord task on an independent Sonnet agent — see
> `../fjord-tides/`.

Draw a **pelican riding a bicycle**, as a TEA sketch. This is deliberately an
**aesthetic, not mathematically-specifiable task** — there is no closed form
for "looks like a pelican," so the feedback loop (render, look at the frame,
judge, revise) is where the real work happens, not the trig.

- The bicycle should read clearly as a bicycle (frame, two wheels,
  handlebars, pedals/crank) rolling along ground that scrolls to suggest
  motion.
- The pelican should read clearly as a pelican (large pouched bill, plump
  body, curved neck) sitting on the saddle, with its feet tracking the
  pedals as the crank revolves.
- A `speed` param scales the whole animation rate (wheel spin, crank
  revolution, ground scroll). A `pause` boolean freezes everything for clean
  inspection.
- Motion should be a pure function of `model.frame` and the params, so
  pausing/resuming needs no extra state.
- **Be honest across iterations.** After each render, look at the actual
  frames — don't just describe what you intended to draw — and report
  cycle-by-cycle what worked, what didn't, and what you changed. A
  "stranger test" will be applied afterward: would someone with no context
  looking at these frames actually see a pelican on a bicycle?
