---
title: "Acknowledgements backfill: credit adopted external ideas"
status: draft
workstream: acknowledgements
issues:
  - ../../../issues/docs-and-chores/2026-09-30-attribution-for-adopted-ideas.md
---
# Acknowledgements backfill: credit adopted external ideas

Bee Box adopted ideas from other projects (skills, review formats, workflow
shapes, design patterns). Credit for those ideas lives only in research notes
and closed issues, which go stale. This plan produces a vetted acknowledgements
file from the repository record, as an unattended overnight run: sweep the
record for candidates, verify each against the landing site and the source,
and deliver a draft plus a review table for the boxholder to vet before
anything is committed.

**Issues addressed:** `issues/docs-and-chores/2026-09-30-attribution-for-adopted-ideas.md`
(both parts: the place for idea credits, and the backfill). Duplicate check:
`grep -rli 'attribution\|acknowledg' issues/` matches 58 files, all incidental
uses ("git attribution", "Created-By attribution"); none proposes crediting
external ideas.

## Smallest fix and budget

Smallest fix: one agent greps for "inspired by" and writes entries from memory.
Rejected: the boxholder's requirement is that entries be vetted and
well-supported, and the issue warns that keyword greps are noisy and that
"based on" matches ordinary prose. Memory-sourced credits are the failure mode
this plan exists to avoid.

Chosen design: one planner (Fable), eight bounded sweep workers (Sonnet), a
verification pass (Opus), and an assembly step. Authored output: one draft
acknowledgements file (~100–300 lines), one review table (~150–400 lines), one
exhibit. Code: none beyond ad-hoc grep prefilters. Nothing is committed except
this plan and any helper scripts.

## Stated preferences this plan trades against

- Boxholder, 2026-10-06 (handoff): "I want to vet the results before they go
  into history, as some things might not be well supported." → nothing enters
  git history; every candidate carries evidence and a confidence.
- Boxholder: "there should be some good planning here about the approach" →
  this plan, cross-model reviewed before the run.
- Issue threshold: adopted, changed, or used as a direct model gets an entry;
  evaluated-and-rejected does not. Research notes keep the evaluated list.
- `research/CLAUDE.md`: research corpora carry adopt/adapt/reject dispositions
  per idea. A disposition of "adopt" in a research note is a *proposal*, not
  proof of adoption; the proof is the landing file plus the commit or issue.
- Repo rule: public sources only. `private-issues/` and box content are never
  read or cited. Credits ship publicly.
- Memory ("minimize invented concepts"): do not create two tiers of
  attribution file if one will do (see Placement).

## What already exists

- `beebox/docs/attribution.md` — licensed-asset credits (Twemoji). Entry shape:
  package, artwork/author, license, where used, why. Reused as the model for an
  entry; not reused as the file (see Placement).
- `research/*/README.md` indices with disposition columns (`research/CLAUDE.md`:
  "which idea is adopt/adapt/investigate/reject"). These are the richest
  candidate source: a row marked adopt/integrate names a source and an idea.
- `research/external-skills-harvest.md`, `research/courseware-external-skills-triage.md`
  — per-item resolutions (`adopt`, `fold-in`, `write-new`, `idea`, `skip`), with
  DONE markers. Direct candidate rows.
- Corpus sizes, measured at commit `eb9a5e625` in this worktree with the
  commands in `scratch/ack/counts.sh` (re-run it to reproduce):

  | Source | Size |
  |---|---|
  | `research/` | 10 directories, 14 flat notes |
  | `issues/**` (all categories, open and closed) | 1,119 files |
  | `beebox/docs/plans` + `implemented-plans` | 297 files |
  | `beebox/docs/**` other than plans | 147 files |
  | tracked `CLAUDE.md`, `AGENTS.md`, `README.md` files | all packages |
  | `.claude/skills/*` | 24 skills; `.claude/rules/` does not exist |
  | `git log` (full bodies) | 8,420 commits |

  Prefilter regex, applied to full text (and to full commit bodies, not
  subjects): `github\.com|inspired|adapted from|borrowed|modeled on|modelled on|
  lifted from|ported from|stolen from|after the (approach|pattern|design)` plus
  the project names the research indices name (gstack, claude-elixir-phoenix,
  superpowers, openclaw, hermes, letta, opencode, pai, tiddlywiki, obra,
  addyosmani, mattpocock, hoversource, omi, rowboat, beads). The prefilter is a
  starting list, not the boundary: workers also read every research index,
  every skill, and every `CLAUDE.md` in full.

## Prior art (external)

No decision here depends on an external premise. Formats for CREDITS /
ACKNOWLEDGEMENTS files are conventional (one entry per source: name, author,
link, license, what was taken); no search needed.

## Ontology

- **Source**: an external project or person whose idea we took. Identified by
  its canonical URL. Has an author (named as the project presents them) and a
  license (as the repository states it; "none stated" is a valid value).
- **Idea**: one line describing what we took: a method, prompt structure,
  workflow, hook, or design. One source may contribute several ideas; each is
  its own candidate but entries group by source.
- **Landing**: the file (and line range where meaningful) in this repo that
  now embodies the idea. Must exist on `main` today. A landing that was later
  removed is a *historical* adoption and is flagged, not credited by default.
- **Adoption record**: the commit, issue, plan, or research row that names the
  source at the time of adoption. Distinguishes a credit from an inference.
- **Candidate**: (source, idea, landing, adoption record, confidence, reason,
  sweep origin). Produced by sweeps, merged by the planner, judged by verifiers.
- **Confidence**: `strong` = record names the source, landing verified present,
  author/license verified from the source; `plausible` = record names the
  source but the landing changed substantially or the adoption record is
  indirect (e.g. a research "adopt" row with the landing found by search);
  `weak` = inferred from resemblance, from memory, or evaluated-only with an
  unclear outcome.
- **Recommendation**: `include` / `include with changes` / `drop`, with the
  changes stated when applicable.

## Tracks / scope

### Track 1: Sweeps (Sonnet, 8 workers, ≤4 concurrent)

Each worker gets the shared brief (`scratch/ack/BRIEF.md`: the candidate
record shape, the threshold, the boundary rules) and its own corpus. It writes
`scratch/ack/sweep-<name>.md` with three required sections: `## Candidates`
(one record each), `## Read, no candidates` (every file or commit the worker
read that produced nothing), and `## Absent or skipped` (corpora that did not
exist, files it could not read). A sweep file missing any section fails the
aggregator check (`scratch/ack/check-outputs.sh`), which lists expected sweep
and verification files and refuses assembly until all exist and parse.

Workers must not use web lookups or memory; they report only what the corpus
says. For each candidate they quote (a) the adoption-record line that names the
source **and** connects it to what we built, and (b) the landing line(s) in the
current tree that embody the idea. A record that names a source without
connecting it to a landing, or a landing that merely resembles a source with no
record naming it, is reported as `weak` with the gap stated.

| Worker | Corpus | Method |
|---|---|---|
| research-a | `research/gstack`, `research/claude-elixir-phoenix`, `research/external-skills-harvest.md`, `research/courseware-external-skills-triage.md`, `research/pai`, `research/opencode`, `research/writing-practice` | Read every README index and disposition table; for each adopt/adapt/integrate/fold-in/DONE row, follow the stated landing or grep for it. |
| research-b | `research/openclaw-hermes`, `research/openclaw-personality-onboarding`, `research/openclaw-architecture-review.md`, `research/tiddlywiki`, `research/installable-app`, `research/backend-alternatives`, and the flat notes (hoversource, omi, rowboat, memory-atlas, no-mistakes, beads-vs-issues, chat-scroll, collection-use-cases, google-auth) | Same. |
| issues-closed | `issues/closed/**` (679 files) | Prefilter grep, then read each hit; also scan titles for external project names. A closed issue is an adoption record only if it names the source and the change shipped (check the landing). |
| issues-open | `issues/{bugs,features,exploration,decisions,deferred,docs-and-chores,code-quality,watch}` (440 files) | Same. Open items usually mean not yet adopted: report as `weak`/pending unless the landing already exists. |
| plans | `beebox/docs/plans`, `beebox/docs/implemented-plans` (296 files) | Prefilter grep, then read "Prior art (external)" sections of hits. A plan's prior-art row counts only if the plan shipped (implemented-plans, or landing exists). |
| skills | `.claude/skills/*/SKILL.md` and `references/`, every tracked `CLAUDE.md` and `AGENTS.md` (`git ls-files '*CLAUDE.md' '*AGENTS.md'`), `bin/*.md` | Read each in full for named sources and for borrowed structure (e.g. bbx-debug "Iron Law", circuit breaker). Unnamed structural resemblance is reported as `weak` with the resemblance stated; the planner cross-references it against research notes. |
| docs | `beebox/docs/**/*.md` excluding `plans/` and `implemented-plans/`, every tracked `README.md`, `agent-doctest/docs`, `workstreams-app/docs`, `canvas-loop`, `scan-uploader`, `beebox-clerk`, `ios-app` docs | Prefilter grep, then read each hit in full. |
| git-log | `git log --format='%H%x00%B' ` filtered by the prefilter regex on full bodies; for each hit `git show --stat --name-status --find-renames <hash>` | Read the body; record the hash as the adoption record; record the touched paths; follow renames to the current path and confirm the idea is present there now. Skip merges and dependency bumps. |

The eight workers run four at a time (two waves), each as a foreground
subagent with a bounded corpus so its context stays small; a worker whose
corpus prefilter exceeds ~60 files is told to process in alphabetical chunks
and append to its output file.

### Track 2: Merge and dedupe (planner)

Planner concatenates sweep outputs, groups by source URL (normalizing
`github.com/<org>/<repo>` variants), merges duplicate ideas, keeps every
distinct adoption record as corroborating evidence, and assigns a provisional
confidence. Candidates whose only evidence is resemblance with no record naming
the source stay `weak` regardless of how many sweeps noticed them.

### Track 3: Verification (Opus, batches of ~8 candidates, ≤4 concurrent)

For each candidate the verifier:

1. Reads the landing file and confirms the idea is present today; quotes it.
2. Reads the adoption record and confirms it names the source (not the
   planner's inference).
3. Fetches the source (repository root, README, LICENSE) and records author
   as presented, canonical URL, and license text name. If the source is
   unreachable, says so; the entry keeps the URL from the record and license
   "unverified".
4. Judges threshold: adopted/changed/direct model vs merely evaluated.
5. Writes the final confidence, recommendation, one-line reason, and a draft
   entry in the file's format.

Verifiers may use WebFetch/WebSearch for step 3 only. They must not add
candidates from their own knowledge.

### Track 4: Assembly and delivery (planner)

- The review table is the authoritative deliverable; the draft is derived
  from it. `ACKNOWLEDGEMENTS.md` at the repository root, uncommitted, contains
  only `strong` candidates whose recommendation is `include` or `include with
  changes` (with the verifier's wording). `plausible` candidates with an
  `include` recommendation go in a clearly separated final section of the draft
  headed "Needs confirmation", so the boxholder can delete the section or
  promote rows. `weak` candidates never enter the draft, whatever their
  recommendation; they are table-only until the boxholder promotes one.
- `scratch/ack/review-table.md`: one row per candidate, grouped strong /
  plausible / weak, with columns: id, source (project, author as presented,
  canonical URL, license, verified-on date or "unverified"), idea, landing path
  with quoted line, adoption record with quoted line, threshold basis (adopted /
  changed / direct model / evaluated only), confidence with reason,
  recommendation with the change wording, sweep origin(s).
- Exhibit: `bin/exhibits add --title "Acknowledgements backfill: vet the
  candidates" --ask decide --prose "<what happens after each option>"
  --option "Commit the draft as drafted" --option "Commit after my edits to the
  draft" --option "Rework: wrong approach or threshold" scratch/ack/review-table.md`.
  No `--open` (the boxholder is asleep). The prose states: option 1 → the next
  session commits `ACKNOWLEDGEMENTS.md` and links it from attribution.md;
  option 2 → the boxholder edits the file in the worktree, then the next
  session commits; option 3 → nothing is committed, the table stays as input.
- Final message: counts per tier, placement recommendation, anything the
  verifiers flagged as needing a human call (e.g. a person who should be named
  but whose project does not state a license).

## Placement (the issue's open question)

Recommendation: a root-level `ACKNOWLEDGEMENTS.md`, linked from
`beebox/docs/attribution.md` and the root README. Reasons: most adopted ideas
are dev-side (skills, hooks, review formats, `bin/` tools) and are not part of
the shipped `beebox/` package; the shipped package's licensed-asset obligations
stay in `attribution.md` where the license text expects to find them; one file
for ideas avoids a shipped/dev split that would make every new entry a
placement decision. Alternative kept open for the boxholder: a section in
`attribution.md` if they prefer one file for everything. The draft is written
so either placement is a move, not a rewrite.

## Could this be simpler?

Simplest version: one Opus agent reads the research indices and writes entries.
It fails on the issue's own warning ("review the matches by hand"): a single
context cannot read 1,100 issues, 296 plans, and 8,400 commits with care, and
would fall back to memory for coverage, which is exactly what the boxholder
does not want in history. The sweep/verify split buys auditable coverage (each
worker lists what it read) and a second model reading each candidate with the
source in hand.

What the plan does not do: no finish-flow check that adoptions carry entries
(issue Part 1, "when an entry is added"). That is a process change, out of scope
for a backfill, and noted under NOT in scope.

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| A sweep worker invents a source from its own knowledge | no | Worker instructions forbid it; verifier step 2 requires the adoption record to name the source | clear: fails verification |
| A research "adopt" row is treated as an adoption though nothing shipped | no | Worker must confirm the landing with `test -e` and a quote; verifier re-reads | clear |
| The landing was later removed or rewritten | no | Verifier step 1; entry flagged "historical" and recommended `include with changes` or `drop` | clear |
| Two sweeps report the same idea under different URLs | no | Planner normalizes URLs in Track 2 | mostly clear; a missed merge yields a duplicate row the boxholder sees |
| Author named wrongly (handle vs name, org vs person) | no | Verifier takes the author as the source presents them; table shows both when they differ | clear |
| Source unreachable overnight | no | License "unverified", confidence capped at `plausible` | clear |
| Machine overload | no | ≤4 concurrent workers, no test suites, grep prefilters, keep-awake hold placed | observable |
| A worker produces no output file, or a truncated one | no | `check-outputs.sh` names the expected files and required sections; assembly refuses to start until it passes; a failed worker is re-run on its corpus | clear |
| A corpus named in the plan does not exist (e.g. `.claude/rules/`) | no | Worker records it under "Absent or skipped"; planner confirms the list | clear |
| A landing resembles the source but nothing recorded the borrowing | no | Confidence capped at `weak`; never enters the draft | clear |
| A worker reads `private-issues/` | no | Instruction + the mount is outside the listed corpora; planner greps outputs for `private-issues` before verification | clear |
| Codex plan review unavailable | n/a | Report the blocker in the final message; proceed, since the boxholder said not to wait | clear |

Residual risk: the handling above is instructions to models plus one shell
check; a worker can still misquote a line. The verifier re-reads every quoted
line from disk, and the boxholder's vetting is the final gate, which is why
nothing is committed.

## Agent-flow / user-flow edge cases

- Wrong tier: the boxholder can move a row; the table shows the reason so the
  tier is contestable. ADDRESSED.
- Fabricated free-form value: the entry format requires a URL and a quoted
  landing line, which are checkable. ADDRESSED.
- Stale ref: landing paths are verified at run time on this branch (merged
  with `main` first). ADDRESSED.
- Hand-edit drift / two agents on one file: not applicable; one planner writes
  the draft.
- Partial state: if the run stops midway, `scratch/ack/` holds every finished
  sweep and verification batch; a resumed session re-runs only the missing
  ones. ADDRESSED.

## NOT in scope

- A finish-flow gate that checks adopted sources carry an entry (issue Part 1):
  process change, separate decision.
- Crediting code dependencies: `attribution.md` already states their licenses
  travel in `node_modules`.
- The two pending entries named in the issue (reader-context writing and
  incident-investigation, by Yaniv Ben-Ami): they appear in the table as
  pending (adopt not yet confirmed) unless the sweep finds the landing.
- Editing `attribution.md` or committing the draft before vetting.
- Reading `private-issues/` or any box content.

## Open design questions

- Whether a person named only as a handle should be credited by handle or by
  a name found elsewhere. Lean: as the project presents them, per the handoff.
- Whether "used as a direct model" includes a format we read and then wrote our
  own version of with no copied text. Lean: yes when the record says so.

## Knowledge audits

Skip: no box-agent-facing concept changes.

## What will hold this after it ships

Docs only. The doc-check hooks (links, path leaks, blocklist) run on commit.
The review table is the vetting record; it stays in `scratch/` (gitignored).

## Implementation order

1. Commit this plan. Cross-model review (Codex, plan mode); apply findings.
2. Track 1 sweeps, 4 then 3 concurrent. Outputs to `scratch/ack/`.
3. Track 2 merge. Grep outputs for `private-issues` and box paths.
4. Track 3 verification batches.
5. Track 4 assembly: draft, table, exhibit, final message. Release the
   keep-awake hold.

## Rollout shape

No tests. Done when: the draft exists uncommitted at the root, the review table
covers every candidate from every sweep, the exhibit is created with a `decide`
ask, and the final message reports counts and the placement recommendation.
