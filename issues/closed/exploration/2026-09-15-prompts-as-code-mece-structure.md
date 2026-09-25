---
title: "Prompts as code: MECE structure against accretion, and whether our instruction surfaces need it"
workstream: doc-structure
area: beebox
filed-by: agent
discovered-by: Ian
discovered-in: main — the boxholder brought an OpenAI applied-AI post for discussion
resolution: implemented
---

> Closed 2026-09-25 as implemented by
> [`doc-structure`](../../../beebox/docs/implemented-plans/doc-structure.md)
> (commit range ending `9915e8125`, plus the finish-time site-build fix). The
> boxholder adopted the organization half of the argument for `beebox/docs/`:
> nine mechanical principles (one home per fact, siblings as one axis, names
> as the search path) now live in `beebox/docs/README.md` "Organizing
> principles", proved on a pilot restructure of the testing cluster into
> `beebox/docs/testing/`, measured before/after with a ten-question
> find-the-fact protocol. The article's phase-based template (Background /
> Behaviour / Output) was adapted, not adopted verbatim — this repo's axis is
> *subject* first, *aspect* second, with Background/Behaviour/Output folded
> into the aspect headings. Box-loaded guidance, `CLAUDE.md`/skills, and the
> rest of `beebox/docs/` are explicitly deferred to follow-on plans (see the
> plan's NOT-in-scope section), not resolved here.

An OpenAI applied-AI engineer argues that most production prompts are bad for a
structural reason, and proposes a fix. The boxholder wants to discuss whether it
applies here before anything is done. Source:
[Wulfie Bain on prompt structure](https://x.com/wulfie_bain_/status/2098060386813566990).

## The argument

**Prompt evolution is accretive.** Engineers add and never remove. New
instructions land on top of old ones that said something else, and nobody reads
the whole thing end to end. The result is contradictions nobody can see.

**Implicit knowledge produces ambiguity.** A reviewer reads what they meant, not
what the text says. "Never refer to competitors" is clear to the person who
thinks about competitors daily and undefined to the model.

**Conditional assembly compounds both.** When fragments are injected per
scenario and owned by different people, each part can be reviewed while the
assembled whole is not.

Two claims follow. **Prompt decisions are product decisions** — output format,
whether to ask before acting, speed against thoroughness are all product, so
whoever writes prompts is designing behaviour. And **prompts should be treated
as code**: modular, DRY, refactored on purpose, with sections that are mutually
exclusive and collectively exhaustive.

The proposed template is three top-level sections, hierarchically nested:
**Background** (the world before the run), **Behaviour** (how it acts while
working — the "backend", invisible to the user), and **Output** (the
user-facing "frontend"). The claimed benefits are cheaper review, safer
iteration, tree-search instead of grep, non-engineers able to contribute
safely, and faster model upgrades because obsolete scaffolding is easy to find
and delete.

Two of its own caveats are worth keeping. Smarter models do not resolve
ambiguity — they resolve *how*, not *what*. And meta-prompting does not escape
the problem, because the rewriter's prompt needs the same clarity.

## What this repo already has

| surface | scale |
|---|---|
| box agent guide (`src/core/agent-guide/`) | 11 modules, 1355 source lines |
| `CLAUDE.md` files | 38 files, ~4200 lines |
| skills (`.claude/skills/*/SKILL.md`) | 24 files, ~3073 lines |
| schedule prompts (`schedules/*/prompt.md`) | 7 files, ~641 lines |

The agent guide is already modular by file and has a **named-section registry**
(`agent-guide/sections.ts`): headings and every cross-reference derive from one
constant, so a pointer cannot drift from the heading it names. That is a partial
implementation of the article's structural idea, and it is worth deciding
whether to extend or to leave as is.

## The tension worth discussing

The registry organises by **topic** — `THE_LAWS`, `ABOUT_CARDS`, `TODOS`,
`DIRECT_QUOTES`, `PROVENANCE`. The article organises by **phase** — context,
behaviour, output. These cut across each other. A topic section naturally holds
some context, some behaviour, and some output rules together, which is good for
locality and bad for the article's claim that you can change output formatting
in one place. Which axis serves this repo better is a real question, not a
settled one, and `cards.ts` at 270 lines is the obvious place to test it.

Second question: the article targets a product's system prompt, where the team
owns every word. Much of our instruction surface is `CLAUDE.md` and skills read
by coding agents, plus box-side guidance read by box agents. Those have
different readers and different lifetimes.

## Related open issues

- [Review all prompts](../../docs-and-chores/2026-03-16-review-all-prompts.md) —
  the end-to-end read this argues for, with tooling already built: the prompt
  viewer at `/main/dev/prompts/` shows every fragment and the assembled context
  stacks with per-layer token counts, and gives each a citable name.
- [Instruction surface size budget](../../docs-and-chores/2026-07-04-instruction-surface-size-budget.md)
  — attacks accretion by volume, with a proposed `bbx validate` size warning.

Those two cover *reading* the prompts and *bounding their size*. Neither covers
**organisation**, which is the article's actual contribution: structure is what
makes contradictions findable in the first place. Its size figure (agent guide
generated at ~657 lines) is from 2026-07 and needs re-measuring before anyone
reasons from it.

## Notes for the discussion

- Standing repo guidance already names the accretion problem for agent and
  skill files: rewrites get a line budget, mechanics move to scripts, and only
  judgment-carrying rules stay. That is the same diagnosis with a different
  remedy.
- The article's suggestion — hand it to a coding agent and have it audit the
  repo's prompts against the advice — is cheap and is one concrete way to open
  the discussion rather than a commitment to restructure anything.
