---
name: cross-model
description: Get an independent review from the other model family for a plan, branch diff, or adversarial failure analysis. Use when requested and whenever root guidance requires cross-model review for work larger than a small bug fix.
allowed-tools: Bash, Read, Grep, Glob
---

# Cross-model review

Use a read-only reviewer from the other model family. Completion means the
driving agent has adjudicated findings against the human's request, addressed
verified material defects within scope, verified fixes, and surfaced remaining
risks or decisions. The reviewer supplies evidence, not authority.

This policy applies equally to Astra and Sol (Codex), and Fable and Opus
(Claude). Choose the runner by family, not capability tier. If the other family
cannot run, report the blocker; do not substitute a same-family review.

## Select the target and mode

| Mode | Trigger | Target and purpose |
|---|---|---|
| **plan** | `plan [name]` | Read the plan in `docs/plans/` and verify its approach and source claims. |
| **review** | `review [focus]` | Review the current branch diff for correctness. |
| **challenge** | `challenge [focus]` | Find production failure modes in a diff or plan. |

No-arg: if a plan was just written/edited this session, use plan mode;
otherwise, if there is a diff against `main`, ask review-or-challenge.
An optional focus narrows investigation, not the originating requirements.

## Construct the reviewer prompt

Keep the following scaffolding in delegated prompts, regardless of the driving
model. Point at in-repo plans and briefs instead of embedding their contents.

1. **Orientation glue: orient to the actual targets.** Run from this worktree's repository root
   (`git rev-parse --show-toplevel`). Explain which paths are monorepo-relative
   and which are subproject-relative: for a beebox target, `src/`, `docs/`, and
   `test/` may mean paths under `beebox/`; `bin/` is at the monorepo root.
   Permit read-only repo docs and `.claude/rules/` needed to verify claims.
2. **Name the scope.** Provide a read-list, any pre-verified facts that need not
   be rechecked, and a findings cap. Permit cited source for plan verification.
   For diffs, name first-hop files and allow only directly relevant call sites,
   sibling paths, and shared state owners needed for the traces below. Require
   the reviewer to name every extra file opened.
3. **Provide authority.** Include this block in every mode; quote decisive
   human wording where practical, otherwise label a faithful paraphrase.
   Say `none available` when an originating request or document is unavailable.

```text
Review authority (highest to lowest):
- Direct human requirements/decisions: <wording or labeled paraphrase>
- Originating issue or brief: <repo path or none available>
- Plan under review or being implemented: <repo path or none available>

Direct human requirements and later decisions outrank issue proposals, plan
prose, inferred intent, and implementation choices. Report any contradiction.
Do not promote optional issue/plan ideas into requirements.
```

4. **Require evidence.** Spot-check `file:line` citations and claims such as
   "we already do X", "free reuse", and "validation catches it" against source.
   Request ranked, concrete findings, without padding to fill the cap.
5. Add the applicable instructions below. In diff prompts, place the three
   required moves after review authority and before the findings cap.

### Required diff instructions

Include these in every review and every diff-target challenge, attached to the
changed logic and named intent, not a generic invitation to redesign surrounding
systems:

```
- For new or changed logic, choose at least one concrete input or state and
  trace it through the relevant code. Look especially for a wrong value,
  label, state, or side effect that does not throw or otherwise announce itself.
- When the change claims a durable bug fix, reconstruct the original failing
  sequence and the invariant the fix must establish. Inspect relevant sibling
  paths and shared state transitions. Call the fix inadequate only when source
  evidence shows the failure the change was authorized to fix remains
  reachable; report an adjacent reachable failure as its own finding under the
  remedy rule below.
- For each material finding, identify the smallest honest remedy. If that
  remedy would extend the authorized change by adding durable state, a schema
  change, background/retry/persistence machinery, a new subsystem, or a product
  decision, label it `human decision required` rather than presenting that
  expansion as an ordinary fix. The primary agent will adjudicate and mediate
  the decision with the human.
```

### Plan prompt

Fill this skeleton with the orientation, read scope and findings cap above:

```
<boundary prefix from references/codex-runner.md — Claude → Codex only>
<orientation glue>

You are an independent, adversarial engineering+design reviewer. A <other model>
wrote docs/plans/<name>.md. Read it, then read the source it cites and verify
the citations and the "we already do X / free reuse / validation catches it"
claims against the actual code — you are a different model family; find what a
same-model self-review would miss.

Review authority (highest to lowest):
- Direct human requirements/decisions: <decisive wording, or "none available">
- Originating issue or brief: <repo path, or "none available">
- Plan under review: docs/plans/<name>.md

Direct human requirements and later decisions outrank issue proposals, plan
prose, inferred intent, and implementation choices. Report any contradiction.
Do not promote optional issue/plan ideas into requirements.

Review for, in priority: (1) wrong-problem / over-engineering — what's the
minimal version, what to cut; (2) architecture flaws; (3) silent failure modes
(no test AND no handling AND invisible); (4) things treated as settled that will
bite in implementation; (5) incorrect/unverifiable citations — name them.

Be concrete: cite plan section + file:line. Rank by impact. Don't pad. End with
the single most important change.
```

### Challenge prompt

Add this persona to the shared scaffold, retaining review authority and the
applicable plan or diff instructions:

> Your job is to find ways this will fail in production. Think like an attacker
> and a chaos engineer — edge cases, races, resource leaks, silent data
> corruption. No compliments, just the problems.

## Run the other family

Read the applicable runner before launching:

- **Claude driving (Fable or Opus):** [Codex runner](references/codex-runner.md).
- **Codex driving (Astra or Sol):** [Claude runner](references/claude-runner.md).

Write the complete prompt to `scratch/` and pass it on stdin. Run in the
foreground: backgrounded reviewer runs are killed before completing in this
harness. Follow any yielded session handle to actual process completion.
If the reviewer exits nonzero or stalls, report the failure with relevant
stderr. Retain raw output as a scratch artifact.

## Adjudicate and stop

Repeated adversarial rounds can extend scope. Allow two fresh-review rounds
per work unit, then verification only:

- **Round 1**: the full review.
- **Round 2**: verify the fixes hold; fresh findings are still welcome.
- **After round 2: STOP inviting new problems.** Any further invocation is
  verification-only — the prompt names the already-found problems and asks
  whether the fixes hold, and explicitly tells the reviewer NOT to hunt for
  new findings. If a fix-verification pass turns up a defect in the fix
  itself, that's in scope; a brand-new surface is not.
- Residual or newly-suspected risks after that go to the human as
  accept-or-fix decisions, never silently fixed.

Adjudicate findings against the project's over-engineering line before
fixing them: mid-operation I/O-failure windows in one-shot operator-run
tools, exotic input encodings (CRLF, quoting edge cases), and
attacker-is-the-owner scenarios are presumptively REJECTED, not fixed —
raise them with the human only if you think one genuinely clears the bar.
The reviewer's "not fit" verdict is evidence, not the stopping condition;
the human's risk judgment is.

The reviewer is evidence, not authority. Verify each actionable claim against
the source, distinguish real defects from scope opinions or noise, and decide
what to change.

For a cross-model pass required as validation during another work unit:

- Apply verified findings before declaring the work done.
- In the final handoff, lead with the work outcome and validation status.
- Mention the review only to explain a material change, unresolved risk, or
  decision the human may want to override.
- Do not add a review transcript, a ritual `Recommendation:` line, or a second
  conclusion after the actual conclusion.

When the human explicitly requests the review as the deliverable, return a
concise ranked summary in your own words, followed by your adjudication. Quote
the reviewer sparingly where its exact wording matters. Raw/verbatim output is
opt-in.

Never editorialize about the review's worth ("earned its keep", "proved
valuable", etc.). Report material findings and decisions, not praise for
having run the review.
