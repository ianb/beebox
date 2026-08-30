---
title: "Give cross-model diff review concrete trace, durable-fix, and remedy-scope instructions"
workstream: research-no-mistakes
area: tooling
labels: [agents, review]
filed-by: agent
discovered-in: research/no-mistakes-review.md
---

**Direction chosen by the boxholder, 2026-08-30:** carry all four principles
into the cross-model skill. The remaining work is the focused prompt design and
verification, not deciding whether the ideas belong.

The cross-model skill is explicit about independence, source verification,
prompt fencing, and adjudication, but its diff review/challenge guidance does
not prescribe two concrete review moves that No Mistakes v1.60.3 uses:

- for new or changed logic, choose at least one concrete input or state and
  trace it far enough to find wrong results that do not error;
- for a purported durable bug fix, reconstruct the original failure sequence
  and invariant, then inspect sibling paths/shared state transitions for the
  same still-reachable failure.

No Mistakes also separates defect classification from remedy authorization: if
the smallest honest fix would add durable state, a schema change,
background/retry/persistence machinery, or a new subsystem, the finding asks
the user even when the defect itself is source-verifiable.

The boxholder additionally required the review to attach itself to the
originating request—an issue, explicit user request, or similar authority—with
special weight for statements made directly by the user. Current plan mode
points at the plan and diff mode points at the diff/focus, but neither prompt
contract requires the original authority or states that direct human decisions
outrank inferred intent and plan/issue proposals.

Adapt those instructions into the `review` and `challenge` prompts in
`.claude/skills/cross-model/SKILL.md`. Preserve the current architecture:
the other model remains read-only, the driving agent adjudicates findings, and
material outcomes are surfaced. Do not import the automated fix loop as part of
this change.

**Implemented in this workstream:** every mode now requires a compact
review-authority block. It quotes decisive human wording where practical,
points at originating issue/brief/plan paths, establishes direct human
decisions as highest authority, and says when no originating request is
available rather than inventing one. The concrete-trace, durable-fix, and
remedy-scope prompt changes above remain open.

Before editing, compare the additions against the existing fencing and findings
cap so the prompt stays bounded rather than becoming a generic review checklist.

Source comparison: [research/no-mistakes-review.md](../../../research/no-mistakes-review.md).
