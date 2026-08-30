---
title: "Story extraction: rubric, prompts, and the A/B review loop"
status: active
workstream: unknown
issues: []
---
# Story extraction: rubric, prompts, and the A/B review loop

Develop the extraction rubric and prompts that let subagents pull *story
nuggets* out of repo documents, prove them on a small varied corpus, and give
the boxholder an A/B review surface for judging prompt variants against each
other. The deliverable is a trusted extraction process, not extracted content —
content at scale comes after the rubric earns trust.

## Stated preferences this plan trades against

- The boxholder's spec (this session, 2026-07-21), the load-bearing lines:
  - Goal: "things that help describe why bbx is what it is, and also what it
    will become, and highlight features that serve a design purpose that might
    not be clear. We want people to feel a bit of surprise, or to understand
    the structure that fits things together."
  - "Often history is a good way to do that, so decisions and reasoning is
    important."
  - "Some things might seem simple but are very important to me (like
    `{% quote %}`), regardless of how complicated they might be."
  - Cross-cutting: "an individual thing doesn't make the cut (any one lint
    rule) but the aggregate would (all the lint rules)… Maybe we'd just use
    tags to accumulate them."
  - Method: "come up with some prompts, test them against a small set of
    documents… err on the generous side to start, and probably you should
    also directly review the subagent's work."
  - Judging: "I'll want you to look at my specific inputs, not an aggregate
    score, though sometimes we'll just throw away a prompt for being clearly
    bad."
- [writing-skill](../../../issues/features/2026-07-05-writing-skill.md):
  extraction output is machine-layer material (never published as-is — the
  parent plan's `proposed` wall); over-steering research argues for blind
  labels and unranked presentation in the review app.
- `docs/engineering-principles.md`: **3** (validate at boundaries — spans
  verified against sources mechanically), **4** (resilient and never silent —
  a fabricated span is a hard error, not a quiet drop), **11** (enforcement
  beats convention — the span check is code).
- Boxholder feedback memories: filter signal, not griping (the tedious-
  conventional failure mode is the extraction version of predictable-gripe
  noise); run the verification you author.

## What already exists

- **Nugget schema (parent plan Track E)**: `source` + verbatim `span` +
  `status: proposed` + tags — extraction output here is exactly `proposed`
  nuggets, so this subplan reuses that shape rather than inventing an eval-only
  format ([public-site.md](public-site.md), Track E). Eval runs add
  wrapper metadata (which prompt variant, which run) around that shape.
- **`dev/` static serving** (`bin/router-docs.ts:609-663`, served from disk,
  no cold start): the review app's natural home — `dev/story-eval/` with the
  app as `.html` and run data as JSON beside it, viewable at
  `/<worktree>/dev/story-eval/` with zero router changes.
- **Subagent machinery**: the Agent tool with parallel dispatch; model choice
  per CLAUDE.md ("Sonnet 5 is good at subagent work"; extraction is
  judgment-heavy, so first runs use Opus and we can test whether Sonnet
  matches).
- **Span verification precedent**: the parent plan's span-identity rule
  (verbatim, must match exactly once). The eval harness applies the same rule
  at ingest.
- **`site/` package tooling** (typechecked/linted/tested): harness code lands
  there (`site/story/`), not in `dev/` (which is untyped content).

## Prior art (external)

Deliberately not searched, with rationale: prompt-eval frameworks (promptfoo,
LLM-as-judge harnesses) solve aggregate-metric evaluation at N where a human
can't read everything. Here the evaluator is the boxholder reading specific
outputs by explicit instruction ("look at my specific inputs, not an aggregate
score"), N is single-digit prompts over single-digit documents, and the
review surface is bespoke to his triage flow. Adopting an eval framework would
replace the thing he asked for with the thing he declined. If extraction later
scales to the point where nobody reads everything, revisit.

## Tracks / scope

### Track A — the rubric and prompt variants

- **What**: one rubric (the concrete definition of "interesting" + the item
  shape) and N prompt variants that package it differently. The rubric is a
  named list, not vibes:
  1. **Unconventional choice** — bbx deviates from standard practice, with the
     reasoning (filesystem as DB, git as history, no accounts…).
  2. **Decision with reasoning** — a call that was made, what it traded away,
     especially reversals and roads-not-taken. History beats.
  3. **Non-obvious design purpose** — a feature whose *why* isn't visible from
     its *what* (schedules-off-by-default, marked placeholders…).
  4. **Simple-but-load-bearing** — small mechanisms carrying values weight
     (`{% quote %}` is the canonical case).
  5. **Unique/interesting mechanism** — things few other systems have (output
     parsing, reactor loop, agent-legible docs as product surface).
  6. **Distinctive development practice** — how the project is built
     (knowledge audits, doctests, agent-maintained artifacts).
  7. **Cross-cutting accumulation** — individually-small instances of a
     pattern; tagged so the aggregate can surface (`tag: lint-philosophy`,
     one per rule encountered) even when no single instance makes the cut.
  8. **Future-shaping** — tensions or intentions that say what bbx is becoming.
- **Item shape**: one idea per nugget. A verbatim `span` (the smallest quote
  that carries the idea — guideline ≤ ~25 lines, hard cap 40), a `gloss` (≤ 2
  sentences of agent prose saying what the nugget is — machine-layer text,
  never published), `tags` (kebab-case, including cross-cutting accumulators),
  `criteria` (which rubric numbers it claims), and `confidence: strong |
  generous` — the generous tier is explicitly invited this round.
- **Variants for run 1** (the A/B axes are framing, not criteria — all
  variants carry the same rubric list so we test packaging, not coverage):
  - **V1 checklist-sweep**: systematic — walk the document, test every
    section against every criterion, emit all candidates.
  - **V2 story-first**: role-framed — "you're researching the story of this
    project for a profile; find the beats that would surprise a technical
    reader or make the structure click," rubric as background.
  - **V3 outsider-surprise**: contrast-framed — "you know how these systems
    are usually built; extract every place this one does it differently and
    why, plus anything small the author treats as sacred."
- **First chunk**: the rubric + three variant prompts written into
  `site/story/prompts/` as committed files (the committed-prompt pattern from
  the parent plan applies here first).

### Track B — the run harness

- **What**: dispatch N variants × M documents as parallel subagents, each
  returning strict JSON (nugget list in the Track A shape); a small ingest
  tool (`site/story/ingest.ts`) validates with zod, **verifies every span
  appears verbatim exactly once in its source** (fabricated or mangled span =
  hard error naming the nugget — principle 4), strips/flags failures, and
  writes a run file `dev/story-eval/runs/<run-id>.json` carrying doc, variant
  (blind-labeled), and nuggets.
- **Why**: the span check is the honesty boundary — without it, "extraction"
  can quietly become invention.
- **First chunk** — **shipped 2026-07-22** (`site/story/ingest.ts` + tests):
  zod-strict validation (criteria 1–8 integers, kebab-case slug/tags,
  confidence enum), verbatim span check (0 → hard error naming the nugget;
  >1 → `spanCheck: "ambiguous"`), run files carry an embedded `docText`, and
  build-everything-before-writing keeps a fabrication fail-closed. Tests cover
  valid ingest, fabricated-span-rejected-by-name, ambiguous flag, criterion 12
  rejected, malformed tags, and docText embedding. Verified by re-ingesting
  run-003's v1-activities-retro (output matches the committed file modulo
  `docText`).
- **Coverage ledger** — **shipped 2026-07-22** (`site/story/coverage.ts` +
  tests): since the run dirs are now gitignored, `coverage.json` is the one
  tracked record of which docs have been scanned (runs, variants, nugget
  totals) and whether the scanned content still matches disk — `scanned-text`
  provenance when a run embedded `docText`, honest `current-file` fallback for
  older runs. `--check` reports drift (nonzero exit). First real run: 37 docs,
  all current.

### Track C — the review app

- **What**: `dev/story-eval/index.html` (static, no build step, served by the
  existing dev route): pick a run/document, see the document text with nugget
  spans highlighted, and the variants' nugget lists **blind-labeled** (A/B/C —
  mapping recorded in the run file but not shown) and unranked. Triage per
  nugget: keep / drop plus critique chips — `too-expansive`,
  `misinterpretation`, `tediously-conventional`, `bad` — and free text.
  Keyboard-first. Verdicts accumulate in localStorage with an **export**
  button producing a verdicts JSON the boxholder hands back (pasted or saved
  to `dev/story-eval/verdicts/`); ingest merges them.
- **Why static-first**: `dev/` serving needs no router change and no restart;
  the export step is the cost. If it annoys in practice, the fallback is a
  small router POST endpoint (a later decision, not built now).
- **Visual structure is the point**: the boxholder — "I'm not going to be
  able to read the text well without visual structure."
- **First chunk**: the app rendering one committed run with triage + export
  working.

### Track D — the evaluation loop

- **What**: for each run: (1) the agent's own direct review FIRST — named
  failure modes to hunt: *missed the good stuff* (spot-check: did it find the
  things we already know matter — `{% quote %}` in a doc that contains it?),
  *tediously conventional* (nuggets any project could emit), *too-expansive*
  (span sprawl), *misreading*; prompts failing obviously die here without
  spending the boxholder's time. (2) Surviving variants go to the boxholder's
  A/B pass in the app; his specific verdicts (not aggregates) drive the next
  prompt iteration. (3) Iterate on the same seed docs until a variant earns
  trust; then widen the corpus and keep evaluating on the new material.
- **Seed corpus (chosen for variety)**:
  `issues/closed/decisions/2026-07-08-release-cloud-provider-honesty.md`
  (tiny values decision — tests restraint),
  `beebox/docs/knowledge-audits.md` (distinctive-practice doc),
  `beebox/docs/implemented-plans/cards-as-markdown-rfc.md` (2555-line
  foundational plan — tests needle-finding).
- **First chunk**: run 1 (3 variants × 3 docs), agent self-review memo
  committed alongside the run.

## Subplans

None — this is already the subplan.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Subagent fabricates or mangles a span | planned (B1) | ingest span check: hard error naming nugget + source | clear |
| Span matches source more than once (ambiguous anchor) | planned (B1) | flagged at ingest; nugget carries the flag into review | clear |
| All variants converge (A/B tests nothing) | no — judgment | variants differ on a named axis (framing); self-review notes convergence | semi-silent, caught in D review |
| Generous tier floods review with noise | n/a (deliberate this round) | critique chips exist to prune; generosity dial tightens next iteration | clear by design |
| Review app can't usefully show a 2555-line doc | no | app design: span-anchored scrolling, collapsed non-matched regions | visible immediately in use |
| Verdicts lost (localStorage cleared before export) | no | export early/often; verdicts committed under `dev/story-eval/verdicts/` | semi-silent residual, accepted (single-user tool) |
| Agent self-review steers the boxholder's judgment | no | blind labels, unranked lists; self-review memo names *prompt-level* failures, not per-nugget rankings, before his pass | partial — accepted, he asked for exactly this pre-filter |
| Eval nuggets confused for publishable content | existing | they live in `dev/story-eval/runs/`, never `site/nuggets/`; the site generator only reads `site/` | clear by construction |

No critical gaps: every silent-and-unhandled candidate above is either
deliberate (generosity), single-user-accepted (localStorage), or caught at the
next human touchpoint.

## Agent-flow / user-flow edge cases

- **Fabricated free-form value** — the gloss misrepresents its span:
  **PARTIALLY ADDRESSED** — the span check proves existence, not fidelity;
  the boxholder's per-nugget review (with the `misinterpretation` chip
  feeding prompt scoring) is the designed backstop, and glosses never
  publish.
- **Stale ref** — seed doc edited mid-evaluation: **ADDRESSED** — runs pin
  content by span verification at ingest time; a later re-ingest against a
  changed doc errors loudly. Not a live concern during a run.
- **Hand-edit drift** — boxholder hand-edits a run/verdict JSON: **GAP,
  accepted** — these are ephemeral eval artifacts; zod re-validation on any
  ingest is the only guard.
- **Wrong tag** — subagents inventing divergent tag vocabularies across runs:
  **DEFERRED** — tags are accumulators whose vocabulary the boxholder will
  curate at elicitation time; premature normalization would fight the
  cross-cutting goal. Noted for the elicitation phase.
- **Two agents / concurrency, validation UX, partial migration** — not
  applicable: single-writer eval workspace, no data migration; validation
  errors are ingest CLI output read by the driving agent.

## NOT in scope

- **Elicitation** — explicitly deferred by the boxholder ("Elicit can come
  afterward, so don't worry about that at all").
- **Publishing** — nothing from eval runs reaches `site/nuggets/` or the
  page; promotion of trusted extractions into real `proposed` nuggets is a
  later, separate step.
- **Full-corpus extraction** — only after the rubric earns trust on seeds.
- **Git-history mining** — a later corpus; files first.
- **Chat-log mining** — a later corpus (boxholder, 2026-07-21: "we might want
  to do searches of chat logs to find some more of the decision process on
  some topics"). Worth extra weight when it comes up: the boxholder's side of
  a transcript is his *verbatim words*, so this corpus yields voice-authentic
  material the file corpora mostly can't — extraction and voice-sourcing in
  one pass. Privacy triage applies (transcripts weren't written for
  publication).
- **Router POST endpoint for verdicts** — static export first; build only if
  the export step proves annoying.
- **Embeddings/clustering** — parent plan already defers them.
- **Prompt-eval frameworks** — see Prior art.

## Open design questions

- **Model for extraction**: start Opus everywhere; once a prompt is trusted,
  test whether Sonnet matches on the same seeds (cost matters at full-corpus
  scale). Lean: decide on evidence from run 2+, not now.
- ~~**Where triage verdicts ultimately live**~~ — DECIDED (boxholder,
  2026-07-22): the triage *process* is not tracked. Extraction runs and
  verdict exports are local working files (gitignored:
  `dev/story-eval/runs/`, `dev/story-eval/verdicts/`); only **outcomes**
  commit — promoted nuggets, rubric/prompt revisions, and learnings folded
  into this subplan. (Runs 001–003 and the pass-1 verdicts predate the
  decision and remain in git history; untracked going forward. No history
  surgery, per the standing 2026-07-05 decision.)
- **When a "trusted" prompt is trusted enough** — the boxholder calls it; no
  numeric threshold (house rule: no scoring).

## Knowledge audits

Skip, with rationale: dev-repo editorial tooling; no box agent ever touches
the rubric, harness, or app. The conventions that matter to future dev-repo
agents live in this subplan and `site/story/prompts/` themselves.

## Implementation order

1. **A1** — rubric + three variant prompts committed (`site/story/prompts/`).
2. **B1** — ingest.ts (zod + span verification) + tests.
3. **D1** — run 1: 3 variants × 3 seed docs via parallel subagents; ingest;
   agent self-review memo committed with the run.
4. Prompt iteration from the memo (kill/fix variants) → run 2 if warranted.
5. **C1** — review app over the surviving run.
6. Boxholder A/B session; his verdicts drive the next loop.

Steps 1–4 need no boxholder input and are the "initial test yourself" he
asked for; 5–6 are where he enters.

## Rollout shape

- Tests named with their chunks: B1's ingest tests (valid run; fabricated
  span rejected by name; ambiguous span flagged) are the load-bearing ones —
  they encode the honesty boundary. The app (C1) is verified by use against a
  committed run, not unit-tested (static single-user tool).
- No migration; no data shape changes outside the eval workspace.
- This subplan ships with its parent: nothing here gates the site's public
  behavior — the eval workspace is dev-only (`dev/` is never published to
  Pages; the generator reads only `site/`).
