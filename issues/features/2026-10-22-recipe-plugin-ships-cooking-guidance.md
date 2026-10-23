---
title: "The recipe plugin should ship the cooking guidance the old cooking guide held"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: Ian
discovered-in: worktree-knowledge-audit-refresh — reviewing the failing cooking-guide audits, 2026-10-22
---

The recipe card type is a plugin (`beebox/src/plugins/recipe/`): a card base, a scaling view, and a card template. How to cook *with* the person is not in the plugin. That guidance was a box guide card, a cooking guide: plan the meal, gather ingredients, pace the steps, and use two output channels. `test1` no longer has that card, and no box gets it by default.

The courseware plugin shows the shape: it ships its process as a skill (`PluginDefinition.skill`, `beebox/src/plugins/courseware/skill.ts`). The engine mirrors the skill into `.claude/skills/<plugin>/` when a box activates the plugin. A recipe skill would give every box with the recipe plugin the cooking pattern, with no guide card per box.

Open questions:

- What the skill holds. The knowledge audits `cooking-guide-awareness` and `cooking-follow-recipe-pattern` in `beebox/src/dev/knowledge-audits.yaml` record what the old guide taught.
- Whether a box guide card can still refine it. Guide cards learn from the boxholder; a plugin skill is engine-owned.

When the skill exists, rewrite the two cooking audits to expect a read of it, and close [2026-10-22-cooking-guide-audits-need-a-guide](../decisions/2026-10-22-cooking-guide-audits-need-a-guide.md).
