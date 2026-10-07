---
title: "The browser-task executor procedure is a dev-repo skill; move it into the product, and review the other skills for the same mistake"
workstream: unattached
area: beebox
labels: [agent-guidance]
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder noticed `.claude/skills/browser-task/` should probably not be a skill
---

`.claude/skills/browser-task/SKILL.md` (75 lines) tells a Claude Code session
with Claude in Chrome how to run a box's `browser-task` card: open the card,
copy the prompt, schema, and watermark, scan the source at a human pace,
write `records.json` with a coverage block, fetch images before the Meta CDN
URLs expire, and upload through the card's page. That is the product's
executor procedure, not development work, but it lives in the dev repo's
skills:

- It loads into every development session here, where it is irrelevant.
- It works only for the developer, from this checkout. Another boxholder has
  no copy, so a shipped feature depends on an unshipped file.
- It is versioned apart from the card it drives (`browser-task` schema, its
  copy block, the upload route in `beebox/`), so the two can drift.

The plan says the executor "reads the card when a person starts a run"
(`beebox/docs/implemented-plans/browser-task-card.md`).

## Fix

Preferred: make the card's **Copy prompt, schema and watermark** block
self-contained. The copied text carries the run procedure along with the
prompt, schema, and watermark, so any Claude with Chrome access can run it
from a paste, with nothing installed. Move every rule from the skill into
that text (or the card type's docs it renders from), then delete the
dev-repo skill.

Alternative: a managed box skill (`beebox/src/core/box/guidance-sync/skills.ts`
installs them into `<box>/.claude/skills/`). It helps only when the executor
session runs inside the box directory, which the design does not assume.

Verify with a dry run: paste the copied block into a fresh Claude session
that has no repo skills and check it produces a valid batch against a test
card.

## Review the other skills

Check every skill under `.claude/skills/` (and the generated Codex mirror,
`.agents/skills/`) for the same mistake: a procedure a box agent, a
boxholder's session, or a shipped feature depends on, kept where only this
checkout's sessions can see it. The survey on 2026-10-07 read only the
descriptions; from those, `browser-task` is the only clear case and the rest
are development or repo-process skills (planning, testing, issues, landing,
schedules, browser verification, iOS overlap, security report, field
probes). Read each body before concluding, and look for product rules
embedded inside development skills too (for example, box-facing wording or
procedures that box guidance should carry instead). For each, record keep,
move (to box guidance via the bbx-context skill, to a card or the product
UI), or split.
