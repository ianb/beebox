---
title: "Remove Claude-isms (\"load-bearing\", \"genuinely\", \"the real X\") from repo docs"
workstream: unattached
area: docs
labels: [writing]
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder request
priority: normal
---

Agent-written docs carry stock phrases that read as model output. Once in a
doc, they persist: agents read the docs, copy the voice, and add more. The
developer's example is "load-bearing".

## Counts (2026-09-16)

`git grep -niE` over tracked `*.md`, excluding `issues/closed/` and
`beebox/docs/implemented-plans/`. Line counts; some hits are legitimate uses.

| Phrase | Lines |
|---|---|
| "the real " | 362 |
| "genuinely" | 296 |
| "not just" | 290 |
| "load-bearing" | 145 |
| "first-class" | 98 |
| "honestly" | 43 |
| "earns/earn its keep" | 14 |
| "belt-and-suspenders" | 7 |
| "crucially" | 6 |

"load-bearing" also appears in 39 `.ts` files (comments, prompt text).
Most `*.md` hits are in `beebox/docs/` (45 files), then `beebox/test/`,
`research/`, and open issues.

Other patterns to look for, which grep finds less easily: the "not X, but Y"
antithesis, candor openers ("Honestly:", "To be clear"), and ratings of an idea
in place of its consequence ("this is the key insight").

## Scope

1. **Sweep.** Rewrite hits in present-tense reference docs, CLAUDE.md files,
   skills, and agent-facing prompt text first. Replace the phrase with the
   concrete consequence: "load-bearing" → what breaks if it is removed.
   Delete intensifiers ("genuinely", "honestly", "crucially").
   Prompt text shipped to box agents counts as a behavior change; run the
   knowledge audits for guidance it touches.
2. **Leave history alone.** Closed issues, implemented plans, and research
   notes are records. Do not rewrite them for style.
3. **Keep it from coming back.** Options, to decide: a doc-check warning on a
   short phrase list for docs and prompt text; a line in the writing guidance
   ([how the agent writes](2026-08-19-skill-for-how-the-agent-writes-to-the-developer.md));
   or both. A lint rule with a word list risks false positives ("first-class"
   and "not just" are often fine), so a warning with a quick allow mechanism
   may fit better than an error.

Related: [check out aislop](../exploration/2026-05-29-check-out-aislop.md).
