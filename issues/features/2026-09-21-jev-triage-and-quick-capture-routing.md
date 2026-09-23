---
title: "Try Jev for document triage, and for a quick-capture entry point that routes itself to the right chat and landmark"
workstream: unattached
area: beebox
labels: [triage, chat, models]
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder wanting to try this soon
---

Two uses of the same idea, and the boxholder wants to try them soon: a typed,
calibrated judgment where today there is a prompt and a parse. The model is
Jev, TypeSafe's System One model
([exploration](../exploration/2026-09-17-typesafe-system-one-judgments.md)):
send state plus typed questions, get back an answer with a probability per
option and a confidence.

## 1. Triage of incoming documents

The triage stage already has the exact shape Jev serves. It compiles a
destination doc from landmarks' `destinations:` frontmatter, runs a subagent
over a batch of intake-complete items, and applies decisions
(`beebox/src/core/triage/index.ts`, `instructions.ts`, `routing.ts`).

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
