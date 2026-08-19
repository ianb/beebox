---
title: A stale annex.largefiles is never re-applied, so uppercase-extension assets commit as raw blobs
workstream: annex-bypass-check
area: callback-box
resolution: implemented
filed-by: agent
discovered-by: agent
discovered-in: worktree-annex-bypass-check — investigating the photo-batch annex-bypass report
---

**Closed 2026-08-19 — box convergence now runs on its own.** `deploy.sh` runs
`cb migrate --sweep` per box after shipping code, and box configuration is
expressible as a migration (`annex-config-2026-08` runs the `cb doctor annex`
repair pass). A box the sweep cannot converge — dirty tree, or a pending
agent-driven procedure migration — is reported by `cb health` as
`box-migrations`, so it is visible after the deploy log scrolls away.

**The residual, stated plainly:** a manifest key runs once, so the next change to
`ASSET_EXTENSIONS` or either rendering needs a NEW dated migration entry, and
forgetting to add one is silent. That is a discipline cost, not a mechanism gap,
and it is written down in `docs/migrations.md` and in the migration script's own
comment. If it bites anyway, the fix is a convergence step that is not keyed on
a one-shot name — re-running the annex doctor unconditionally at box startup was
the alternative considered here (`docs/plans/asset-annex.md:458` specifies it and
it was never built).

The original tension follows.

---

`annex.largefiles` is written into a box once, at conversion or at `cb init`.
When `ASSET_EXTENSIONS`/`assetLargefilesExpression()` changes, nothing re-applies
it to boxes that already exist. `cb doctor annex --check` reports the staleness
correctly, but nothing runs it on a schedule and `cb health` does not surface it:
`webapp/trpc/routers/health.ts:181` forwards only the `binary` and
`content-present` checks. So the box is silently misconfigured until someone
runs `cb doctor annex` or `cb init` by hand.

This has already produced a real gap. `5aed3eef` (2026-08-05) added the
uppercase extension variants (`*.JPG` alongside `*.jpg`) because git-annex's
match expressions are case-sensitive. Boxes converted before that date still
carry the lowercase-only expression. Three of the four annexed production boxes
are in that state as of 2026-08-18 — `cb doctor annex --check` reports
`✗ largefiles` and `✗ attributes` on each.

**Verified consequence.** On an annex box whose `annex.largefiles` is the
lowercase-only expression, two 2 MB files committed together into the same
attach scope:

| file | committed object |
|---|---|
| `IMG_9999.JPG` | 2,000,000 bytes — **raw blob in git** |
| `img_9998.jpg` | 102 bytes — annex pointer |

`IMG_*.JPG` is exactly what an iOS camera roll and most scanners produce.

**Not yet fired in production.** A census of all four annexed boxes finds zero
tracked assets with an uppercase extension, so no raw blob has landed this way.
Bulk batches are unaffected by *this* issue: their batch-local `.gitattributes`
sets `* annex.largefiles=anything`, which overrides the stale config expression
for any path the filter runs on. The exposure is every other write path —
capture filing, `cb scan-import`, clerk frozen pages, an agent moving an asset
into `store/`.

Related but distinct:
[the filter-scope / largefiles disagreement](2026-08-18-annex-filter-scope-and-largefiles-disagree.md)
is a gap in the *current* expressions that repairing a box does not close.

**The fix is really two questions.** Repairing today's boxes is one
`cb doctor annex` run each. The durable question is what re-applies box-level
annex configuration when the code's idea of it changes — a startup repair, a
housekeeping step, a health check that fails loudly, or an explicit rollout like
the template-version tracker. Related: `issues/watch/` has no item for this and
`config/template-versions.json` does not cover annex config.
