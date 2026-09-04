---
title: "session hot context"
workstream: unknown
needs: [design]
area: beebox
priority: backlog
---

Cross-session continuity: a short doc the agent loads at session start describing what was in progress last time, what decisions were pending, what the user was about to do. Currently the agent reconstructs this from cards + conversation log, which is slow and incomplete.

The non-obvious design point is the TTL. Stale hot-context is worse than no hot-context, because the agent confidently presents outdated state as current ("you were about to call Alice" — when that was last Tuesday and is no longer relevant). After some threshold (72h is the tip's suggestion, but probably varies by content type) the entry should be ignored or actively flagged as stale.

Open design questions:
- **When is it written.** End of session is the natural moment but conversations don't have clean endings in beebox. Continuous update during the session is more robust but more expensive.
- **What goes in it.** "Decisions pending" and "in-progress threads" are clearer than "what we talked about." The summary should be operational, not narrative.
- **Where it lives.** In the box (visible to all agents on that box), or per-agent scratch. Probably in the box.
- **How TTL works.** Per-entry timestamps with the agent skipping expired ones is cleaner than whole-file expiry — different items have different shelf lives ("user prefers warm tone" doesn't expire in 72h; "user is mid-decision about the kitchen contractor" probably does).
- **Connection to cache-freshness.** Same shape as the `data_through` / `last_sync` pattern: the hot-context doc is a synthesized cache of state, and inherits the same staleness-propagation problem.
