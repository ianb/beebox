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

Three independent responsibilities: fix an accidentally live reservation test;
prepare raw MIME using a real parser; add opt-in Gmail admission before writes.
The first two can be designed and implemented without settling thread admission.
Do not turn them into a general connector framework.

Provisional estimate: 700–1,000 changed source lines, 600–900 test lines, and
150–250 authored documentation lines; no generated output expected. The upper
range is a **BIG CHANGE**. Final Gmail policy and a narrower implementation
estimate must be settled before implementation at that scale. The immediate
fake-backend correction should be under 30 changed lines. This draft does not
claim the larger change has size approval.

## Stated preferences this plan trades against

The boxholder required "no unadmitted box content", accepted temporary extraction
with cleanup and ID-only pending records, and asked for understandable CLI
operations. The boxholder now says a real box is already using triage and asks to
look at Gmail, preparation, and test cleanup. Todo annotation is a possible later
addition, not part of this implementation.

Keep the single overarching intake guide and landmark destination explanations.
Admission answers relevance; destination selection answers placement. A relevant
message with no current filing destination must not be discarded merely because
filing returned no-match. Preserve this distinction in instructions and output.

## What already exists

- `beebox/src/connectors/gmail/connector.ts:232`: `refreshThreadSnapshots` is the
  materialization seam after discovery/rule evaluation. Lines 229–235 also feed
  changed, already-tracked threads into that seam. Both paths need admission.
- `beebox/src/connectors/gmail/config.ts:40`: `StageActionInputSchema` has
  `type: z.literal("stage")`; it is an existing action, not a new admission policy.
  `rules.ts:106` builds `pendingSummary`, and line 111 spreads
  `summarizeGmailMessage`: current pending state retains snippets and metadata.
- `beebox/src/connectors/gmail/threads.ts:134`: `fs.writeFile(bodyPath,
  opts.message.textBody)` and line 141 writes attachments. Filter the fetched-message collection before `writeThreadCards`, not just the
  individual writes. Thread subject, participants, labels and dates must derive
  only from admitted messages; a rejected reply must not alter the thread card.
- `beebox/src/core/triage/judge.ts:56`: "Classify one admitted document"; lines 80/99
  call `appendJevDebug`. `core/judgment/service.ts:75` writes to
  `.beebox/jev-debug.log`. This admitted-content wrapper is not safe to reuse
  unchanged for unadmitted mail. Reuse the typed service and budget primitives.
- `beebox/src/core/triage/evidence.ts:151` starts format preparation; the `.eml`
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
- Tracked thread: existing connector identity. Whether it admits future messages
  automatically is the product decision still awaiting an answer.
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

Proposed connector-level opt-in admission policy covers rule-driven tracking and
new messages during tracked refresh. Existing explicit `track` is a deliberate
admission by its caller; record that actor as explicit-command, never infer
human confirmation. Jev must not overrule that deliberate admission. The pending
thread-policy decision also determines whether explicit thread tracking admits
future replies or only its current snapshot.

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

The provisional direction is per-message admission, with existing admitted history
preserved. Thread-level admission is awaiting the boxholder's decision. The first
Gmail implementation chunk is blocked on that decision; do not disguise it as a
routine implementation choice. No already-imported content is automatically deleted.

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
| Tracked refresh leaks a rejected reply into thread metadata | Existing refresh bypasses gate | Filter collection before all card writes; admitted-only thread summary | New byte-identical-card regression |
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
- DEFERRED to the explicit decision below: future messages in an admitted thread.
- ADDRESSED in direction: existing content stays; no retrospective deletion.
- ADDRESSED in direction: malformed policy is a visible configuration error.
- DEFERRED: an ordinary research agent cannot inspect unadmitted body text while
  meeting the no-persistent-transcript requirement.
- DEFERRED: todo annotation needs preservation, stable identity/deduplication,
  and a deliberate execution schedule; current review is not an immediate runner.

## NOT in scope

- Post-triage todo creation or a new task runner: the user described this as later work.
- A production chat warm-up lifecycle rewrite without a deterministic failing test.
- Automatic deletion/reconciliation of mail already in a box.
- A general connector framework or isolated ephemeral agent runtime.
- New extraction cache migration or fabricated vision model-version metadata.
- Live real-box/provider trials or production configuration changes during this design pass.

## Open design questions

1. Does a relevant message admit its whole thread and future replies, or is each
   message checked? Asked explicitly; current lean is per-message to honor the
   earlier wording. The Gmail integration remains a draft until answered.
2. For the later todo feature, should new agent todos run on the next sweep or
   only under existing due/start/stale review semantics? Do not invent dates to
   force scheduling. Also decide whether text comes from instruction templates
   or a grounded agent; Jev does not write prose.

## Knowledge audits

Implementation needs real audits for admission-versus-filing, ID-only pending
review, and missing extraction evidence. Raw MIME mechanics and test fake
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

1. Resolve thread admission; narrow the estimate and review the full scope.
2. Isolate the metadata reservation tests and verify the named test exits cleanly.
3. Add the MIME decoder, then common temporary extraction and provenance tests.
4. Integrate opt-in Gmail admission and ID-only state/review/retry operations.
5. Run audits, selected tests, cross-model finished-change review, and commit.
   Land only on a new explicit finish request.

## Rollout shape

Synthetic/fake tests first. Existing Gmail behavior remains for boxes without the
new opt-in gate; enabling it must explicitly purge legacy pending summaries so
contentful pending state does not survive unnoticed. This is not retroactive
cleanup of already-admitted cards. Only enable a real box after the complete
admission boundary is verified and the boxholder has authorized that rollout.
