---
title: "Day-to-day usage docs: the missing genre"
workstream: launch-docs
area: docs
filed-by: agent
discovered-in: worktree-open-source-readiness — docs-genre audit for the soft launch
labels: [soft-launch]
---

Genre audit (2026-07-20) of all of `beebox/docs/`: install is
well-covered (3 verified guides + per-connector setup), reference/
architecture dominates (~40 contributor/agent-facing files), and the
**USE genre — "I have a running box, what do I do with it day to day" —
is empty**. The entire operator onboarding after install is one sentence
in the README ("it already knows how to use itself"). Connector guides
stop at OAuth success; nothing shows what a synced card looks like or
what to do when the agent gets one wrong. The narrative orientation
chapters (`docs/architecture/01…`, `02…`) are 2 of a planned 8
(`architecture/outline.md`).

Highest-value missing docs for a network invitee's first week:

1. **Using your box day-to-day** — how to talk to it, feed it things
   (voice memo, email, photo), what its questions look like, how to
   correct a mistake.
2. **Teaching your box** — how an in-chat instruction or rule edit
   becomes durable behavior (the unwritten outline ch. 4/5).
3. **Connector catalog** — what exists, one line each on what it does
   once synced.
4. **Operator troubleshooting/FAQ** — "it seems stuck", "it
   miscategorized X", "how do I see what it did overnight" — pitched at
   a non-engineer, unlike `health-checks.md` (author's prod runbook).
5. **Reviewing what the box did** — reading git history as the activity
   log; "git is history" is the headline pitch and is never demonstrated
   for a reader.

Register matters: most existing docs are deliberately agent/contributor-
addressed (`docs/README.md` says so), so an invitee browsing `docs/`
mostly finds material not written for them. The USE docs should address
the human operator in second person, like the install guides already do.

**Delivery mechanism** (boxholder, 2026-07-20): these may live as a
knowledge base fetched on demand rather than bundled into every box.
Security constraint settled in that conversation: on-demand fetch must be
**pinned to the installed version's commit/tag in the same repo** — same
trust root as the code, no new attacker. Fetching "latest from main" or
from a separate mutable site is a prompt-injection channel (whoever edits
the doc steers every box that fetches it) and is off the table. A
fetch-then-cache-in-box middle path keeps what the agent reads
inspectable and diffable.

Gate 3 (README front door) in
[soft-launch posture](../decisions/2026-07-20-soft-launch-posture.md)
is the orientation half; this item is the depth behind it.

> 2026-09-05 survey (main session): still true, and still empty. `beebox/docs/`
> has 64 files and none in the USE genre — `connectors.md` explains the
> `Connector` interface to a contributor, `tours.md` is test tooling, the
> architecture narrative is still chapters 01 and 02 of the outlined eight.
> The nearest things to doc 1 ("using your box day-to-day") live elsewhere:
> the unmerged `public-site` worktree carries a walkthrough page ("a morning
> with the box", unlisted, marked editorial placeholder) built from verified
> user stories, and the 649-story catalog under `beebox/user-stories/` is an
> internal test corpus, not reader-facing. In-box `*.guide.card` files are
> agent-addressed rules, not operator docs. The on-demand,
> version-pinned delivery mechanism decided here has no plan and no code.
> Pairs with gate 3 of the soft-launch posture (the README front door), which
> is also unwritten.
