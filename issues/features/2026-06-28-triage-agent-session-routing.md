---
title: "triage agent session routing"
workstream: unknown
needs: [design]
area: beebox
---

An incoming message doesn't always belong in a fresh chat — often it's a
follow-up to an ongoing conversation, or a memo that some *existing* session is
already the right home for. Today a new message starts a new session (or lands
wherever the entry point hardcodes); nothing decides *where it should go*.

The idea: a lightweight **triage agent** sits in front, deciding the
destination. Probably its own intake endpoint — more "memo"-shaped than "chat"
(fire-and-forget capture, not a live two-pane session). The message hits the
triage endpoint, which spins up a short triage session seeded with instructions
on how to route, plus a **`switch-to-session` tool**. The triage agent either:

- decides this really is new → let it become/continue a session here; or
- recognizes it belongs to an existing session → calls `switch-to-session`,
  and the original message is **re-dispatched to that session** as if it had
  arrived there in the first place. The triage session itself is throwaway.

So the routing logic is the *re-send*: triage doesn't answer the message, it
just figures out the destination and replays the message into it.

Open questions (don't design here):
- **Target universe.** Just open web-chat sessions? Telegram threads too
  (there's already a thread→session registry — `chat-reactor-sessions.ts`)?
  Non-chat destinations (a job, a procedure, the inbox)?
- **What triage knows.** It needs a catalog of candidate sessions with enough
  summary to route — recent sessions + their topic/companion-card, the way the
  retro walker already enumerates sessions. How fresh, how much detail.
- **Endpoint shape.** Independent "memo" endpoint vs. intercepting the first
  message of any new session. The user leaned memo-like/independent.
- **Cost & latency.** Every routed message pays a triage agent turn before the
  real session even sees it — fine for async memo capture, a problem if it sits
  in the interactive send path. Suggests this is for the async/intake lane, not
  live chat.
- **Re-dispatch mechanics.** How a message is "sent again" into an existing
  session programmatically (the send path currently assumes a user/UI origin —
  see the `/chat/send` POST and the session registry), and what trace the
  triage hop leaves (none? a routing note?).
- **Failure mode.** Mis-routes are recoverable but annoying; the bias should be
  "when unsure, start fresh" rather than guess into the wrong conversation.
