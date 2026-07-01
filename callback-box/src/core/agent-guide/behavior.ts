/**
 * General agent behavior: the role of git history, and a guide to choosing
 * where to record discovered information.
 */

export function gitHistorySection(): string[] {
  return `## Git History

Git history is the box's primary record of what happened — who did what, when,
and why. To reconstruct that, **read \`git log\` first**; don't spelunk the
filesystem for clues.

Commits carry structured trailers (key: value metadata after the message body).
Most are provenance in \`<Verb>-By:\` form naming what touched the content —
\`Created-By\`, \`Moved-By\`, \`Pulled-By\`, \`Sent-By\`, \`Trashed-By\`,
\`Triggered-By\` (a connector, \`cb procedure\`, or a wakeup) — plus a few pipeline
markers: \`Phase:\` (which stage of a pipeline), \`Session:\` (the agent session),
and \`Commit-Source:\` / \`Fallback:\` (a system fallback commit rather than the
agent's own). You don't need these memorized — read them off the log, and filter
by one when you want a slice:

- \`git log --oneline -20\` — recent activity overview
- \`git log --all --grep='Phase: brief'\` — every brief-creation commit
- \`git log -- box/inbox/\` — history of one directory
- \`git show <hash>\` — the full diff of a change
`.split("\n");
}

export function whereToRecordSection(): string[] {
  return `## Where to Record What You Find

The box's own files capture knowledge that persists across sessions and is
visible to every agent working in this box. Use them.

**Do NOT use \`.claude/memory/\` for box information.** Those files are private to
one agent and are not part of the box's state. The box's own files — briefing,
cards, guides, personality — are the record.

Where each kind of thing goes:

- **Situational context** — what the box is for, who the key people are, the
  facts every agent needs → the **briefing card** (\`briefing.briefing.card\` at
  the box root; a directory briefing explains what that subdirectory holds).
  Adding a key person? Also create \`people/First_Last.person.card\`. Its fields
  are documented in \`docs/generated/card-briefing.md\` — think notes for a new
  team member.
- **A discrete item** — a bank account, a contact's phone number, a piece of
  furniture → a card in \`store/\` (record / memo / bookmark). Most things you
  encounter belong here.
- **A per-domain pipeline rule** — the user says "always do X with Y" for a
  specific pipeline (intake, calendar review, …) → the matching
  \`config/*.guide.card\`.
- **A filing target** — where a *kind* of item belongs → the destination
  directory's landmark \`destinations\` list (a \`for: [triage]\` routing target or
  a \`for: [commentary]\` capture target), not a guide card. See
  \`docs/plans/triage-design.md\`.
- **How the agent sounds** — tone, formality, how proactive → the personality
  card (\`config/main.personality.card\`). Voice and manner **only** — never
  situational context, the box's purpose, or facts about people (those are the
  briefing).

**Retrospective-inferred beliefs.** The weekly \`process-retrospective\` mines past
chat sessions and writes what it learned into personality/guide cards as
\`source: inferred\` entries — treat those as the agent's own working hypotheses:
don't promote them past \`medium\`, and don't use them to contradict a
\`user-stated\` belief (that takes the boxholder's say-so). The full
confidence-ladder detail lives with the retrospective procedure; run reports are
in \`store/reviews/retro/\`.

### Don't drop unexpected information

While processing one item you may hit something important but off-task — a legal
deadline buried in a furniture walkthrough, an unknown contact mentioned in
passing, an account number in a casual note. **Don't silently discard it** — that
is the worst outcome. Handle it by context:

- **In chat** — mention it naturally in your reply. Don't hijack the turn for an
  aside, but acknowledge it and flag that it may need follow-up.
- **In a processing job** — if you're confident where it belongs, file it (a
  record, todo, or other card). Otherwise raise a question card in
  \`box/questions/\` and move the source item to \`box/inbox/unhandled/\` so it
  isn't lost.

When in doubt, ask.
`.split("\n");
}
