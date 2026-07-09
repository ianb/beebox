---
area: callback-box
needs: [design]
---

# Per-surface/per-view background agent, or is box-wide reactor + generated views enough?

From the Rowboat competitive note (`research/rowboat-review.md`, Tier 1). Rowboat's
sharpest divergence from us: **each work-surface has its own persistent background
agent** (the email surface's agent watches the inbox and pre-drafts; the notes
surface has a different agent). We have the opposite: **one box = one agent
identity**, proactivity via the **reactor** (schedule → wakeup → process pending job
cards in a cycle), and **views generated on demand** — no agent "lives behind" a
given view.

Often the outcome is identical: you open email and see a ready draft — Rowboat's
per-surface agent wrote it; ours came from the last reactor wakeup and a generated
email view shows it. So the question is whether a per-surface agent actually buys
anything the reactor doesn't:

- **Liveness** — a resident surface-agent is *continuous* (drafts the instant mail
  lands); the reactor is *periodic* (drafts on the next wakeup, `src/core/reactor/`,
  `docs/scheduler.md`). Is the latency gap real for the user, and could it be closed
  more cheaply than N standing agents (e.g. event-triggered wakeups)?
- **Specialization** — a dedicated agent can hold surface-specific context/skills; the
  reactor is a generalist that re-derives context each cycle.

Against that: our **"one box = one agent = one human"** is a deliberate identity +
simplicity bet (`callback-box/CLAUDE.md`). Note the cost is NOT "N standing agents":
Rowboat's per-surface agents are **trigger-invoked configs** (fired on event/schedule
via the OpenAI Agents SDK), not running processes — same shape as our reactor. The
real cost of per-surface factoring is **coordination + surface area**: more agent
definitions to maintain, and "which one speaks for the box?" — which is what cuts
against the one-identity bet. See also `project_views_attach_to_cards`.

**Disposition: investigate, don't adopt blind.** The design pass decides: (a) does
reactor + on-demand views already deliver the felt experience; (b) if the gap is
purely liveness, is an event-triggered wakeup the cheap fix; (c) is there any surface
whose job genuinely wants a standing, specialized agent — and if so, how does it stay
under one box identity? Ready-for-a-plan only after that question is answered, not
before.
