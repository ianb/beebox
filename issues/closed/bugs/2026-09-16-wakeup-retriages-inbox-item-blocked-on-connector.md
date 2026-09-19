---
title: "Wakeup opens a new intake job every cycle for an inbox item blocked on a broken connector"
workstream: connector-silence
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: main — production box feedback triage (bbx feedback)
resolution: implemented
---

> **Closed** — `cd78d1dc7` excludes `*.email-outbound.card` from the wakeup
> unjobbed-inbox-item scan (`NEVER_TRIAGED_SUFFIXES`). See
> `beebox/docs/implemented-plans/connector-silence.md`.

An `email-outbound` draft could not upload because the box's Google OAuth
grant had expired. A reauthorization todo already tracked that. Each wakeup
cycle still flagged the draft as an unjobbed inbox item and opened a new
intake job. On 2026-09-03 this happened three times for the same card. Each
job re-read the card, found it correctly filed, and closed with no change.

The unjobbed check is in `beebox/src/cli/commands/wakeup-steps.ts` /
`wakeup.ts`.

## Why resolution is not obvious

Wakeup needs a signal that an item was triaged and is waiting on an external
dependency. Candidates: a `todos:` ref to the blocking todo suppresses
re-jobbing until that todo closes; the connector's blocked state suppresses
jobs for its own outbound items; or a triaged-at marker newer than the card's
last change. Each option puts the knowledge in a different place.
