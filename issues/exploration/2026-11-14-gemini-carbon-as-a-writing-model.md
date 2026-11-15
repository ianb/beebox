---
title: "Gemini Carbon as a writing model: where would it fit?"
workstream: unattached
area: beebox
labels: [writing]
filed-by: agent
discovered-by: Ian
discovered-in: main session — developer heard Gemini Carbon writes well, 2026-11-14
---

The developer heard that Gemini Carbon writes good prose. Claude, the default
model, writes prose that reads as LLM output. The box can already reach Gemini
models through its OpenRouter key. Nobody has decided where a separate writing
model would be used, so this item is vague on purpose.

## Open questions

- Is Gemini Carbon better at writing for our uses? Nobody has compared it
  with Claude on our own writing tasks.
- Which writing would it do? Some candidates:
  - Box prose that the boxholder reads as finished text: summaries, overviews,
    slides, spoken scripts.
  - Edit passes on text that another model drafted, or on the boxholder's own
    rough words. See [suggested edits](../features/2026-10-13-suggested-edits-tracked-changes.md).
  - The dev side: docs, presentations, or the assistant's reports to the
    developer. See [how the agent writes to the developer](../docs-and-chores/2026-08-19-skill-for-how-the-agent-writes-to-the-developer.md).
- How would it be called? It could be a full engine, a tool the main agent
  calls for one pass, or a step in a procedure. A tool call keeps Claude as the
  driver and limits the new surface.
- The [writing practice](../features/2026-07-05-writing-skill.md) puts the
  boxholder's own words first. A better prose model does not change that. It
  can matter for connective text and for edits.

## Research (incomplete)

- Confirm the OpenRouter model ID and its price.
- Take a few real writing tasks from `test1`, run each with Claude and with
  Gemini Carbon, and compare the results blind.
