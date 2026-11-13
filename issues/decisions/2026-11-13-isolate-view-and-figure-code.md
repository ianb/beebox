---
title: "Isolate agent-written view and figure code from the person's session"
workstream: unattached
needs: [design, decision]
area: beebox
labels: [views, figures, security]
priority: important
filed-by: agent
discovered-by: Ian
discovered-in: "canvas-brushes workstream, activity-log plan review, 2026-11-13"
---

Views and figures written by box agents run in the app's own page, same
origin, with the signed-in person's session. Whatever helpers they are
handed, their code can call any in-wall route with `fetch`, including the raw
file write route, which admits any non-card, non-dot path in the box's
underscore areas (`beebox/src/webapp/routes/api/register/files-write.ts`,
`guard`). The security report records this as §7c and accepted risk 18.

The boxholder decided on 2026-11-13: no hard block and no iframes yet, but
this is a high priority to revisit; the gap makes them anxious. Page code can
also call the card API, so cards are reachable too (they must validate).
Removing write helpers from figures (`beebox/docs/implemented-plans/activity-log.md`,
Track A) narrows the API but does not enforce anything.

Options when this is taken up:

- Run figures (and later views) in a sandboxed iframe on another origin or
  without the session, with a message channel for params, events, activity
  and any granted saves. This is the same piece as the planned channel
  between a view and a figure it embeds.
- A per-render capability token the server checks on writes, so a request
  from figure code is recognizable and limited.
- A Content Security Policy for view and figure code that limits
  `connect-src`; it cannot separate same-origin calls by caller.

Related: [view-file-writes-too-broad](2026-11-13-view-file-writes-too-broad.md).
