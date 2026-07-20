# Lightbox mobile gestures: double-tap zoom + pan, pinch, swipe-to-dismiss

Issue: `issues/features/2026-07-20-lightbox-mobile-gestures.md` (monorepo root).
Target: `src/frontend/src/components/ImageLightbox.tsx` (+ its only in-repo
mount point, `LightboxProvider.tsx` — no call-site changes needed; all work is
inside the lightbox component and new supporting modules).

Reviewed by Codex (cross-model, 2026-07-20); this version incorporates its
accepted findings. Its scope recommendation (defer pinch) is recorded under
"Open decisions" rather than adopted — the boxholder decides.

## Requirements

From the boxholder, via the issue:

1. **Double-tap to enter zoom + pan** — magnify and drag around, double-tap
   again to return to fit.
2. **Swipe up or down over the image closes it** — tracking the finger with a
   fade, snapping back below a threshold.

Plus two adjacent expectations the issue flags as arriving immediately:

3. **Pinch-to-zoom** — planned default: in scope, because anyone who
   double-tap-zooms will pinch and the transform math is shared. But it is
   where the hard mode transitions concentrate; see "Open decisions" — cutting
   it from v1 is clean if preferred.
4. **Horizontal swipe for prev/next** — deferred, but the gesture mode machine
   is structured so a `swiping-nav` mode can be added without rework (axis
   dominance classification already exists; the horizontal branch just has no
   handler in v1).

Mode-awareness is the crux: a vertical drag means **dismiss at fit scale** and
**pan when zoomed**. Dismiss is disabled entirely while zoomed — the exit is
double-tap back to fit (iOS Photos behavior; match muscle memory, don't invent).

Both up and down dismiss (as asked). We have no competing use for either
vertical direction, and down-only would make half of users' first swipe a
dead gesture.

## Library research (2026-07-20)

Criteria from the boxholder: *solid* (actually maintained), *well typed* (this
codebase bans `any` and `as`), *comprehensive in its domain* (one dep covering
the gesture space). Research method: npm/GitHub activity + issue-tracker
character, reading the **shipped `.d.ts`** of each candidate (not README
badges), and local esbuild+gzip size measurement.

| | @use-gesture/react 10.3.1 | react-zoom-pan-pinch 4.0.3 | motion 12.42.2 | hand-roll |
|---|---|---|---|---|
| Maintained | **No** — frozen since 2024-03; unanswered issues incl. iOS pinch/drag bugs | Yes — releases through 2026-04, touch fix 2026-07-11 | Yes — very active | n/a |
| Types | Good state types; `any` in memo/bind plumbing | **Excellent** — 1 internal `any` | 109 `any`s in motion-dom d.ts, some user-facing (`dragControls?: any`) | ours |
| Covers our gestures | drag/pinch state only — no double-tap, **no animation** | zoom/pinch/pan/double-tap native; **no dismiss concept**, owns the touch surface | drag/rubber-band strong; **no pinch, no double-tap** | all, by construction |
| Size (gzip) | ~7–9 KB | ~22 KB | ~28–46 KB (+ a pinch dep it lacks) | 0 |
| Verdict | fails *solid* | fails *comprehensive* (misses the primary ask) | fails *comprehensive* + types | chosen |

Detail on the two near-misses:

- **@use-gesture/react** is the canonical React gesture lib (5.6M weekly
  downloads) but has had no commit since March 2024. Its open, unanswered
  issues include duplicate pinch events on Safari (#681), flaky
  `preventDefault` during iOS drag (#685), and un-guarded `setPointerCapture`
  throws (#701) — each squarely in our path. It also ships no animation: the
  snap-back/spring layer (the part the issue says hand-rolls get wrong) would
  be hand-written anyway, or we'd add react-spring on top of a frozen dep.
- **react-zoom-pan-pinch** is well maintained and cleanly typed, and covers the
  zoomed half of the feature natively. But it has no dismiss/swipe-away
  concept, and it owns the wrapper's touch surface — the swipe-to-close (the
  thing actually asked for) would be a second, hand-coordinated touch layer
  toggled around its semi-private `isPanning`/`isPinching` state. Its issue
  tracker shows users fighting exactly this shape of compound-gesture
  extension. We would be hand-rolling the risky part anyway and coupling it to
  a black-box state machine.

**Decision: no library.** Every candidate leaves a substantial hand-written
remainder precisely where the risk is; none passes all three criteria. The
gesture logic decomposes into pure, unit-testable math plus a thin DOM layer,
and the irreducible cost — feel-tuning on a real phone — is identical in every
option. Two honest caveats (from cross-review): hand-rolling means the
maintenance burden is ours rather than absent, and a whole-component
replacement (e.g. PhotoSwipe, a complete lightbox UI) was excluded up front
because it would discard this component's deliberate a11y structure, provider
integration, and styling rather than augment them — that's a scoping choice,
not an ecosystem finding.

## Design

### New files

- `src/frontend/src/lib/lightbox-gesture-math.ts` — pure functions, no DOM:
  transform model, clamping, rubber-band, scale-about-point, axis
  classification, tap classification, velocity estimation, dismiss decision.
  Doctested in `test/` like any other pure module.
- `src/frontend/src/hooks/use-lightbox-gestures.ts` — the hook: pointer
  bookkeeping, mode machine, rAF spring, native listener attachment
  (`{ passive: false }`), style writes via refs.
- `ImageLightbox.tsx` — gains a zoom wrapper `div` around the `img`, dismiss
  transform/fade on the `figure`, and hook wiring.

### DOM/CSS sketch (what moves, what fades, what stays)

Two transform layers with distinct jobs:

- **Dismiss** transforms the whole `figure` (y-translate + opacity), so the
  image, caption, and controls move and fade together; the backdrop's own
  opacity fades in parallel via a style on the root `div`. Arrows stay put
  (they belong to the list, not the image).
- **Zoom/pan** transforms an inner wrapper `div` around the `img` only. The
  caption and controls stay in place while zoomed (v1 accepts this; hiding
  chrome while zoomed is a possible later polish).

The wrapper is NOT layout-neutral by default (a shrink-wrapped flex child
becomes a new containing block and defeats `max-w-full` on the img): the
figure's sizing constraints transfer deliberately — the wrapper gets
`max-w-full min-w-0` and the img's existing `max-w-full max-h-[…]` classes
stay on the img, with the wrapper `flex`-centered so the fitted geometry is
identical to today's. Verified visually against current rendering before any
gesture code lands.

### Transform model and coordinate system

Single `{ scale, x, y }` held in a ref (never React state — per-frame values
bypass render entirely; ref+rAF work outside render is invisible to React
Compiler analysis, though this is asserted from its documented model, not
tested against it). Applied as `transform: translate3d(x, y, 0) scale(s)` with
an explicit **`transform-origin: center`** on the wrapper, and all math done in
**container-centered coordinates**: a pointer event's `clientX/Y` is converted
via `p = client − rect(container).center` before use, where the container is
the wrapper's untransformed layout box captured at gesture start (reading
`getBoundingClientRect()` of a transformed element returns transformed
coordinates — never read it mid-gesture for math). `x`/`y` translate the
wrapper's center; `imageFitSize` is the img's laid-out (fit) size, measured
after load.

With origin, translate order, and coordinate space fixed as above, the
keep-point-fixed formula holds for both double-tap and pinch: when scale
changes s→s′ anchored at point `p` (container-centered),
`t′ = p − (p − t)·(s′/s)`.

Pan bounds per axis: `max(0, (imageFitSize·s − containerSize) / 2)`; during a
live drag the excess past a bound is compressed with the iOS damping curve
(`f(x) = (1 − 1/(x/d + 1))·d`) rather than hard-clamped, then springs back on
release. Container measured via `getBoundingClientRect()` at gesture start
(not `window.innerHeight` — iOS dynamic toolbar skew). "At fit scale" is
always an epsilon test (`scale < 1 + ε`, ε ≈ 0.01) — after pinch/spring math,
exact `=== 1` comparisons are float traps; releasing a pinch inside the
epsilon band snaps scale to exactly 1 and zeroes the translate.

### Mode machine

Implemented as a **pure reducer** — `(mode, event) → (mode, actions)` — in
`lightbox-gesture-math.ts`, so every transition below is doctestable without a
DOM. Modes: `idle`, `pending` (pointer down, not yet classified),
`dismissing`, `panning`, `pinching`, `settling`. The hook only executes the
returned actions (style writes, spring starts, close()).

Full transition table (rows omitted from earlier drafts are the ones that
bite):

| mode | event | → |
|---|---|---|
| idle | pointerdown | pending (record start; if a spring is in flight, adopt its current value and cancel it — i.e. settling→pending is the interrupt path) |
| pending | pointermove ≥ ~10px | classify by axis dominance + fit-state: vertical∧fit → dismissing; any-axis∧zoomed → panning; horizontal∧fit → idle-passthrough (reserved for future nav; v1: no-op, pointer released from tracking) |
| pending | pointerup < ~10px | tap bookkeeping (below), → idle |
| pending / panning / dismissing | second pointerdown | pinching (baseline distance/midpoint/scale; an in-progress dismiss's y-offset springs back first via an immediate settle action) |
| pinching | third pointerdown | ignored (not tracked; pinch continues on the first two) |
| pinching | one of the two tracked pointers up/cancel | panning if a tracked pointer remains (re-baseline anchor to current transform — no jump), else settling |
| pinching | untracked third pointer up | no-op |
| dismissing | pointerup | close if \|velocity\| ≥ ~0.5 px/ms or \|displacement\| ≥ ~30% viewport height, else settling (spring back, opacity restored) |
| panning | pointerup | settling (rubber-band return if out of bounds, else idle) |
| any tracked | pointercancel / lostpointercapture | treated exactly as pointerup-with-snap-back; pointer removed from the map (a missed removal is a phantom pointer that corrupts all later pinch math) |
| settling | spring done | idle (snap scale to 1 and zero translate when inside fit-epsilon) |

Double-tap: taps resolve on `pointerup` (movement < ~10px); second tap within
~300ms and ~30px of the first toggles fit ↔ ~2.5× anchored at the tap point.
Pinch ending at-or-below fit-epsilon while zoom was in flight also lands on
exact fit. Native `dblclick`/browser double-tap-zoom are suppressed
(`touch-action: none`) and unused. Single taps have no action in v1, so no
single-tap delay is needed.

### Pointer lifecycle and listeners

- `setPointerCapture` on the gesture surface at `pointerdown`, wrapped in
  try/catch (it can throw for already-departed pointers); capture failure
  degrades to uncaptured tracking. `lostpointercapture` is handled as cancel.
  Capture is what keeps a fast desktop drag delivering events after the
  cursor leaves the transformed image.
- Native listeners (not JSX props) attached in one effect with
  `{ passive: false }` where `preventDefault` must work; handlers read all
  mutable state through refs so the effect never re-subscribes per render
  (empty-ish dep list, torn down on unmount — which also cancels any rAF).
- `preventDefault` guarded by `event.cancelable`.

### Gesture-state reset contract

The hook instance survives image navigation (`LightboxProvider` swaps `index`
on the same mounted component), so transforms MUST NOT leak across images.
On any change of the displayed `src`: cancel springs, clear the pointer map,
reset `{scale:1, x:0, y:0}` and opacity, and drop tap history. Re-measure and
re-clamp on: img `load` (natural size arrives late), element resize
(ResizeObserver on the container), and `visualViewport` resize (iOS toolbar).
Failure mode being prevented: "next image opens zoomed/offscreen" — silent,
no error anywhere.

### Animation without a library

Two mechanisms, chosen per case:

- **rAF critically-damped spring** (~40 lines, velocity-carrying,
  interruptible) for dismiss snap-back and pan rubber-band return — the cases
  the user will interrupt mid-flight.
- **CSS transition** for the double-tap zoom toggle — interruption is rare and
  low-stakes there.

`prefers-reduced-motion` collapses both to instant/short transitions.

### Constraints honored (from the issue)

- **A11y structure untouched**: the backdrop stays a real `<button>`; the
  figure keeps `pointer-events-none` with `auto` restored on visible children.
  Gesture listeners attach to the zoom wrapper inside the figure — no new
  element above the arrows or controls.
- **Drag must not fire click-to-close on release** — and the suppression must
  not be a global boolean (that can eat a later keyboard activation or miss a
  delayed compatibility click). Scheme: a capture-phase `click` listener on
  the overlay root consumes exactly the click that belongs to a completed
  drag — matched by recency (same pointer sequence, within ~500ms of its
  pointerup) and only when `event.detail > 0`, so keyboard/AT activations
  (`detail === 0`) always pass through to the backdrop button.
- **Keyboard/AT paths unchanged** — all gesture code is pointer-only and
  additive. Verify visually, not just by tabbing.
- `touch-action: none` + `user-select: none` on the overlay root and wrapper;
  `preventDefault` on non-passive listeners to stop iOS body scroll/native
  zoom behind the fixed overlay.

### Pre-existing z-stack bug (found in cross-review; fix as part of this work)

The component's documented order "backdrop 0 < figure 10 < arrows 20 <
controls 30" (`ef98ae6f`) is not what CSS actually does: the figure's `z-10`
creates a stacking context, so the controls' `z-30` competes only *inside*
the figure and can never outrank the sibling arrows' `z-20`. In an overlap
(short, wide image — the exact case `ef98ae6f` targeted) an arrow paints over
the close button today. Fix: remove `z-10` from the figure (keep `relative`).
Then the figure participates at `z-auto` — above the `z-0` backdrop by
document order, its static img content below the positioned `z-20` arrows
(preserving the `ef98ae6f` wide-image fix), while the controls' `z-30` now
joins the root stacking context and genuinely sits above the arrows. Verify
all three relationships visually (wide image, overlapping controls) and
update the component comments to describe the real mechanism.

### Out of scope (v1)

- Horizontal swipe prev/next (mode machine leaves the slot).
- Inertial pan coasting after release while zoomed (release = rubber-band
  settle only). The dismiss flick reads velocity but coasting adds a second
  physics system; add later only if the boxholder misses it on-device.
- Desktop mouse-drag panning / scroll-wheel zoom (could ride the same math
  later; pointer events make it near-free but it changes desktop click
  semantics, so decide separately).

## Testing

- Doctests for every pure function in `lightbox-gesture-math.ts` — including
  the **mode reducer**, which makes transition correctness deterministic
  rather than device-only: second-pointer promotion mid-drag, pinch demotion
  on pointer loss, cancel/lost-capture as snap-back, tap/double-tap
  bookkeeping, drag-followed-by-click suppression decisions, the dismiss
  decision table, and reset-on-image-change. Hardware is needed for *feel*;
  transition logic is tested here.
- Plus the math: clamping, rubber-band curve, scale-about-point (round-trip:
  zoom in then out about the same point returns to start), fit-epsilon
  snapping.
- `pnpm typecheck` + `pnpm lint` (strict: no `any`, no `as`).
- Desktop smoke via dev router + browse skill (pointer events fire from mouse;
  drag-to-dismiss and double-click-zoom are exercisable; pinch is not), and a
  visual pass on the z-stack fix (wide image: both arrows visible, controls
  above arrow in overlap).
- **`needs: [manual-testing]` stays on the issue**: pinch feel, rubber-band
  damping, flick thresholds, and iOS Safari behavior inside the fixed overlay
  (touch-action honored, no body scroll-through, no native zoom) are only
  verifiable on hardware. The issue will record exactly what to try.

## Open decisions (boxholder)

1. **Pinch in v1?** Codex's strongest recommendation was to cut pinch (and the
   rAF spring) from v1 and ship double-tap zoom + pan + dismiss with CSS
   transitions only — pinch is where the hard transitions and device-only
   validation concentrate. The counter (this plan's default): the issue itself
   predicts pinch's absence "will read as broken" to anyone who double-taps,
   the transform math is shared, and the reducer makes the extra transitions
   testable. Both cuts are clean if wanted — pinch is additive rows in the
   reducer table.
2. **Both dismiss directions** (as asked) is the default here; down-only is
   the common-viewer convention and reserves up. No competing use for up
   exists or is planned.
3. **Whole-component replacement** (PhotoSwipe-class) was ruled out to protect
   the existing a11y/provider/z-stack work — flag if you'd rather evaluate
   that direction seriously instead.
