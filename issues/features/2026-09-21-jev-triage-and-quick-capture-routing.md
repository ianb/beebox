---
title: "Try Jev for document triage, and for a quick-capture entry point that routes itself to the right chat and landmark"
workstream: jev-triage
area: beebox
labels: [triage, chat, models]
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder wanting to try this soon
---

Two uses of the same idea, and the boxholder wants to try them soon: a typed,
calibrated judgment where today there is a prompt and a parse. The model is
Jev, TypeSafe's System One model
([exploration](../closed/exploration/2026-09-17-typesafe-system-one-judgments.md)):
send state plus typed questions, get back an answer with a probability per
option and a confidence.

## 1. Triage of incoming documents

The triage stage already has the exact shape Jev serves. It compiles a
destination doc from landmarks' `destinations:` frontmatter, runs a subagent
over a batch of intake-complete items, and applies decisions
(`beebox/src/core/triage/run/core.ts`, `instructions.ts`, `routing.ts`).

The important part is what the decision carries: a **self-reported confidence
word** — `confident` | `probable` | `guess` (`routing.ts:33`) — and behavior
already branches on it (`routing.ts:4-7`). `confident` and `probable` both
route to `inbox/triaged/<category>/`; `probable` additionally drops a review
marker; `guess` goes to `_unsure/` and raises a question card for the
boxholder.

So the system already believes a confidence signal and acts on it, while the
signal is a word an agent chose about itself. A Choice over the compiled
categories returns a probability per category plus a confidence, which is the
same three-way behavior driven by a number with a threshold set from the
box's own history rather than by the model's self-description.

What has to be worked out:

- **Thresholds are per box, not global.** A box with three destinations and a
  box with thirty behave differently at the same number. Set them against
  recorded decisions, not a cookbook.
- **What "no category fits" means.** A Choice needs an explicit no-match
  outcome, or it will pick the least-bad option with a middling probability.
  Today that case is `guess` plus a question card.
- **Where the reason text comes from.** `routing.ts:41` surfaces a one-line
  agent explanation on `probable` review and in question prompts. Jev does not
  generate prose. Either the reason disappears, or code composes it from the
  distribution, or an agent still writes one for the uncertain cases only.
- **Batch shape.** Triage runs over a batch today; independent questions over
  the same state go in one Jev call, but each item is its own state, so this
  is one call per item rather than one per batch.

## 2. The quick-capture entry point

The boxholder has wanted "a generic entry point that is routed to a chat, new
or existing, and a particular landmark". That is
[triage agent session routing](../closed/features/2026-06-28-triage-agent-session-routing.md)
(`needs: [design]`), which proposes a throwaway triage session with a
`switch-to-session` tool that re-dispatches the message to the destination.

Jev changes the cost of that design. The routing decision is a Choice over
candidate destinations — recent sessions, landmarks, a new chat — and the
returned probability is what decides whether to route silently, route and say
so, or ask. That old issue's open questions still stand and are not settled
here: what the target universe is (web sessions, Telegram threads via
`chat-reactor-sessions.ts`, non-chat destinations) and what the catalog of
candidates must carry for a decision to be possible at all.

Related: [MCP launch into chat](2026-08-02-mcp-launch-into-chat.md) already
moves a conversation to a named landmark or chat, so the *destination* half
may exist; this is about choosing the destination.

## What both share

A capture the person fires and forgets is only worth having if it lands
somewhere sensible, and the honest failure mode is "ask me" rather than a
confident wrong guess. Both halves need the same three-way behavior: act, act
and flag, or ask. Today one of them is a word a model picked; the other does
not exist.

## Before building either

The exploration issue's cautions apply: every question sends box content to a
third party, and a new vendor key per box is real setup the boxholder weights
heavily. The smallest useful experiment is offline — replay recorded triage
decisions three ways (current agent pass, the `smallModel` slot, Jev) and
compare agreement with what actually happened. Triage has exactly the recorded
history to make that possible, which is why it is the better of the two to try
first.

## 2026-09-26 (notifications workstream)

Partly addressed, not closed. The notifications work built the general Jev
plumbing this issue's two applications would sit on top of:
`jev.judge` (`src/core/judgment/service.ts`) returning a probability per
option plus a confidence (`noul`/choice/score per
`src/schemas/judgment-instructions.ts` (moved to `beebox/src/schemas/judgment/instructions.ts`)), and the `.judgment.card` schema
(`src/schemas/judgment.ts` (moved to `beebox/src/schemas/judgment/schema.ts`)) plus `bbx judge` as its runner. At that time neither triage
routing nor quick capture used it. Document triage has since been rewired in
the admitted-document implementation. Quick Chat was implemented separately
and is documented at [`beebox/docs/chat/quick-chat.md`](../../beebox/docs/chat/quick-chat.md);
check that work against the broader candidate-universe questions above before
calling this half fully resolved.

## 2026-09-28 — document-triage experiment

The [synthetic experiment report](../../beebox/docs/reports/jev-document-triage-experiment-2026-09-28.md)
and [implementation plan](../../beebox/docs/implemented-plans/jev-document-triage.md) cover only
half 1. Production routing has not changed. Current triage already uses
smallModel, so those proposed comparison arms are now the same baseline.

The corpus covers destination boundaries, MIME/body loss, attachment-only
relevance, PDF text quality, OCR, and preparation failure. Live Jev worked on
the synthetic text evidence, but preparation failures make a classifier-only
replacement insufficient. No per-box thresholds have been selected.

The boxholder clarified the admission boundary: unadmitted bodies/attachments
must stay out of box content and Git; unresolved mail stays at its source with
ID-only pending state; temporary extraction files are permitted and deleted.
Rules must carry the necessary context, remain understandable and updateable
as destinations change, and support a full-agent research fallback when Jev
cannot classify well. Those requirements are in the plan. Half 2 remains open
and is not implemented by this workstream.

Further discussion favors treating unclear as an explicit outcome, letting an
agent correct the canonical instructions when it discovers a mis-triaged item,
and making commits identify the triaged item, instruction paths, classifier,
and confidence signals. Mandatory upfront calibration and a separate outcome
record system are not accepted requirements. The full plan now specifies
explicit outcomes, bounded research and replayable instruction changes.

The household-administration corpus was regenerated and all observations rerun:
228 live Jev calls plus three current-agent batches. Jev matched 11/12 short
destination examples (cloud-storage notes became no-match); both models matched
all four prepared documents. Explicit unclear separated missing evidence from
no-match, while concrete best-effort rules controlled ambiguous filing. The
[paired report](../../beebox/docs/reports/jev-instruction-experiment-2026-09-28.md)
records the instruction experiment. The complete admitted-document implementation
plan requires size/scope approval before coding. Gmail admission remains outside
that implementation unit and keeps this issue open. Quick Chat now exists in
separate chat-routing work; the older quick-capture description is historical
context, not a current claim that no quick-chat surface exists.

## 2026-09-28 — admitted-document implementation

The boxholder approved the full scope. The worktree adds opt-in `triage --engine
jev`, preparation/instruction/judgment CLI operations, fixed-evidence and
prepare-again replay, confirmed-outcome discovery, correction, bounded research,
and scoped receipt-backed application. Attachment scopes travel with intake
cards. The default classifier remains the existing agent until explicitly opted in.

The [agent-facing guide](../../beebox/docs/box/triage-instructions.md) covers
instruction repair and regression replay. All four new knowledge audits passed.
Receipts intentionally retain prepared evidence until explicit deletion; deleting
an original alone does not remove snapshots or Git history. Native Codex research
cannot enforce a USD ceiling, though tool turns and Jev calls remain bounded.

This issue stays open for Gmail pre-materialization admission and any remaining
gap between the original generic capture-routing proposal and the separate Quick
Chat implementation. No real box was used for model probes; worktree commits do
not deploy. Final implementation checks are recorded in the linked plan/review.

## Next-action note (2026-10-06)

Checked "fixed?": partly. Quick capture: Quick chat routes through a Jev choice (`beebox/docs/chat/quick-chat.md`; plan `beebox/docs/plans/chat-routing.md`, status partial); its entry points are now with the `quick-chat-design` workstream. Document triage: a Jev engine exists (`beebox/src/core/triage/judge.ts`) but production routing is unchanged, no per-box thresholds are chosen, and preparation failures block a classifier-only replacement (2026-09-28 note). Telegram and non-chat destinations remain.
