---
title: "Interactives in educational material: triggers that decide what happens next"
workstream: unattached
area: courseware
labels: [interactives, design]
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder voice note
---

Educational material has author content and an interactive (an exercise,
a simulation, a widget). The open question is what happens after the
learner uses the interactive: how the session moves on, and how the box
reacts to what the learner did.

The boxholder's answer is **triggers**. A trigger says "when this happens,
do that". The most common action is to tell the chat, so the tutor can
respond. Other actions are possible.

## Kinds of trigger

- **Right answer.** The learner reaches the correct state, and the
  session moves on.
- **Specific wrong answers.** Some wrong answers are worth reacting to,
  because they show a particular misunderstanding. A trigger for one of
  those can bring in the tutor with that context.
- **An LLM reads the state log.** The interactive records its state
  changes. An LLM reads that log with instructions and detects situations
  that are different in some way, including ones the author did not list
  as triggers.
- **Brainstormed triggers.** An LLM proposes many candidate situations to
  capture, and the author keeps the useful ones.

## Questions

- Where a trigger is declared: in the interactive's own code, in the
  course card that uses it, or in a separate card the tutor reads.
- What "tell the chat" means in practice: a message the learner sees, a
  hidden context note for the agent, or a new turn the agent starts. An
  agent-started turn connects to
  [the tutor cannot open a session](../features/2026-10-08-course-session-cannot-open-with-the-tutor.md).
- How an interactive records state changes so that a trigger or an LLM can
  read them, and where that log lives.
- When the LLM reads the log: on every change, at the end of an attempt,
  or on a pause. Each costs differently.
- Whether triggers belong to the courseware plugin only, or are a general
  mechanism for any interactive card.
