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

## Fix (boxholder, 2026-10-07: "it's a skill for boxes, not for the codebase")

Make it a **managed box skill**. `beebox/src/core/box/guidance-sync/skills.ts`
already installs managed skills into `<box>/.claude/skills/<name>/SKILL.md`
(with the DOCID marker, refreshed by `bbx init`, wakeup, chat start, and
`bbx docs refresh`; see `skills-content.ts` for the existing ones). Move the
procedure there, versioned with the `browser-task` card type, and delete the
dev-repo copy.

This makes the documented way to run a browser task: a Claude Code session in
the box directory, with Claude in Chrome, invokes the box's `browser-task`
skill. Update the card's page and the box guidance to say so, and check that
the skill's wording fits a box session (paths are box-relative; no dev-repo
references such as this checkout's scratchpad conventions). The copy block
can stay as it is.

Verify: run `bbx init` on a test box, confirm the skill is installed, and
check with the knowledge-audit skill that a box session finds and follows it
for a browser-task request.

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
move (to a managed box skill or other box guidance via the bbx-context
skill, or into the product UI), or split.
