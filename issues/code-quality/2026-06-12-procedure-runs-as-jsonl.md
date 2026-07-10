---
title: "procedure runs as jsonl"
needs: [design]
area: callback-box
---

The 2026-06 hygiene work (no-op suppression, `expires` stamps, `cb procedure gc`) treats `procedure/runs/` as a recent cache — which raises the next question: do per-run XML card files committed to git earn their keep at all? Each materialized run costs a directory, a card, and several bookkeeping commits (`Start procedure`, per-step, `Complete`), and most of what the card records is already structured data that would sit more naturally as an append-only line in something like `.callback-box/procedure-runs.jsonl` (gitignored, size-rotated — same shape as `scheduler.jsonl`). Agent *work* commits would remain; only the engine's bookkeeping would leave git. The `Procedure:`/`Step:` commit trailers already carry run identity in history, so the archival story may not even need the card.

A halfway design keeps the run dir on disk *during* the run — it's the live-run signal for the at-rest gate, and mid-run agents read the run card for context — but never commits it: completion appends the jsonl record and deletes the dir. That would let the whole expires/GC apparatus be deleted again (it was cheap to build; no sunk-cost attachment).

Open questions:
- **Pinning loses its surface.** `expires="never"` works because the run is an editable artifact; with jsonl, retaining an interesting run needs another home (copy the record into a review card? a pinned-runs file?).
- **Payload size.** Run cards hold step stdout and validation/review prose — fine as a card, awkward as a jsonl line. Maybe the line holds a summary + git refs and the prose stays only in commit history.
- **Consumers.** `cb procedure status` and the at-rest gate read run cards today; both have straightforward jsonl/lock-file equivalents, but it's a real migration, and legacy boxes have years of run dirs in history that tooling shouldn't choke on.
