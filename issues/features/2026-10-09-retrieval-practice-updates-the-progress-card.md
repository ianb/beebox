---
title: "Retrieval practice in tutoring updates the progress card; a miss gets a cited explanation"
workstream: unattached
area: beebox
needs: [design]
labels: [courseware, competitive-research]
filed-by: agent
discovered-by: agent
discovered-in: worktree-notebooklm-research — comparing Gemini Notebook's quiz loop with courseware
---

Courseware Phase 2 names retrieval practice
(`beebox/docs/implemented-plans/courseware-phase1.md:512`) but has no shape
for it. Gemini Notebook's September 2026 study loop is a worked example:
quizzes in several formats, Got it / Missed it that persists, "Explain" on a
miss that gives a cited explanation, and "ask the chat about my quiz
performance" ([research](../../research/notebooklm/comparison.md#learning)).

The box already has the better record. A `progress` entry carries a level,
a basis (observed, inferred, self-report), evidence, `next-probe` and
`misconception` (`beebox/src/schemas/progress.ts`), and the chemistry walks
show the wrong first model staying visible after correction. What is missing
is the practice that feeds it.

## Shape to design

- **No `quiz` card type.** A practice round is an `interactive` segment of
  the lesson plan run in the course chat; its outcome is a `progress` entry
  update with `basis: observed` and the evidence quoted. Notebook's
  per-card Got it / Missed it is the weaker model; the box's per-concept
  level is the stronger one and should stay the only record.
- **A miss gets a cited explanation.** The `build-course` skill already
  demands sources for answer keys
  (`beebox/src/core/box/guidance-sync/skills/content.ts:134`); the tutor's
  correction should carry a `{% source %}` anchor into the material. This is
  a check for the journey reader as much as a feature.
- **"How am I doing" is a question to the progress card.** The learner-facing
  study home ([issue](2026-09-21-course-study-home-last-next-uncertain.md))
  is where the answer should appear; this issue supplies the data it reads.
- **Formats.** Short answer and fill-in-the-blank fit a chat; multiple choice
  is the weak one for a Socratic tutor and can wait.

Spaced review and numeric mastery stay rejected
(`courseware-phase1.md:205, 431`); this is practice, not scheduling.
