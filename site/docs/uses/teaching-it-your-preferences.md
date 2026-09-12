---
description: "Correct it once and have the correction stick: rules, guides, and a personality card the box reads before it acts."
---
# Teaching it your preferences

An assistant out of the box has someone else's defaults. A chat product may
remember some of what you tell it, but you cannot see what it kept, edit it, or
know when it will apply. A **box** is one directory of your data, a **card** is one markdown file in
it, and **the agent** is the coding agent that reads those cards before it acts,
so what you teach it is a file you can read and edit.

**What you do.** Correct it when it gets something wrong. Answer the questions it
asks. Say how you want to be spoken to: shorter, less cheerful, in Spanish. Say
where a kind of thing belongs when it files something wrong. None of this is
configuration you fill out in advance; it accumulates from use.

**What the box does.** A correction is written as prose at the place it applies,
so the next item of that kind is handled the same way. A guide card holds the
box's working theory of you for one kind of job: triage rules, actions, and
reactions, each with a confidence level and a note of where it came from. A personality card holds voice and communication style, folded into what every
agent reads before it acts; a briefing card holds a directory's situational
context. Answering a question can write the fact into a guide, briefing, or personality
card, so an answer becomes a standing preference. The box's own instructions file (`CLAUDE.md`, for the
curious) and rules directory are the mechanism a coding agent already uses.

**What it needs.** Nothing beyond the box and some use over time.
[Making it yours](../13-making-it-yours.md),
[what it requires](../08-what-it-requires.md).

**Where it is still rough.** The rule sets do not rewrite themselves from a
single low-confidence answer: turning a recurring pattern into a rule is a manual
edit. The retrospective pass that mines recent chats for what you taught
implicitly ships switched off. A box has one personality and one set of rules
shared by everyone in it, so it cannot hold two people's preferences separately.

**What makes it possible**

- **Guides and personality** ([making it yours](../13-making-it-yours.md)): a guide is a living document, a theory of you to be refined rather than a static config, which is what makes this teaching instead of configuring.
- **The questions loop** ([questions](../capabilities/questions.md)): every answer is precedent; the placement is the small part and the rule you just taught is the valuable part.
- **The history** ([durability and provenance](../design/durability-and-provenance.md)): committing is what makes a change durable here, so what the box came to believe about you has a trail you can read.

**Read next.** [How the box is taught](../design/teaching.md),
[how an action earns autonomy](../design/trust.md),
[guide](../reference/cards/guide.md),
[personality](../reference/cards/personality.md),
[question](../reference/cards/question.md).
