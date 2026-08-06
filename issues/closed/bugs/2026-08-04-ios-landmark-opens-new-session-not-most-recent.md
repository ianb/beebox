---
title: "iOS: selecting a landmark starts a NEW chat instead of resuming the landmark's most-recent session"
area: callback-box
resolution: implemented
filed-by: agent
discovered-in: main session — boxholder on iOS
---

> **Fixed + confirmed on device 2026-08-06.** `f8ecf363` — an explicit
> assignment handshake so `ChatPage` only carries the fresh-chat machine forward
> when the announced id matches; a landmark selection now remounts and loads the
> resumed session's history. Boxholder confirmed on iPhone.

> **Job to be done:** *When I tap a landmark on my phone to pick up where I left
> off, I want to land in the chat I was already having about that place, so I
> continue the thread — not start from scratch and lose the context I built up.*

On iOS, selecting a landmark **creates a new chat session** rather than opening the
**most-recent** session already bound to that landmark's directory. On web it
resumes correctly.

## The web mechanism (works)

`useOpenLandmarkChat` (`src/frontend/src/hooks/useOpenLandmarkChat.ts`) is
resume-or-start:

- fetch `chat.lastSessionForDirectory({ contextDir: dir })`
  (`src/webapp/trpc/routers/chat.ts:87`, backed by `getLastSessionForDirectory`,
  `src/core/chat/session/history.ts:253`);
- if it returns a `sessionId`, navigate to `…/chat?session=<sessionId>` (RESUME);
- if it returns null, navigate to `…/chat?session=new&contextDir=<dir>` (NEW).

So the resume-vs-new decision hinges on that lookup and the `?session=` URL param.

## Diagnosis and fix (2026-08-05)

There is no native landmark picker. The iOS tap uses the web `PlacePill` and
`useOpenLandmarkChat`. The lookup returns the existing session id. `ChatWebView`
allows the same-origin navigation and does not replace its query parameters.

The failure was in `ChatPage`. It used the URL shape alone to identify a new
chat's server-id assignment. Every `session=new` to `session=<id>` transition
kept the fresh chat machine mounted. A landmark selection from a fresh chat has
the same URL shape, so `ChatPage` carried the blank machine onto the selected
existing id instead of remounting and loading its history. Starting from an
already-resolved web chat did remount, which explains the apparent web/iOS split.

Commit `f8ecf363` adds an explicit assignment handshake. The live chat announces
the backend-assigned id before it rewrites the fresh-chat URL. `ChatPage` carries
the machine only when the announced id matches. An ordinary landmark or session
navigation now remounts and loads history.

Automated evidence:

- `test/frontend/chat-session-transition.doctest.md` covers assignment, landmark
  navigation, stale announcements, and ordinary session switches.
- A mobile-width browser probe started at `session=new`, selected a landmark with
  a seeded prior transcript, reached that transcript's UUID, and rendered both
  prior messages.

This changes internal React state coordination only. It does not change the
web/iOS URL or bridge contract.

## Related

- `docs/mobile-contract.md` / cb-ios-overlap — this is a web/iOS parity gap on a
  shared surface; the fix should keep the native path using the web's
  resume-or-start contract, not a divergent one.
- `docs/landmarks.md` — the landmark↔session association model.
