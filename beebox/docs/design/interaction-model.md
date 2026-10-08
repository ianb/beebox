# Interaction model

## Idle by default — and definitely also a chatbot

Two coexisting truths (ruling 5):

- **Background processing is idle by default.** The engine doesn't poll or run
  continuous loops. Something happens — input arrives, a schedule fires
  (`bbx tick`, see [`../scheduler.md`](../scheduler.md)), a connector pulls new
  data — the system wakes, processes, and goes back to idle. You can record a
  voice memo and walk away; the box answers hours later. This is still true
  and load-bearing for the engine (see `processing.md`).
- **The system is definitely also a chatbot.** Web chat is a continuous,
  session-resuming presence: the server keeps a long-lived agent session per
  chat ([`../chat/sessions.md`](../chat/sessions.md)); the reactor's chat path
  resumes per-thread sessions for connector threads such as Telegram
  (`src/core/reactor/DESIGN.md`). The current design direction makes chat the
  standing frame primitive ([interface-as-cards](../plans/interface-as-cards.md)).

**Proactivity is active ambition** (aspiration): the boxholder wants *more* of
the box initiating — noticing, suggesting, following up — than exists today.
The idle engine is the substrate for that, not an argument against it.

## Right place, right time

The box's value is getting the right information and the right action in
front of a person at the moment it applies, not having it generically
available to someone who knows to search. That is why design starts from a
situation ("When [situation], I want to [motivation], so I can [outcome]"):
the situation names the moment, and the moment decides the surface. Every
proactive or shown thing answers, per situation: is this the moment to act,
to show, or to stay quiet; and where does it appear (which surface, which
card, which tier of attention: interrupts, waits to be found, background).
Quiet and findable is the default; an interruption needs a reason the person
would give. The bbx-design skill walks a plan through this; this is the rule
it serves (boxholder, 2026-10-08).

## Connectors are the boundary — for external services

Connectors are the abstraction for touching the outside world: each pulls
external state into the box as cards, transforms formats, and pushes outbound
cards back out (flushed by `bbx finalize`). See [`../connectors.md`](../connectors.md);
calendar, a prime early integration, is [`../connectors/calendar.md`](../connectors/calendar.md).

The old claim that "nothing else is particularly privileged — not voice, not
web, not any particular UI" no longer holds: **the web has become privileged**,
or at least the richest surface and the main focus (ruling 6). Chat has
dedicated machinery (its own reactor path, session pool, history); Telegram
and other channels are additional connectors, not peers of the web UI.

## Sync is an event, not just data transfer

When a connector pulls, the point is not only the new state — it's the
**opportunity to react**. A sync that finds something creates a job card
describing it (`_bookkeeping/jobs/`), and the reactor hands that to an agent with the
referenced material inlined. Pull → describe what arrived → agents get the
chance to do something about it. This early principle survived intact as the
connector → job → reactor pattern.
