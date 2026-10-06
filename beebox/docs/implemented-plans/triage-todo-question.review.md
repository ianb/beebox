# Plan Engineering Review — triage todo question

## What already exists

Claude Fable reviewed the plan and its cited source before implementation.
Existing Noul questions, global frontmatter todos, and application-commit replay
support the approach without a new task executor.

## Ontology (verified against the code's own names)

Landmark destination, instruction snapshot, judgment, decision receipt and todo
remain their existing concepts. `todo-question` is optional per destination.

## Prior art (external) — verified

No external premise; only existing local contracts are used.

## Stated preferences this plan trades against

The human chose a per-item destination-specific question, with omission meaning
no todo. Normal bounded todo review remains the processing mechanism.

## Could this be simpler? (verified)

The review removed connector preservation from this change. Gmail/Drive cards
currently bypass staged triage; preserve metadata when that integration lands.

## Failure modes

Routing original bytes must be committed before annotation for exact replay.
Pending annotation state must be written ahead of the source mutation.

## Agent-flow / user-flow edge cases

The default agent engine must honor the same field as Jev. A correction with no
recorded binary answer must fail explicitly rather than manufacture no.

## Findings

### Default agent engine needs the shared merge contract

**Location in plan:** Tracks 1–2.
**Citation:** `beebox/src/core/commands/triage.ts:17` defaults to `agent`.
**Issue:** The initial plan specified receipt semantics only for Jev.
**Why it matters:** Default triage would ignore or inconsistently apply the field.
**Suggested action:** Share the pure todo merge helper; merge before legacy move.
**Disposition:** Accepted and added to Track 2.

### Required annotation must survive the routing checkpoint

**Location in plan:** Track 2.
**Citation:** `beebox/src/core/triage/decisions/apply.ts:177` marks routing applied.
**Issue:** Metadata absence cannot distinguish old decisions from interrupted new work.
**Why it matters:** A retry could omit the requested follow-up.
**Suggested action:** Derive need from immutable snapshot/answer; save pending
hashes in the routing checkpoint and handle completed annotation before digest checks.
**Disposition:** Accepted, including explicit missing-answer failure. Implementation
saves pending hashes after committing routed original bytes and before source
mutation; immutable fields still require the annotation when metadata is absent.

### Connector changes are premature

**Location in plan:** Track 3.
**Citation:** `beebox/src/connectors/gmail/threads.ts:161` writes outside staged intake.
**Issue:** Connector regeneration is not a current downstream path for this operation.
**Why it matters:** General preservation broadens this feature without exercising it.
**Suggested action:** Defer preservation to Gmail admission integration.
**Disposition:** Accepted; retained in the broader Gmail plan.

## NOT in scope (verified)

No Gmail admission, separate task executor, immediate run, or scheduler change.

## Things I checked and found clean

The reviewer verified that prepare-again searches all matching application
commits and rejects blobs that do not match the original evidence digest.
Existing annotation types and sweep state can be reused. Updated plan includes
the fourth sweep-list instruction and schema changes; no second fresh plan review
was needed for these concrete corrections.

## Finished-change review

Claude Opus reviewed the completed diff and traced both engines, replay, retry
checkpoints and sweep selection.

- Accepted: schema-parsed reserialization could drop unknown frontmatter. Keep
  schema validation, but append through the existing format-preserving YAML
  approach and preserve the body; add an unrelated-field/comment regression.
- Accepted narrowly: unreadable evidence has no binary answer. Keep the planned
  explicit failure, but explain that evidence must first become readable and a
  new decision must be judged; retrying the same correction cannot fix it.
- Deferred policy: a positive raw-file decision cannot carry frontmatter. The
  current explicit error retains the item staged; legacy rejects that batch.
  Automatically filing without the requested todo, wrapping raw files, or
  converting annotation errors into destination questions needs a separate
  choice. This limitation is recorded as a focused follow-up, not silently
  resolved by inventing a negative answer.

The reviewer verified yes/no/omitted behavior, same-call questions, completed
todo preservation, pending retry recovery, original-byte replay, and sweep
start/recheck/terminal/cap filters.

Fix verification by Claude confirmed frontmatter preservation and the corrected
missing-answer guidance. Its narrow wording follow-up was accepted: remove the
generic “retry apply” wrapper that contradicted the new-decision instruction.
Added coverage for appending alongside an existing todo with its own unknown
field/comment and done/recheck state. No new review scope was opened.
