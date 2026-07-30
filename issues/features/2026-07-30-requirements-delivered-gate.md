---
title: "finish should check the plan's stated scope was actually delivered"
area: callback-box
filed-by: agent
discovered-in: worktree-elixir-skills-review — reviewing claude-elixir-phoenix
---

`.claude/agents/finish.md` reconciles planning docs with reality (step 6) and
closes `issues/` items the work resolved (step 7b). Neither step asks the
question **"did we build what the plan said we'd build?"**

The failure this misses: an agent writes clean, well-tested, review-passing code
that silently drops half of a plan's scope. Every quality-shaped check — lint,
typecheck, tests, `/code-review`, `codex` — passes it, because each of them
inspects what *is* there, not what was promised and isn't. Step 6 currently
moves an implemented plan to `docs/implemented-plans/` largely on the strength
of the work having happened, not on a scope check.

## The shape worth copying

From [research/claude-elixir-phoenix](../../research/claude-elixir-phoenix/workflow-and-orchestration.md),
whose `requirements-verifier` is a deliberately narrow agent:

- One job — was it delivered? **Never** code quality, never suggested fixes.
- Extract requirements from the plan (and any `issues/` item the branch cites).
- Classify each **MET / PARTIAL / UNMET / UNCLEAR** against `file:line` evidence.
- **Never fabricate evidence.** With no citation available the answer is UNCLEAR
  with "cannot verify from diff" — not a guess.
- Never mark something MET on the strength of a commit message or branch name.

That last pair is what keeps it from degenerating into a rubber stamp, which is
the obvious failure mode for a self-assessment step.

## Open questions

- **Where it lives.** A step inside `finish.md`, or a separate agent `finish`
  spawns? `finish` runs headless and already can't ask mid-run, so an UNMET
  finding has to resolve to a BLOCKED result naming what's missing — which fits
  its existing contract but adds a new class of block.
- **What counts as the requirement source.** Our plans have no checkboxes (see
  [plans-as-execution-state](../decisions/2026-07-30-plans-as-execution-state.md)),
  so there's no crisp list to check against — the verifier would have to extract
  requirements from prose, which is exactly where fabrication risk lives. That
  decision item and this one are coupled: if plans grow checkboxes, this gets a
  lot more reliable.
- **False-blocking risk.** A plan often outruns the branch on purpose. UNMET
  should probably mean "say so in the report," not "refuse to merge," at least
  initially.
