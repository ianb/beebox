---
description: "How a box gets customized: rules, briefings, guides, personality, box-local card types, views, procedures, and scripts."
---
# Making it yours

A **box** is your own directory of **cards**, files with a structured header
that gets checked, and most customization is itself a card or a file in the
box.

**Rules and context.** A box has standing-instruction files (`CLAUDE.md` and
`.claude/rules/`, for the curious) that the agent loads, the same mechanism a
coding agent already uses on any programming project. Per-directory context
lives in **briefing** cards: what every agent working in that area needs to
know, one per directory.

**What the agent believes about you.** A **guide** card holds a working
theory of you for one kind of job: triage rules, actions, and reactions, each
with a confidence level. A **personality** card holds the voice and
communication style, included in every agent's context. Both accumulate
through use. A retrospective pass mines recent chats for what you taught
implicitly and records it as beliefs whose confidence rises with recurrence,
turning anything that contradicts a stated belief into a question instead.

**Your own kinds of things.** A box can define its own card types, each
with its own fields and its own instructions for the agent (for the curious:
they are small code files inside the box). You do not design them yourself; you say what
you are collecting and the agent proposes fields, adds more later, and keeps
anything that does not fit as prose on the card. Start with generic record
cards and promote to a type once a shape repeats.

**Your own interfaces.** A **view** is a page or display the agent builds
for a kind of card: a recipe laid out as a recipe, a shelf of records you can
browse and filter, a dashboard of what is open. You describe what you want
to see; the agent writes it, and it lives in the box like everything else.
The technical shape is in [capabilities/views.md](capabilities/views.md).

**Automation.** A **procedure** is a card that spells out a multi-step task
for the agent to follow. A scheduled-script card declares when a command
runs, with limits on how long or how often. Small repeated tasks can become
programs the agent writes in the box (often small Python scripts, for the
curious).

**Navigation.** A **landmark** card marks a directory as an area you work in
and jump to, and as a filing destination for triage.

Card-type references are in
[reference/cards/index.md](reference/cards/index.md); the rest of the
internals are in [reference/index.md](reference/index.md).
