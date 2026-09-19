---
title: "A Gmail draft whose upload keeps failing is retried on every sync with no end"
workstream: connector-silence
area: beebox
labels: [connectors]
filed-by: agent
discovered-in: worktree-connector-silence — deferred from the connector-silence plan
resolution: implemented
---

> **Closed** — `ae4d53ae2` strands a draft whose failure is the card's own
> fault (`gmail-draft-error`, no more retries); `bb45c7827` strands any other
> failure after 7 days of continuous retries (`gmail-draft-failing-since`).
> See `beebox/docs/implemented-plans/connector-silence.md`.

`uploadPendingDrafts` (`beebox/src/connectors/gmail-drafts.ts`) uploads every
`email-outbound` card in `draft` status with no `gmail-draft-id`. A card that
fails is left unchanged, so the next sync tries it again, indefinitely.

Since connector-silence, the failure is visible: it joins the sync result's
`error`, and after two days of all-error syncs the box sends one "failing"
message and shows a dashboard warning. It is still never *stranded*: nothing
on the card records that it failed, when it started failing, or that the box
has stopped trying.

## Why it was deferred

The common cause is an expired Google grant. Every draft then fails for the
same box-wide reason, and retrying is correct as soon as the boxholder
reconnects. Stamping each card with an error, or stopping after a week, would
strand drafts whose only problem was fixed elsewhere.

A card-specific failure (bad MIME, an unresolvable `in-reply-to` ref) is
different: it will never succeed, and a box agent reading the card cannot see
why it has no draft id.

## Possible direction

Record `gmail-draft-error` (and when it started) on the card for card-specific
failures only, stop retrying those after a bounded time, and leave auth-shaped
failures to the connector-level failing alert. Needs a way to tell the two
classes apart from the Gmail API error.
