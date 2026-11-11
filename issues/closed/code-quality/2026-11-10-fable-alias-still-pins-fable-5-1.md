---
title: "`MODEL_ID.fable` still resolves to `claude-fable-5-1`; Claude Code 2.1.321 made Fable 5.2 the default"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-sdk-update — reviewing Claude Code 2.1.321
labels: [sdk-update]
resolution: implemented
---

**Closed (implemented, 2026-11-10):** MODEL_ID.fable now claude-fable-5-2; claude-fable-5-1 folds into it; picker label Fable 5.2 (2026-11-10, main checkout)

Claude Code 2.1.321 (2026-11-09): *"Added Claude Fable 5.2
(`claude-fable-5-2`), now the default Fable model — 1M context, $8/$40 per
Mtok with $0.20/Mtok cache reads."* It also moves saved Fable 5.1 picks to
`fable`.

`beebox/src/shared/model-ids.ts:21` still sets `fable: "claude-fable-5-1"`, so
a box that asks for Fable gets the older model while Claude Code's own `fable`
alias means 5.2.

Checked 2026-11-10 on Agent SDK 0.3.319 (bundled Claude Code 2.1.319): a
`query()` with `model: "claude-fable-5-2"` answered from that model with a
`success` result, so the pin does not block the move.

The change: point `fable` at `claude-fable-5-2`, and add `claude-fable-5-1`
to the legacy map (the block above `model-ids.ts:42`) so stored 5.1 picks
fold into the alias, as was done for Sonnet 5 and Haiku 4.5
(`issues/closed/code-quality/2026-09-28-sonnet-alias-still-pins-sonnet-5.md`).
