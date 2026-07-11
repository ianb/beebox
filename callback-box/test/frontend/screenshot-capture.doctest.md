# Screenshot capture — outcome mapping

`captureTabScreenshot` (src/frontend/src/components/chat/screenshot-capture.ts)
resolves an enumerable `CaptureOutcome` rather than throwing — every degraded
path is named so callers (the composer "Send screenshot…" item, and later the
`cb chat screenshot` consent popup) branch honestly. The DOM-heavy grab itself
(getDisplayMedia → hidden `<video>` → canvas → PNG) can't run under the Node
doctest tier, but the two pure decision points can: the getDisplayMedia
rejection mapping and the feature-detect.

```ts setup
import {
  classifyGetDisplayMediaError,
  isFrameDecoded,
  isScreenshotSupported,
} from "../../src/frontend/src/components/chat/screenshot-capture.js";

// getDisplayMedia rejects with a DOMException-shaped error; the classifier keys
// on `error.name`, so a plain Error with the name set stands in for it.
function named(name, message) {
  const e = new Error(message);
  e.name = name;
  return e;
}
```

## A dismissed picker maps to `declined`

The browser rejects with `NotAllowedError` both when the user cancels the
picker and when permission is denied — either way it's the user's deliberate
"no", handled silently by callers.

```ts
JSON.stringify(classifyGetDisplayMediaError(named("NotAllowedError", "Permission denied")))
=> {"kind":"declined"}
```

## Any other rejection is a real `error` carrying the message

```ts
JSON.stringify(classifyGetDisplayMediaError(named("NotFoundError", "no capture source")))
=> {"kind":"error","message":"no capture source"}
```

A non-Error rejection still yields a usable message rather than `[object Object]`
losing the detail.

```ts
JSON.stringify(classifyGetDisplayMediaError("stream unavailable"))
=> {"kind":"error","message":"stream unavailable"}
```

## Feature-detect is false without a mediaDevices API

Under Node (no `navigator.mediaDevices`) the menu item is hidden — the same
result mobile Safari and insecure contexts produce.

```ts
isScreenshotSupported()
=> false
```

## Frame-readiness is only true for a decoded, non-zero frame

`isFrameDecoded` is the predicate the frame-wait loop polls. A decoded frame
needs `readyState >= HAVE_CURRENT_DATA` **and** real dimensions — an undecoded or
zero-sized first frame is not ready, so we never draw a blank PNG.

```ts
const frame = (readyState, videoWidth, videoHeight) => ({ readyState, videoWidth, videoHeight, HAVE_CURRENT_DATA: 2 });

isFrameDecoded(frame(2, 1920, 1080))
=> true

isFrameDecoded(frame(0, 1920, 1080))
=> false

isFrameDecoded(frame(4, 0, 0))
=> false

isFrameDecoded(frame(2, 1920, 0))
=> false
```

## Manual-verify boundary: frame-wait cancellation

The leak fix — a timed-out capture aborting its pending
`requestAnimationFrame`/`requestVideoFrameCallback` and detaching the `<video>`
on every exit path — is DOM/timing behavior that can't run under the Node tier.
It's verified by driving Track A in a real browser (a stream that never decodes
must not leave a rAF loop spinning). The pure `isFrameDecoded` seam above is what
that loop consults.
