---
title: "A chat binds to a landmark at creation and never moves — so the lending chat lives under 'Box' while 'Lent & Borrowed' says no chats here yet"
workstream: unattached
area: beebox
labels: [journey-findings]
needs: [decision]
filed-by: agent
discovered-by: agent
discovered-in: worktree-user-stories-refresh — journey A, 2026-08-25 walk; mechanism traced by a verifier agent
priority: backlog
---

## Recovery assessment (2026-09-21)

The binding mechanism remains: `beebox/src/webapp/trpc/routers/chat.ts:292-312`
groups by exact `contextDir`; `core/chat/session/history.ts:237` fills only an
undefined binding, and line 340 matches exact bindings. No fresh browser walk
or rebind experiment was performed. No exact queue duplicate was found.


> Recovered 2026-09-21 from `worktree-user-stories-refresh` at `f914fcb4e`.
> The account below describes the 2026-08-25 walk, not a new reproduction.
> Source line numbers in that account are historical. Current disposition is recorded below.


When a conversation builds a place in my box, I want to find that conversation
from the place it built, so the place is where its own history lives.

Journey A's entire evening was one lending conversation. That conversation
created the `store/lending/` landmark. At the end of the night, the Landmarks
page showed **Lent & Borrowed — "No chats here yet"** while the whole
conversation sat under the generic **Box** landmark.

> "the landmark that matches my subject is empty and the generic one has
> everything. I don't know how I'd have got the chat to land in the right
> place, or whether it matters."

**Mechanism, verified:** membership is exact-string equality between the chat's
`contextDir` and the landmark's dir (`src/webapp/trpc/routers/chat.ts:227-242`)
— no prefix, no roll-up. `contextDir` is chosen at creation from where the chat
was started (box root → `""`) and written once; `appendHistory` only fills it
when undefined, `""` is a real binding, and no rebind path exists. Structurally
non-trivial to change: `contextDir` also determines the SDK cwd and where the
transcript lives (`session/history.ts:286-295`). Nearest-enclosing-landmark
logic exists (`src/core/landmark/nearest.ts`) but only runs when starting a
chat *from a card*, never when bucketing existing chats.

So this walk's shape — start talking at the root, the talk creates the place —
is precisely the shape the binding rule cannot serve. First conversations are
disproportionately root-started, so the first landmark a new user creates will
reliably greet them with "No chats here yet".

Needs a decision more than a patch; options with different costs:

- **Display-time association** (leave `contextDir` alone; let a landmark's
  page also list chats that created or heavily touched its dir). No transcript
  migration; needs a signal for "touched".
- **Rebind on creation** (a chat that creates a landmark moves under it). Fights
  the cwd/transcript coupling.
- **Agent-guided** (the agent, which just made the landmark, tells the user the
  chat stays under Box / offers to continue in a new chat there). Cheapest,
  and worst — it explains the seam instead of removing it.
