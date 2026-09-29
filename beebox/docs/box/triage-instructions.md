---
title: Triage instructions and replay
read-when: Filing admitted documents, repairing a wrong triage, or testing destination rules against earlier decisions.
---
# Triage instructions and replay

Triage prepares evidence, compiles policy, judges one item, and applies a decision.
`bbx triage --engine jev` composes those operations. The default engine remains
the existing agent. Jev dry-run stops at classification: no research or moves.
These commands handle material already admitted to the box. They do not prevent
Gmail from importing unrelated mail. Do not send unadmitted mail through ordinary
box-agent research: its prompts and transcripts persist.

## Where instructions belong

`_config/intake.guide.card` is the single overarching decision policy. It holds
identifying context, priorities, ambiguity handling and whether to do your best.
Landmark `destinations` entries with `for: [triage]` explain each destination's
scope, exclusions and boundary cases. Reuse those fields; do not create a second
catalog. User-stated rules outrank feedback, inferred rules and defaults, in that
order. A missing guide uses a visible conservative policy. An invalid guide is
an error. Unresolved conflicts require research.

A destination may also have an optional `todo-question`, such as
`todo-question: "Does this require follow-up?"`. Jev evaluates each configured
question in the same classification call; a yes probability above 0.5 creates
an ordinary todo on the filed item with `assigned="agent"`, `by="agent"`, and
the actual creation date, while a tie is no. The legacy agent triage path uses
the same yes/no meaning. Destinations without a question are not evaluated and
create no todo. These todos enter the existing bounded daily review; the
question adds no immediate run, deadline, or action authority.
Todo identity includes the destination and question, so changing the question
creates a distinct todo and leaves completed entries intact. Replay remains
read-only and reports the resulting todo outcome; a configured question with a
missing answer is an explicit failure. This applies to items that reach staged
triage: connector cards currently bypass it, so connector metadata preservation
is deferred to Gmail admission.

Good rules state the facts the classifier needs: whose records count, the scope
of this box, what distinguishes overlapping categories, and concrete exceptions.
For example, specify whether a plumbing invoice belongs with property work or
financial records. If best effort is acceptable, explain which destination wins
that overlap and when missing evidence still requires uncertainty. Jev cannot
research unstated identifiers or follow a procedure; give it the resulting facts.

Readable material outside every destination is **no-match**. Missing necessary
contents or unresolved ambiguity is **unclear**. Both can trigger bounded research
in an automatic admitted-document run. A high probability is not correctness;
confidence is another classifier signal, not an independently verified label.

## Inspect and experiment

Use caller-owned paths for trial JSON. Explicit output files must be new, unless
`--overwrite` is supplied. `--json` prints full machine-readable output; normal
summaries omit source bodies.

```sh
bbx triage prepare /_content/inbox/staged/Notice.doc.card --out /tmp/triage-evidence.json
bbx triage instructions --out /tmp/triage-original.json
bbx triage judge --evidence /tmp/triage-evidence.json --instructions /tmp/triage-original.json --out /tmp/triage-decision.json
```

Inspect evidence status, parts, methods and omissions before interpreting a
judgment. Unsupported attachments, broken text layers and failed extraction are
missing evidence, not proof that the item is irrelevant. Raw image/PDF bytes are
not Jev input. Preparation performs extraction in temporary space and cleans it.
It does not silently truncate. Agent interpretations must identify their source
and uncertainty; never substitute a guessed transcription for missing text.

A failure is an opportunity to improve rules scientifically:

1. Identify the cause: missing evidence, an ambiguous boundary, a conflicting
   rule, or a model error. State a falsifiable hypothesis.
2. Create a candidate guide or landmark copy. Compile it with `instructions
   --overlay <candidate-guide.card>` and/or `--landmarks <map.json>`. The map
   keys are canonical landmark refs and values are candidate file paths. Trial
   guide compilation includes explicit hypotheses without changing canonical files.
3. Use `decisions --destination <landmark-ref> --outcome user-confirmed --json`
   to find prior correct cases. Include positive and negative boundary neighbors
   and earlier corrections. Predictions, agent assertions and silence are not
   user confirmation. If no confirmed history exists, report that weak coverage.
4. Replay explicit IDs with candidate instructions, `--compare original`, and
   `--max-calls N`. This runs fresh old and new instructions on the same saved
   evidence and pinned returned model. `--repeat N` tests variability. Model
   overrides explicitly change the experiment. Historical answers remain separate.
5. Keep a narrow canonical edit only if the failed case improves without
   regressions on confirmed cases. Do not optimize probabilities at the expense
   of labels or weaken user-stated policy. If rules conflict, leave the question
   unresolved and explain the conflict. Recompile and rejudge after any edit.

```sh
bbx triage replay <decision-id> --instructions /tmp/triage-candidate.json --compare original --max-calls 2 --json
bbx triage replay <decision-id> --instructions current --prepare-again --max-calls 1 --json
```

Fixed-evidence replay never launches an agent, changes instructions, moves a file,
raises a question or alters the original receipt. `--prepare-again` is a different
experiment: it verifies original bytes at the applied location or historical
revision and reports preparation changes. Missing annex objects or a retired
model are unavailable coverage, never passing cases or silent substitutions.
Automatic research has one invocation and one subsequent rejudge per item.
It requests twelve turns and a $1 ceiling. Claude enforces that ceiling; the
Codex harness enforces tool turns but cannot cap USD cost and reports that limitation.
It shares a bounded Jev allowance across its subprocess commands. Do not clear
that allowance or launch recursive automatic triage to bypass it.

## Apply and correct

`bbx triage apply <decision.json>` applies a canonical, current decision. Stale
source or instruction digests require a fresh decision. Collisions stop instead
of overwriting. An interrupted application leaves an incomplete receipt; rerun
`apply <decision-id>` to complete verified missing operations without another
model call. Ambiguous recovery states require investigation.

Each applied item gets a receipt under `_bookkeeping/triage/decisions/` and a
scoped commit with instruction paths, outcome, model, probabilities and confidence.
Classifier summaries are labeled summaries; only grounded agent research supplies
a semantic reason. The receipt preserves evaluated inputs and appends application
and outcome metadata. A correction creates a new linked decision.

`correct <decision-id> --question <answered-ref>` applies a held question's
selected destination. `confirm <decision-id> --source <ref> --outcome <landmark-ref>`
records an explicit outcome. Only an actual user answer or user-authored chat turn
supports user confirmation; a CLI answer needs a cited user turn (`--user-turn`).
An agent's account of what the user wanted is agent-asserted. Missing legacy answer
provenance is unknown. Free-text answers need grounded research, not execution as
an arbitrary destination. Do not directly rewrite rules from one correction:
use the hypothesis and regression loop above.

Receipts retain prepared content until explicitly deleted. Deleting the original
alone does not erase replay evidence, and normal Git history retention still
applies. This is intentional reproducibility, not an automatic retention service.
