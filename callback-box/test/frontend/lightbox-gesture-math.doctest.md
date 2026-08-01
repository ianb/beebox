# Lightbox gesture math

Pure functions behind the image lightbox's mobile gestures (double-tap zoom +
pan, pinch, swipe-to-dismiss). No DOM — every value here is deterministic, so
the parts a phone can only *feel* are still unit-checked. Coordinates are
container-centered (a client point minus the wrapper's untransformed center).

```ts setup
import {
  clampAbs,
  clampScale,
  classifyAxis,
  dismissProgress,
  distance,
  estimateVelocity,
  isAtFit,
  isDoubleTap,
  isTap,
  midpoint,
  movedEnough,
  panBound,
  rubberBand,
  rubberBandPan,
  scaleAboutPoint,
  shouldDismiss,
  snapToFit,
  swipeStep,
  toContainerCentered,
} from "../../src/frontend/src/lib/lightbox-gesture-math.js";
import {
  clampTransformToBounds,
  computePan,
  computePinch,
  settleTarget,
} from "../../src/frontend/src/lib/lightbox-transform.js";
```

## Coordinate conversion and geometry

A client point becomes container-centered by subtracting the container center:

```ts
JSON.stringify(toContainerCentered({ x: 100, y: 200 }, { x: 60, y: 60 }))
=> {"x":40,"y":140}

distance({ x: 0, y: 0 }, { x: 3, y: 4 })
=> 5

JSON.stringify(midpoint({ x: 0, y: 0 }, { x: 10, y: 20 }))
=> {"x":5,"y":10}
```

## Scale about a point keeps that point fixed (round-trip)

Zooming in about an anchor, then back out about the same anchor, returns exactly
to the start — the identity `t' = p − (p − t)·(s'/s)` is its own inverse:

```ts
const zoomedIn = scaleAboutPoint({ scale: 1, x: 0, y: 0 }, { anchor: { x: 100, y: 0 }, nextScale: 2 });
JSON.stringify(zoomedIn)
=> {"scale":2,"x":-100,"y":0}

JSON.stringify(scaleAboutPoint(zoomedIn, { anchor: { x: 100, y: 0 }, nextScale: 1 }))
=> {"scale":1,"x":0,"y":0}
```

## Pan bounds and hard clamp

The half-range of pan is `max(0, (fitSize·scale − containerSize) / 2)` — zero
when the scaled image is no bigger than its frame, positive once it overflows:

```ts
panBound({ fitSize: 1000, scale: 1, containerSize: 1000 })
=> 0

panBound({ fitSize: 1000, scale: 2, containerSize: 1000 })
=> 500

panBound({ fitSize: 1000, scale: 0.5, containerSize: 1000 })
=> 0
```

`clampAbs` is the hard bound used for settle targets:

```ts
clampAbs(50, 100)
=> 50

clampAbs(150, 100)
=> 100

clampAbs(-150, 100)
=> -100
```

## iOS rubber-band resistance

`rubberBand(x, d)` compresses overshoot `x` against dimension `d`, asymptotic to
`d` — at `x = d` it yields exactly half:

```ts
rubberBand(0, 1000)
=> 0

rubberBand(1000, 1000)
=> 500

rubberBand(3000, 1000)
=> 750
```

A live pan passes through in-bounds and damps past the bound (so a finger can
drag past the edge with resistance, then springs back on release):

```ts
rubberBandPan(50, { bound: 100, dimension: 1000 })
=> 50

rubberBandPan(1500, { bound: 500, dimension: 1000 })
=> 1000

rubberBandPan(-1500, { bound: 500, dimension: 1000 })
=> -1000
```

## Scale clamp (live pinch band)

```ts
clampScale(2)
=> 2

clampScale(5)
=> 4

clampScale(0.5)
=> 0.85
```

## Axis, tap, and double-tap classification

Larger travel wins the axis; a tie is vertical (so an ambiguous swipe dismisses
rather than doing nothing):

```ts
classifyAxis(30, 10)
=> horizontal

classifyAxis(10, 30)
=> vertical

classifyAxis(10, 10)
=> vertical
```

Under 10px is still a tap; 10px or more classifies as a drag:

```ts
[movedEnough(3, 4), isTap(3, 4)].join(",")
=> false,true

[movedEnough(6, 8), isTap(6, 8)].join(",")
=> true,false
```

A second tap pairs only when close in both time and space:

```ts
isDoubleTap({ prev: { point: { x: 0, y: 0 }, time: 0 }, current: { point: { x: 5, y: 5 }, time: 200 } })
=> true

isDoubleTap({ prev: { point: { x: 0, y: 0 }, time: 0 }, current: { point: { x: 5, y: 5 }, time: 400 } })
=> false

isDoubleTap({ prev: { point: { x: 0, y: 0 }, time: 0 }, current: { point: { x: 40, y: 0 }, time: 100 } })
=> false
```

## Velocity uses the last samples, not the whole gesture

A slow drag that ends in a flick reads as fast: the estimate spans only the last
five samples, so the early slow segment doesn't dilute it:

```ts
const samples = [
  { point: { x: 0, y: 0 }, time: 0 },
  { point: { x: 0, y: 5 }, time: 100 },
  { point: { x: 0, y: 15 }, time: 110 },
  { point: { x: 0, y: 25 }, time: 120 },
  { point: { x: 0, y: 35 }, time: 130 },
  { point: { x: 0, y: 45 }, time: 140 },
];
JSON.stringify(estimateVelocity(samples))
=> {"x":0,"y":1}

JSON.stringify(estimateVelocity([{ point: { x: 0, y: 0 }, time: 0 }]))
=> {"x":0,"y":0}
```

## Dismiss decision table

Close on a fast flick OR a far-enough drag; otherwise spring back:

```ts
shouldDismiss({ velocityY: 0.6, displacementY: 10, viewportHeight: 800 })
=> true

shouldDismiss({ velocityY: 0.1, displacementY: 240, viewportHeight: 800 })
=> true

shouldDismiss({ velocityY: 0.1, displacementY: 100, viewportHeight: 800 })
=> false
```

A fast flick BACK toward center (velocity opposing the displacement) is a
cancel, not a close — only away-moving velocity counts:

```ts
shouldDismiss({ velocityY: -0.8, displacementY: 100, viewportHeight: 800 })
=> false

shouldDismiss({ velocityY: -0.8, displacementY: -100, viewportHeight: 800 })
=> true
```

Fade progress tracks displacement toward the fade ratio (40% of the viewport):

```ts
[dismissProgress(0, 800), dismissProgress(160, 800), dismissProgress(400, 800)].join(",")
=> 0,0.5,1
```

## Swipe decision table

Same two triggers as dismiss — a fast flick OR a quarter of the viewport —
but the answer is a direction. Dragging RIGHT pulls the previous image in from
the left, so a positive displacement steps `-1`:

```ts
swipeStep({ velocityX: -0.5, displacementX: -40, viewportWidth: 1280 })
=> 1

swipeStep({ velocityX: 0.5, displacementX: 40, viewportWidth: 1280 })
=> -1

swipeStep({ velocityX: 0.05, displacementX: -400, viewportWidth: 1280 })
=> 1
```

A slow, short drag stays put, and so does a flick back toward centre — the
same away-from-rest guard `shouldDismiss` applies, so a drag that changed its
mind is a cancel:

```ts
swipeStep({ velocityX: 0.05, displacementX: -100, viewportWidth: 1280 })
=> 0

swipeStep({ velocityX: -0.9, displacementX: 100, viewportWidth: 1280 })
=> 0
```

A commit-speed flick that never actually moved has no direction to commit to,
so it stays rather than picking one arbitrarily:

```ts
swipeStep({ velocityX: 2, displacementX: 0, viewportWidth: 1280 })
=> 0
```

A narrow viewport needs proportionally less travel — the threshold is a
fraction of the width, not a fixed distance, so the gesture feels the same on
a phone as on a desktop:

```ts
[
  swipeStep({ velocityX: 0, displacementX: -110, viewportWidth: 390 }),
  swipeStep({ velocityX: 0, displacementX: -110, viewportWidth: 1280 }),
].join(",")
=> 1,0
```

## Fit epsilon snapping

Post-float math never compares `scale === 1`; the epsilon band collapses a
near-fit transform to exact fit and leaves a genuinely zoomed one alone:

```ts
[isAtFit(1), isAtFit(1.005), isAtFit(1.5)].join(",")
=> true,true,false

JSON.stringify(snapToFit({ scale: 1.005, x: 5, y: 5 }))
=> {"scale":1,"x":0,"y":0}

JSON.stringify(snapToFit({ scale: 2, x: 5, y: 5 }))
=> {"scale":2,"x":5,"y":5}
```

## Transform composition (pan, pinch, settle)

Bounds are computed against a `Frame` — the image's fit size plus the overlay
viewport (`container`). Live pan is the base translate plus the finger delta,
rubber-banded at the edge:

```ts
const frame = { fit: { width: 1000, height: 1000 }, container: { width: 1000, height: 1000 } };
JSON.stringify(computePan({ base: { transform: { scale: 2, x: 0, y: 0 }, pointerStart: { x: 0, y: 0 } }, pointer: { x: 50, y: 0 }, frame }))
=> {"scale":2,"x":50,"y":0}

JSON.stringify(computePan({ base: { transform: { scale: 2, x: 0, y: 0 }, pointerStart: { x: 0, y: 0 } }, pointer: { x: 1500, y: 0 }, frame }))
=> {"scale":2,"x":1000,"y":0}
```

An axis whose scaled size still fits the viewport has no pan range at all — a
wide image zoomed 1.5× (scaled height 600 < viewport 800) stays vertically
centered rather than sliding off-center, while its overflowing width pans:

```ts
const wideFrame = { fit: { width: 1000, height: 400 }, container: { width: 800, height: 800 } };
JSON.stringify(clampTransformToBounds({ scale: 1.5, x: 999, y: 999 }, wideFrame))
=> {"scale":1.5,"x":350,"y":0}
```

Live pinch scales about the baseline midpoint by the finger-distance ratio, then
follows the midpoint drift so two fingers also pan:

```ts
const base = { distance: 100, midpoint: { x: 0, y: 0 }, transform: { scale: 1, x: 0, y: 0 } };
JSON.stringify(computePinch({ base, pointers: [{ x: -100, y: 0 }, { x: 100, y: 0 }] }))
=> {"scale":2,"x":0,"y":0}

JSON.stringify(computePinch({ base, pointers: [{ x: -90, y: 0 }, { x: 110, y: 0 }] }))
=> {"scale":2,"x":10,"y":0}
```

Settle snaps to exact fit inside the epsilon, else clamps translate into bounds
at the current scale:

```ts
const frame2 = { fit: { width: 1000, height: 1000 }, container: { width: 1000, height: 1000 } };
JSON.stringify(clampTransformToBounds({ scale: 2, x: 600, y: 0 }, frame2))
=> {"scale":2,"x":500,"y":0}

JSON.stringify(settleTarget({ scale: 1.005, x: 5, y: 5 }, frame2))
=> {"scale":1,"x":0,"y":0}

JSON.stringify(settleTarget({ scale: 2, x: 600, y: 0 }, frame2))
=> {"scale":2,"x":500,"y":0}
```
