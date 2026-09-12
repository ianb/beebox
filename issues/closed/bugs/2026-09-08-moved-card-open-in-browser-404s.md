---
title: "A card moved while it's open 404s in the browser instead of following the move"
workstream: moved-card-forwarding
resolution: implemented
area: beebox
priority: normal
labels: [browse, cards, move]
filed-by: agent
discovered-by: Ian
discovered-in: main session — "when a card is moved, if it's open then the open reference doesn't get fixed up, it's just 404 and not redirected to the new location"
---

Resolved by `0adddf91f`: card reads now consult validated Git rename recovery
only after `ENOENT`, and routed Card, Browse, and canonical chat workspaces
replace the stale path while preserving their existing state. The implementation
uses an ephemeral Git index to cover uncommitted moves, so it is broader than
the issue's original committed-history concern without adding a durable ledger.

`bbx move` rewrites references properly on disk — `move-operations.ts` runs the
resolution-based ref rewrite over every other card and plain `.md` (referrer
refs, the moved card's own outbound refs, view refs, and Phase-2 card files).
What it can't reach is a **browser that already has the card open**: that tab's
URL still names the old path, so the next load — a refresh, a live-refresh
fetch, an image or view request under that path — 404s. The person watching a
card just sees it break, with no indication that the card still exists
somewhere else.

The on-disk story is only half the contract. A move is a rename of a live
address, and nothing currently carries the old address forward.

## What a fix needs

- **A way to answer "where did this path go?"** — the move already knows both
  ends; nothing persists that pairing. A small move ledger in `_bookkeeping/`,
  or deriving it from git rename detection at lookup time, are the two obvious
  shapes. Only the second needs no new state, but it only works for committed
  moves.
- **A 404 path that consults it.** The card/browse route should, on a miss, ask
  whether the path was moved recently and redirect (or render "this moved →"
  rather than a bare not-found).
- **A decision about the open tab.** A redirect on next navigation is the floor.
  Better: the open view learns of the move over the live-refresh channel and
  follows it in place, the way an editor retargets a renamed file. Worth
  deciding which of those we're building before starting.
- **Scope**: uncommitted moves, directory moves (a whole capture session
  relocating), and the case where the old path is later reused by a different
  card all need answers.

## Related

- [card vs views route consolidation](../code-quality/2026-08-02-card-vs-views-route-consolidation.md)
  — two parallel single-card routes means a redirect has to be taught twice
  unless they're consolidated first.
- [addressable URIs for cards](../../features/2026-05-11-addressable-uris-for-cards.md)
  — a stable identity independent of path would make this a non-issue for
  anything holding a URI instead of a path.
- [chat history references pre-migration paths](../../bugs/2026-09-07-chat-history-still-references-pre-migration-paths.md)
  — the same failure at a different timescale: an old path recorded somewhere
  we can't rewrite, hitting a 404 with no forwarding.
