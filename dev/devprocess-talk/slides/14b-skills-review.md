# What the review concluded, and what landed the next day
## Supporting: dev/skills-review-2026-10.md
```markdown
- The human types a skill name almost never. In Claude only `finish` (128
  sessions), `bbx-pick-issues` (8) and `bbx-issue-actions` (4) were typed.
  Everything else is reached by an agent reading the description.
- Agent-written briefings used a bare `/finish` or `$finish` sigil in 61 Claude
  and 22 Codex sessions, against the rule in the root CLAUDE.md.

| skill       | lines         | Claude sessions | recommendation |
| cross-model | 187 + 190 refs| 140             | shrink to ~130; runner prose becomes a script |
| finish      | 75            | 35 (+129 typed) | keep; drop "checkpoint" from the description |
| bbx-debug   | 163           | 1               | its description has a negative clause and no symptom keywords |
```
- Landed within a day (6657f44d1 and siblings): 6 skills retired; cross-model 377 → 150 lines, launch 218 → 91; a deploy-status script from "22 sessions ask about deploy state"; a foreground-sleep rule from 104 sleep-blocked sessions; skill-lint; 85 stale doc references fixed
- Also found: a skill contradicted a code-style decision (barrels), and the flake policy said two things in two files

Notes:
A rule added to the root the same week: "Agent and skill files only ever grow unless pruned: when touching one, remove more than you add, move mechanics into a script the agent runs… and give a rewrite a line budget."
