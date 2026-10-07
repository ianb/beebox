---
title: "Credit adopted ideas in an acknowledgements file, and backfill it from history"
workstream: acknowledgements
area: docs
labels: [agent-workflow]
filed-by: agent
discovered-by: Ian
discovered-in: main session — crediting reader-context-writing and incident-investigation
priority: normal
resolution: implemented
---

Closed: implemented by the acknowledgements workstream (commit b50b22610, `ACKNOWLEDGEMENTS.md` plus guidance edits in bbx-plan TEMPLATE, research/CLAUDE.md, issues/CLAUDE.md). The Twemoji credit moved into the same file and `beebox/docs/attribution.md` was removed. The pending Yaniv Ben-Ami note is covered by the new file and guidance.

The boxholder wants to credit the people whose ideas Bee Box adopts.
`beebox/docs/attribution.md` exists, but it covers only third-party
**assets** we redistribute under a license that requires credit (today:
Twemoji). There is no place for **ideas**: a method, a prompt structure, a
workflow, or a design borrowed from another project. Credit for ideas now
lives, if anywhere, in the issue or research note that discussed the source,
and those close or go stale.

## Part 1: a place for idea credits

Add a section to `attribution.md` (or a sibling `credits.md` that
`attribution.md` links to). One entry per source:

- the project and its author, with a link and license;
- what we took (the idea, in one line);
- where it landed (the skill, doc, or code path that uses it).

Decide:

- **Threshold.** An idea we adopted, changed, or used as a direct model gets
  an entry. An idea we only read and rejected does not. Research notes under
  `research/` keep covering what we evaluated.
- **When an entry is added.** At the commit that adopts the idea, so the
  credit lands with the change. The issues and research notes that propose an
  adoption name the source; the finish flow could check that an adopted
  source has an entry.
- **Where `attribution.md` lives.** It sits in `beebox/docs/`, but some
  adopted ideas are dev-side (skills under `.claude/skills/`, `bin/` tools)
  and not part of the shipped package. One file for both, or a root-level
  file for dev-side credit.

## Part 2: backfill from history

Search the record for ideas already adopted from external sources, and
write their entries. Places to look:

- `research/`: one directory or note per external project evaluated
  (gstack, claude-elixir-phoenix, openclaw and hermes, opencode, pai,
  tiddlywiki, and others). Each note says what we evaluated; find which
  ideas we then shipped.
- Closed issues that name an external project as the source of the
  change. Examples found while filing this: the plan-review format and
  failure-loop hook (gstack / claude-elixir-phoenix review), the
  requirements-delivered gate in `/finish`, cross-model review, the
  instruction-surface size budget.
- Skills under `.claude/skills/`: read each for borrowed structure (for
  example, the bbx-debug "Iron Law" and circuit-breaker shape).
- Commit messages and plan docs (`beebox/docs/implemented-plans/`) that say
  "inspired by", "adapted from", "based on", or link a GitHub repository.
  A plain `git log --grep` for those words is noisy ("based on" is common in
  ordinary prose); review the matches by hand.

For each candidate, confirm the idea actually shipped before writing an
entry, and name the file it landed in.

Pending entries from 2026-09-30:
[reader-context writing](../../exploration/2026-09-30-reader-context-writing-and-structured-thinking-tag.md)
and [incident-investigation](../../exploration/2026-09-30-evaluate-incident-investigation-skill.md),
both by Yaniv Ben-Ami. Add them if and when their ideas are adopted.
