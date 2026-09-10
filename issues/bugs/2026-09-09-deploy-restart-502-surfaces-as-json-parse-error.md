---
title: "A 502 during a deploy restart reaches the UI as \"Unexpected token '<', \\\"<!DOCTYPE\\\"... is not valid JSON\""
workstream: unattached
area: beebox
priority: normal
labels: [deploy, frontend, error-reporting]
filed-by: agent
discovered-by: Ian
discovered-in: main session — the Google Services admin panel showed the parse error after clicking Re-authorize
---

Clicking **Re-authorize** in Google Services on a box produced
`Unexpected token '<', "<!DOCTYPE "... is not valid JSON` in the panel's error
box. Nothing was wrong with the OAuth flow: nginx returned its own HTML 502
page because the hub was mid-restart, and the tRPC client tried to parse it.

The nginx log is unambiguous — two `POST /<box>/api/trpc/admin.googleSetup?batch=1`
at 14:14:11 and 14:14:13 UTC, both `502 568`, referrer `/<box>/admin`, while
the hub was between its SIGTERM (14:13:12) and its restart (14:14:12). Batched
queries in the same window 502'd too. Calling `admin.googleSetup` afterwards
returns a valid `authUrl`, so nothing is broken now.

`trpcFetch` in `beebox/src/frontend/src/lib/trpc/index.ts` has a case for 401
(`reportSessionEnded`, from the one-401-ejects-the-app work) but nothing for a
non-JSON body or a 5xx. Every surface with an error box shows the parse error
raw, which reads like a client bug and tells the boxholder nothing actionable.

## What to change

- **Detect a non-JSON response in `trpcFetch`** — a `content-type` that isn't
  JSON, or a 502/503/504 — and turn it into one honest message: the server is
  restarting or unreachable, try again in a moment.
- **Consider a retry** for idempotent queries during a restart window; a deploy
  takes ~60s here, so a single delayed retry would hide most of it. A mutation
  must not auto-retry.
- **Related**: [stale web bundle detection](../features/2026-08-12-stale-web-bundle-detection.md)
  — the other half of "the deploy moved under the open page."
