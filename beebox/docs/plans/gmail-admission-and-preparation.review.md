# Plan Engineering Review — Gmail admission and preparation

## What already exists
Gmail already has candidate rules, staged summaries, tracked threads, explicit
tracking and a read-only external-mail command. The new gate must use those
boundaries rather than assuming only automatic initial import writes mail.

## Ontology (verified against the code's own names)
Admission is distinct from destination selection; an explicit track is an actor's
admission rather than a Jev prediction. The later human decision admits the whole conversation once relevant, including
future replies. Tracked refresh therefore remains unchanged after admission.

## Prior art (external) — verified
The draft links the upstream PostalMime and MailParser documentation. Raw MIME
parsing differs from the existing Gmail API-tree decoder; shared extraction does
not imply one shared input parser.

## Stated preferences this plan trades against
No unadmitted automatic content writes, ID-only pending, temporary extraction,
CLI operations, and later—not immediate—todo annotation.

## Could this be simpler? (verified)
Keep Gmail's existing full-tree API and fix its body-alternative handling; do not
add raw fetch and replace attachment transport solely to share a MIME parser.

## Failure modes
Thread metadata is content too. An unadmitted conversation must produce no
thread summary or message cards; after admission its full snapshot is permitted. A procedure must not receive pending bodies before admission.

## Agent-flow / user-flow edge cases
Explicit track is deliberate caller admission and must not be overruled by Jev.
It does not prove human confirmation. Existing explicit external-mail tools can
retain transcripts; the automatic pipeline guarantee is not a capability sandbox.

## Findings

### Filter before thread rendering, not individual body writes
**Location in plan:** What already exists; Gmail track.
**Citation:** `threads.ts:129` writes a message card; `:177–184` computes thread
metadata from the fetched message collection.
**Issue:** Filtering only body and attachment writes still retains rejected
subjects, snippets and participants.
**Why it matters:** Violates the admission boundary through normal refresh.
**Suggested action:** Accepted boundary, revised by the later human decision:
gate whole-thread materialization before all writes. Test that an unadmitted
thread writes nothing and an admitted thread refreshes without reclassification.
Per-message filtering is no longer required.

### Settle existing procedure and explicit-access behavior
**Location in plan:** Gmail track.
**Citation:** `rules.ts:149–154` tells the procedure to inspect pending mail;
`cli/commands/connector.ts:104–120` exposes the external Gmail command.
**Issue:** Ordinary agent fallback can retain unadmitted content, while applying
Jev to deliberate manual tracking would let it overrule the caller.
**Why it matters:** Existing workflows need explicit semantics under the gate.
**Suggested action:** Accepted: procedures run after admission; explicit track
records caller admission; the automatic gate does not invoke external-mail tools.
Keep explicit external-mail access available and disclose its transcript behavior,
rather than expanding this plan into global agent confinement.

### Raw MIME parser does not receive Gmail API trees
**Location in plan:** Preparation track.
**Citation:** `mime.ts:159–163` returns the first plain part; `:215` parses the
Gmail API message and `:233` fetches attachments separately.
**Issue:** A raw parser alone cannot fix Gmail's placeholder-body loss.
**Why it matters:** The motivating Gmail case would remain broken.
**Suggested action:** Accepted: preserve both relevant body alternatives in the
Gmail adapter, add the raw-email adapter separately, share downstream extraction.

## NOT in scope (verified)
Todo execution, broad shutdown refactoring, live rollout, and agent sandboxing.

## Things I checked and found clean
Claude verified the metadata-test live-backend path and the todo findings.
The human settled thread policy after this review: "Admit the whole conversation
once relevant." The plan now preserves whole-thread history and future refresh,
removes per-message filtering, and updates the estimate. Final scope/size review
remains before a BIG CHANGE. No production implementation has begun.

## Later accepted scope: agent todo annotation

After this review the boxholder accepted todo annotation. The plan now includes
a final design track using existing agent todos, preserving them through Gmail
refresh and making new actionable items eligible for the next sweep. This was
not part of the reviewed implementation direction. Its receipt/replay mutation
contract and concrete scope need review before code; the combined estimate now
reaches BIG CHANGE size. No implementation has begun.
