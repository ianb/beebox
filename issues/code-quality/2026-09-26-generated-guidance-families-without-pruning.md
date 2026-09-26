---
title: "Two generated guidance families still leave orphans: guides-for-<type> rules and dangling AGENTS.md symlinks"
workstream: unattached
area: beebox
labels: [box-guidance, docs-gen]
filed-by: agent
discovered-by: agent
discovered-in: worktree-doc-structure — Track 1 of docs/implemented-plans/doc-structure-box-guidance.md
---

The box-guidance registry (`beebox/src/core/box/guidance-surfaces.ts`) gave
the rule, skill, and Codex-mirror generators manifest pruning: a file that
carries the generated marker and is not in the run's manifest is removed
(`beebox/docs/box-guidance.md`, "Generated files carry a marker"). Two
generated families were left out:

- `.claude/rules/guides-for-<type>.md` (`beebox/src/core/docs-gen/compile.ts`):
  when a box loses the guide card for a job type, the rule that listed it stays.
- `AGENTS.md` symlinks beside every `CLAUDE.md`
  (`beebox/src/core/agent-context-mirrors.ts`, `ensureAgentsMirror`): when a
  `CLAUDE.md` is removed, its `AGENTS.md` link dangles. The `.agents/skills/`
  symlinks got dangling-link pruning; these did not.

Neither is reachable by ordinary use today, which is why the track shipped
without them. Give both the same treatment: prune by marker and manifest for
the rules, prune dangling links for the mirrors, with a case each in
`test/core/box-guidance-sync.doctest.md`.
