---
title: "Give cross-model diff review concrete trace and remedy-scope instructions"
workstream: research-no-mistakes
area: tooling
labels: [agents, review]
filed-by: agent
discovered-in: research/no-mistakes-review.md
---

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

Consider adapting those instructions into the `review` and `challenge` prompts
in `.claude/skills/cross-model/SKILL.md`. Preserve the current architecture:
the other model remains read-only, the driving agent adjudicates findings, and
material outcomes are surfaced. Do not import the automated fix loop as part of
this change.

Before editing, compare the additions against the existing fencing and findings
cap so the prompt stays bounded rather than becoming a generic review checklist.

Source comparison: [research/no-mistakes-review.md](../../../research/no-mistakes-review.md).
