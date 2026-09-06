---
title: "The agent should know which client the user is on and whether the Clerk extension is installed"
workstream: launch-docs
needs: [design]
area: beebox
labels: [soft-launch]
filed-by: agent
discovered-by: Ian
discovered-in: worktree-launch-docs — planning the "what could you do with your box" starter doc
---

Boxholder (2026-09-05): the agent should have a command to detect whether the
browser extension (Bee Box Clerk) is installed, and generally should know
whether the user is currently on the iOS app or the web. Some of this may
already exist.

Why it matters for the starter docs: an offer like "save pages from your
browser with your comments attached" or "photograph things from your phone"
is only a good offer if the agent can tell whether the user has the extension
or the app. Without that it either recommends something the user cannot do
yet, or has to ask.

What exists today:

- **Client kind is partly known.** Every chat turn carries a read-only
  `<chat-app channel="…">` attribute (`src/core/chat/features.ts`
  `composeChatAppSnapshot`; vocabulary in `src/shared/chat-channel.ts`:
  `web-desktop`, `web-mobile`, `ios-native`, plus `telegram` server-side).
  The value is declared by the client or classified from the User-Agent
  (`src/webapp/routes/chat-helpers.ts` `resolveChannel`). So "am I talking to
  someone on iOS right now" is answerable in chat; whether the agent guide
  tells the agent to use it for this purpose is a separate question. Outside
  chat (a wakeup, a procedure) there is no current client.
- **Whether the iOS app is paired at all** is knowable from the device store
  (`src/core/mobile/pairing.ts`), but no `bbx` command or guide text exposes
  "this box has a paired phone" to the agent.
- **The Clerk extension has no presence signal.** It talks to the box through
  the `clerk` tRPC router (`src/webapp/trpc/routers/clerk.ts`: destinations
  query, commentary and tab-arrangement mutations). Nothing records that the
  extension has ever connected, and nothing lets the agent ask. The only
  evidence today is indirect: `*.webpage.card` files with `captured`
  frontmatter exist in the box.

To settle:

- What the signal is for the extension: a last-seen stamp written when the
  extension calls any clerk procedure (a small `_bookkeeping/` file, like the
  connector state files), versus inferring from webpage cards. A stamp answers
  "installed and connected" honestly; inference answers "has been used".
- The agent-facing surface: a `bbx` command (`bbx clients`?) that reports
  paired phones, extension last-seen, and Telegram configured, or a line in
  the `<chat-app>` snapshot, or a health/status line the agent reads. The
  snapshot is per turn and cheap; a command works outside chat too.
- Guide text: a sentence in the agent guide telling the agent to check before
  recommending a surface the user may not have.
