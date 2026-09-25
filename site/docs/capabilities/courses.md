---
description: "Builds a structured learning experience on a topic you choose, with a knowledge map, a delivery plan, and evidence-backed tracking of what you've learned."
---
# Courses

A box is a directory of your data, kept under version control with a full
history of changes (using git); a card is a markdown file with a structured
header; the agent is the coding agent (Claude Code or Codex) that operates the
box. A course is a set of linked cards the agent builds to teach one bounded
topic.

**What it does for you**

- Breaks a topic into a knowledge graph (a concept map) so the course has a
  checkable structure instead of an unstructured pile of material.
- Plans how to present the material and in what order, tailored to what you
  said you want out of it and, optionally, to you specifically rather than a
  generic learner.
- Delivers segments either live in chat (interactive) or as a pre-made
  material card, in the order the lesson plan sets.
- Tracks your progress per concept with actual evidence behind each
  "understood" mark, not just a checkbox.

**What it needs**

Nothing beyond the box itself; you ask the agent to build a course on a
topic and it creates the cards.

**How it works, briefly**

A course card is a manifest that references, by attachment, a concept-map
card, an exposition-plan card, a lesson-plan card, a directory of material
cards, and a progress card per learner. These are separate, checkable cards
rather than one large document, so the topic graph, the presentation
approach, the delivery order, and your evidence-backed understanding can each
be inspected and revised on their own. Building and delivering a course
happens in chat, driven by the agent, not on a schedule.

**Limits**

The documentation does not describe a course marketplace or pre-built course
library; every course is built for your box from scratch or from material
you provide.

**Go deeper**

[../reference/cards/course.md](../reference/cards/course.md),
[../reference/cards/concept-map.md](../reference/cards/concept-map.md),
[../reference/cards/exposition-plan.md](../reference/cards/exposition-plan.md),
[../reference/cards/lesson-plan.md](../reference/cards/lesson-plan.md),
[../reference/cards/progress.md](../reference/cards/progress.md),
[../reference/cards/figure.md](../reference/cards/figure.md)
