# What a pointer does when it is clicked

`performControlAction` is the dispatch behind a `control:` link: given the element
its address resolved to, it points at it, focuses it, or opens it. It is written
against `ControlTarget` — the four things an action needs from an element —
rather than `HTMLElement`, so it runs here under plain Node with a fake target
that records what was called. `ControlPointer` supplies the live-element
implementation; `ring.ts` holds the geometry the overlay is drawn from.

```ts setup
import { performControlAction, REVEAL_NOT_OPTED_IN } from "../../../../src/frontend/src/lib/ui-scan/actions.js";
import { ringBox, isRectInViewport, RING_PADDING } from "../../../../src/frontend/src/lib/ui-scan/ring.js";
import type { ControlAction } from "../../../../src/frontend/src/lib/ui-scan/types.js";

/** A target that records the calls instead of driving a browser. */
function fakeTarget({ revealable, inView }: { revealable: boolean; inView: boolean }) {
  const calls: string[] = [];
  return {
    calls,
    target: {
      revealable,
      inView,
      scrollIntoView: () => calls.push("scrollIntoView"),
      focus: () => calls.push("focus"),
      click: () => calls.push("click"),
    },
  };
}

/** One line: what was called, then what the outcome reported. */
function run(action: ControlAction, options: { revealable: boolean; inView: boolean }): string {
  const { calls, target } = fakeTarget(options);
  const outcome = performControlAction(action, target);
  const flags = [
    outcome.scrolled ? "scrolled" : "",
    outcome.focused ? "focused" : "",
    outcome.revealed ? "revealed" : "",
  ].filter((flag) => flag !== "");
  const degraded = outcome.degraded === null ? "" : ` (degraded: ${outcome.degraded})`;
  return `${calls.join(",") || "-"} → ${flags.join(",") || "-"}${degraded}`;
}
```

## Every action points first

A control already fully in the viewport is not scrolled; one that is off screen —
or half off the bottom edge — is scrolled to before anything else happens, so the
ring the caller draws always lands on something the user can see.

```ts
run("point", { revealable: false, inView: true })
=> - → -

run("point", { revealable: false, inView: false })
=> scrollIntoView → scrolled
```

`focus` is `point` plus the browser's own focus, which is the only state it
changes:

```ts
run("focus", { revealable: false, inView: false })
=> scrollIntoView,focus → scrolled,focused
```

## `reveal` clicks only what the author opted in

`reveal` is the one action that dispatches a synthetic click, so it is the only
place the "reveal it, don't do it for them" line can be crossed. It requires the
explicit `data-cb-reveal` opt-in — never an inference from markup, since
`role="tab"` and friends fire real state changes in this app.

```ts
run("reveal", { revealable: true, inView: true })
=> click → revealed
```

Without the opt-in the control is *never* clicked. The pointer degrades to
`point` and says why, which the component puts in its tooltip — degraded in the
open, not silently inert:

```ts
run("reveal", { revealable: false, inView: true })
=> - → - (degraded: this control is not marked as a disclosure control, so it was pointed at rather than opened)

REVEAL_NOT_OPTED_IN
=> this control is not marked as a disclosure control, so it was pointed at rather than opened
```

## Ring geometry

The ring sits *outside* the target's border box, inflated by `RING_PADDING` on
every side, so it never covers the control it points at:

```ts
JSON.stringify(ringBox({ top: 100, left: 40, width: 32, height: 32 }, RING_PADDING))
=> {"top":96,"left":36,"width":40,"height":40}
```

A degenerate box — a zero-height inline control — still yields a visible ring
rather than collapsing to nothing:

```ts
JSON.stringify(ringBox({ top: 10, left: 10, width: 0, height: 0 }, 4))
=> {"top":6,"left":6,"width":8,"height":8}
```

"In view" means *fully* in view: a control half off the bottom edge is one the
user cannot properly see, which is exactly the case `point` scrolls for.

```ts
const viewport = { width: 1024, height: 768 };
JSON.stringify([
  isRectInViewport({ top: 100, left: 40, width: 32, height: 32 }, viewport),
  isRectInViewport({ top: 750, left: 40, width: 32, height: 32 }, viewport),
  isRectInViewport({ top: -20, left: 40, width: 32, height: 32 }, viewport),
  isRectInViewport({ top: 100, left: 1000, width: 32, height: 32 }, viewport),
])
=> [true,false,false,false]
```
