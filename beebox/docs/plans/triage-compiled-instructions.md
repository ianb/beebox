---
title: "Triage: exact-duplicate removal and agent-compiled instructions with default tie-break principles"
status: draft
workstream: jev-triage-trial
issues:
  - ../../../issues/features/2026-09-21-jev-triage-and-quick-capture-routing.md
---
# Triage: exact-duplicate removal and agent-compiled instructions

Jev triage misfiles documents where two destination rules overlap and nothing
says which wins. This plan adds default tie-break principles and an
agent-compiled instruction file. The agent pass reruns when the guide or a
landmark changes. The plan also removes exact duplicates before any model call.

**Issues addressed:** the document-triage half of
`issues/features/2026-09-21-jev-triage-and-quick-capture-routing.md` (2026-10-29
note). The issue stays open for quick capture and Gmail admission. A queue
search for "dedup", "duplicate" and "triage" found
`2026-09-20-near-duplicate-todos-accumulate-across-cards.md` (todos, unrelated)
and `2026-05-27-guide-cards-inbox-triage.md` (guide-card triage history, not
overlap or duplicates). Neither is resolved here.

## Design

No design section: the change is inside the triage engine. What a person meets
is unchanged except one existing surface: an unresolved rule conflict becomes an
ordinary text question card. Triage already raises question cards for held items
(`beebox/src/core/triage/decisions/apply.ts:111`: **`const content = createSelectQuestionTemplate({`**).

## Smallest fix and budget

Smallest fix: hand-edit each overlapping landmark rule with a tie-break. The
2026-10-29 replay did that with four overlay edits; agreement went from 74/93
to 79/93, with one low-margin regression. It works for one box once. The
boxholder asked for a mechanism (2026-10-29): *"take all the rules and do an
agent pass to create a triage document, and re-do that when any of the
components change"*, starting from adjustable principles.

Chosen design, three tracks:

1. Exact-duplicate check and removal, as a CLI operation and a run step: about 240 source lines, 170 test lines.
2. Default principles in the compiled policy: about 30 source lines, 40 test lines.
3. Compiled instructions file, compile command, cited facts, staleness and snapshot use:
   about 440 source lines, 320 test lines.

Total about 1,240 changed lines plus about 60 lines of box documentation. Not a
BIG CHANGE.

## Stated preferences this plan trades against

- Boxholder, 2026-10-29: *"rescans we won't be able to do, but the other dedups
  we should do."* Only byte-identical copies are removed.
- Boxholder, 2026-10-29: *"Generally more specific is the preferred destination
  … importance or whether something is more an archival destination or a
  work-to-be-done destination (work-to-be-done gets priority)."* These become
  the default principles.
- Boxholder, 2026-09-28 (`beebox/docs/implemented-plans/jev-document-triage.md:46`):
  *"each failed triage is an opportunity to improve the instructions"*. The
  compiled file is generated from the canonical sources. It is never a second
  place to edit rules.
- Same plan, line 49: one overarching decision policy and decentralized
  destination explanations. The compiled file adds tie-breaks between
  destinations. It does not move rules out of landmarks.
- Engineering principle 4 (resilient and never silent): a stale or missing
  compiled file falls back to the raw sources, and says so in output and in
  the snapshot.
- Engineering principle 3 (validate at boundaries): agent output is validated
  against the snapshot's destination refs before it is written.

## What already exists

- `beebox/src/core/triage/snapshot.ts:54`: **`export async function compileInstructionSnapshot(boxRoot: string, options?: SnapshotOptions)`**.
  It records every source's digest (line 89, for each landmark: **`sources.push({ ref, digest: digest(content), ...overlayField(overlay) });`**; line 64 pushes the guide).
  Reuse those digests as the staleness key.
- `snapshot.ts:77`: the fixed precedence sentence **`Source precedence: user-stated > feedback > inferred > default.`**
  Default principles enter at the `default` level, so any guide rule outranks them.
- `beebox/src/core/triage/auto/research.ts:29`: **`createAgent({ name: "triage-research" }).invokeStructured(researchSchema, {`**
  with `maxTurns: 12, maxBudgetUsd: 1`. Reuse this structured-agent pattern
  for the compile pass.
- `beebox/src/core/triage/auto/core.ts:50`: **`export async function runJevTriage(options: RunJevOptions)`**
  lists staged files and processes each one. Dedupe and the compile check go
  at the start of this function.
- `beebox/src/lib/annex-pointer.ts:81`: **`export function parseAnnexPointer(bytes: Uint8Array): AnnexPointer | null`**.
  Reuse it to read SHA-256 from annex keys without fetching content.
- `beebox/src/core/commands/trash/command.ts:186`: **`export async function moveCardsToTrash(ctx: CommandContext, cardPaths: string[])`**
  and line 203 **`commitTrashReceipt`**. Reuse them for card items. Line 107
  rejects non-card paths (**`throw new NotACardFileError(cardPath)`**), so bare
  staged files need a small trash path. See Track 1.
- `beebox/src/core/triage/evidence/packing.ts:29`: **`export function scanRepresentations(parts: Part[], manifestRefs?: string[])`**
  identifies a scan's generated derivatives. Reuse it to tell original bytes
  from derivatives.
- `beebox/src/schemas/question.ts:270`: **`export function createTextQuestionTemplate(params: CreateQuestionTemplateParams): string`**.
  Reuse it for conflict questions. A select question cannot carry free text:
  `beebox/src/core/commands/answer.ts:64` resolves a select answer only to an
  option label or letter.
- `beebox/src/core/upload-helpers.ts:3`: an upload ledger keyed by SHA-256
  (`.beebox/uploads.json`). It only covers the upload command, and the
  2026-09-28 scan-promote retry bypassed it. It is not a box-wide index.

A search for an existing box-wide content-hash index found none. `fclones` is
on the box host (`beebox/src/core/agent-guide/ledger.yaml:1013`), but it scans
working-tree bytes, and annexed files may be absent locally. Annex keys are cheaper.

## Prior art (external)

No external premise drives a decision here. Exact duplicates are compared by
SHA-256, as git-annex already keys content. The tie-break principles come from the
boxholder, not from a published scheme.

## Ontology

- **Staged item** (existing): one file in `inbox/staged/`, plus its attach scope for a card.
- **Original file** (new term, no type): a file in an item that is not a generated
  derivative. That is the bare staged file itself, a scan's `.pdf.card` `filename`
  source, or a non-card file in the scope outside any `.pdf.card`'s own
  `.attach/`. Page images, Docling sidecars, text layers and figure crops are
  derivatives.
- **Exact duplicate** (new finding, not a judgment): an item where every original
  file's SHA-256 matches a tracked file outside `inbox/` and `_bookkeeping/trash/`,
  or matches an earlier item in the same check. An item with no original file is
  never a duplicate. It is NOT a near-duplicate rescan.
- **Removable duplicate**: an exact duplicate whose item has no authored context
  to lose. That means a bare file, or a scan-import session with verified
  provenance: a `capture-session` card whose `uploader` (legacy field: `source`)
  starts with `scan-upload/` (`beebox/src/schemas/capture-session.tsx:44`), that
  is not `annotated: true`, has no audio clips, whose every card in scope is one
  its own manifest lists (so a note added later keeps it for review even after
  intake moves the scope and its history is lost), and whose whole scope is what one
  import wrote: every scope file arrived in a single commit and nothing has
  changed or been added since (a never-committed import counts when every entry
  is new). The same card type also
  holds chat captures (`capture-session.tsx:4-6`), so the suffix alone is not
  enough. Other exact duplicates are reported for review and never moved.
- **Principle** (new text, no type): one built-in default tie-break sentence at
  `basis: default`. It is not a guide field. The boxholder overrides it with an
  ordinary guide `triage-rules` entry.
- **Compiled instructions** (new file): `_bookkeeping/triage/compiled-instructions.json`.
  It holds the agent's added destination boundaries, each destination's role,
  the tie-breaks, and unresolved conflicts, keyed by the source digests it was
  compiled from. It is NOT editable policy. A hand edit is not detected as
  stale: it stays visible in Git history and the next compile replaces it.
- **Role** (new value inside compiled instructions): `work` or `archive`, assigned
  per destination by the compile agent from the landmark's own rule text.
- **Tie-break** (new): `{ between: [refA, refB], when, winner, basis }`. `basis`
  is a guide rule quote or a principle number.
- **Conflict** (new): a pair the principles and rules cannot settle. It becomes a
  text question card. Until answered, the policy tells Jev to use unclear for that case.
- **Cited fact** (new): an identifying fact the compile agent adds to a destination
  (an address, a property ID). It quotes a box card verbatim; that card's digest
  joins the staleness key.
- **Instruction snapshot** (existing, `snapshot.ts:24`): gains one source entry
  for the compiled file when it is used. No schema version change.

## Tracks / scope

### 1. Exact-duplicate removal

**What.** A CLI operation, `bbx triage duplicates [<ref>...] [--apply] [--json]`,
finds exact duplicates among inbox items and, with `--apply`, moves removable
ones to trash with a scoped commit. With no refs it checks `inbox/staged/`.
Refs may name any inbox item, so the agent that works intake jobs can call it
on inbox-root scans today. `runJevTriage` runs the same function first, applying
outside dry-run. No model call is made.

**Why.** About 240 of 285 inbox scan items in the real-box replay were
byte-identical copies from one promote bug. Jev has no discard outcome and would
classify each copy again.

**Direction.** New `beebox/src/core/triage/duplicates.ts`:

```ts
export interface DuplicateFinding { sourceRef: string; originals: Array<{ ref: string; sha256: string; copyOf: string }> }
export async function findExactDuplicates(boxRoot: string, sourceRefs: string[]): Promise<DuplicateFinding[]>;
```

The index is `git ls-files -z` over tracked paths, excluding `_content/inbox/`
and `_bookkeeping/trash/`. For an annex pointer or symlink, read the SHA-256 from
the key: SHA256E/SHA256 backends only; other backends are hashed from local bytes
when present, else skipped. For a plain file, `stat` the size, and hash only
files whose size matches an original being checked. Originals under 1 KiB are never
counted, so an item whose only originals are tiny is never a duplicate. Items are checked in sorted
order, so the first of several identical staged items is kept and the later
ones are duplicates of it. Without `--apply`, or in dry-run, findings are
reported and nothing moves. Each finding says `removable` or `review`.
Apply runs under the box Git lock, checks every originally checked ref again
from scratch, and refuses (moving nothing) if any removable finding changed,
including its filed copy's bytes. Candidates must be inbox items, so a filed
document cannot match itself. Bare files move with the annex-preserving move
helper. Applied removable card items go through `moveCardsToTrash` and `commitTrashReceipt`,
with reason `exact duplicate of <ref>`. Bare files get a new
`moveFileToTrash(boxRoot, ref)` that reuses the collision stamping at
`trash/command.ts:376` (**`export function withCollisionStamp(`**).
`JevTriageResult` gains `duplicates: DuplicateFinding[]`; `DuplicateFinding`
gains `disposition: "removable" | "review"`.

**Vocabulary lock-ins.** `duplicates` in `JevTriageResult`; commit trailer
`Triage-Duplicate-Of: <ref>`.

**First chunk.** `findExactDuplicates` with tests: annexed copy filed elsewhere;
plain-file copy; two staged copies; differing scan wrapper cards with identical
PDFs (removable); a doc card whose attachment matches (review, not moved); a
dotted rescan (different bytes, kept); an item with no original file (kept).

### 2. Default principles

**What.** The compiled policy states three default tie-break principles.

**Why.** Five of the 19 replay disagreements were overlaps with no stated
tie-break. Two more ignored a History exception that is already stated; the
work-over-archive principle points the same way, which may reinforce it. The
replay measures this; the plan does not assume it.

**Direction.** In `snapshot.ts`, after the guide policy and before the
precedence sentence, append:

```
Default tie-break principles [basis: default], applied in order when more than one destination's rule covers an item:
1. The more specific destination wins: one whose rule names this item's party, property, account or document type beats one that names only a general category.
2. A destination where work is pending (a case, a sale, a bill to pay) beats an archival destination kept for reference.
3. The destination for the more consequential obligation (court, tax, legal deadline) beats a convenience record.
```

This order is a starting default, as the boxholder asked ("basic principles to
start with, that can be adjusted"): specificity first ("generally"), then work
over archive (stated as a priority), then importance (named as a "probably").
Destination rules and their stated exceptions outrank all three, and any guide
rule overrides them by precedence. Implementation chunk 1 replays the 93
documents with the principles alone and records which misses each one changes.

**First chunk.** Principles text and a snapshot test that guide rules still
precede it and the precedence sentence still follows it.

### 3. Compiled instructions

**What.** `bbx triage compile` runs one bounded agent pass over the canonical
snapshot. It writes `_bookkeeping/triage/compiled-instructions.json` and raises
a question for each unresolved conflict. `compileInstructionSnapshot` uses the
file when its digests are current. Automatic Jev triage compiles first when the
file is stale or absent.

**Why.** Overlaps belong in the rules, not in per-item confidence. In the replay,
Jev was confident on misfiled overlaps (0.98, 0.90, 0.70, 0.78), so a
distribution check would not catch them.

**Direction.**

```ts
export const compiledInstructionsSchema = z.object({
  version: z.literal(1),
  compiledFrom: z.array(z.object({ ref: z.string(), digest: z.string().nullable() })), // raw snapshot sources, then cited cards
  principlesVersion: z.literal(1),
  model: z.string().nullable(),
  destinations: z.array(z.object({ ref: z.string(), role: z.enum(["work", "archive"]), boundaries: z.string(), // added after the canonical rule, never replacing it
    facts: z.array(z.object({ text: z.string().min(1), ref: z.string() })) })),
  tieBreaks: z.array(z.object({ between: z.tuple([z.string(), z.string()]), when: z.string().min(1), winner: z.string(), basis: z.string().min(1) })),
  conflicts: z.array(z.object({ between: z.tuple([z.string(), z.string()]), when: z.string().min(1), questionRef: z.string() })),
});
```

The compile operation:

1. Build the raw snapshot, ignoring any compiled file.
2. Invoke `createAgent({ name: "triage-compile" }).invokeStructured(agentOutputSchema, …)`
   with `maxTurns: 8`, `maxBudgetUsd: 1` and `loadBoxContext: false`. (A live
   run with box context spent the $1 ceiling on four destinations; the snapshot
   file carries the rules, and the agent reads cards with its tools.) Pair
   fields are length-2 arrays: the agent CLI rejects the `prefixItems` that
   `z.tuple` serializes to. The agent
   sees the raw snapshot file and the principles. It returns `destinations`,
   `tieBreaks` and `conflicts`, without question refs. The prompt asks it to
   write, for each destination, boundary text to add after its canonical rule,
   so that every overlap it finds names its winner and basis, and to keep identifying facts (addresses, IDs,
   names) verbatim. Any fact it adds beyond the guide and landmark text goes in
   `facts`, quoting a box card verbatim.
3. Validate the output. Every snapshot destination ref appears exactly once.
   Every `between` and `winner` is a snapshot ref, and the winner is one of
   the pair. No pair and case (`when`) appears as both a tie-break and a
   conflict; one pair may have a settled case and an unsettled one. Each `basis`
   starts with `principle 1`–`principle 3`, or quotes text in double quotes that
   occurs verbatim in the raw policy or a landmark rule. Each fact's `text` occurs verbatim in its
   `ref` card; the ref must be a canonical card ref that resolves inside the box.
   The cards are read once, and that card's `{ ref, digest }` from those bytes is
   appended to `compiledFrom`. A cited card modified or replaced (mtime or
   ctime) after the pass started
   makes the result `superseded`. On failure,
   write nothing and exit non-zero with the validation message.
4. Prepare each conflict, in memory, as a text question for
   `_bookkeeping/questions/Triage_Conflict_<sha256(refA|refB|when)[:12]>.question.card`.
   Its memo names the two destinations, the case and why the principles do not
   settle it. Its prompt asks where such items go and when. Its directive is:
   add the answer as a `user-stated` intake-guide triage rule, which makes the
   compiled file stale.
5. Under the box Git lock, recompute the raw sources and cited-card digests and
   reread the compiled file. If either changed since step 1, discard this result,
   questions included, and report `superseded`. Otherwise write the compiled file
   and the new question files (an existing question file is kept), and make one
   scoped commit of them, with trailers `Triage-Compiled: <short digest of compiledFrom>` and
   `Triage-Classifier: <model>`.

Use in the snapshot:
- `compileInstructionSnapshot` reads the compiled file when no overlay is given.
  If its `compiledFrom` equals the raw sources followed by the cited cards' current
  digests, and `principlesVersion` matches,
  each destination keeps its canonical `rules` text unchanged, and the compiler
  appends `Role: work|archive`, the compiled boundary text, and any cited facts
  after it. A rewrite can add boundaries but cannot drop a stated exception.
  The policy gains a "Tie-breaks" section and a "Conflicts (use unclear)"
  section. The compiled file is appended to `sources` with its digest, so apply's
  existing digest check (`decisions/apply.ts`) invalidates a decision when the
  file changes.
- When the file is stale, absent or invalid, the snapshot uses the raw rules,
  and `instructions` output reports `compiled: stale|absent|invalid`. An invalid
  file is reported, never silently ignored: the summary names the zod error.
- Overlays (`--overlay`, `--landmarks`) always compile raw, because a trial
  tests canonical edits.

In `runJevTriage`: dedupe first, then compile when the compiled file is stale
or absent, once per run and not in dry-run. Dry-run reports the staleness and
judges with the raw rules. A compile failure warns and the run continues on raw
rules, which is today's behavior. `JevTriageResult` gains
`compiled: "current" | "recompiled" | "stale" | "absent" | "failed" | "superseded"`,
and each receipt's snapshot shows whether the compiled file was a source.

**Vocabulary lock-ins.** File path `_bookkeeping/triage/compiled-instructions.json`;
command `bbx triage compile [--json]`; roles `work`/`archive`; question basename
prefix `Triage_Conflict_`.

**First chunk.** Schema, validation and snapshot use, with a hand-written
compiled file in a test box: current, stale and invalid cases. No agent yet.

## Could this be simpler?

Simplest: principles text only (Track 2), with no compile pass. It costs about
70 lines. The replay shows where it falls short. The two shop property-tax misses
need an identifying fact (the property address or ID) tied to the right
destination. A principle cannot supply it; the compile agent can, by reading the
box's own cards. The collection letters need a definition of "creditor claim",
which only the boxholder can give. The conflict question is how that answer
gets requested and recorded. Track 2 still lands first and alone, so its effect
can be measured before Track 3.

A cheaper alternative for Track 1 is size-plus-hash over the working tree. It
fails when annexed content is absent locally (the July backup lacked most
objects). Annex keys work without content.

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| The compile agent omits a destination or names a non-snapshot ref | Planned (Track 3 validation) | Validation rejects; nothing written | Clear: non-zero exit, raw rules used |
| The compile agent invents a fact, such as a wrong property ID | Planned (fake agent: uncited and misquoted facts) | A fact must occur verbatim in its cited card, or validation rejects the output | Clear |
| A cited card changes after compiling | Planned (stale test) | Its digest is in `compiledFrom`, so the file is stale | Clear: `compiled: stale` |
| Two compiles run at once | Planned (fake agents, interleaved) | Digest recheck under the Git lock; the later result is discarded | Clear: `superseded` |
| A landmark is edited after compiling | Planned (stale test) | Digest mismatch, raw rules used, recompile on the next real run | Clear: `compiled: stale` |
| Someone hand-edits the compiled file | None | Not detected; the edit is used until the next compile | Silent except in Git history. Accepted risk: the file says it is generated, and box docs say where rules live |
| A duplicate check matches a 0-byte or tiny common file | Planned | Originals under 1 KiB are never duplicates | Clear: the item proceeds to triage |
| A duplicate card carries a note the filed copy lacks | Planned | Only bare files and verified, unedited scan-import sessions are removable; others are `review` | Clear: reported, not moved |
| A chat capture session matches filed bytes | Planned | No `scan-upload/` provenance, so `review` | Clear: reported, not moved |
| A compile drops a destination's stated exception | Planned (snapshot test) | Canonical rule text is always kept; compiled text is only appended | Clear |
| A non-SHA256 annex backend | Planned | Hash local bytes if present, else that file is not indexed | Item proceeds to triage; never removed wrongly |
| A dotted rescan of a filed document | Planned | Different bytes, so not a duplicate | Clear |
| Trash commit fails after the move | Existing (`commitTrashReceipt`) | Item stays in trash, uncommitted; the sweep commits it | Visible as an uncommitted change; same as `bbx rm` today |
| Conflict question answered | Existing text-question and directive flow | The follow-up agent writes a user-stated guide rule; the compiled file goes stale | Clear |
| The compile pass exceeds its budget | Existing (agent invoke limits) | `invokeStructured` failure means no file is written, raw rules are used, warning shown | Clear |

No critical gap: every silent path either cannot remove content or is an
accepted risk in a committed, readable file.

## Agent-flow / user-flow edge cases

- Wrong field: the boxholder edits the compiled file instead of a landmark.
  ADDRESSED: the file's header field `"note"` says it is generated; box docs say
  where rules live; the next compile overwrites it.
- Stale ref: a destination landmark is removed. ADDRESSED: its digest leaves
  `sources`, so the compiled file is stale and raw rules apply.
- Two agents: chat and the reactor both run triage. ADDRESSED: Track 3 step 5
  rechecks digests under the Git lock before writing; the later compile is
  discarded as `superseded`.
- Fabricated value: the compile agent makes up a tie-break basis. ADDRESSED in
  part: `basis` must quote a guide rule or name a principle number; validation
  checks principle numbers and that quoted text occurs in the policy (Track 3, step 3).
- Validation UX: compile errors name the destination ref and field.
- Transition: boxes without a compiled file behave exactly as today until the
  first non-dry-run Jev triage.

## NOT in scope

- Wiring intake jobs to the Jev engine. The box in the replay files scans through
  agent-worked intake jobs, and `runJevTriage` reads only `inbox/staged/`. The
  boxholder chose to work backwards (2026-10-29: *"I like working backwards"*),
  so the wiring is the next plan. That plan also holds the per-destination batch
  agent pass the boxholder described. Until then, both new operations are CLI
  commands that the intake-job agent can call.
- Near-duplicate rescans: boxholder decision.
- A per-item overlap question to Jev: the replay data show confident misfiles,
  so overlap is handled at compile time. It can be revisited with the replay loop.
- The agent triage engine (`run/core.ts`) using the compiled file. It keeps its
  own instructions until the wiring plan decides which engine reads what.
- Replaying receipts automatically after compile. The existing replay commands
  serve that; the box doc tells agents to use them.

## Open design questions

- When a recompile no longer lists a conflict (the boxholder edited the guide
  directly, or the agent reworded the case), its earlier unanswered question
  stays pending. Lean: on a successful compile, remove unanswered generated
  `Triage_Conflict_*` questions that the new file does not list, and keep
  answered ones. Needs the boxholder's decision (cross-model code review finding).

- Should `bbx triage compile` also replay confirmed receipts and refuse a
  compile that regresses them? Lean: yes, in the wiring plan, once a box has
  confirmed receipts. The replay box has none yet.

## Knowledge audits

One new agent-facing concept: rules live in landmarks and the guide; the compiled
file is generated. Add `triage-compiled-is-generated` (knows_directly: edit a
landmark or the guide, then recompile; never edit the compiled file) to
`beebox/src/dev/knowledge-audits.yaml` and run it on the worktree's test box.

## What will hold this after it ships

- `test/core/triage/duplicates.test.ts`: tmp-box tests with fake annex pointers.
- `test/core/triage/snapshot.test.ts`: principles placement; compiled current,
  stale, invalid and overlay cases.
- `test/core/triage/compile.test.ts`: fake agent output, both valid and each
  invalid case, question files, commit trailers.
- `test/core/triage/auto/core.test.ts`: the run order dedupe → compile → judge,
  dry-run doing neither move nor compile.
- One live check on test1 with a real compile agent on synthetic rules, recorded
  as an observation.
- The 93-document real-box replay as a measurement. Running the compile agent on
  that box's content needs the boxholder's yes first: it sends rule text to a
  non-Jev model.

## Implementation order

1. Track 2 principles plus test. Rerun the 93-document replay (Jev only) and record the delta.
2. Track 1 `findExactDuplicates` plus tests; then trash moves and the run integration.
3. Track 3 schema, validation and snapshot use with a hand-written file.
4. Track 3 compile command, agent pass, questions, commit; then run integration.
5. Box docs (`docs/box/triage-instructions.md`), knowledge audit, change-selected
   tests, typecheck, lint, cross-model code review.

## Rollout shape

Done when the tests named above pass, the knowledge audit passes, and the replay
deltas are recorded in the issue (aggregates) and the private report (per item).
No data migration: the compiled file and trash moves are new; receipts keep
snapshot version 1. Boxes opt in by running `bbx triage --engine jev` as today.
