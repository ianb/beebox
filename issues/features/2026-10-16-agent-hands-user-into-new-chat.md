---
title: "A box agent can hand the person into a new chat (maybe a new landmark), opened with a message from that agent"
workstream: unattached
needs: [design]
area: beebox
labels: [chat, landmarks]
filed-by: agent
discovered-by: Ian
discovered-in: main session — 2026-10-16
---

## What the boxholder asked for

> there should be a tool call that launches the user into a new session, maybe
> a new landmark, with an initial message (that's quoted as coming from the
> launching agent, not the user)

(Boxholder, 2026-10-16.)

## The shape

A chat agent decides a topic deserves its own conversation. It calls one tool
(a `bbx chat …` verb), which:

1. creates a new chat session, optionally in a new or existing landmark;
2. puts an opening message in it, shown as written by the launching agent,
   quoted or attributed, and not as the person's own words;
3. moves the person's client into that chat.

The new chat's agent then starts from that message.

## What exists to build on

- Agent-to-client calls already exist: `bbx chat ui` and `bbx chat screenshot`
  long-poll a route until the connected chat client answers
  (`beebox/src/cli/commands/chat/ui.ts`). A "go to this chat" request could
  use the same channel, with the same outcomes when no client is connected.
- Quick chat already reserves a new chat in a place and posts into it
  (`beebox/src/webapp/trpc/routers/quick-chat.ts`;
  `beebox/src/core/chat/session/reserve.ts`, which supports only the Claude
  engine and has a fallback for others).
- Landmark creation is an agent action today; check the landmark docs for the
  current verb before inventing one.

## Open questions

- **Who speaks first.** Whether the new chat's agent answers the opening
  message at once (it reads like a handoff briefing) or waits for the person.
- **Attribution.** How the message is marked in the transcript and in the UI:
  a distinct "from the agent in <chat>" bubble, with a link back to the
  launching chat. It must not look like the person said it, and the new agent
  must not read it as the person's instruction. A handoff is data from another
  agent, the same rule the repo's launch-worktree-session briefings follow.
- **Consent.** Whether the person is moved at once or offered a "Go to new
  chat" control in the launching chat. Moving someone mid-sentence (or on
  another device) is abrupt; an offer is safer as the default.
- **Clients.** Web, the iOS app, and a closed client. The new chat should
  exist even when no client is connected, so the offer can wait.
- **New landmark.** Whether the tool creates the landmark, or only targets one
  the agent created first.

## Related

- [Quick drop entry points](2026-09-25-quick-drop-entry-points.md): new chats
  in a place, without the person typing first.
