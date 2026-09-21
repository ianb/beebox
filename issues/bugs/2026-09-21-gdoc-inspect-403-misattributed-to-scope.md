---
title: "Google Docs 403 SERVICE_DISABLED crashes inspect and is misdiagnosed as a scope problem"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: main — production box feedback triage (bbx feedback)
---

A box's Google Doc inspect/sync call failed with HTTP 403
`SERVICE_DISABLED` — the Docs API was never enabled on the connected GCP
project — not a token or scope problem. The boxholder reauthorized (full
scope grant, fresh token) expecting that to fix it; it could not have, since
the failure is a project-level API toggle, not a credential.

## Mechanism

`beebox/src/connectors/drive-handler-docs.ts` has two call paths to the Docs
API, and only one of them degrades gracefully:

- `pull()` (line ~219) wraps `service.getDocument()` in `tryGetDocument()`
  (line ~163), which catches any failure and prints a console warning:
  "If this is a 403, run 'bbx engine google-auth' to grant the
  documents.readonly scope." That advice is wrong for `SERVICE_DISABLED`
  (project-level, not scope-level) and the warning only reaches `console.warn`,
  not the boxholder.
- `docsHandler.inspect()` (line ~183) calls `service.getDocument(file.id)`
  directly, with no try/catch — a 403 here throws unhandled, so `bbx drive
  inspect` fails outright instead of degrading like `pull()` does.

Both paths assume any Docs API failure is a `documents.readonly` scope gap,
which is only one of the possible causes (401 vs 403 vs 403
`SERVICE_DISABLED` are distinguishable from the Google API error body already
being read at the catch site).

## Why the resolution isn't obvious

Fixing the message requires parsing Google's structured error reason
(`SERVICE_DISABLED` vs a scope-insufficiency reason) and deciding what
actionable text to show for each: enabling a GCP API requires a one-time
manual step in Cloud Console the box cannot perform for itself, so the right
fix is a clearer diagnostic (and a link), not a retry. Whether `inspect()`
should degrade like `pull()` (return reduced-fidelity data) or surface an
explicit error to the boxholder is also a product choice: inspect is
metadata-preview at read time, e.g. cascading it silently masks the same
problem `pull()` has today.
