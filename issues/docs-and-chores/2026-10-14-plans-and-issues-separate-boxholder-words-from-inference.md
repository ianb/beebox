---
title: "Plans (and maybe issues) record the boxholder's exact words apart from what agents inferred"
workstream: unattached
area: docs
labels: [dev-process]
filed-by: agent
discovered-by: Ian
discovered-in: main session — after the retrospective's bbx-plan deferral alert, 2026-10-14
---

A plan written with the bbx-plan skill mixes three kinds of text with no
marks between them: what the boxholder said, what the planner inferred from
it, and what the planner proposed. A later reader (an executing agent, a
reviewer, the boxholder) cannot tell which statements are the boxholder's.
An agent's paraphrase then gets the authority of a boxholder decision.

The retrospective schedule found one symptom twice: the watch item
`bbx-plan-unsized-deferrals`. In "NOT in scope", a reader cannot tell whether
a deferral was the boxholder's decision or the planner's proposal.

## What the boxholder asked for

- The template documents exactly what the boxholder said, in a part of the
  plan separate from inferred or agent-generated text.
- Only text with known provenance goes in that part. Each quote has a source
  that can be checked.
- Issues may need the same rule.

## Privacy (boxholder decision, 2026-10-14)

Verbatim words can carry private specifics, and a commit puts them in
history for good. The rule: when a quote could leak private information,
the agent asks the boxholder before it commits the quote. The boxholder
can then approve the quote, trim it, or send it to `private-issues/`. A
paraphrase does not avoid the question: it is not a quote, so it does not
go in the quoted section at all.

## What "known provenance" excludes

- A paraphrase presented as a quote.
- Words reconstructed from a compaction summary. Summaries rewrite the
  wording. The full transcript (`~/.claude/projects/<project>/<session>.jsonl`)
  keeps the exact text, so a quote can be recovered from there.
- Words passed through a launch briefing. `bin/launch-worktree-session`
  briefings usually say "the human wants X" in the launching agent's words.
  The launched session cannot tell a quote from a summary unless the briefing
  marks quotes as quotes.

## Open questions

- **Shape in the template.** A "What the boxholder said" section with dated,
  sourced quotes, near the top of `.claude/skills/bbx-plan/TEMPLATE.md`. Other
  sections then cite a quote when they say a decision is the boxholder's.
  Anything without a cite is the planner's.
- **Source format.** What a checkable source is: a session ID and date, a
  `bin/comments` document comment, an issue body, a commit message.
- **Issues.** `issues/AGENTS.md` already says to quote a message that answers
  a next action. A general rule could require a "What the boxholder said"
  section when an issue states a boxholder decision or preference. Issues
  filed from chat (most of them) would then carry the request verbatim.
- **Briefings.** The launch-worktree-session skill could require quoted
  boxholder words to stay quoted, so provenance survives the handoff.

## Related

- [Plan template has no developer-only section](../exploration/2026-09-21-plan-template-no-developer-only-section.md):
  also about who a plan's text is from and for.
- [Decision-shaped thinking discipline](../exploration/2026-05-19-decision-shaped-thinking-discipline.md).
