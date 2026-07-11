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
