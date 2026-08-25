---
title: "History shows no trigger for procedure and trick commits, and its Workflow filter only matches pre-rename runs"
workstream: unattached
area: callback-box
labels: [user-stories-audit]
filed-by: agent
discovered-in: worktree-user-stories-refresh — user-story catalog verification
priority: normal
---

**What is wrong.** The history UI reads only two trigger conventions, and one of them is the retired name.

- `CommitTimeline.tsx` (CommitRow, ~line 157) puts a badge and aria-label on a row from `trailers.Phase` and `trailers["Triggered-By"]` only. `CommitDetail-commit.tsx` adds `Session`, `Workflow` and the connector keys (`Pulled-By`/`Created-By`/`Fetched-By`/`Pushed-By`/`Sent-By`).
- Procedure runs do not write `Triggered-By`. They write `Procedure: <name>` and `Step: <id>` (`core/procedure/engine.ts:163`, `core/procedure/engine-step.ts:152,184,272`, `core/procedure/engine-phase.ts:185`, `core/procedure/engine-orchestrate.ts:104`). Tricks write `Run-By: trick/<name>` (`cli/commands/trick.ts:42`). A grep over `callback-box/src/frontend/src` finds no reader for `Procedure`, `Step` or `Run-By`.
- The filter axis that would cover procedures is keyed on `Workflow:` — `getTrailerFacets` in `lib/git-log.ts:230` collects only that key, `webapp/trpc/routers/history.ts:42` greps `^Workflow: `, and `HistoryFilterBar.tsx:72` labels the control "Workflow". Nothing in `src` writes a `Workflow:` trailer any more; it is the name procedures had before the rename.

**User-visible consequence.** In the timeline, a procedure or trick commit looks like a hand edit — no trigger badge, nothing in the aria-label — which is the exact distinction the History page exists to make. The Workflow filter is populated from history old enough to predate the rename, so it lists stale run names and silently cannot select any procedure run made since; a boxholder who wants "show me what that procedure run changed" has no filter for it. In the detail pane the procedure trailers appear only as leftover text in the commit body, because `stripTrailers` (`CommitDetail-commit.tsx:33`) strips `Session|Phase|Triggered-By|Feedback-Source|Agent|Items-Processed` and not `Procedure`/`Step`/`Run-By`.

**Files involved.**
- Readers: `callback-box/src/frontend/src/components/history/CommitTimeline.tsx`, `CommitDetail-commit.tsx`, `HistoryFilterBar.tsx`, `history-filter.ts`, `HistoryBrowser.tsx`, `HistoryViewCard.tsx`
- Server/facets: `callback-box/src/lib/git-log.ts` (`getTrailerFacets`), `callback-box/src/webapp/trpc/routers/history.ts` (`buildGreps`)
- Writers: `callback-box/src/core/procedure/engine.ts`, `engine-step.ts`, `engine-phase.ts`, `engine-orchestrate.ts`, `callback-box/src/cli/commands/trick.ts`, `tick-helpers.ts`, `wakeup-steps.ts`, `callback-box/src/connectors/*`

**How this was established.** Grepped every trailer writer in `callback-box/src` and every trailer reader in `callback-box/src/frontend/src`. Then counted trailers in the worktree's test box (`~/src/box-worktrees/user-stories-refresh/test1`): `git log --format='%(trailers:only,unfold)'` yields 1857 `Triggered-By`, 104 `Workflow`, 54 `Procedure`, 97 `Step`, 0 `Run-By`; every `Workflow:` commit has a `[workflow] …` subject (pre-rename) while current runs subject as `[procedure] …` and carry `Procedure:`. An independent browser pass over `/history` in the same box confirmed the working half (rows badged "triggered by cb wakeup", session chip filtering to a run) and noted that rows without a `Triggered-By` — including procedure commits — show no badge at all.

## Updating the user-story catalog

This issue is why [`browse/see-which-changes-the-box-made-on-its-own-and`](../../callback-box/user-stories/catalog/2026-08-21.md#flagged-worth-a-human-glance) is currently
flagged ❌ in [the user-story catalog](../../callback-box/user-stories/catalog/2026-08-21.md) — a catalogue of what callback-box can
actually do, where every claim is checked against the source.

**When you fix this, re-check that story so the catalog stops being wrong.** It is a
short agent run over just the affected stories, not the full regeneration:

```
Workflow({scriptPath: "callback-box/user-stories/pipeline/recheck.workflow.mjs",
          args: {root: "<repo root>", date: "2026-08-21",
                 ids: ["browse/see-which-changes-the-box-made-on-its-own-and"]}})

pnpm exec tsx callback-box/user-stories/pipeline/apply-recheck.ts 2026-08-21
pnpm exec tsx callback-box/user-stories/pipeline/render.ts \
  > callback-box/user-stories/catalog/2026-08-21.md
```

The recheck is adversarial by design: it will not mark the story accurate just because
this issue was closed — it re-reads the code. If it still refutes, that is worth knowing
before you call the fix done. Details in
[the pipeline README](../../callback-box/user-stories/README.md).

Catalogued as `browse/see-which-changes-the-box-made-on-its-own-and` in the [user-story catalog](../../callback-box/user-stories/catalog/2026-08-21.md).
