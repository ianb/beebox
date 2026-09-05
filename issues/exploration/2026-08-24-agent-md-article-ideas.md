---
title: "Check out Fabien Sanglard's `agent.md` piece for practices worth adopting"
workstream: unattached
area: docs
labels: [tooling-eval, agent-instructions]
filed-by: agent
discovered-by: Ian
discovered-in: main session — link passed along for evaluation
priority: important
---

[agent.md](https://fabiensanglard.net/agent.md/index.html) — Fabien Sanglard's
argument that a standing instruction file, reloaded per session, turns an LLM
from a source of cleanup work into "an infinitely patient junior" needing mainly
architectural oversight.

**Read the page before acting on this.** The notes below come from a summarizer,
not a direct reading, and at least one item looks garbled in transit ("functions
under 30 characters" is presumably 30 *lines*). Treat this as a pointer, not a
digest.

> **Boxholder's calls, 2026-08-24 — read before reopening either.**
>
> - **Enums instead of booleans: wanted.** "Actually great." Open question is
>   the mechanism — *"I almost want it as a lint rule or something, but not
>   sure."* So the next step is deciding whether this is a rule in the preset, a
>   line in `code-style.md`, or both; not whether to adopt the idea.
> - **Reload agent.md: declined.** *"I'm not apt to do the reload agent.md
>   thing, I don't understand what would trigger it reasonably."* The objection
>   is the trigger, not the mechanism — nothing tells an operator that quality
>   has drifted, so the move has no moment to be invoked. Don't re-propose it
>   without answering that.

## Two ideas we do not have

- **"Reload agent.md" as an explicit move when quality drops.** The article
  treats context dilution as an expected condition with a named remedy the
  operator invokes mid-session. We have no equivalent: our instructions load at
  session start and nothing re-asserts them when an agent starts drifting.
  Whether that is a skill, a phrase, or a hook is open — and whether it works at
  all under our harness needs checking rather than assuming, since re-reading a
  file is not the same as re-weighting it.
- **Enums instead of booleans for parameters.** Not in `code-style.md`. It fits
  this codebase's existing convictions unusually well: the exhaustiveness rules
  exist so a new union member breaks the build, and a boolean parameter is
  precisely the shape that cannot do that. Cheap to adopt, and the sort of thing
  the preset could enforce.

## Ideas we already hold, worth comparing wording with

Not to re-adopt, but because someone else's phrasing of a rule you already have
sometimes lands better with an agent:

- **Fewest words for human-facing text** — we have this as Simplified Technical
  English in `issues/CLAUDE.md`, plus standing feedback about compression.
- **Layered abstraction, each layer talking only to its neighbour; drivers
  encapsulating low-level mechanics** — `docs/module-map.md` and the
  `lib`/`shared`/`core` boundary.
- **A new session per feature** — this is the worktree-session model, arrived at
  independently.
- **Failing test before the fix** — `docs/testing.md` gestures at test-first for
  decomposition, but does not state the bug-fix rule specifically.
- **Function length limits** — `code-style.md:112` (300-line files, 150-line
  functions); the article's number is far stricter, and the discrepancy may be a
  summarizer artifact.

## What to actually do

Read it, and decide on the two novel items. The reload-when-degraded idea is the
interesting one, because it is operational rather than stylistic and we have no
answer to the problem it names. Record the call here either way — "read, nothing
to take" is a real outcome and stops the link being re-evaluated later.
