---
title: "Under failure, the agent narrated a confident, specific, wrong root cause — and repaired an unrelated file"
workstream: unattached
area: beebox
labels: [journey-findings, prompt-surface]
filed-by: agent
discovered-by: agent
discovered-in: worktree-user-stories-refresh — journey A, 2026-08-25 walk; disproven by a verifier agent
priority: normal
---

## Recovery assessment (2026-09-21)

The current schedule-tag parser still parses quoted attributes, not YAML, so
the historical explanation did not describe that mechanism. This recovery does
not establish that today's model would repeat the fabricated diagnosis. No
exact duplicate or dedicated corrective instruction was found.


> Recovered 2026-09-21 from `worktree-user-stories-refresh` at `f914fcb4e`.
> The account below describes the 2026-08-25 walk, not a new reproduction.
> Source line numbers in that account are historical. Current disposition is recorded below.


When the box hits an internal failure, I want it to either fix it quietly or
tell me something true, so that what I learn about the system is real.

In journey A, the user's month-out chat timer fired instantly twice (the
setTimeout overflow — [chat-timer-over-25-days-fires-instantly](2026-08-25-chat-timer-over-25-days-fires-instantly.md)).
The agent then said, in-channel:

> "The colon inside the message tripped YAML — quoting the whole `runs:` value."

**Every part of that is wrong.** The chat-timer path contains no YAML anywhere:
regex + quoted-attribute parsing into a JSON store
(`src/core/chat/schedule-tags.ts`, `.beebox/chat-schedules.json`). A colon
is inert on that path. `runs:` is a field of the *scheduled-script card* — the
fallback artifact the agent was creating, a different mechanism entirely — so it
diagnosed a failure in system A by describing an edit it was making to system B.
The real cause (32-bit overflow) it could not have seen, but it did not say "I
don't know why"; it invented a cause with technical specificity, which is what
made it convincing.

The user's reading:

> "For a second I thought I had broken it by typing a colon."

and, on the episode as a whole:

> "I should have seen 'Reminder set for Sept 25' and nothing else. Everything
> between that and the apology is the app talking to itself with the door open."

Two tensions, probably both prompt-surface work:

- **Fabricated diagnosis.** Under visible failure the agent asserted a
  mechanism. The agent guide should be explicit: name what was observed
  (fired early; retrying differently), never a cause it cannot verify. A user
  learns the system's vocabulary from these moments — this one taught them
  something false about colons.
- **Repair narration in-channel.** The retry loop, the tool chatter, and the
  workaround belonged behind the fold. What reached the user should have been
  the outcome plus the honest hedge it did give ("the todo is dated Sept 25
  regardless") — which was the *good* part of an otherwise bad episode, along
  with an unprompted apology.

Worth saying: the same walk shows the agent handling *user-side* uncertainty
superbly (the tape-measure entry). The failure is specifically about its own
internals: honest about the world, confabulating about itself.
