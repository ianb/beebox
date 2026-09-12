---
description: "How a box gets customized: rules, briefings, guides, personality, box-local card types, views, procedures, and scripts."
---
# Making it yours

A **box** is your own directory of **cards**, markdown files with validated
frontmatter, and most customization is itself a card or a file in the box.

**Rules and context.** A box has a `CLAUDE.md` and a `.claude/rules/`
directory the agent loads, the same mechanism a coding agent already uses in
a code repository. Per-directory context lives in **briefing** cards: what
every agent working in that area needs to know, one per directory.

**What the agent believes about you.** A **guide** card holds a working
theory of you for one kind of job: triage rules, actions, and reactions, each
with a confidence level. A **personality** card holds the voice and
communication style, compiled into every agent's context. Both accumulate
through use. A retrospective pass mines recent chats for what you taught
implicitly and records it as beliefs whose confidence rises with recurrence,
turning anything that contradicts a stated belief into a question instead.

**Your own kinds of things.** A box can define its own card types as
TypeScript files in the box's `src/schemas/`, with their own fields and their
own instructions for the agent. You do not design them yourself; you say what
you are collecting and the agent proposes fields, adds more later, and keeps
anything that does not fit as prose on the card. Start with generic record
cards and promote to a type once a shape repeats.

**Your own interfaces.** A **view** is a React component in the box's
`src/views/`, written by the agent, attached to a card type, and compiled
server-side. A collection of cards plus a view is how a shelf of things
becomes something to browse and filter.

**Automation.** A **procedure** is a declarative multi-step workflow defined
as a card. A scheduled-script card declares when a command runs, with
budgets and locks. Small repeated tasks can become programs the agent writes
in the box, including Python tools run through `uvx`.

**Navigation.** A **landmark** card marks a directory as an area you work in
and jump to, and as a filing destination for triage.

Card-type references are in
[reference/cards/index.md](reference/cards/index.md); the rest of the
internals are in [reference/index.md](reference/index.md).
