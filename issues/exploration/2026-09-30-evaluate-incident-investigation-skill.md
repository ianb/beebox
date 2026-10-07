---
title: "Evaluate the incident-investigation skill against bbx-debug, starting with blame at three levels"
workstream: unattached
area: docs
labels: [agent-workflow]
filed-by: agent
discovered-by: Ian
discovered-in: main session — boxholder shared the incident-investigation repository
---

**Credit:** [incident-investigation](https://github.com/yaniv256/incident-investigation)
by Yaniv Ben-Ami (MIT, 2026). Anything adopted from it carries that credit; see
[the attribution issue](../closed/docs-and-chores/2026-09-30-attribution-for-adopted-ideas.md).

## The source

A skill for production incidents and hard bugs: a 10-phase, hypothesis-driven
investigation that writes everything to one investigation file. `SKILL.md` is
about 10,200 words, plus references (anti-pattern catalog, assumption lock-in,
templates) of about 4,000 more. Our counterpart is the bbx-debug skill
(`.claude/skills/bbx-debug/SKILL.md`, about 1,450 words), which centers on a
tight feedback loop and has a 3-fix circuit-breaker.

## What the boxholder flagged: blame at three levels

Phase 7 assigns blame at three ascending levels, each with its own fix scope:

1. **Lines of code**: the proximate cause. Fix the lines (minutes to hours).
2. **Anti-pattern**: the programming pattern that made those lines possible.
   Search the whole codebase for other instances (hours to days); its Phase 9
   reports this search often finds 10-100x more than the incident.
3. **Coding style**: the practice that let the anti-pattern persist (no
   failure-path tests, functions that cannot report failure, health checks
   that lie). Change the practice (ongoing).

It adds a rule: an operator error, especially a repeated one, is evidence of a
bad interface, and blame goes to the interface. For an agent, the interface is
its tool, status, and error surface.

bbx-debug stops near level 1. Its Phase 6 asks "what would have prevented
this?" and raises architectural answers with the boxholder, but it has no
step that searches for other instances of the pattern (level 2) or names the
practice (level 3).

## Other ideas worth a look

- **Maximum-pain ordering**: test first the hypothesis that is most
  uncomfortable to accept (your own last change, your tooling lying), as a
  correction for motivated reasoning.
- **Reserved probability for "none of the above"**, and experiments chosen to
  reveal causes outside the list, not only to pick among it.
- **Attractor hypotheses**: explanations an agent reaches for across
  unrelated incidents ("the event was untrusted", "the platform blocked it").
  The skill argues a remembered caution does not counter them; a required
  step at the point of temptation does (for example, a forced A/B before
  building a workaround).
- **Category pivot after three failed experiments in one category**, a cousin
  of our 3-fix circuit-breaker.

## Why adoption is not obvious

- **Size and register.** bbx-debug is short on purpose. The source is long and
  emphatic (bold rules, "MANDATORY", "non-negotiable"), the register the
  claude-api prompt audit flags as over-steering current models. Adopt ideas,
  not text.
- **Some content does not transfer**: the chained-prompts MCP preamble, the
  code-graph MCP requirement for Phase 9, and the "Original Shame" framing.
- **Overlap with existing rules.** The repository already says "scope anchored
  to the incident" (a fix starts from the smallest change), so levels 2 and 3
  must produce a filed issue or a proposal, not a bigger fix. The issues skill
  is the natural sink.
- **Where it goes.** A Phase 6 addition to bbx-debug, a separate post-incident
  skill, or the prod-incident path only.
