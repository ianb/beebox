# docs/design/ — engineering rationale

Why the system is shaped the way it is. Peer of [`../stack-decisions.md`](../stack-decisions.md)
(the decisions log): these files answer *why*, never *how to*. The onboarding
narrative lives in [`../architecture/`](../architecture/CLAUDE.md); the values
compass is [`../architecture/spirit.md`](../architecture/spirit.md) — **design
serves the values written there**; spirit.md's "if the architecture contradicts
this, the architecture is wrong" is meant literally (the boxholder wrote it and
meant it, then forgot it existed — reasserted 2026-07-04).

This directory replaces the former monolithic `docs/design.md`, rewritten to
the boxholder's rulings in [`../plans/design-reconciliation.md`](../plans/design-reconciliation.md)
(2026-07-04). Anything labeled *aspiration* is deliberate design intent the
code doesn't fill yet — don't read it as description.

## Files

- [`representation.md`](representation.md) — the anchor principle: the representation mirrors the shape of the idea (Engelbart); strict validation with deliberate, scarce escape valves; cards that aren't domain ideas (husks, landmarks) are still ideas.
- [`identity.md`](identity.md) — what this is: OS as the ambition, shared boxes (one sharing granularity each), web UI as the privileged surface, documents as the record, runs on a full computer only (local or remote), never serverless.
- [`interaction-model.md`](interaction-model.md) — idle-by-default background engine AND definitely also a chatbot; proactivity as active ambition; connectors as the external-service boundary; sync-as-event.
- [`processing.md`](processing.md) — what `bbx wakeup` and the reactor actually do (verified against code), what "processing" an item means, the question loop, sessions.
- [`durability-and-provenance.md`](durability-and-provenance.md) — committing makes it durable and real (with the chat-messages exception); the filesystem is the index; provenance as aspiration with `{% source %}`/`{% quote %}` as the current attempts.
- [`trust.md`](trust.md) — question → confirmation → automatic; paperwork lives on as schema process-fields; the three confidence vocabularies.
- [`teaching.md`](teaching.md) — the teaching relationship and what shipped of it (retro, personality/guide cards, briefings, category rules); proposals still ambition.
- [`extensibility.md`](extensibility.md) — knowledge over plugins (active plan; neither exists yet); composition over new infrastructure; where "modes" vocabulary stands.

Former design.md sections that were pure pointers after reconciliation:
triage pipeline → [`../triage.md`](../triage.md); calendar →
[`../calendar.md`](../calendar.md); scheduling → [`../scheduler.md`](../scheduler.md)
and [`../chat-schedules.md`](../chat-schedules.md).

## Retired sections

Moved verbatim to [`../implemented-plans/design-md-retired-sections.md`](../implemented-plans/design-md-retired-sections.md):

- **§3 File formats and envelopes** — taught the XML envelope; cards are YAML frontmatter + markdown (`../cards-as-markdown.md`).
- **§9 Commands as files** — command cards are removed; actions flow through reactor jobs + `bbx finalize`. The paperwork idea survives as schema process-fields (see `trust.md`).
- **§10 Untrusted-content tokenization** — deferred idea, never picked up.
- **§11 Sidecars / agent-hidden JSON** — deferred idea, never picked up.
