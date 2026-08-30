---
title: "iOS: 'open in a new tab' does nothing — needs in-place nav (+ back) or the overlay"
workstream: unknown
area: beebox
filed-by: agent
discovered-in: main session — boxholder hit it trying to focus a card on iOS
resolution: implemented
---

> **Fixed + confirmed on device 2026-08-06.** `ChatWebView.swift` now
> implements the WebKit new-window boundary (`createWebViewWith`, `targetFrame ==
> nil` detection): same-origin loads in place, cross-origin/non-web go to
> `UIApplication.shared.open`. Boxholder confirmed.

## Implemented 2026-07-21

The native wrapper now handles WebKit new-window requests at one boundary:

- same-origin links load in the existing `WKWebView`, preserving its history and
  existing edge-swipe back gesture;
- cross-origin and non-web links go to the system URL handler instead of taking
  the box WebView away from the app;
- no individual web affordances need native-shell detection or special cases.

Automated coverage exercises the same-origin, cross-origin, and non-web routing
decisions and their side effects. The full iOS test suite and a signing-free
simulator build pass.

Manual verification remains: in the native app, try an internal “Open as full
page” / “Open in browse view” link and confirm it replaces the current view and
edge-swipe returns; then try an external Markdown/source link and confirm it
opens outside the app. The separate mobile “expand the tab” layout idea below
is not part of this bug fix.

On iOS (the native `WKWebView` wrapper) you can't open things in a new tab — e.g.
tapping "open as full page" to focus a card does nothing. The web app leans on
`target="_blank"` / `window.open` for these, and **a plain `WKWebView` silently
drops both** (it won't create a new window/tab unless the app implements
`webView(_:createWebViewWith:...)`, which `ios-app/.../ChatWebView.swift` does
not). So the affordance is dead — worse than a broken link, since there's no
feedback at all.

The boxholder's read, and the open design question:

> Will need to be navigating instead, but also then calls for a back button, not
> sure what to do.

## Where the new-tab affordances are

All silently inert on iOS:

- `components/FileView.tsx:266` — "Open in browse view (new tab)".
- `components/ui/FileEntry.tsx:139` — "Open as full page (new tab)".
- `components/ImageLightbox.tsx:147` — "Open full size in new tab".
- `components/ui/ExternalIconLink.tsx` and `components/Markdown.tsx:129` — any
  `target="_blank"` link.
- `components/CommentaryView.tsx` / `WebpageView.tsx` — `window.open(...)` for the
  frozen-snapshot text fragment.

## Two different cases, don't conflate them

The fix differs by link destination:

1. **Internal "focus this card/view in a new tab"** (FileView browse, FileEntry
   full-page). This wants to stay *in* the app. Options: navigate in-place (needs
   a back affordance — see below), or open it in the existing dismissible
   **`ViewOverlay`** (below), which sidesteps back entirely.
2. **Genuinely external links** (a source page, a frozen snapshot on another
   origin, an external URL in markdown). These should open in the **system
   browser** (`SFSafariViewController` / open-URL), not navigate the app's
   WebView away and not silently die. This is a native-wrapper capability the
   web app can't fix alone — the WebView's navigation delegate
   (`decidePolicyFor navigationAction`, `ChatWebView.swift:222`) should catch a
   `_blank` / external navigation and hand it to Safari.

## The strong option: reuse the overlay, avoid the back problem

The codebase already solved a very similar trap. Following a media link used to
full-page-navigate and strand you with no way back; it was fixed
([mobile media view trap](2026-07-17-mobile-media-view-no-back.md),
commit 59a0d3ea) by opening the file in a global **`ViewOverlay`** — a dismissible
sheet over the current context with its own ✕/Escape/backdrop, *chrome-independent*
so it works identically in a tab, a PWA, and the iOS wrapper. `useViewNavigate`
already routes through it (`hooks/useViewNavigate.ts`).

So for the internal "focus a card" case, the cleanest answer may be **don't
navigate at all** — route these affordances through `ViewOverlay` on iOS (and
arguably everywhere), the way file/media links already go. Then there's nothing
to go back *from*, which is exactly why that fix worked. That likely beats adding
in-place nav plus a bespoke back button.

## If in-place nav is chosen anyway — the back affordance

The full-screen iOS WebView has no browser chrome and no back gesture wired. If
"focus a card" becomes an in-place navigation, it needs a back control that works
in the wrapper: either the web app renders an in-app back button when running in
the native shell, or the wrapper adds an edge-swipe/`allowsBackForwardNavigationGestures`
+ a nav bar. Note the app must *push history* for browser-back to have anything
to return to. This is the harder path and reintroduces exactly the
strand-the-user risk the overlay avoids.

## Related want: a mobile "expand the tab" focus mode

Boxholder, same session:

> There should be a way on mobile to expand more of the tab, leaving just input
> and the callouts as feedback.

This is a third answer to "focus a card on mobile," and arguably the best-fitting
one: instead of a new tab (impossible), a full navigation (needs back), or a modal
overlay (covers the chat), let the companion card **grow to take most of the
screen** while the chat collapses to just the **composer input + callouts** — the
minimal feedback surface. You keep reading/working the card at near-full size and
can still talk to the agent, and the agent's responses surface as callouts rather
than a full transcript.

Why it fits: on mobile the chat and companion pane already compete for one narrow
screen (they can't sit side by side like desktop). A resize/expand affordance
(drag handle, or an expand toggle) that biases the split toward the card — down to
"card + composer + callouts only" — is a more honest mobile layout than either
pane fully winning. It also preserves the chat loop the overlay/nav options
interrupt: you're focused on the card *and* still in the conversation.

Design notes:
- It's a **layout state**, not navigation — no back-button problem, nothing to
  strand. Probably a sizing mode on the mobile chat/companion split, persisted
  per session.
- "Callouts as feedback" implies the collapsed chat still surfaces `{% callout %}`
  / ack-style signals inline near the composer, so the user isn't blind to what
  the agent did while the transcript is hidden. Confirm what the minimal
  feedback set is.
- Interacts with the composer's own mobile behavior (the recently-fixed
  grow-on-scroll bug, the native iOS composer) — the expanded mode must not
  reintroduce the composer eating the screen.

This may be the primary mobile answer, with the overlay/external-link fixes above
handling the cases it doesn't (external links, quick peeks).

## Open questions

- Is the native shell detectable client-side so the web app can swap `_blank`
  affordances for overlay/in-place on iOS while keeping new-tab on desktop? (A
  capability flag or a UA marker.)
- Does the ViewOverlay cover *every* current new-tab target (browse view,
  full-size image, full-page file), or are some not overlay-able and genuinely
  need nav?
- External links → `SFSafariViewController` is a native-wrapper change; scope it
  with the Android companion's equivalent in mind (custom tabs) so both platforms
  handle external links the same way.

Pairs with the broader mobile-nav surface and the iOS companion work.
