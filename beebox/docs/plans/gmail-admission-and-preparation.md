---
title: "Gmail admission and email preparation"
status: draft
workstream: jev-triage
issues:
  - ../../../issues/features/2026-09-21-jev-triage-and-quick-capture-routing.md
  - ../../../issues/code-quality/2026-09-28-passing-tests-start-chat-warmup-after-tempdir-removal.md
---
# Gmail admission and email preparation

Keep unrelated incoming mail out of box content while preparing enough evidence
to judge messages with HTML, PDFs, and images. This is a design draft following
admitted-document triage, not authorization to enable admission on a live box.

**Issues addressed:** The combined Jev issue's Gmail follow-up and the warm-up
warning above. Related, not resolved here: Gmail tracked-set reconciliation
(`issues/features/2026-08-10-gmail-reconcile-tracked-set-against-rules.md`) and the
Cloudflare email inbox proposal (`issues/features/2026-09-25-cloudflare-email-inbox-connector.md`).
Quick chat already exists in the separate chat-routing work; reconcile the older
combined issue's stale quick-capture description during implementation.

## Smallest fix and budget

The original three responsibilities are test isolation, raw MIME preparation,
and Gmail admission. The boxholder has now accepted a fourth: post-triage agent
todo annotation. Keep that as a separate final track with an explicit design
before implementation.
Admission is once per conversation: one relevant message admits its history and
future replies. This preserves the existing whole-thread materialization model.
Do not turn them into a general connector framework.

Revised estimate after whole-conversation admission: 600–850 changed source
lines, 500–750 test lines, and 350–450 authored documentation lines (including
this plan and review); no generated output expected. Total: 1,450–2,050 lines.
The upper range remains a **BIG CHANGE**; implementation at that scale needs
explicit size approval. Whole-conversation admission removes per-message
filtering and reconstruction of partially admitted thread cards. The immediate
fake-backend correction should be under 30 changed lines. Todo annotation adds
an estimated 150–300 source lines, 150–250 test lines, and 50–100 documentation
lines: revised combined range 1,800–2,700 lines, a **BIG CHANGE**. This draft does
not claim approval for implementation at that size; the added track needs its
concrete mutation/replay contract settled before a final scope review.

## Stated preferences this plan trades against

The boxholder required "no unadmitted box content", accepted temporary extraction
with cleanup and ID-only pending records, and asked for understandable CLI
operations. The boxholder now says a real box is already using triage and asks to
look at Gmail, preparation, and test cleanup. The boxholder subsequently accepted todo annotation. Include it as a separate
final design track: existing agent-assigned todos, preservation across connector
refresh, and next-sweep pickup without fabricated deadlines.

Keep the single overarching intake guide and landmark destination explanations.
Admission answers relevance; destination selection answers placement. A relevant
message with no current filing destination must not be discarded merely because
filing returned no-match. Preserve this distinction in instructions and output.

## What already exists

- `beebox/src/connectors/gmail/connector.ts:232`: `refreshThreadSnapshots` is the
  materialization seam after discovery/rule evaluation. Lines 229–235 also feed
  changed, already-tracked threads into that seam. Initial tracking needs admission; already-tracked threads remain admitted.
- `beebox/src/connectors/gmail/config.ts:40`: `StageActionInputSchema` has
  `type: z.literal("stage")`; it is an existing action, not a new admission policy.
  `rules.ts:106` builds `pendingSummary`, and line 111 spreads
  `summarizeGmailMessage`: current pending state retains snippets and metadata.
- `beebox/src/connectors/gmail/threads.ts:134`: `fs.writeFile(bodyPath,
  opts.message.textBody)` and line 141 writes attachments. Gate the entire thread before `writeThreadCards`, not just individual writes.
  An unadmitted thread must create no message card, body, attachment, or thread
  summary. Once admitted, all its messages contribute normally to the snapshot.
- `beebox/src/core/triage/judge.ts:56`: "Classify one admitted document"; lines 80/99
  call `appendJevDebug`. `core/judgment/service.ts:75` writes to
  `.beebox/jev-debug.log`. This admitted-content wrapper is not safe to reuse
  unchanged for unadmitted mail. Reuse the typed service and budget primitives.
- `beebox/src/core/triage/evidence/core.ts` starts format preparation; the `.eml`
  branch records `mime-unparsed`. Gmail `mime.ts:154` extracts from an API MIME
  tree, not raw RFC822. No raw MIME parser dependency was found in the workspace.
- `beebox/test/webapp/trpc/routers/chat.model-policy.doctest.md:93` constructs
  `makeTestServer()` without a fake; line 120 calls `reserveSession`.
  `core/chat/session/registry/warm.ts:85` starts `void prewarmBackend`.
  This is a concrete accidental live-backend path in a metadata test.
- `beebox/docs/box/todos.md:39`: `by="agent" assigned="agent"` already represents
  an agent follow-up. `core/todo/review-sweep.ts:100` requires age beyond
  `STALE_DAYS` for undated items, so a new undated annotation does not immediately
  reach the review sweep. `preserve-agent-fields.ts:15` preserves only
  `contains` and `contains-evidence` across connector regeneration.

## Prior art (external)

[PostalMime](https://github.com/postalsys/postal-mime) accepts raw byte buffers,
returns decoded bodies and attachment buffers, and exposes nesting/header limits.
It buffers input before parsing. Prefer this bounded adapter for the existing
byte-oriented preparation path; enforce input/part/output limits outside it.

[MailParser](https://nodemailer.com/extras/mailparser) offers streaming attachment
parts, but requires consuming and releasing each part. Use it instead only if
bounded buffering proves inadequate. Do not write a MIME parser ourselves.

## Ontology

- Candidate: Gmail message/thread IDs discovered by the connector, not admitted content.
- Admission: a relevance decision: admit, reject, or unclear. It does not choose a folder.
- Prepared evidence: decoded text and extraction results with explicit omissions;
  unadmitted evidence exists only during the operation.
- Pending admission: IDs plus machine status/rule revision, not a subject/snippet or receipt.
- Tracked thread: existing connector identity and admitted conversation. Admission
  covers its history and future replies; no per-reply classifier gate is added.
- Destination decision: the already-implemented admitted-document judgment/receipt.
- Agent todo: existing todo metadata; no new task type proposed.

## Tracks / scope

### 1. Test isolation

Inject the existing fake chat backend into metadata-only reservation tests. Keep
model selection/reservation assertions unchanged. Inspect sibling setups that
exercise the same path; change only evidenced accidental live backends.

First chunk: fake injection and the named model-policy doctest. Do not rewrite
production shutdown based only on this warning. The observed probe did not
reproduce the exact warning; it exposed the real startup path and did not finish
within the observation window. Its runner is no longer present.

### 2. MIME and common extraction

Add a bounded raw-email decoder in the service layer. Preserve decoded headers,
plain and HTML alternatives, nested message boundaries, and attachment metadata.
A placeholder plain body must not hide useful HTML. Strip markup without fetching
remote resources. Pass PDF/image bytes through the existing extraction services.
Unsupported or failed parts remain explicit omissions, never evidence of irrelevance.

First chunk: synthetic MIME fixtures and the raw-email decoder adapter. Gmail
continues using its existing full API tree and attachment fetches; it does not
call the raw-email parser. Fix its `extractTextBody` plain-first early return by
retaining distinct readable plain/HTML alternatives in prepared evidence. Both
input adapters then call the same byte/extraction primitive, separated from
box-ref discovery, with a caller-owned temporary workspace. No raw Gmail API
method or wholesale connector decoder replacement is needed. Raw `.eml` replay stays anchored to the original file digest;
extracted attachments use MIME part identities and must not masquerade as durable
box paths after scratch cleanup. Settle the additive evidence representation in
that extraction chunk before integration; keep existing receipt readers valid.

All scratch is caller-owned and deleted in finally. Do not add durable caches for
legacy extraction artifacts; their re-extraction is currently honest behavior.
Exact vision model reporting is deferred rather than guessed.

### 3. Gmail admission

Proposed connector-level opt-in admission policy covers initial rule-driven
tracking of an unadmitted conversation. Already-tracked conversations, including
those present when the gate is enabled, remain admitted and refresh normally. Existing explicit `track` is a deliberate
admission by its caller; record that actor as explicit-command, never infer
human confirmation. Jev must not overrule that deliberate admission. Explicit
tracking admits the full conversation and future replies on the same terms.

With admission enabled, `procedure` rules fire only after admission, with admitted
card refs. Stage rules retain IDs only. The existing `gws` command remains an
explicit external-mail tool; the automatic admission pipeline never invokes it
or passes its output to a normal research agent. Its deliberate use can retain
mail in an agent transcript. This plan promises content-free automatic admission,
not a sandbox preventing an agent from deliberately reading Gmail through other
tools; preserve that distinction in the guide and security report.
The overarching intake guide states box relevance separately from filing policy.
An enabled gate without that policy fails visibly instead of inferring irrelevance
from the destination catalog.

The boxholder chose "Admit the whole conversation once relevant." A relevant
message admits the entire conversation, including historical messages and future
replies. Classify candidate messages only until the conversation is admitted; do
not charge for or rejudge later replies. A new message on a rejected or pending
conversation is new evidence and can trigger another admission attempt. Deduplicate
admission by Gmail thread ID. No already-imported content is automatically deleted.

First Gmail chunk: deterministic gate tests for initial admission, ID-only pending,
and a tracked refresh that imports a later reply without invoking the classifier.

Call the typed Jev service with prepared candidate evidence and explicit admission
criteria. Reuse call budgets, but keep all request/response/error logs content-free;
ordinary full-agent fallback and the admitted-item receipt store are forbidden
before admission. Unclear, missing evidence, and operational failure stay pending
at Gmail. Rejected mail stays at Gmail too; retain only enough IDs and decision
revision to avoid repeatedly classifying unchanged material. Admit before creating
box cards/attachments or durable evidence copies.

Pending review should list IDs/status and Gmail links. Fetching bodies into an
ordinary agent transcript is not an ephemeral review mechanism. Explicit review
and rule-change retry commands must operate without exposing unadmitted bodies
through logs or normal research prompts. Preserve all pending IDs when pagination
advances; do not inherit the current 50-summary truncation as an admission queue.
Budget exhaustion leaves resumable work; no busy retry loop on every wakeup.

### 4. Post-triage agent todos — accepted direction, detailed design next

Use existing frontmatter `todos` with `assigned: agent`, `by: agent`, and the
actual `created` date. Rules may ask for a concrete follow-up; Jev does not invent
prose. Prefer authored action text with source links; use grounded agent text
when item-specific reasoning is required. Filing success and follow-up completion
remain separate outcomes. No new todo type or independent execution daemon.

The existing sweep must explicitly select newly actionable agent todos on its
next scheduled pass, respecting genuine future start dates and recheck state.
Do not invent due/start dates merely to enter its current date-based categories.
Retain the existing bounded review procedure and its authority rules.

Before implementation, settle idempotent annotation identity, preservation across
Gmail thread regeneration, and the boundary with receipt byte verification.
Adding frontmatter changes the source digest: it must not invalidate apply retry
or pretend changed bytes are the original replay input. A regression must cover
triage -> annotation -> refresh -> repeat apply -> fixed-evidence/reprepare replay.
Use a stable short todo ID, preserve completion on retries, and prevent an old
triage decision from recreating a completed todo.

First chunk is design/tests for those interactions, not a speculative annotation
write. This accepted track is not yet implementation-ready.

## Could this be simpler?

Gmail query rules alone are the smallest filter, but they do not classify
attachment-only relevance or ambiguous sender/body cases. Running existing triage
after import fails the user's admission boundary. A small preparation primitive
and an admission gate buy that boundary; a general isolated research-agent
runtime would be substantially larger and is deferred.

## Subplans

None yet. If ephemeral agent research becomes necessary before admission, it
needs a separate design rather than an implicit expansion of this one.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Placeholder plain body hides relevant HTML | Synthetic experiment only | Decoder must retain both | Explicit partial/complete evidence |
| MIME attachment extraction fails | Existing PDF adapter tests | Mark omission; admission unclear | Explicit pending |
| Debug log retains rejected content | Not for Gmail admission | Use content-free admission wrapper | New mandatory regression |
| Unadmitted thread leaks subject/snippet through early card rendering | Existing writer assumes admission | Gate before every thread write | New no-card/no-body/no-attachment regression |
| Admitted thread is reclassified or loses later replies | Existing refresh already works | Preserve refresh; classifier only for unadmitted thread IDs | New no-rejudge/full-refresh regression |
| Cursor advances past pending IDs | Current summaries cap at 50 | Durable ID-only continuation before advance | New mandatory regression |
| Temporary extraction survives failure | Existing Docling cleanup tests | Caller finally owns whole workspace | Extend to MIME/admission |
| Reservation test starts SDK during teardown | No deterministic warning reproduction | Inject fake in metadata-only test | Named test must exit cleanly |

These are planned regression requirements, not claims that the unimplemented
Gmail path is already protected.

## Agent-flow / user-flow edge cases

- ADDRESSED in direction: distinguish admission from destination no-match.
- ADDRESSED in direction: a missing attachment means pending, not reject.
- ADDRESSED in direction: manual track is explicit admission, recorded as an
  actor choice rather than a classifier or human-confirmed outcome.
- ADDRESSED by the explicit human decision: future replies are admitted with the
  conversation and sync without another relevance judgment.
- ADDRESSED in direction: existing content stays; no retrospective deletion.
- ADDRESSED in direction: malformed policy is a visible configuration error.
- DEFERRED: an ordinary research agent cannot inspect unadmitted body text while
  meeting the no-persistent-transcript requirement.
- ACCEPTED DIRECTION, DESIGN PENDING: todo annotation needs preservation, stable
  identity/deduplication and next-sweep selection. Current review is not an
  immediate task runner; reuse its scheduled procedure.

## NOT in scope

- A new task runner: accepted todo annotation reuses the existing sweep/procedure.
- A production chat warm-up lifecycle rewrite without a deterministic failing test.
- Automatic deletion/reconciliation of mail already in a box.
- A general connector framework or isolated ephemeral agent runtime.
- New extraction cache migration or fabricated vision model-version metadata.
- Live real-box/provider trials or production configuration changes during this design pass.

## Open design questions

Thread policy is settled: whole-conversation admission, including future replies.

Todo direction is accepted: annotate with an agent-assigned todo, preserve it,
and surface actionable work on the next sweep. Detailed choices still required:
annotation identity and mutation ordering relative to receipts/replay; authored
follow-up templates versus grounded item-specific text. These belong to the
fourth track's design, before its first code change.

## Knowledge audits

Implementation needs real audits for admission-versus-filing, ID-only pending
review, and missing extraction evidence. Todo annotation needs audits for next-sweep
eligibility, evidence-grounded action text and retry preservation. Raw MIME mechanics and test fake
injection alone are infrastructure and need no new always-loaded guidance.
Use a lean existing guide pointer and on-demand Gmail/triage docs.

## What will hold this after it ships

Use existing doctests and fake Gmail/Jev/extractor services. Cover mixed relevant
and irrelevant mail, attachments, tracked refresh, manual track, provider failure,
pending pagination, rule-change retry, procedure post-admission timing, and zero
retained unadmitted content from the automatic admission path in
box files, Git, debug logs, or agent transcripts. MIME fixtures cover encoded
headers, charset/transfer decoding, alternative bodies, PDF/image attachments,
malformed structure and limits. No new testing tier or live provider golden labels.

## Implementation order

1. Whole-conversation admission is settled. Confirm the final scope/size before
   implementation if the estimate exceeds 2,000 changed lines.
2. Isolate the metadata reservation tests and verify the named test exits cleanly.
3. Add the MIME decoder, then common temporary extraction and provenance tests.
4. Integrate opt-in Gmail admission and ID-only state/review/retry operations.
5. Complete the accepted todo track design, then implement annotation, connector
   preservation and next-sweep selection with replay/retry regressions.
6. Run audits, selected tests, cross-model finished-change review, and commit.
   Land only on a new explicit finish request.

## Rollout shape

Synthetic/fake tests first. Existing Gmail behavior remains for boxes without the
new opt-in gate; enabling it must explicitly purge legacy pending summaries so
contentful pending state does not survive unnoticed. This is not retroactive
cleanup of already-admitted cards. Only enable a real box after the complete
admission boundary is verified and the boxholder has authorized that rollout.
