---
title: "Public site — orientation & re-entry map"
status: partial
workstream: public-site
issues: []
---
# Public site — orientation & re-entry map

*(The static deployment target is Cloudflare Pages. The thing is the
project's public site.)*

**Read this first when picking the work back up.** A snapshot of where the
effort is and the open fork, so a fresh session (and the boxholder) can
re-enter without replaying the whole history. Links the two design docs:
[the site plan](public-site.md) and
[the extraction subplan](public-site-story-extraction.subplan.md).

## What this is

A public site for Bee Box on Cloudflare Pages. Settled principles
(in [the issue](../../../issues/features/2026-07-20-public-site.md)):
spare, not slick — "cool in a different way," discovered by iterating, not a
hero page; **the boxholder's own words carry the human-facing prose** (AI
structure ok, AI words not); a visibly separate machine layer for agents
(llms.txt); static and precalculated (no live AI); **generated on deploy from
repo content**; telescopic/"fisheye" (expand-in-place) presentation as the
design exploration; **outcomes tracked in git, the working process not**.

## Current checkpoint (2026-09-10)

The static site exists. Commit `3777331df` adds app-matched paper/card/system
themes through local CSS snapshots, an authored navigation card, recursive
attached documents, desktop parent/aside and mobile single-card layouts, and
optional in-page navigation with history and saved offsets through reload.
Agent-prompt blocks have exact-text copy and selectable-text fallback. The
existing install prompt is near the top of home; learning-prompt authoring is
supported, but no learning prompt has been written.

See the [card authoring guide](../../../site/card-authoring.md) for current
behavior and the [site plan](public-site.md) for checkpoint evidence. Content
remains editorial drafts. Public prefix naming, tabs, contextual deep-link
policy, box authoring/export, and the broader extraction/content plan remain
open. Landing this checkpoint does not establish deployment completion.

## Existing story-extraction feeder

The **story-extraction pipeline** mines the repo for "story nuggets" (verbatim
spans + why-they-matter), which the boxholder triages keep/drop, destined to
become his-voice content on the page. The following records earlier work;
this checkpoint does not independently re-verify the extraction pipeline:

- **Rubric + 2 prompt variants** (`site/story/prompts/`), sharpened twice from
  boxholder triage: size budgets, cross-cutting accumulators, and the
  load-bearing **deficiency-vs-tension** rule (a real tension is story; "X
  doesn't work yet" is not).
- **Ingest tool** (`site/story/ingest.ts` + `span-locate.ts`) — the honesty
  boundary: strict zod, and every span verified verbatim against source
  (fabrication hard-fails), with whitespace-tolerant recovery that stores the
  canonical source text.
- **Coverage ledger** (`site/story/coverage.json`, `coverage.ts`) — which docs
  are scanned, at what content-hash, drift detection via `coverage --check`.
- **Review app** (`dev/story-eval/`, a `/dev/` page) — triage nuggets
  keep/drop with blind A/B prompt-variant glosses, chips, notes, autosave,
  per-doc + aggregate progress. Reached via the `/dev/` manifest card.
- **Extracted so far**: ~37 docs (research syntheses, retrospectives,
  implemented-plans, the decision-issue cluster). Runs + verdicts are
  **local working files, gitignored** — only the tooling and coverage commit.

## What was learned (don't re-derive)

- **Corpus kind dominates quality.** Research syntheses & retrospectives
  triage near-100% keep; launch/process-mechanics decisions near-chaff. Feed
  the story-dense corpora first.
- **Deficiencies are not story; tensions are.** An unfixed problem restated as
  "notable" is a false positive; a genuine competing-goods conflict — even
  unresolved, even in-progress — is real story. (Rubric now enforces this.)
- **Triage notes are proto-elicitation.** The boxholder's best material so far
  wasn't extracted — it was what he *typed while triaging* ("you can throw
  away very big ideas with much less regret"). The note field is quietly
  becoming the interview. This shapes the elicit step below.

## Direction shift (2026-08-19)

The fork below is now historical: (d) was chosen and prototyped (fisheye →
three-voice categorized asides; unlisted pages `fisheye.md` and
`walkthrough.md`), and the design moved again in conversation — **a box
authors the site** (box-defined page/aside card types + views as the CMS; a
separate ad hoc React/Tailwind static builder with cards as source; publish
as its own path). See the "Direction shift" section of
[the site plan](public-site.md), the
[box-CMS exploration issue](../../../issues/exploration/2026-08-19-site-authored-in-a-box.md),
and the [Bee Box rename decision](../../../issues/decisions/2026-08-19-bee-box-rename.md)
(character/mascot direction: Brown Paper School register, wordless bee = the
agent, the boxholder as a voice strictly in his own words). Next experiment:
a `page` schema in a test box, the walkthrough authored as a card, a crude
export.

## The open fork — superseded (kept for history)

The back half of the pipeline, and the site itself, are undesigned. Pick one:

- **(a) Keep triaging.** Concrete, in-progress; more verdicts sharpen the
  rubric and reveal the elicitation shape. Lowest-design, highest-momentum.
- **(b) Build the *promote* step.** Turn keeps into real committed
  `site/nuggets/` (the `proposed → reinterpreted/excerpt` lifecycle in the
  plan's Track E). Undesigned; the bridge from triage to publishable content.
- **(c) Design *elicitation*.** Where a kept nugget becomes a question that
  draws out the boxholder's *telling* — the point where his voice enters. The
  triage notes show this is the real product. Deferred until now on purpose.
- **(d) Start the *site itself*.** The fisheye prototype and the actual
  front-door letter — nothing has been built. The pipeline has arguably
  outrun the thing it feeds; this refocuses on the deliverable.

No default is right — it's a boxholder call about where energy goes.

## Practical state (updated 2026-08-15)

- **All tooling is landed on `main`** (through `e84d2ac6`); the workstream was
  renamed `github-pages-site` → `public-site` and the old worktree/branch
  removed. Current work happens in the `public-site` worktree.
- **The triage working set did not survive the old worktree's removal.** The
  extraction runs (`dev/story-eval/runs/`, ~37 docs of nuggets) and the
  autosave verdicts file were gitignored and lived only in that worktree; no
  manual export exists on disk. What remains:
  - `site/story/coverage.json` — which docs were scanned, content hashes,
    nugget counts (but not the nuggets themselves).
  - Browser localStorage (`story-eval-verdicts-v1`, origin `localhost:3210`,
    shared across worktree prefixes) — likely still holds decisions, chips,
    and the triage **notes** (the proto-elicitation material). The app's
    Export builds from loaded runs, which now 404, so salvage means reading
    the key directly via devtools console, not pressing `e`.
  - Verdicts key on group ids derived from run spans, and re-extraction is
    not deterministic — so decisions can't be re-joined to spans. The notes
    text (keyed by doc) is the recoverable part worth salvaging.
  - The rubric sharpenings and learnings above were committed — the durable
    outcomes survived; the working process did not (as the principles said).
- App/`dev/` changes need no router restart (served from disk); past
  `router.ts` changes did.
