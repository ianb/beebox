---
title: "Decide what, if anything, to take from Hermes' self-improvement machinery"
workstream: unattached
area: callback-box
needs: [decision, design]
labels: [agents, research]
filed-by: agent
discovered-by: Ian
discovered-in: main session — cb feedback triage
---

Hermes' self-improvement work is well spoken of, and Ian wants to look at it
more. The deliverable here is **a call**, not a build: does callback-box take
anything from it, and if so what.

## The research already exists — start there, don't redo it

`research/openclaw-hermes/deep-hermes-learning.md` is a deep dive on exactly
this, covering:

- **`agent/background_review.py`** — the background review/learning loop: two
  independent trigger counters (both defaulting to 10), an in-process
  cache-warm *replay* rather than a subprocess fork, a tool whitelist enforced
  at runtime (thread-local, pre-dispatch) rather than merely prompted, the
  prompts verbatim, what the loop is permitted to write, how those writes are
  applied and validated, and its cost controls.
- **`agent/curator.py`** — a Curator subsystem on a weekly, inactivity-triggered
  cadence rather than cron.

Sibling docs in that directory compare skills/tools and context/memory.

So the question is not "what does Hermes do" — it's **which of those mechanisms
earns a place here**, given callback-box already has retrospectives, guide
cards, personality cards, and a questions subsystem doing adjacent work.

## What to actually decide

For each mechanism, one of: adopt, adapt, or explicitly decline (with the
reason, so it isn't re-litigated).

- **A background review loop.** Closest existing thing is the retro pipeline
  (scan → observations → integrate into a sink). Does Hermes' counter-based
  trigger beat the current cadence? Note the sink machinery has a live bug
  ([retro sinkRef](../bugs/2026-08-12-retro-sinkref-invalid-path-and-shape.md))
  that would need settling either way.
- **Runtime-enforced write permissions.** A whitelist enforced pre-dispatch
  rather than prompted is a materially different safety posture from
  instructions-in-a-prompt, and callback-box leans on the latter. This may be
  the most transferable idea in the whole document.
- **The Curator's inactivity-triggered cadence** — interesting alongside
  [box dormancy](../exploration/2026-08-11-encryption-at-rest.md), which also
  keys off human inactivity. Two features wanting the same missing signal is an
  argument for building that signal once.
- **Cost controls**, given a self-improvement loop spends tokens unattended.

## The prior question

**Does callback-box want an agent that rewrites its own guidance?** The box
already learns through retrospectives and questions, but those put a human in
the loop by design. A background loop that edits its own instructions is a
different bargain, and worth naming as a bargain before evaluating mechanisms
that assume the answer is yes.
