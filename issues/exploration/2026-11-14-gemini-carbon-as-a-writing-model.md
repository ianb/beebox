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

## Source

The report comes from a
[Bluesky post by @davidcrespo.bsky.social, 2026-11-14](https://bsky.app/profile/davidcrespo.bsky.social/post/3n2cz5hdf5s2v).
The poster's setup is a review pass. The coding agent keeps writing, and an
instruction tells it to send its prose to Carbon through a CLI before it
finishes. The scope is prose that people read, such as PR and issue bodies,
code comments, and docs. Chat replies are exempt. The poster says that after one day
of use, LLM writing "might be solved".

Other people in the thread report two problems. Gemini rewrites can
introduce factual errors, so one person always has Claude check the
rewrite afterward. Some Claude models reject Gemini's edits, but people
report that 5.5 models accept them.

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
  calls for one pass, or a step in a procedure. The source uses a one-pass
  tool. That keeps Claude as the driver and limits the new surface. A fact
  check after the rewrite is probably necessary.
- The [writing practice](../features/2026-07-05-writing-skill.md) puts the
  boxholder's own words first. A better prose model does not change that. It
  can matter for connective text and for edits.

## Research (incomplete)

- Confirm the OpenRouter model ID and its price.
- Take a few real writing tasks from `test1`, run each with Claude and with
  Gemini Carbon, and compare the results blind.
