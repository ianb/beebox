---
title: "refresh-maps max-turns:40 is an unmeasured throughput knob"
workstream: refresh-maps-throughput
filed-by: agent
discovered-in: refresh-maps convergence work (worktree-refresh-maps-convergence)
area: callback-box
---

`templates/procedures/refresh-maps.procedure.card` caps its agent at
`max-turns: 40` on haiku. Before the convergence fix, an agent that hit that cap
banked *nothing* — the whole brief repeated next run — so the cap was a
correctness problem disguised as a budget.

That's fixed: finalize now runs as a run-phase shell and stamps only the maps it
can prove were rewritten, so a capped run banks its partial work and the next run
continues from there (see
[`docs/plans/refresh-maps-convergence.md`](../../callback-box/docs/implemented-plans/refresh-maps-convergence.md)).

What's left is a genuine throughput question with no measurement behind it: on a
box with a large brief, 40 turns means N runs to converge, and nobody has checked
what N actually is or how many maps one haiku run gets through. Raising it, or
switching model tier, is guessing until someone watches a real refresh on a big
box. Worth measuring before tuning.

Related: [box-packageify doubled subtrees](../closed/bugs/2026-07-15-box-packageify-doubled-subtrees.md)
— the corruption that produced a maximally-inflated brief in the first place.

## Measured, 2026-08-24

Sample: every refresh-maps run with a surviving agent transcript on the three
deployed boxes that carry history — 28 runs, 2026-07-13 → 2026-08-24. (Earlier
run cards exist but are stuck in `status: running` with no session, from before
the engine recorded step results.) All three boxes are on the `claude` engine and
every run resolved to haiku, so the `haiku` → tier `efficient` rename does not
split the sample. Turn counts are per agent invocation: the validate step spawns
its own review agent in the same session, which does not draw on the refresh
step's `max-turns`.

**The cap is not the binding constraint.**

- Refresh-agent turns: median 12, range 9–41. **One run of 28 hit the cap.**
- The largest single run banked **36 maps in 25 turns** and passed validate. The
  biggest box holds 28 MAP.md files total, so a maximally-dirty whole-box brief
  already fits inside 40 turns with room to spare.
- Cost structure is ~9–11 turns of fixed overhead (brief, finalize, commit)
  plus well under one turn per map at volume — a 1-map run costs 9–12 turns, a
  36-map run costs 25.
- Wall clock: 64s–441s per run, median ~200s.
- No box ever needed multiple runs to work off a backlog. Multi-run streaks
  exist, but each run's brief was 1–6 maps; they are repeat *failures*, not a
  queue draining.

**The one capped run was not throughput-limited.** Its brief was 2 maps. It
spent 36 of 40 turns on `Bash` — repeated `git show`/`status`/`log`/`ls-tree`
and four re-runs of `cb refresh-maps` — auditing its own work, and 2 turns
writing maps. Raising the cap would have bought it more auditing.

**What does limit this procedure: a *different* turn cap.** 12 of 28 runs are
marked `failed`. Classifying all 12:

- **6 are not verdicts at all.** The validate step's review agent has its own
  budget — `REVIEW_MAX_TURNS = 8` in `engine-validate-model.ts` — and blew
  through it, recording "could not obtain a verdict: Reached maximum number of
  turns (8)". All six also recorded `stdout: All MAP.md files current.`, i.e.
  the map work was fine and only the judge ran out of room. **This, not
  `max-turns: 40`, is the turn cap that actually binds.** A retry at double the
  budget landed in `6183eb7e` on 2026-08-24 — after every run in this sample —
  so the fix is in main and unproven in the field.
- **3 are the reviewer being wrong about the ignore policy.** Two runs were
  flagged for "regressing" maps by dropping `config/connectors|procedures|
  schedules|schemas/` and `store/archive|calendar|chat|trash/`. Every one of
  those is in `SKELETON_HIDDEN_PATHS`, whose own doc comment says "the dir
  itself is excluded from its parent's listing". The refresh agent removed them
  correctly; the judge, reasoning only from "these still exist on disk", called
  it a regression. A third flagged missing evidence in the session manifest.
- **2 are real but structural, not map quality.** `store/usage/session-manifest.jsonl`
  lives *inside* `store/`, so procedure bookkeeping re-dirties `store/` right
  after it is stamped. The judge is correct that the next precheck will not be
  a no-op; nothing is wrong with the maps.
- **1 is a genuine outstanding-work failure** — the only run in 28 where
  `--brief` still reported `needsWork: true`.

**No confirmed case of the efficient tier writing a bad map.** The one run that
looked like proof of it was the reviewer's error. An earlier draft of this
measurement reported that regression as real; it was not.

One real (small) bug surfaced along the way, filed as
[map children git vs disk](../bugs/2026-08-24-map-children-git-vs-disk.md):
`children` is
derived from `git ls-tree` on the update and asOf-recovery paths but from
`readdir` on the no-state create path, while `listMappableDirs` always walks
disk. A directory holding only untracked content is therefore visible to the
walker but absent from the git-derived listing — which is why one directory
dropped out of its parent's map on 2026-08-06 and returned on 2026-08-11 once
it had tracked content.

**Cost, for whatever tuning follows.** Mean $0.14 per refresh invocation at
`efficient`/haiku (dominated by cache reads); the same token profile at
`balanced`/sonnet prices is ~$0.41. Across three boxes running daily that is
roughly $12/mo → $37/mo. Raising `max-turns` alone changes nothing, since
almost nothing reaches it.

## Tier comparison, 2026-08-24

Measured rather than argued, since the tier question came up once the "haiku
damages maps" reading was withdrawn. A purpose-built fixture box, bootstrapped
from one pinned seed commit, produces a 7-directory / 25-child brief mixing
names that need an annotation with names that don't. Three runs per tier through
the real procedure path, `efficient` vs `balanced`, same brief every run.

**Both tiers are mechanically perfect.** 7/7 maps written, 0 children dropped,
0 entries invented, 0 annotations over the 100-character limit, in all six runs.
Nothing supports the idea that the efficient tier damages maps.

**They differ on whether the map says anything.** Scoring against the fixture's
two deliberate name classes — 8 entries whose meaning the name does not carry,
12 that speak for themselves:

| tier | annotated the opaque 8 | annotated the obvious 12 | mean |
|---|---|---|---|
| `efficient` | 2.0 (range 1–3) | 0.7 | 232s |
| `balanced` | 5.0 (range 3–6) | 4.7 | 185s |

The same directory, same brief:

```
efficient                 balanced
- `codes/`                - `codes/` — ISO reference tables (country, currency)
- `g7.doc.card`           - `g7.doc.card`
- `rfc-index.doc.card`    - `rfc-index.doc.card`
- `scratch/`              - `scratch/` — working notes
```

The efficient tier reliably produces a strictly worse `ls` — it costs a model
call and adds nothing the filenames already carried. That defeats the point of
MAP.md while passing every check the procedure makes, because the template says
annotations are optional.

But `balanced` is not the fix. It annotates 4.7 of the 12 self-explanatory
entries, which the template explicitly tells it not to do, and it still misses
the two most opaque names in the fixture. Its range (3–6) overlaps the efficient
tier's. And neither tier obeys the SHELL DIRS rule: both were handed a directory
whose contents are hidden by ignore patterns and asked for an honest count, and
neither produced a count in any run.

Both tiers fail the same instructions, in the same places, at different rates.
That is a prompt result, not a capability result — the annotation rule is
written as permission ("annotations are OPTIONAL … only earns its place when it
tells a reader something the name doesn't"), and it gives no way to tell which
case a given entry is. Buying around it with `balanced` costs ~3× per run and
still leaves the SHELL DIRS rule unfollowed and the obvious entries
over-annotated.

### Then the template was sharpened, and the prompt hypothesis failed

The reading above — "prompt problem, not capability problem" — was testable, so
it was tested. The annotation rule was rewritten to lead with a mandatory `ls`
into each subdirectory ("a name is not enough to annotate from"), to replace
"annotations are OPTIONAL" with one explicit test (*could someone who has never
seen this box predict what is inside, from the name alone?*) with paired
yes/no examples, and to require a count for shell dirs. Same fixture, same
seed, three runs per tier again.

Raw coverage rose for both tiers. But so did annotation of the entries that
should have stayed bare, by about the same amount — so what moved was the
annotation rate, not the judgment:

| tier | version | annotated the opaque 8 | annotated the obvious 12 | discrimination |
|---|---|---|---|---|
| `efficient` | before | 25% | 6% | +0.19 |
| `efficient` | after | 54% | 33% | **+0.21** |
| `balanced` | before | 62% | 39% | +0.24 |
| `balanced` | after | 83% | 50% | **+0.33** |

Discrimination is the gap between the two rates — the thing the test in the
prompt is supposed to produce. **For `efficient` it did not move** (+0.19 →
+0.21 is inside the run-to-run spread; its opaque range across three runs was
2–6). For `balanced` it did (+0.24 → +0.33). A sharper instruction turned the
dial up on the efficient tier and taught the stronger one the rule.

Neither tier produced the count the SHELL DIRS rule asks for, in any of the
twelve runs across both versions. After the rewrite they do annotate those
directories, but with characterizations ("trip photos") or file enumerations
("(a.jpg, b.jpg)") rather than the honest count the instruction spells out and
gives an example of. That instruction is not landing for either tier, and more
prompt did not fix it.

**Revised recommendation: the tier change is justified; the earlier "sharpen
the prompt instead" was not.** The prompt was the cheaper hypothesis and it was
worth testing before spending 3× per run, but it failed on its own terms: the
efficient tier does not apply a decision rule it is given, it just responds to
emphasis. Keep the sharpened rules (they help `balanced` and raise coverage on
both), and move the template to `balanced`.

Cost of that, measured rather than guessed: mean $0.14 → ~$0.41 per invocation
at API prices, ~$12/mo → ~$37/mo across three boxes running daily — and
materially less than that on subscription quota. Note the direction of the
per-run duration too: `balanced` was not slower (185s mean vs 232s for
`efficient` in the first round), because it needs fewer turns to get there.

**The reusable part:** the fixture, the arms, and the rubric are a harness for
this question, not a one-off. Re-running is one command, so the next person to
wonder whether a tier or a prompt change helps can answer it in twenty minutes
instead of arguing.

**Recommendation: leave `max-turns: 40` alone.** It is correctly sized and is
not what limits throughput. The open question the data actually raises is
whether the validate judge should be taught the ignore policy it keeps
tripping over — filed as
[validate judge lacks ignore policy](../bugs/2026-08-24-validate-judge-lacks-ignore-policy.md)
— and whether an inconclusive review should read as inconclusive rather than as
a failure. Both are separate from this issue.
