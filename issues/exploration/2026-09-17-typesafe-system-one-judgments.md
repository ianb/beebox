---
title: "Check out TypeSafe (System One / Jev) — typed judgments with calibrated probabilities as a code primitive"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder shared typesafe.ai
---

[TypeSafe](https://typesafe.ai/) sells a hosted model (Jev, their "System One"
model) that answers typed questions about supplied state. It returns an answer
plus a probability distribution and a confidence value. It does not generate
prose or reasoning. Their agent skill is public and MIT licensed
([SKILL.md](https://github.com/typesafe-ai/skills/blob/main/skills/typesafe-ai/SKILL.md),
[docs](https://docs.typesafe.ai/llms.txt)). Nothing is installed; this note is
from reading the skill and docs on 2026-09-17.

## What it is

- One endpoint: `POST https://api.typesafe.ai/v1/systemone`, bearer API key,
  a `state` field plus a map of named `questions`, and `"model": "jev-latest"`.
- Three question types: **Choice** (one of a defined set), **Score** (a level
  on an ordered, described scale), **Noul** (probability that a yes/no
  condition holds). Each answer carries per-option probabilities; Choice and
  Score also carry a confidence value that summarizes how concentrated the
  distribution is.
- Independent questions over the same state go in one call and run in
  parallel. A second call is needed only when one answer determines the next
  state or options.
- Their stated model: code owns the workflow, keeps rules, arithmetic, and
  lookups, and asks the model only for the semantic judgment. Their docs warn
  that typed output guarantees the interface, not the truth, and that
  thresholds must be set against your own data.

Pricing is not on their docs site; a pricing page 404s. The API is hosted only;
no self-hosted or local option is documented.

## Where this could fit

Bee Box currently does every semantic judgment by running an agent session and
parsing what comes back. Candidates where the needed answer is a label, a rank,
or a yes/no:

- **Inbox triage and job routing** — which handler an incoming item needs.
  Related: [triage agent session routing](../closed/features/2026-06-28-triage-agent-session-routing.md),
  where the open question is "which existing session should this message join?"
  That is a Choice over candidate sessions.
- **Search ranking** — reranking issue or card search candidates by relevance.
- **Validation and audit judgments** — the refresh-maps validate judge, and
  knowledge-audit grading, which today spend an agent turn per judgment.
- **Cheap passes already split out** — the `smallModel` slot
  ([closed issue](../closed/features/2026-08-25-small-model-slot.md)) exists
  because title, summary, chat-review, and procedure-judge passes do not need
  a flagship model. Those are the same shape.

The calibrated-probability part is what a prompt-and-parse pass does not give:
a threshold you can set, and a defensible "not sure, ask a person" branch.

## What would have to clear first

1. **Egress.** Every question sends box content to a third party. Box content
   is the boxholder's private material, and the security report's data-egress
   section (`beebox/docs/security-report.md`, §3) is the place that has to
   account for it. A judgment over a chat message or an email is exactly the
   content a box exists to keep private.
2. **Another vendor, another key.** The boxholder weights setup surface
   heavily: zero extra setup beats a lower per-call cost. A new API key per box
   or per deploy is real friction, and this is a young company with no visible
   pricing.
3. **Calibration is a claim.** "Trained for calibrated decisions" needs
   measurement on our own data before a threshold decides anything. Any trial
   should compare against the same judgment from the `smallModel` slot, on
   recorded cases, not on their cookbook examples.
4. **Prior art in the queue.** [OpenRouter consolidation](../closed/exploration/2026-08-31-openrouter-optional-services-consolidation.md)
   was the last look at adding an optional model service. Read its disposition
   before proposing another.

## Smallest useful experiment

Take one existing judgment with recorded inputs and known outcomes — the
procedure judge or an inbox-triage decision — and run it three ways offline: the
current agent pass, a `smallModel` pass, and a TypeSafe Choice/Noul. Compare
agreement with the recorded outcome, latency, and cost. No box content leaves
the machine until the boxholder approves the egress for that trial.
