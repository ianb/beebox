---
title: "Every page's browser title is just \"Callback Box\", so tabs and history are unidentifiable"
workstream: tab-identity
resolution: implemented
area: callback-box
labels: [ui, navigation]
filed-by: agent
discovered-by: Ian
discovered-in: main session — boxholder noticed every page shares one title
---

`index.html:14` sets `<title>Callback Box</title>`, and almost nothing changes
it. So every tab, every history entry, and every bookmark says the same thing
regardless of what is on screen.

## The mechanism exists and is used once

`src/frontend/src/hooks/useDocumentTitle.ts` already does the job — it sets
`"<title> — Callback Box"` on mount and restores the previous title on unmount.

**Exactly one of 19 page components calls it**: `pages/browse/BrowsePage.tsx:244`.
The other eighteen — dashboard, chat, chats, card view, landmarks, history,
questions, settings, admin, inventory, capture, login, setup, the dev harnesses
— inherit the static title.

So this is not "build a titling system". It is "decide what the titles should
say, and make it impossible for the next page to forget".

## Why it bites harder here than in a normal app

- **One router serves many boxes and many checkouts.** URLs are
  `/<main|worktree>/<box>/…`, so a person can easily have several tabs open on
  different boxes and different worktrees — all reading `Callback Box`. The box
  slug is arguably more valuable in the title than the page name.
- **Chat tabs are long-lived** and the thing you switch back to. A chat's own
  label already exists (`chat.label`, husk titles, the nightly chat review names
  them), so the good title is sitting right there unused.
- **Mobile/PWA.** The title is what an installed app and the iOS shell surface;
  a single generic string wastes that.

## What to decide

- **The shape.** `<page> — <box> — Callback Box` is complete but long, and
  browsers truncate tabs hard. What matters most in the first ~20 characters is
  the real question. The box slug may deserve to come first.
- **Dynamic titles.** A chat's title changes as the chat is renamed; a card page
  should presumably name the card. `useDocumentTitle` already takes a changing
  value, so this is a matter of feeding it the right one — but decide whether a
  chat with no title yet shows the id prefix, the landmark, or nothing.
- **Whether the dev harness pages need real titles**, or whether uniformity
  there is fine.

## Make it structural, not a convention

Eighteen pages forgot the hook, which is what a convention looks like when
nothing enforces it. Worth considering the router instead: **`@tanstack/react-router` v1.166 ships
`HeadContent`**, so a route can own its own head/title rather than each page
component remembering a call. That moves titling to the same place the route is
already declared, and a route with no title becomes visible in one file rather
than invisible across nineteen.

This is the third instance this month of a rule kept by discipline rather than
by structure — see the
[AGENTS.md pairing](../bugs/2026-08-22-agents-md-missing-from-claude-md-special-cases.md)
issue, which argued the same thing about filename constants. Whatever is chosen
here, the test is: *when someone adds page twenty, what makes them supply a
title?*

## Note

`useDocumentTitle` restores the *previous* title on unmount. With one caller
that is invisible; with nineteen it becomes worth checking, since a restore can
briefly reinstate a stale title during navigation, and nested callers make
"previous" ambiguous. Route-owned titles would sidestep this entirely.

## Resolved

Titles are `<page> — <box>`, page first (browsers truncate tabs to about
twenty characters) and no app name — it appears only where there is no box.
The boxholder chose that shape over box-first and over keeping a
`Callback Box` suffix, and declined a worktree/checkout marker.

Structure rather than convention: `StaticDataRouteOption` is augmented with a
required `title`, which makes TanStack Router's `staticData` mandatory on every
route — route twenty does not typecheck until it says what it is called, and a
route that names nothing says `title: null` out loud. Pages whose real name is
data they load publish it through `usePageTitle`; the route's static title
stands in until it arrives. `HeadContent` was considered and passed over: no
route here uses a loader, so a route `head()` could not see a chat's label or
the box's display name, and mixing it with a hook would have meant two writers
of `document.title`.

The save/restore this issue flagged is gone with the old hook — one writer,
recomputing from the current route.
