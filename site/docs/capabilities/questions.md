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
- Never records a guess as your answer. An unanswered question ages out of the
  active list and stays answerable. If you put a question away or leave it
  waiting, the box may settle it for you in a smaller way (see "Putting a
  question away" below), and says so on the card.
- Turns your answer into two things when relevant: the immediate action it
  unblocks, and a durable rule recorded so the same situation doesn't ask
  again.
- Lets you answer from the question's own card, from chat, or from a "needs
  attention" list, and put one away with "Later" if you don't want to answer
  it now.
- Opens the newest waiting question beside a new chat, so you can answer it
  in words in the chat. The pinned row on that question offers "Later" and
  "Decide for me".
- Reminds you (chases itself) when a question sits unanswered and the queue
  isn't draining.
- Opens a new box with one question of its own, "What do you want to keep track
  of here?" A new chat opens with that question beside it, and the empty chat
  tells you to answer it there or start something else. The agent judges
  whether your first message answers it; if so it records what the box is for
  and then offers a few things it could do about that.

**Putting a question away**

"Later" sets a question aside; it stays answerable, and you can still answer
it from the Questions page or in chat. "Decide for me" hands it to the box:
an agent works on it in the background, in a chat that appears in your chat
list. The agent is told to choose the reversible option that changes the
least, and never to delete, send, spend, publish, or reword your words. It
either records a provisional decision, with its reasoning and how to undo it,
or rewrites the question to be simpler and asks again.

A daily review (on by default, and it runs an agent only when a question
qualifies) does the same for questions put away three or more days ago and
questions that have waited fourteen or more days, at most five per run. A
decision made this way is shown on the card as "The box decided for now". It
is not your answer: the card keeps no answer from you, and what the box
learns from it is marked as inferred. If you answer later, the box reverses
what it can of its decision and tells you what it could not.

**What it needs**

Nothing beyond the box itself. Questions arise from triage, jobs, and
procedures as they run.

**How it works, briefly**

A question is a `question` card with the question text and the kind of answer
expected. It has no status label: whether it is waiting, answered, dismissed,
or expired follows from which of those times is recorded on it. Answering it
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
