---
title: "iOS: selecting a landmark starts a NEW chat instead of resuming the landmark's most-recent session"
area: callback-box
filed-by: agent
discovered-in: main session — boxholder on iOS
---

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

## Why iOS lands on "new" — to investigate

There is no landmark code in `ios-app/` (grep), so the landmark UI runs in the
WKWebView — yet iOS ends up on the `session=new` branch. Candidates:

- A **native landmark surface / entry** (or a mobile-web variant of the landmark
  list) that builds the chat URL directly and hardcodes `session=new` instead of
  calling `useOpenLandmarkChat` / `lastSessionForDirectory`.
- The **native chat-URL construction** (`ChatWebView` `authenticatedChatURL`, or a
  deep link) **dropping/overriding the `?session=<id>`** param so the webview loads
  a fresh session.
- `lastSessionForDirectory` returning null on the mobile path (less likely — same
  backend — but worth confirming it's actually queried on iOS).

First step is to determine which surface the iOS landmark tap goes through and
where `?session=<id>` is lost, then route iOS landmark selection through the same
resume-most-recent logic the web uses.

## Related

- `docs/mobile-contract.md` / cb-ios-overlap — this is a web/iOS parity gap on a
  shared surface; the fix should keep the native path using the web's
  resume-or-start contract, not a divergent one.
- `docs/landmarks.md` — the landmark↔session association model.
