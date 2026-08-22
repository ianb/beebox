# User stories

What callback-box can actually do, catalogued from the source and checked against it.

The current catalog is [catalog/2026-08-21.md](catalog/2026-08-21.md). It is produced by reading
the source with a fleet of agents and then checking every claim they make.

The output is only worth having if you trust it, and the only reason to trust it is that **nothing
in the document is asserted by the agent that wrote it**. Every stage below exists to check the
previous one. If you change this pipeline, keep that property or the document becomes decoration.

## Layout

```
user-stories/
  README.md          this file
  pipeline/          the workflows and tools that produce a catalog
  catalog/
    2026-08-21.md    the readable catalog
    2026-08-21.jsonl one capability per line, with the evidence behind
                     its verdict — what the markdown is rendered from
    2026-08-21.meta.json  run-level facts (counts, in-app page reports)
    2026-06-26.md    the superseded predecessor, kept for its item
                     numbering (a follow-up plan indexes into it)
  work/              gitignored. A run's ~400 intermediate files.
                     Disposable: `freeze.ts` collapses what matters into
                     catalog/, and `render.ts` prefers that, so a
                     committed catalog re-renders from the repo alone.
```

**On the two committed formats.** The `.jsonl` is the data; the `.md` is the artifact people read
and link to. Keeping both means the content sits in the repo twice (~1.4 MB + ~1 MB per run), which
is the price of a catalog that is both browsable and checkable. The `.jsonl` is line-delimited and
sorted by id specifically so git can diff it: a re-run that changes three capabilities shows three
changed lines rather than reshuffling a 1.4 MB blob.

## What a "story" is

One record = one thing a person or their agent can actually do today. The whole pipeline moves
records around; the markdown at the end is just a view over them.

```json
{
  "id": "seam-connectors-r2-02",
  "title": "Calendar sync repairs an expired sync token and isolates one bad calendar",
  "story": "As a box owner, I want ... so that ...",
  "group": "connectors",          // product capability area, NOT a source directory
  "audience": "agent-scripts",    // web-ui | agent-scripts | operator
  "files": ["callback-box/src/connectors/google-calendar.ts"],
  "evidence": "runCalendarSync catches the per-calendar failure: on HTTP 410 it ...",
  "sourceFile": "seam-connectors.r2.json"
}
```

`id` is the join key for everything downstream. Duplicated or malformed ids break the run, which
is why the validator refuses to continue on one.

## The stages

Each stage writes JSON under `scratch/user-stories/` (gitignored) and returns only a compact index,
so 650 stories' worth of prose never enters the orchestrator's context.

| # | Stage | Agents | Writes |
|---|---|--:|---|
| 1 | **Discover** — read the code, write down what it does | ~76 | `areas/` |
| — | *validate* (script, fails closed) | 0 | `stories.json` |
| 2 | **Consolidate** — fix labels, merge duplicates | 15 | `normalize.json`, `dedup/` |
| — | *apply* (script, fails closed) | 0 | `stories.final.json` |
| — | *batch* (script) | 0 | `batches.json` |
| 3 | **Verify** — check each claim against code, then against the running app | ~241 | `verdicts/`, `browser/` |
| 4 | **Panel + triage** — re-examine every flag, decide what it means, file issues | ~90 | `panel/`, `triage/` |
| — | *render* (script) | 0 | the markdown |
| — | *freeze* (script) | 0 | `catalog/<date>.jsonl` + `.meta.json` |

### 1. Discover

21 readers: **14 by directory** (the carve covers every directory under `src/` — check this if the
tree changes) and **7 by seam**, following one capability end to end across directories. The seam
readers exist because a route + a component + a core service is *one* capability that no
single-territory reader sees whole; telling readers to stay in their territory drops exactly the
capability users care about most.

Each unit loops until a round returns fewer than 3 new stories, to a ceiling of 4 rounds. A fixed
round count cannot prove dryness.

Then **four bounded critics** each walk a finite, listable surface — every CLI command, every tRPC
procedure and route, every card schema, every capability the docs claim — and report items with no
coverage. Bounded is the point: one critic asked to audit everything samples and anchors instead.

### 2. Consolidate

The 21 readers deliberately overlap, so the same capability gets written down two or three times.
One merger per `group` collapses them, told throughout that **under-merging is far safer than
over-merging**: a near-duplicate left in is untidy, a wrong merge silently deletes a real
capability. Last run: 1,024 → 667.

Labels are normalized *first*, so dedup compares stories that are actually in the same group.

### 3. Verify

A different agent than the one that wrote the story, told to **refute when uncertain**.

Batches of 3 are **stratified, not sibling** — each batch draws from three different readers
(`make-batches.ts` round-robins over units). Three adjacent stories from one reader is the worst
available batching choice, because siblings share that reader's blind spots, vocabulary and cited
files, so one anchored verifier can wrongly confirm the whole cluster.

The browser pass drives the real app with `bin/browse`, one agent per page. It reports problems it
hits whether or not a story covers them — last run that produced most of the filed issues.

### 4. Panel and triage

Every flagged story goes to three reviewers, one question each:

1. **exists** — is the code real and wired up?
2. **reachable** — can the story's role actually get to it?
3. **wording** — does the code do the *whole* of what the sentence claims?

> **Any single refutation upholds the flag. This is NOT a majority vote.**
>
> The lenses test three separate *necessary* conditions — a story is true only if all three hold.
> Counting votes lets "exists" and "reachable" outvote a correct wording refutation, which is
> precisely how an over-claim ends up wearing a green check.
>
> This was gotten wrong on the first run (2026-08-21) and shipped three stories with a ✅ directly
> above their own panel note reading "upholds the flag". Fixing the rule flipped **21 of 28**
> results; 19 had been refuted on wording alone. Real gaps went 4 → 9. Do not re-introduce a
> threshold here.

Triage then classifies what survives as `stale-story` (drop it), `false-negative` (restore it), or
`real-gap` (a genuine product problem → an issue in `issues/`, with no `priority:` set).

## Running it

Needs `pnpm dev` up (for the browser pass) and a box to point at. Chain the workflows across turns
— read each result before starting the next, and re-run the validator between stages.

```bash
ROOT=$(git rev-parse --show-toplevel)
mkdir -p "$ROOT"/callback-box/user-stories/work/{areas,verdicts,panel,browser,dedup,triage}
```

1. `Workflow({scriptPath: "callback-box/user-stories/pipeline/discover.workflow.mjs", args: {root: ROOT}})`
2. `pnpm exec tsx callback-box/user-stories/pipeline/validate-discovery.ts` — **exits non-zero on a
   partial discovery; do not proceed past a failure.** It checks every expected unit produced a
   file, every file parses, every id is unique, every field is present, and every cited path exists.
3. `Workflow({… consolidate.workflow.mjs, args: {root: ROOT, groups: [...]}})` — groups come from
   the validator's output.
4. `pnpm exec tsx …/apply-consolidation.ts` then `…/make-batches.ts`
5. `Workflow({… verify.workflow.mjs, args: {root: ROOT, batchCount: N}})` — N from make-batches.
6. `Workflow({… panel.workflow.mjs, args: {root: ROOT, flagged: [...], browserFailed: [...]}})` —
   both lists come from the verify result.
7. `pnpm exec tsx …/render.ts > callback-box/user-stories/catalog/<date>.md`
8. `pnpm exec tsx …/freeze.ts <date>` — collapses `work/` into the committed `.jsonl`.
   **Do this before `work/` is cleaned**, or the catalog stops being reproducible: the verifier
   notes and panel votes behind every verdict live only in `work/` until it runs.

Every workflow takes `{root}` as an absolute path. They have no filesystem access and every
subagent prompt needs absolute paths, so it cannot be derived inside the script.

## Things to change next time

- **Set `model` on the cheap stages.** The 2026-08-21 run left every agent on the inherited session
  model (Opus 5) — ~420 agents, ~30M tokens. Discovery, verification and dedup are mechanical
  enough for Sonnet; reserve the larger model for the critics, panel and triage. `agent()` takes
  `{model: 'sonnet'}`.
- **Give the browser pass an owner session.** `bin/browse` authenticates with a key that clears the
  box auth wall but is *not* the box owner, so owner-gated surfaces returned 403. That is most of
  the 57 inconclusive checks — a third of the whole browser pass.
- **Re-check the directory carve.** The 14 territories were verified against the tree as of
  2026-08-21. New top-level directories under `src/` will silently belong to nobody.
- **Review the rendered output, not just the design.** The design was cross-model reviewed before
  the run and the panel bug survived it; reviewing the finished document is what caught it.

## Why the scripts do the assembling

`render.ts` builds the document mechanically from the records. A ~650-story document is more than
one agent can emit faithfully, and generating it in code is what guarantees the badge on a story
matches the verification actually recorded for it. Nothing between the evidence and the page is a
judgment call. Keep it that way.
