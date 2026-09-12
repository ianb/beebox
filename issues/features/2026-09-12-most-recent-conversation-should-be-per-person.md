---
title: "\"Most recent conversation\" is the box's, not yours — landing in someone else's thread is jarring"
workstream: unattached
area: beebox
priority: normal
needs: [design]
labels: [chat, multi-user, identity]
filed-by: agent
discovered-by: Ian
discovered-in: main session — "It would be jarring to go into another person's most recent conversation if you hadn't participated in it"
---

Boxholder: "I think the 'most recent conversation' is for the box, but maybe
should be for the user. It would be jarring to go into another person's most
recent conversation if you hadn't participated in it."

Opening a box drops you into its most recent thread. On a single-person box
that is exactly right — it is where you left off. On a shared box it means
arriving mid-conversation in something you have never seen, authored by
someone else, with no signal that it is not yours.

## Why this is live now, not hypothetical

Pairing changed on 2026-09-12: anyone with box access can pair their own
device, and a paired device acts as the person who paired it rather than as
the owner (see `docs/mobile-contract.md` §2.3). Shared boxes with distinct
identities are becoming the normal case, and "most recent" resolving box-wide
is a single-user assumption the rest of the system is moving away from.

## What needs deciding

- **What "yours" means when you have never chatted here.** A first visit has no
  personal most-recent. Falling back to the box's newest thread reintroduces the
  problem; starting fresh is safer but discards a genuinely shared conversation
  someone wants you to see.
- **Whether some threads are deliberately shared.** A household box may well
  want one continuing conversation everyone joins. If so this is not
  per-person-versus-box but a property of the thread, and the resolver reads
  that property instead of guessing.
- **What the transcript shows about authorship.** Even landing in a shared
  thread correctly, it is currently hard to tell which turns were someone
  else's. Attribution may matter more than the routing.
- **Where the resolution actually happens** — the chat-everywhere resolver
  (`components/chat/everywhere/resolve-conversation.ts`) and the session
  history it reads. Worth confirming whether "most recent" is one lookup or
  several before changing any of them.

Related: the sessionStorage key `bbx-conversation:<box>` is per-browser, so a
returning person on their own device already gets their own thread — the
box-wide fallback is what bites a newcomer or a fresh device.
