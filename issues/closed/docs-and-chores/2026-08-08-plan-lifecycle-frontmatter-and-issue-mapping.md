---
title: "Plans need frontmatter and a mapping from incomplete plans to issues"
workstream: workstreams
area: process
design: ../../../callback-box/docs/implemented-plans/workstreams.md
labels: [plans, issues, worktrees]
resolution: implemented
---

Closed by `b66aed4f` and `8b6d91df`: plan and issue frontmatter are now
machine-validated, the document graph exposes the mapping, and `/finish`
reconciles incomplete plan work explicitly.

There are **44 active plans in `callback-box/docs/plans/`, 18,838 lines** (plus
105 files / 45,130 lines in `implemented-plans/`). Nothing about that state is
machine-readable, and the leftover work in a partially-implemented plan is
tracked nowhere.

## What's missing

**No frontmatter at all — 0 of 44 plans have any.** Every plan opens with an
`# H1`. Status exists only as the prose first-line convention from
`docs/plans/README.md` (`**Status:** implemented YYYY-MM …`), which can't be
queried, filtered, or validated. So there is no way to answer "which plans are
in flight," "which are stalled," or "which are partially done" without reading
44 documents.

**The plan↔issue link is one-directional and barely used.** Issues have a
`design:` frontmatter field pointing at a plan — 11 open issues use it. The
reverse is prose: `cb-plan`'s SKILL.md prescribes an "Issues addressed" section
(`.claude/skills/cb-plan/SKILL.md:103`), and **3 of 44 plans actually have one.**
So from an issue you can find its plan; from a plan you generally can't find its
issues, and nothing can compute the join.

**Nothing captures what's LEFT.** `/finish` step 6 already reconciles planning
docs against reality with a three-way disposition — implemented (→
`implemented-plans/`), partially implemented (stays in `plans/`, prose edited to
mark real vs future), abandoned (→ `unimplemented-plans/`). The partial case is
the gap: the plan stays put with prose saying what's still future, and that
remaining work never becomes a tracked item. It's visible only to whoever next
reads the whole document.

**No worktree/branch association.** Same gap the
[worktree/session workflow redesign](../features/2026-08-08-worktree-session-workflow-redesign.md)
describes for issues: `discovered-in:` is free text there, and plans have
nothing at all. A plan produced by `worktree-foo` doesn't say so, so you can't
get from a plan back to the work in flight on it.

## What to figure out

- **A frontmatter schema for plans.** Candidates: `status` (draft / in-progress
  / partial / implemented / superseded), `worktree` or `branch`, `issues:` (the
  machine-readable counterpart to "Issues addressed"), `superseded-by`. Keep it
  small — `issues/`'s schema is deliberately minimal and that's why it gets used.
- **The incomplete-plan → issue mapping.** When `/finish` marks a plan partially
  implemented, should the remainder become an issue automatically, or is that a
  judgment call it should surface rather than perform? Auto-filing risks the
  queue filling with fragments; not filing is the current silent loss.
- **Who reconciles a plan nobody finished?** Today a plan only leaves `plans/`
  when a `/finish` touches it. A plan whose worktree was abandoned sits in
  `plans/` forever, indistinguishable from active work. That's most of what
  makes 44 hard to read.
- **Validation.** `doc-check` already validates links and finds orphans; it
  could enforce the frontmatter once there is one.

## Why now

Nobody types the code here, so plans are the durable record of intent — and
they're the fastest-growing category of prose in the repo (0 → 64k lines in
three months, more than double all actual documentation). The value is real:
`implemented-plans/boxes-as-packages-v2.md` is where the `events.db` two-engine
hazard was documented, and that's how
[the events.db bug](../../bugs/2026-08-08-events-db-truncates-across-engine-checkouts.md)
got filed. But an unqueryable pile of 44 in-flight plans has the same failure
mode as the session/worktree problem: things accumulate and nothing says what's
outstanding.
