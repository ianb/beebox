---
title: "Gmail draft upload failures are silent: no CLI output, no health signal"
workstream: connector-silence
area: beebox
labels: [connectors]
filed-by: agent
discovered-by: agent
discovered-in: main — production box feedback triage (bbx feedback)
resolution: implemented
---

> **Closed** — `cd78d1dc7` makes `uploadDrafts` copy `drafts.errors` into the
> sync result, so `bbx finalize`/wakeup print and count it. See
> `beebox/docs/implemented-plans/connector-silence.md`.

An `email-outbound` card never received a `gmail-draft-id`.
`bbx finalize -c gmail` printed `No outbound items` and nothing else.

`uploadDrafts()` in `beebox/src/connectors/gmail.ts` checks only
`drafts.updated.length`. It does not read or log `drafts.errors` from
`uploadPendingDrafts` (`gmail-drafts.ts`). If `uploadOneDraft` throws (bad
MIME, missing OAuth scope for `drafts.create`, and similar), nothing reaches
the CLI, the wakeup output, or `bbx health`.

The same box agent also found `config/connectors/gmail.json` missing its
required `action` field, which stopped all Gmail sync for four days while
sync reported success. Only a health check showed the error. That part may be
covered by [connector-that-stopped-producing](../features/2026-08-10-detect-a-connector-that-stopped-producing.md).

Later evidence on the same box suggests the root cause was an expired Google
OAuth grant, so this may not reproduce now. The silent error path is still
present.
