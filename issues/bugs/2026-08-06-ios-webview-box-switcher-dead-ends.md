---
title: "iOS: switching boxes via the web-view boxes menu dead-ends on a stuck screen — box-switching should be native-only"
area: callback-box
filed-by: agent
discovered-in: main session — boxholder on iOS
---

> **Job to be done:** *When I'm in a box on my phone and I see the boxes menu, I
> expect it to just show me where I am — not offer to jump to another box and drop
> me on a screen I can't back out of. Changing boxes is something I do from the
> app's + menu; the web view shouldn't pretend it can do it too.*

On the iOS native app, using the **web-view boxes menu to switch to another box**
takes the user to a **weird stuck screen with no way out**. The native shell is a
single `WKWebView` paired/scoped to one box; navigating it to a *different* box's URL
lands somewhere the native shell can't handle (no pairing for that box, no back),
so it dead-ends.

**On iOS the only supported way to change boxes is the native "+" menu in the app** —
not the web view. So the web box-switcher should be **suppressed in the native
shell**: still *show* the current box, but don't offer to *switch* boxes from the
web UI.

## Where

- The web box-switcher / box list: `components/AppNav.tsx` (uses `hooks/useBoxes.ts`,
  shows the box name — check whether it's a switchable menu), `pages/BoxSelection.tsx`
  + `components/BoxSelectionTiles.tsx` (lists boxes to pick from), and any box-picker
  in `components/PlacePill-panels.tsx`. Pinpoint which surface the iOS tap actually
  hits.
- Native-shell detection already exists — `components/chat/use-native-bridge.ts` /
  the native flag used across `native-post.ts`, `ChatPage.tsx`, etc. Reuse it; don't
  invent a new detector.

## Fix

When running in the iOS native shell, **hide or disable the box-switching
affordance** (the boxes menu / box tiles / any nav that would take the web view to
another box's URL) — the current box still displays, but there's no in-web-view path
to a different box. Keep web (non-native) behavior unchanged: box-switching in a
browser is fine.

Consider also making the dead-end non-fatal as defense in depth (if a box-URL nav
does happen in the native shell, route it back / to the native + flow rather than a
stuck screen) — but the primary fix is not offering the switch at all.

## Related

- `docs/mobile-contract.md` / cb-ios-overlap — web/iOS shared surface; the gate is a
  native-shell conditional in the web UI.
