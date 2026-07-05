# Interaction model

## Idle by default — and definitely also a chatbot

Two coexisting truths (ruling 5):

- **Background processing is idle by default.** The engine doesn't poll or run
  continuous loops. Something happens — input arrives, a schedule fires
  (`cb tick`, see [`../scheduler.md`](../scheduler.md)), a connector pulls new
  data — the system wakes, processes, and goes back to idle. You can record a
  voice memo and walk away; the box answers hours later. This is still true
  and load-bearing for the engine (see `processing.md`).
- **The system is definitely also a chatbot.** Web chat is a continuous,
  session-resuming presence: each thread keeps a resumable agent session
  across reactor cycles (`src/core/reactor/DESIGN.md`), and the current design
  direction makes chat the standing frame primitive
  ([interface-as-cards](../plans/interface-as-cards.md)).

**Proactivity is active ambition** (aspiration): the boxholder wants *more* of
the box initiating — noticing, suggesting, following up — than exists today.
The idle engine is the substrate for that, not an argument against it.

## Connectors are the boundary — for external services

Connectors are the abstraction for touching the outside world: each pulls
external state into the box as cards, transforms formats, and pushes outbound
cards back out (flushed by `cb finalize`). See [`../connectors.md`](../connectors.md);
calendar, a prime early integration, is [`../calendar.md`](../calendar.md).

The old claim that "nothing else is particularly privileged — not voice, not
web, not any particular UI" no longer holds: **the web has become privileged**,
or at least the richest surface and the main focus (ruling 6). Chat has
dedicated machinery (its own reactor path, session pool, history); Telegram
and other channels are additional connectors, not peers of the web UI.

## Sync is an event, not just data transfer

When a connector pulls, the point is not only the new state — it's the
**opportunity to react**. A sync that finds something creates a job card
describing it (`box/jobs/`), and the reactor hands that to an agent with the
referenced material inlined. Pull → describe what arrived → agents get the
chance to do something about it. This early principle survived intact as the
connector → job → reactor pattern.
