---
title: "Documentation structured like code: one home per fact, names as the search path"
status: active
workstream: doc-structure
issues:
  - ../../../issues/exploration/2026-09-15-prompts-as-code-mece-structure.md
---
# Documentation structured like code

Bee Box's written guidance accretes: sections get added beside older sections
that say something overlapping, and nobody reads the whole. This plan adopts one
organizing principle for the engine docs under `beebox/docs/`, and later for
box-loaded guidance: every fact has one home, and directory names, file names,
and headings form a path a reader walks to that home without searching. The
principle is stated so that two people applying it to the same material would
produce the same tree. A pilot restructures the testing cluster and measures the
result before anything else moves.

**Issues addressed:**
[prompts as code](../../../issues/exploration/2026-09-15-prompts-as-code-mece-structure.md)
(the source of the idea). Related, referenced not duplicated:
[review all prompts](../../../issues/docs-and-chores/2026-03-16-review-all-prompts.md)
(the end-to-end read),
[instruction surface size budget](../../../issues/docs-and-chores/2026-07-04-instruction-surface-size-budget.md)
(volume),
[CLAUDE.md / docs backlog](../../../issues/docs-and-chores/2026-07-04-claude-md-review-docs-backlog.md)
(asks for a `testing-practice.md`; the pilot's `testing/README.md` is where
that content belongs, see track 2),
[doc refresh cadence](../../../issues/docs-and-chores/2026-07-04-doc-refresh-cadence.md)
(docs-versus-code adjudication; not organization).

## Smallest fix and budget

Smallest fix: write the principles into `beebox/docs/README.md` and apply them
only when a doc is next touched. That costs nothing now and changes nothing
now. It fails per principle 7 (hierarchy is a discoverability contract): a
contract nobody has seen applied is not adopted, and the existing overlap
(below) stays in place indefinitely.

Chosen design, three tracks:

| Track | Source lines | Authored doc lines (adds + deletes) |
|---|---|---|
| 1. Principles in `docs/README.md` | 0 | ~120 |
| 2. Pilot: testing cluster into `docs/testing/` | ~10 (manifest allowlist and its test) | ~1,600 moved or rewritten, plus ~20 hand-repaired links |
| 3. Measurement: find-the-fact before and after | 0 | ~120 (protocol and results, in this plan) |

No generated output changes except `docs/doc-graph.md`, regenerated. Not a BIG
CHANGE by source; the doc churn is the point and is reported separately. The
broad restructure of the rest of `beebox/docs/` and any change to box-loaded
guidance are outside this plan (see NOT in scope) and get their own plans after
the boxholder reacts to the pilot.

## Stated preferences this plan trades against

- Engineering principle 7, *hierarchy is a discoverability contract*
  (`docs/engineering-principles.md`), and 8, *one way to do each thing*: this
  plan applies both to prose.
- `beebox/docs/README.md` "Layout": the existing top-level axis is *kind*
  (reference, plan, implemented plan, report, design, box, architecture).
  This plan keeps it and adds the axis below it.
- `beebox/docs/README.md` "Naming rules": "Filenames say what the doc IS NOW";
  kept.
- Shipped precedent: [documentation reorganization](../implemented-plans/docs-reorg.md)
  (2026-07) fixed the plans taxonomy and the reference/plan boundary. It did
  not address overlap between reference docs, which is this plan's subject.
- Boxholder rulings (2026-09-24): repetition is the exception, not a habit;
  the discipline is fractal (directory, file, heading, subsection); names are
  the search path; the article's Background/Behaviour/Output axis is one
  candidate, not the winner.
- Memory: *minimize invented concepts, prefer primitives* (directories and
  headings are the hierarchy; no new registry or metadata) and *doc altitude
  matches importance*.

Trade-off accepted: the public narrative series (`development-process.md`
and its four children, promoted as `dev/`) deliberately restates facts from
reference docs in prose for an outside reader. Under these principles a
parent may describe its children but may not state operational facts they
own. Track 2 folds one of those children (`agent-testing.md`) into the
testing parent. The others are untouched here.

## What already exists

- `beebox/docs/README.md`: layout by kind, naming rules. Reuse; extend.
- `pnpm --dir beebox doc-check` (`beebox/src/dev/doc-check.ts:103-135`):
  broken refs and live-area orphans. Orphan checking covers everything under
  `docs/` except `ORPHAN_EXEMPT_PREFIXES` (`doc-check.ts:53`: plans,
  implemented-plans, unimplemented-plans, reports, user-story catalogs), so a
  new `docs/testing/` directory is checked automatically. `README.md` files
  are exempt (`doc-check.ts:127`). Reuse as is.
- `pnpm --dir beebox doc-check --fix` (`src/dev/doc-link-repair.ts`): rewrites
  inbound links after a move when the basename is unique repo-wide. Reuse for
  every move.
- `pnpm doc-graph`: regenerated index. Reuse.
- Agent-docs manifest (`site/docs-manifest.yaml`, loader
  `site/docs-manifest.ts:57-64`): sources admitted only from
  `beebox/docs/<flat>.md`, `docs/design/`, `docs/architecture/`, plus five
  named files. **A `docs/testing/` source is refused today**; track 2 adds one
  prefix line. Promoted today from the pilot cluster: `testing.md`,
  `tours.md`, `knowledge-audits.md`, `knowledge-taxonomy.md`,
  `agent-testing.md` (all under `dev/`).
- `site/docs/dev/README.md:3` `start-here:` names `agent-testing.md` and
  `testing.md`; updated in track 2.
- The agent guide's named-section registry
  (`beebox/src/core/agent-guide/sections.ts`): headings and cross-references
  derive from one constant. Not touched here; it is the box-side analogue of
  "names are the search path" and the second phase builds on it.
- Searched the issue queue for an existing organization principle for docs:
  found the size budget and the review-all-prompts items (volume and reading),
  and the docs-reorg plan (kind). Nothing states a one-home or naming rule.

## Prior art (external)

- Wulfie Bain, prompt structure (linked from the issue): MECE sections,
  Background/Behaviour/Output, prompts as code. The design depends on the MECE
  claim, adopted; the three-part template is evaluated per surface below.
- Diátaxis (https://diataxis.fr/): four kinds, tutorial / how-to / reference /
  explanation, chosen by the reader's need. Bearing on the decision: it is an
  axis by *reader need*, and it warns against mixing kinds in one page. Our
  README already separates reference from plan and design (explanation);
  within a reference doc this plan uses an aspect axis (below) that maps
  onto Diátaxis's how-to versus reference distinction as headings, not files.
- MECE (Minto, *The Pyramid Principle*): the origin of the term; the test that
  siblings do not overlap and together cover the parent. Adopted as the
  sibling test.
- No external prior art found for measuring documentation navigability by a
  name-only walk; the find-the-fact protocol in track 3 is this plan's own.

## Ontology

- **Fact**: one statement a reader might need (a command, a value, a rule, a
  reason). The unit that has exactly one home.
- **Home**: the one section that states a fact authoritatively. Identified by
  file path plus heading. Every other mention is a *pointer*.
- **Pointer**: a link, or one sentence plus a link, that names where a fact
  lives without restating it. A pointer never contains a value, command, or
  number the home owns.
- **Restatement**: a deliberate second full statement of a fact. Allowed only
  under the exception rule (principle 3 below) and marked as such.
- **Node**: a directory, a file, or a heading. Nodes form the tree. A node's
  **name** is its directory name, file stem, or heading text.
- **Siblings**: the nodes directly under one parent. The MECE test applies to
  siblings.
- **Axis**: the one dimension along which a parent partitions its siblings
  (kind, subject, tier, aspect). A parent has one axis.
- **Aspect**: the axis used *inside* a reference doc: what it is, how it
  works, running it, changing it, failure modes. Not every doc has every
  aspect.
- **Cluster**: an informal set of docs about one subject, used only to pick
  the pilot. Not a node.
- Existing names kept: *reference*, *plan*, *report*, *design*, *box doc*,
  *architecture* (`docs/README.md` "Layout"); *promoted* doc
  (`site/docs-manifest.yaml`); *test tier* (`docs/testing.md`).

No new nouns reach code. The manifest and doc-check see only paths.

## Tracks / scope

### Track 1: the principles, written into `docs/README.md`

**What.** A new section "Organizing principles" in `beebox/docs/README.md`,
kept to roughly the length below, stating rules an agent can apply
mechanically. `docs/README.md` is loaded on demand by agents writing docs
(`beebox/CLAUDE.md:67`), so this is the right altitude.

**Why this needs to change.** The README says where a doc goes by kind and how
to name a file. It says nothing about what goes *inside* a doc, when two docs
overlap, or how headings are chosen. Overlap today, measured on the pilot
cluster (2026-09-24):

- The three assertable knowledge-audit levels are stated in
  `knowledge-audits.md` "Test structure", restated in `testing.md` "3.
  Knowledge Audits", and framed as nine levels in `knowledge-taxonomy.md`
  "Knowledge Taxonomy". A reader landing on the nine-level list cannot tell
  which are values the YAML accepts.
- The smoke tier's command and duration appear in `testing.md` "Smoke Tier"
  and in `agent-testing.md` "Testability".
- Tours' weekly edit-or-file rule is stated in full in both `tours.md` and
  `testing.md` "Tours".
- Periodic checks appear in `testing.md` "Periodic Checks", `maintenance.md`,
  and `knowledge-audits.md` "When to run".
- `testing.md` mixes three axes at one level: numbered tiers (1 to 6),
  unnumbered tiers (Smoke, Tours, Field Tests), and cross-cutting sections
  (Creating a box, Testing with Service Fakes, Choosing, Adding, Periodic,
  Future). A reader choosing by heading has no rule for which sibling holds
  "how do I fake Gmail in a test".

**Direction.** The principles:

1. **One home per fact.** Every fact is stated in full in exactly one
   section. Everywhere else it is a pointer. When you find a second full
   statement, delete the one that is not at the home and leave a pointer.
2. **A pointer says where, not what.** One sentence plus a link is the
   maximum. A pointer that carries a value, command, or number is a
   restatement.
3. **Restatement is the exception and is marked.** Allowed when the reader
   cannot be expected to follow the link before acting: a safety rule an
   always-loaded file (`CLAUDE.md`, the agent guide) must carry, or a
   contract clause a client implementer copies. Each restatement ends with
   "(restated from [home])" so a search finds every copy when the home
   changes. A parent's one-sentence description of each child is not a
   restatement; it is the index.
4. **Siblings do not overlap and together cover the parent.** For any fact
   in the parent's scope, exactly one sibling name is the obvious pick. If two
   names could both hold it, rename or merge. If no name could hold it, the
   parent is missing a child or the fact belongs one level up.
5. **One axis per parent.** A parent partitions its children along one
   dimension and says which in its first paragraph. Mixing axes at one level
   ("by tier" beside "by task") is the usual cause of overlap. The axes used
   here, outermost first:
   - `docs/` by **kind** (existing): reference (flat or in a subject
     directory), `plans/`, `implemented-plans/`, `unimplemented-plans/`,
     `reports/`, `design/`, `box/`, `architecture/`.
   - reference, by **subject**: one file or one directory per subsystem or
     activity (testing, secrets, connectors, chat). A subject gets a directory
     when it has more than one child file. The parent is `<subject>.md` beside
     `<subject>/`, not a `README.md` inside it: the flat file keeps its
     basename, so every inbound link, the manifest entry, and `doc-check
     --fix` (which never rewrites the non-unique `README.md`) keep working.
   - a subject directory, by **member**: the parts of the subject that a
     reader operates separately (the test tiers; the connectors).
   - a reference file, by **aspect**: *What it is* (scope and the question it
     answers), *How it works*, *Running it*, *Writing one* or *Changing it*,
     *Reading results* or *Failure modes*. A doc uses the aspects it needs in
     this order and adds no other top-level headings. The article's
     Background/Behaviour/Output is this axis; "What it is" is background,
     the middle three are behaviour, and results are output.
6. **Names are the search path.** A node's name says what it contains, in the
   reader's words, distinguishing it from its siblings without reading either.
   Headings are noun phrases naming the scope, not sentences making a claim
   ("Smoke tier", not "Smoke Tier (a real box boots and is walked — a merge
   gate)"; the claim goes in the first line under the heading). Numbering is
   not a name; numbered headings are allowed only in contracts whose clauses
   are cited by number (`mobile-contract.md`).
7. **A fact lives at the lowest node whose scope contains all its uses.** A
   fact used by one tier lives in that tier's file. A fact about choosing
   among tiers lives in the parent. A fact used across subjects lives in its
   own subject, and other subjects point to it. Tie-breaker for a fact with
   both a subject owner and a cross-cutting catalog (cadence in
   `maintenance.md`, schedules under `schedules/`): the subject owns *what*
   runs and *how*; the catalog owns *when* and is an index of pointers. When
   the catalog is derived from code (`bin/schedules list`), the code is the
   home and the catalog doc points at it.
8. **The parent is an index plus what is true of the whole.** A subject
   directory's `README.md` states scope, the axis, a one-line description
   per child, and the facts that belong to no single child (philosophy,
   choosing among children). It does not summarize a child's content beyond
   that line.
9. **History is not reference.** Design reasoning, rollout records, and
   "why we did not" go to `design/`, `implemented-plans/`, or `reports/`, and
   the reference doc points there (existing rule, restated here because it is
   the most common source of overlap: a shipped plan's prose left beside the
   reference that replaced it).

**Vocabulary lock-ins.** The aspect heading names above (*What it is*, *How it
works*, *Running it*, *Writing one*, *Changing it*, *Reading results*,
*Failure modes*). The marker text "(restated from …)".

**First implementation chunk.** Edit `beebox/docs/README.md`: add the
section; adjust "Layout" so "flat" reference also admits subject
directories; keep the file terse per its own last line. One commit.

### Track 2: pilot, the testing cluster

**What.** Move the testing docs into `docs/testing/` with one file per tier
and a `README.md` parent, applying every principle above, and remove the
overlap listed in track 1.

**Why this cluster.** It is the messiest reference cluster by the overlap
count above; it is entirely developer-facing, so nothing box-loaded changes;
five of its docs are promoted, so the manifest interaction gets exercised; and
it is bounded (six files, about 1,450 lines). Alternatives considered: the chat
cluster (`chat-*.md`, `composer-*.md`, `quick-chat.md`; less overlap, more
subsystem coupling), the Google cluster (`google-setup`, `gmail-setup`,
`google-drive`, `calendar`; already one-file-per-member, so the pilot would
show little), the install cluster (three install docs by audience, a
different axis question).

**Direction.** The parent's axis is **verification instrument**: each child
is one way of answering one question about the system, which is how the
existing "Choosing the Right Approach" table in `testing.md` already frames
them. "Test tier" is too narrow for tours and field tests, which the docs
themselves say are not gates; "instrument" covers gates and non-gates alike.
Target tree, with the question each child answers:

```
docs/testing.md          the parent (same path as today): what verification
                         is here; philosophy; the instruments table (name,
                         question it answers, gate?, cost); choosing; adding
                         one of each (one line each, linking)
docs/testing/
  doctests.md            does this function, route, or box operation behave?
                         (syntax pointer, creating a box, service fakes,
                         injecting into routes, call logging, available
                         fakes, connector pattern, limitations)
  tap-tests.md           what a doctest cannot test without circularity
                         (plus: the tap plugin set is built at install time)
  knowledge-audits.md    does the box agent know X? (knowledge levels: the
                         nine phenomena and the three the YAML asserts;
                         running; test structure; recording results;
                         context size; interpreting failures)
  session-critiques.md   did the tools serve the agent in a real session?
  dev-stubs.md           does the streaming UI behave, checked by hand?
                         (/fakestream, dev harness routes)
  smoke.md               does the app boot and walk at all? (the merge gate)
  tours.md               does each page render and pass axe at both viewports?
  field-testing.md       is it discoverable end to end through the real UI?
```

The card validator hook (tier 5 today, nine lines) is not an instrument a
developer runs; it is a validation hook, and `card-validation.md` already
owns hooks. It folds there and the instruments table links to it.
`field-testing.md` keeps its name (four inbound links; a rename buys
nothing under principle 6, which asks names to distinguish, not to rhyme).

Dispositions:

- `testing.md` (578 lines): stays as the parent, shrunk to facts about the
  whole: "Testing Philosophy", "Choosing the Right Approach" (as the
  instruments table), "Adding New Tests", "Future Directions". Every
  instrument section moves to its child file.
  "Periodic Checks" moves to `maintenance.md`, which already owns the
  periodic-work axis ("What runs on its own", "Run when you touch the
  thing"); `testing/README.md` points there. "The tap plugin set is built at
  install time" goes to `tap-tests.md`. "Creating a box" and "Testing with
  Service Fakes" go to `doctests.md` (both are doctest mechanics).
- `agent-testing.md` (51 lines): its content is descriptions of tiers plus
  restated facts. The tier descriptions become the tiers table in
  `testing/README.md`; the restated facts are deleted. The file is removed.
  `development-process.md` links to `testing.md` in its place. The manifest
  entry `dev/agent-testing.md` is removed; `dev/testing.md` is unchanged.
  `site/docs/dev/README.md` `start-here:` drops it. The site has no
  redirect or alias mechanism (searched `site/*.ts` for redirect, alias,
  tombstone: none), so the public URL stops resolving and the generated
  `dev/index.md` drops the row. Seven repo files link to `agent-testing.md`;
  they are repaired by hand since `--fix` cannot resolve a deleted file.
  **Boxholder decision** at pilot review: remove the page, or keep it as a
  pointer-only narrative (a page that says less than the parent's table).
- `knowledge-taxonomy.md` (492 lines): dispositioned section by section
  (table below, applied in chunk 2). Written before the move:

  | Section | Disposition |
  |---|---|
  | Knowledge Taxonomy (nine levels), Context shifts knowledge levels, How the knowledge chain works | `testing/knowledge-audits.md`, the "Knowledge levels" aspect |
  | Prompt Style Effects | `testing/knowledge-audits.md`, "Writing one" |
  | Test Prompt Guide (the watch-for list) | `testing/knowledge-audits.md`, "Reading results" |
  | Areas 1 to 9 prompt lists, Extension test prompts, Chat-specific view knowledge, Expected levels summary | superseded by `src/dev/knowledge-audits.yaml` (60 sections, 336 entries, every area present); frozen in `reports/knowledge-taxonomy-catalog-2026-02-23.md` |
  | Extending the Box (can / cannot / box-local schemas) | 2026-02 capability notes, unverified since; frozen in the report, not promoted to reference |
  | Future Test Categories | frozen in the report |
  | Test Run Notes and Personality Test Run Notes (2026-02-23) | frozen in the report; they date it |

  The earlier draft of this disposition read: "Knowledge Taxonomy" and "Context shifts
  knowledge levels" become the "Knowledge levels" aspect of
  `knowledge-audits.md`; "Prompt Style Effects" and "Test Prompt Guide" go
  under "Writing one"; the nine numbered per-area sections mix candidate
  prompts (the live catalog is `src/dev/knowledge-audits.yaml`, which has
  evolved past them), capability notes ("Extending the Box"), and dated run
  notes. Default per section: a prompt the YAML lacks and still wants is
  added to the YAML; a capability note that is current moves to the doc that
  owns the capability; run notes and the rest freeze as
  `docs/reports/knowledge-taxonomy-2026-09-24.md`. The manifest entry
  `dev/knowledge-taxonomy.md` is removed (same no-redirect caveat as above).
- `knowledge-audits.md` (111 lines): moves; gains the levels and writing
  guidance; loses "When to run" cadence (a pointer to `maintenance.md`).
- `tours.md`, `field-testing.md`: move and rename; headings aligned to the
  aspect axis; no content change beyond that.
- `chat-scroll-testing.md`: **not moved**. It is a test procedure for one
  component and belongs with the chat subject, which is not in the pilot.
  `frontend-dev-stubs.md` points to it as the worked example of the
  `/fakestream` stub.
- `maintenance.md` gains the periodic checks from `testing.md`; nothing else.

Code changes: `site/docs-manifest.ts:63` gains
`if (source.startsWith("beebox/docs/testing/")) return true;` (and its test in
`site/docs-manifest.test.ts`). `doc-check` needs nothing (`docs/testing/` is
already inside the checked area). Link repair: `testing.md` keeps its path,
so its inbound links (including `beebox/CLAUDE.md:17` and `:67`) need
nothing. `knowledge-audits.md` and `tours.md` move with unique basenames,
so `doc-check --fix` rewrites their inbound links. `agent-testing.md` (seven
inbound) and `knowledge-taxonomy.md` (nine inbound) are deleted, which
`--fix` reports and does not rewrite; those links are repointed by hand to
the section that now holds the fact.

**Vocabulary lock-ins.** Directory name `docs/testing/`; file names above;
the tier names as the parent's table uses them.

**First implementation chunk.** One commit: `docs/testing/` with
`doctests.md`, `tap-tests.md`, `smoke.md`, `session-critiques.md`,
`dev-stubs.md`, and the moved `tours.md` and `field-testing.md`, each
created by moving sections verbatim (no rewording); `testing.md` shrunk to
the parent; the card validator hook folded into `card-validation.md`;
manifest prefix added; inbound links repaired; `doc-check` green; doc-graph
regenerated. A file-level rename check (`git diff -M`) does not prove a
section split survived, so the chunk carries its own check: before the
move, a script records every heading and a hash of every section body in
the six source files; after it, the same script runs over the parent, the
new directory, `card-validation.md`, and `maintenance.md`, and every
pre-move body hash must appear exactly once. The script and both listings
are scratch artifacts referenced from the commit message. The second commit
handles `knowledge-audits.md` and `knowledge-taxonomy.md` (with the
per-section disposition table added to this plan first); the third removes
`agent-testing.md`; the fourth applies the aspect headings and deletes
restatements. Rewording happens only in the fourth commit, so the earlier
diffs are pure moves.

### Track 3: measurement, find-the-fact

**What.** Ten questions whose answers live in the pilot cluster, each given
to a fresh mid-tier agent that may only list directories, list headings, and
read one section at a time, never search content. Recorded: steps to the
answer, whether it was found, and how many sections in the tree state the
fact (counted by the planner with grep, since the navigator must not).

**Why.** Two properties are claimed: names lead to the fact (navigability)
and the fact is stated once (one home). The first is measured by the walk,
the second by the location count.

**Direction.** The protocol, questions, model class, and location-count
method are frozen here so the after-run is comparable. Navigator: one fresh
Claude Sonnet 5 general-purpose agent per question, prompt = the protocol
plus the question, nothing else. Location count: the planner greps
`beebox/docs/` (tracked `.md`, excluding `doc-graph.md`, `plans/`,
`implemented-plans/`, `unimplemented-plans/`, `reports/`) for the key string
listed per question, then reads each hit and counts only sections that
state the fact in full (a pointer or a partial mention is listed but not
counted). Before-run results are in *Rollout shape*.

Protocol (verbatim, given to each navigator):

> You are testing whether a documentation tree can be navigated by NAMES
> alone. Work only inside `beebox/docs/`. Allowed moves (each costs one step;
> log every one in order): (1) `ls <dir>`; (2) `grep -n '^#' <file>` to list
> headings, optionally with `head -6` of the file in the same step; (3) read
> ONE section, from one heading to the next heading of the same or higher
> level. Forbidden: grep or search for content words; reading a whole file;
> reading anything outside `beebox/docs`; answering from prior knowledge (if
> you already know the answer, you must still find and cite the section).
> Stop after 15 steps and report "gave up". Start with `ls` of `beebox/docs`.
> Choose the next move by NAME only. Report: ANSWER, CITED (file#heading),
> STEPS, PATH (every step), ALSO SEEN (other sections that stated the fact,
> agreeing or conflicting), NAME FAILURES (steps where the chosen name led
> somewhere the fact was not).

Questions and key strings:

| # | Question | Key string |
|---|---|---|
| 1 | Which values can the `expected_level` field of a knowledge-audit test entry take? | `knows_directly` |
| 2 | After running knowledge audits, where is the durable record of the results kept? | `Status (YYYY` |
| 3 | Which command runs the smoke test tier, and roughly how long does a run take? | `bin/smoke` |
| 4 | Which five criteria does a session critique evaluate an agent session against? | `Wasted effort` |
| 5 | At which two viewport sizes (pixels) do tours take their screenshots? | `1280` |
| 6 | What is the default run root directory for field-test runs? | `field-runs` |
| 7 | Which flag makes a knowledge audit run against Codex instead of the box's engine? | `--engine` |
| 8 | What does the `context_dir` field on a knowledge-audit entry do? | `context_dir` |
| 9 | How often does the full test suite run, and on which branch? | `hourly` |
| 10 | When the weekly tour session finds a tour that misses because the app changed on purpose, does it edit the tour or file an issue? | `edits the tour` |

**First implementation chunk.** The before-run, already executed; results
below.

## Could this be simpler?

Simplest version: write the nine principles and do nothing else. It changes no
document and so cannot be measured or reacted to; principle 7 (discoverability
is a contract) and the boxholder's instruction to pilot rule it out.

Next simplest: apply the principles by editing `testing.md` in place, no
directory, no moves. It removes restatements but leaves a 578-line file whose
top-level siblings mix three axes, so principle 5 above is not demonstrated
and the manifest interaction goes untested. The directory buys the one thing
the pilot exists to show: that directory, file, and heading names form one
path.

Not done: a generated index, a lint for restatements, a heading registry for
prose docs. Each is a new mechanism with one caller; the existing `doc-check`
and `doc-graph` are enough for the pilot, and a restatement lint is a
follow-up only if the marker convention proves hard to keep by hand.

## Subplans

none. The second phase (box-loaded guidance: agent guide sections, `docs/box/`,
generated reference) gets its own plan after the pilot review, because its
readers, loading mechanism, and test harness (knowledge audits) differ.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| A moved doc's inbound link is left broken | yes, `doc-check` in pre-commit | `--fix` rewrites unique basenames | clear |
| A moved doc's basename is not unique repo-wide, `--fix` refuses | yes, reported by `--fix` | manual | clear |
| Manifest source under `docs/testing/` refused by the loader | yes, `site/docs-manifest.test.ts` | track 2 adds the prefix | clear (build fails) |
| Public pages `dev/agent-testing.md` and `dev/knowledge-taxonomy.md` disappear from the site; no redirect mechanism exists | no automated test; `doc-check` skips `site/docs/` | boxholder decision at pilot review | silent to external readers |
| A fact is dropped during the move (present in old, absent in new) | section-body hash check, chunk 1 | the hash listing must match before the commit | clear once the check runs; silent without it |
| `start-here:` in `site/docs/dev/README.md` names a removed page | unknown; checked in first chunk | edit | to be determined |
| A restatement is deleted whose reader could not follow the link (always-loaded file) | no | principle 3 exception; the pilot touches no always-loaded file | not applicable in pilot |

> **Critical gap:** a fact dropped during the move. `git diff -M` detects
> file renames, not section splits, so chunk 1 carries the section-body hash
> check described in track 2, and rewording is confined to the last commit
> so its diff is readable. The cross-model review of the final diff is the
> second check.

## Agent-flow / user-flow edge cases

- Wrong node: an agent writing a new testing fact puts it in the parent
  instead of the tier file. ADDRESSED by principle 7 and the parent's stated
  axis; not enforced.
- Stale ref: an issue or plan links to `docs/testing.md`. ADDRESSED by
  `doc-check --fix` (unique basename) and the pre-commit hook.
- Two agents touching the same doc: not applicable; one workstream.
- Hand-edit drift: a future edit adds a second statement of a fact. GAP:
  nothing detects it. Accepted for the pilot; a restatement lint is a
  follow-up if it recurs.
- Fabricated value: not applicable.
- Validation error UX: `doc-check` messages already name the file and line.
- Partial migration: between chunks the tree has both old and new paths only
  inside one commit series in the worktree; `main` sees the whole pilot at
  once.

## NOT in scope

- Restructuring the rest of `beebox/docs/` (chat, install, Google, ops
  clusters): waits for the pilot review; each is its own plan or chunk under
  a follow-on plan.
- Box-loaded guidance (`agent-guide/`, `docs/box/`, `docs-gen/`): second
  phase, separate plan; requires knowledge audits.
- `CLAUDE.md` files and skills: different readers and loading; the size
  budget and review-all-prompts issues own them.
- The by-audience question in the install docs (developer, Docker, agent):
  a different axis, not tested by this pilot.
- `guides.md`, the hand-maintained topic index: once subjects are
  directories, most of its rows become derivable. Left as is; the pilot
  edits its testing rows only.
- Generating an index or a restatement lint.
- Re-measuring the agent guide's size figure the issue mentions.

## Open design questions

- Should `agent-testing.md` survive as a public narrative page even though it
  restates? Lean: no; the instruments table in `testing.md` is the same
  content with links, and the site's `dev/testing.md` serves the reader. No
  redirect exists, so the old URL stops resolving. The boxholder decides at
  pilot review.
- Does the aspect axis (What it is / How it works / Running / Writing /
  Results) fit subsystem docs like `questions.md` as well as it fits tiers?
  Lean: yes for reference docs; contracts keep numbered clauses. Tested only
  on the pilot cluster.

## Knowledge audits

Skipped for this plan: nothing box-loaded changes. The second-phase plan will
add audits for any agent-guide restructuring.

## What will hold this after it ships

`doc-check` holds links and orphans on every commit. The principles hold
only by being applied; the reviewable thing is the diff. The find-the-fact
questions and protocol stay in this plan so the walk can be repeated when the
next cluster moves.

## Implementation order

1. Track 3 before-run (done 2026-09-24).
2. Track 1: principles in `docs/README.md`.
3. Track 2 chunk 1: directory, parent, verbatim moves with the section-hash
   check, manifest prefix, links, doc-graph.
4. Track 2 chunk 2: knowledge audits and taxonomy merge; report snapshot.
5. Track 2 chunk 3: remove `agent-testing.md`; update
   `development-process.md`, manifest, `start-here`.
6. Track 2 chunk 4: aspect headings; delete restatements; maintenance gains
   periodic checks.
7. Track 3 after-run; results into this plan.
8. Cross-model review of the plan and the diff (Codex).
9. Boxholder review of principles plus pilot. Land only when asked.

## Rollout shape

Done-when: `doc-check` green, `site/docs-manifest.test.ts` green, doc-graph
regenerated, every question in the after-run found in at most the before-run's
steps, and every fact's location count is 1.

### Find-the-fact, before (2026-09-24)

Ten questions, protocol and counting method as in track 3.

| # | Question | Found | Steps | Cited | Locations |
|---|---|---|---|---|---|
| 1 | Values of `expected_level` | yes | 3 | knowledge-audits.md#Test structure | 3: also testing.md §3; knowledge-taxonomy.md as nine levels |
| 2 | Durable record of audit results | yes | 3 | knowledge-audits.md#Recording results | 1 |
| 3 | Smoke command and duration | yes | 3 | testing.md#Smoke Tier | 2: also agent-testing.md#Testability |
| 4 | Five session-critique criteria | yes | 5 | testing.md#4. Session Critiques | 1 |
| 5 | Tour screenshot viewports | **gave up** | 9 | (fact is in tours.md's intro, above any heading) | 1 |
| 6 | Field-test run root | yes | 3 | field-testing.md#Run a scenario | 1 |
| 7 | Audit engine override flag | yes | 3 | knowledge-audits.md#Running | 1 |
| 8 | What `context_dir` does | yes | 3 | knowledge-audits.md#Test structure | 1 |
| 9 | Full-suite cadence and branch | yes | 10 | agent-testing.md#Testability | 3: partial in development-workflow.md#Recurring work and testing.md#Smoke Tier; full only in the narrative page |
| 10 | Weekly tour miss: edit or file | yes | 4 | tours.md intro, above any heading | 2: also testing.md#Tours |

### Find-the-fact, after (2026-09-24, commit after chunk 4 plus review fixes)

| # | Question | Found | Steps | Cited | Locations |
|---|---|---|---|---|---|
| 1 | Values of `expected_level` | yes | 4 | testing/knowledge-audits.md#Writing one | 1 (the nine-level list is in the same file's "Knowledge levels", labelled as the superset) |
| 2 | Durable record of audit results | yes | 4 | testing/knowledge-audits.md#Recording results | 1 |
| 3 | Smoke command and duration | yes | 5 | testing/smoke.md#Running it (command); testing.md#Instruments (cost column) | 1 command; the duration is the parent's cost column plus the child's What it is |
| 4 | Five session-critique criteria | yes | 3 | testing/session-critiques.md#How it works | 1 |
| 5 | Tour screenshot viewports | yes | 3 | testing/tours.md#What it is | 1 |
| 6 | Field-test run root | yes | 4 | testing/field-testing.md#Running it | 1 |
| 7 | Audit engine override flag | yes | 4 | testing/knowledge-audits.md#Running it | 1 |
| 8 | What `context_dir` does | yes | 3 | testing/knowledge-audits.md#Writing one | 1 |
| 9 | Full-suite cadence and branch | partial | 4 | development-workflow.md#Recurring work (hourly; branch not stated at run time) | 1 after the review fix: `development-workflow.md#Recurring work` now says "hourly on `main`" and `testing.md` points there |
| 10 | Weekly tour miss: edit or file | yes | 4 | testing/tours.md#What it is | 1 |

Before: 9 of 10 found, steps 3 to 10, four facts with more than one home.
After: 10 of 10 found (one partial, fixed after the run), steps 3 to 5, every
fact with one home. The one extra step in most after-run walks is
`ls beebox/docs/testing`, the directory level the pilot added. Name failures
after: `prompt-audits.md` for "audit results" (Q2), `scheduled/` for the
weekly tour session (Q10), `testing.md#Instruments` for the suite cadence
(Q9). The Q9 walk skipped `testing.md#Philosophy`, where the cadence sentence
was; the review fix moved that fact to the recurring-work catalog, which is
where the navigator looked.

### Cross-model review of the diff (Codex, 2026-09-24)

Seven findings, all verified against source and applied: the user-stories
catalog (a verification instrument the old narrative page described) had
been dropped and is restored as an instruments row; `card-validation.md`
had miscounted the hooks and understated the SDK callback, now described
from `src/core/sdk-hooks.ts`; the full-suite cadence had two homes; the
tour-check schedule cited a heading that the rewrite had demoted; the
hand-curated doc-graph narrative table named the retired docs; the parent
page needed an explicit exemption from the aspect-heading rule; and this
after-run table was missing. Residual, not fixed: `site/story/coverage.json`
records `beebox/docs/knowledge-audits.md` as a scanned path in the story
extraction ledger; it is a historical record regenerated by
`pnpm --dir site coverage`, which runs the extraction, and is left for that
schedule.

Name failures reported by the navigators: `chat-review.md` chosen for
"session review" (Q4); `tours.md#How an agent reviews with tours` chosen for
the weekly session's rule (Q10); `maintenance.md#What runs on its own` chosen
for the full-suite schedule (Q9). Two facts (Q5, Q10) sit in an intro
paragraph above the first heading, so no name leads to them; Q5 was not found
at all. The three-step results are the words of the question matching a file
name and a heading, which is the property the principles make deliberate.
