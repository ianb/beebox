---
description: "Asks you directly when the agent is unsure, and turns your answer into a durable rule instead of a one-off fix."
---
# Questions

A box is a directory of your data, kept under version control with a full
history of changes (using git); a card is a markdown file with a structured
header; the agent is the coding agent (Claude Code or Codex) that operates the
box. A question is the agent asking you for something it does not have the
authority or confidence to decide itself.

**What it does for you**

- Asks you a concrete question (pick one of a few options, type an answer, or
  confirm/deny) with enough context to answer without looking anything up.
- Never auto-answers on your behalf: an unanswered question ages out of the
  active list rather than the box guessing and moving on.
- Turns your answer into two things when relevant: the immediate action it
  unblocks, and a durable rule recorded so the same situation doesn't ask
  again.
- Lets you answer from the question's own card, from chat, or from a "needs
  attention" list, and dismiss one you don't want to answer.
- Reminds you (chases itself) when a question sits unanswered and the queue
  isn't draining.

**What it needs**

Nothing beyond the box itself. Questions arise from triage, jobs, and
procedures as they run.

**How it works, briefly**

A question is a `question` card with a status (pending, answered, dismissed,
expired), the question text, and the kind of answer expected. Answering it
creates a follow-up job that hands your answer back to the agent that asked,
and optionally writes a learned fact into a guide, briefing, or personality
card so it shapes future behavior. Questions are created as the box works,
not on a fixed schedule.

**Limits**

The documentation does not describe automatic rule-rewriting from a single
answer; turning a recurring low-confidence pattern into a written rule is
manual today, done by editing the relevant card.

**Go deeper**

[../reference/cards/question.md](../reference/cards/question.md),
[../reference/cards/question-followup-job.md](../reference/cards/question-followup-job.md),
[triage.md](triage.md)
