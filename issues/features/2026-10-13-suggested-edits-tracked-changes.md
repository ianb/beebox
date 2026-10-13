---
title: "Suggested edits: the agent proposes paragraph rewrites, shown as tracked changes with reasons and alternatives"
workstream: unattached
needs: [design]
area: beebox
filed-by: agent
discovered-by: Ian
discovered-in: main session — boxholder asked for an "in-box Grammarly", 2026-10-13
---

The box has no way for the agent to propose a change to a passage and let the
boxholder accept it in place. Today the agent either edits the file or writes
the new text in chat.

*When I have written something rough (a voice note, casual chat input) and it
must become a slide or another formal piece, I want the agent to propose
edits I can see in the text, with the reason for each, so I accept the ones
that keep my voice and skip the ones that do not.*

## What the boxholder described

- **The rules are implicit.** The boxholder does not type an instruction. The
  agent applies standing rules such as "remove filler words", plus the rules
  of the destination form. Example: the boxholder began a message with
  "Basically". For a slide, which must be concise and read without context,
  removing it is a valid edit, and the text is still in the boxholder's voice.
- **Each suggestion has the shape of an edit tool call:** old text, new text,
  in one paragraph or passage.
- **The display is like Grammarly or Word track changes.** Marks in the text
  show deletions and insertions. The boxholder accepts each one.
- **Each suggestion carries a short reason.** It can also carry alternate
  edits that the boxholder scrolls through.
- **A batch of edits can have alternates too.** Example: "these changes give
  a formal style; this other set gives a casual style." It is not clear how
  to express a set of alternate batches in the tool call.
- **Suggestions can be stored and attached to a document.** The boxholder
  accepts that stored suggestions become stale when the text changes.
- **A review can produce many suggestions at once.** The boxholder accepts
  some, comments on others, and the agent then proposes new edits on top of
  the result.

## Open questions

- **Storage and culling.** The boxholder's direction: attachments, one file
  per suggestion at `A_Card.attach/edits/*.json`, each file probably one
  edit tool call plus an envelope (reason, alternates, author, date). Inline
  annotation in the Markdown is too noisy, so it is ruled out. Most
  suggestions have a short life, so they need culling. The envelope marks
  whether a suggestion is durable (for example, motivated by input from the
  boxholder) or not. Non-durable suggestions are deleted as soon as their
  edits no longer apply. Stale detection is easy for the edit-tool shape: the
  old text no longer matches. Open: what happens to a durable suggestion
  that goes stale, and what runs the cull (on write to the card, or on read).
  Also undecided: whether suggestion files go into git history at all. Most
  are short-lived, and commits of them would be noise. Gitignoring
  `*.attach/edits/` would keep them out, but then a durable suggestion is
  lost with the machine.
- **The rules.** Where the standing rules for the boxholder's casual input
  live, and where the rules for each destination form (slide, email, card
  body) live. Presumably a box procedure the agent reads, with no code that
  applies them automatically.
- **Where the marks show.** The card reading view, the editor, or both. Which
  card types: Markdown cards first; slides need their own form.
- **Comment and re-propose.** A comment on a suggestion goes back to the
  agent. The re-proposed set must replace the old set for that passage, with
  the accepted edits already applied.
- **Overlap.** Two suggestions that touch the same text. Alternates are one
  case of this.

## Related

- [Questions as inline annotations](../exploration/2026-08-01-questions-as-inline-annotations.md)
  takes ProofEditor's anchored threads as its model. ProofEditor shows
  suggested edits in the same interaction language (strikethrough old text,
  inserted new text). Suggestions and questions can share one anchoring
  mechanism.
- [Writing practice](2026-07-05-writing-skill.md): put the user's own words
  first. Suggested edits are a way to do that. The agent trims and arranges,
  and the boxholder keeps control of each change.
- [Document comments](../../beebox/docs/plans/document-comments.md) is the
  dev-side comment capability in the workstreams app, which is a different
  surface.
