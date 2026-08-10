---
title: "Nothing notices when a connector that used to produce items stops"
workstream: box-family-email
area: callback-box
filed-by: agent
discovered-in: worktree-box-family-email — a production box went five days without importing mail
needs: [design]
---

> **When something upstream changes and my box quietly stops collecting, I want
> the box to tell me, so I find out in a day rather than by noticing months of
> silence and going looking.**

A production box imported 8–24 Gmail threads a day for five weeks, then stopped
dead and stayed stopped for five days. Nothing reported it. The box kept
committing plausible Gmail activity the whole time — refreshes of already-tracked
threads, committed as ordinary "Pull 1 Gmail thread" messages — so even the
commit log looked healthy. It surfaced only because someone compared per-day
first-message dates across the thread cards by hand.

The specific cause is fixed
([gmail-connector-silent-when-rules-empty](../closed/bugs/2026-08-10-gmail-connector-silent-when-rules-empty.md)).
The detection gap is not, and it is not Gmail-specific: any connector can stop
producing for reasons the connector itself considers success — an upstream
permission revoked, a filter that no longer matches, a cursor that advances past
everything, a rule budget silently exhausted.

The appealing property here is that this needs no per-connector knowledge. A
connector's own recent history is the baseline: something that produced items
daily for a month and has produced none for a week is anomalous *for itself*,
whatever it connects to.

## What makes this hard

- **The signal is absence**, and absence is indistinguishable from a quiet week
  without a baseline. A box on holiday, a seasonal mailing list, a calendar with
  nothing scheduled — all produce legitimate zeroes.
- **It must not become another permanent warning.** The box-growth check is the
  cautionary example: it warns continuously, cannot self-clear, and is therefore
  ignored (see
  [box-growth-warning-cannot-clear](../bugs/2026-08-10-box-growth-warning-cannot-clear.md)).
  A staleness check needs either an acknowledge path or a design where the
  warning genuinely goes away.
- **Where does the history live?** Per-connector transient state is gitignored
  and machine-local. Commit history is durable and already carries
  `Pulled-By: <connector>` trailers — but as this incident showed, commits exist
  that are not new items, so commit counting alone would have reported healthy
  throughout.

## Open questions

- What counts as an "item"? `SyncResult.created` is the obvious candidate and
  would have caught this exactly — `created` was empty for five days while
  `updated` was not.
- Per-connector thresholds, or one rule derived from each connector's own
  trailing rate?
- Does this belong in the health surface, in the retro/scan procedures (which
  already look at the box periodically and involve judgment), or as a briefing
  line? The health surface is the obvious home, and also the one most at risk of
  the permanent-warning failure above.
