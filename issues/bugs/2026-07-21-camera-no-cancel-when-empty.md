---
title: "Camera capture traps you — Cancel is disabled until you've captured something"
area: callback-box
filed-by: agent
discovered-in: main session — boxholder opened the camera and couldn't get out
needs: [manual-testing]
---

Opening the camera capture overlay with nothing captured yet leaves **no way
out**. You've entered a full-screen camera mode and every exit is unavailable
until you take a photo or record.

## Cause

The Cancel button is the only exit from the capture overlay, and it's disabled
when the session has no content — `CaptureControls.tsx:42`:

```tsx
<button onClick={props.onCancel}
  disabled={!props.sessionId || props.finalizing || !props.hasContent}
  aria-label="Cancel capture session" ... disabled:opacity-30 ...>
```

`hasContent` is `photoTotal > 0 || audioTotal > 0 || fileTotal > 0`
(`CaptureOverlay.tsx`). So on a fresh camera — before the first capture —
`!hasContent` is true, Cancel renders at 30% opacity and does nothing.

The intent was presumably "Cancel = *discard* captured content, so there's
nothing to discard when empty." But Cancel is doing double duty as both *discard*
and *leave*, and only the discard case has a reason to be gated. Leaving should
always be available.

Confirmed there is no alternative exit: `CaptureShell` / `StatusBar` render no
close/back control, and no Escape handler is wired (`grep` for
`onExit`/`Escape`/`CloseButton` across `components/capture/` finds nothing but
the disabled Cancel). So an empty session is a genuine dead end — the same class
as the recently-closed [mobile media view trap](../closed/bugs/2026-07-17-mobile-media-view-no-back.md).

## Fixed in `d67084f1` — awaiting phone confirmation

Dropped `hasContent` and `sessionId` from the Cancel button's `disabled` gate
(`CaptureControls.tsx`), leaving only `finalizing`. `handleCancel` already
no-ops the discard on an empty session and calls `onExit`, so exit works with
nothing captured; the aria-label now reads "Exit capture" when empty vs
"Discard and exit" when there's content. Typecheck + lint pass; not visually
verified.

## Fix direction (as filed)

Separate *leave* from *discard*. The exit control should always be enabled; only
its *behavior* is conditional:

- empty session → just exit (call `onExit`/`handleCancel`, nothing to throw away);
- session with content → exit, discarding — ideally with a confirm, since that's
  now a destructive action rather than a no-op.

Simplest version: drop `!props.hasContent` from the `disabled` expression so
Cancel is always live, and let `handleCancel` no-op the discard when empty. If a
confirm-on-discard is wanted, gate the confirm on `hasContent`, not the button.

Whatever the shape, an empty capture session must be leaveable in one tap.

## Manual testing

On a phone: open the camera with nothing captured → confirm Cancel (or whatever
exit lands) is tappable and returns you to chat. Then capture a photo → confirm
Cancel still exits and discards (with a confirm if one is added). Check that
mid-recording and mid-upload states still exit sanely.
