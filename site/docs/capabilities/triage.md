---
description: "Sorts everything that arrives in the box into the right category and destination, asking you when a rule doesn't cover the case."
---
# Triage

A box is a directory of your data, kept under version control with a full
history of changes (using git); a card is a markdown file with a structured
header; the agent is the coding agent (Claude Code or Codex) that operates the
box. Triage is the pipeline that decides where a newly arrived item belongs.

**What it does for you**

- Takes anything landing in the box unsorted (a voice memo, a scanned
  document, an email, a clipped page) and files it toward the process that
  should handle it.
- Learns your categories from where you file things, rather than requiring
  you to define a taxonomy up front.
- Asks a question instead of guessing when an item does not clearly fit an
  existing category, and treats your answer as a rule to apply next time, not
  just a one-off placement.
- Lets you promote a new category simply by dropping a landmark card at a
  directory, marking it as a triage destination.

**What it needs**

Nothing beyond the box itself; triage runs over whatever connectors and
capture paths you already use.

**How it works, briefly**

The process has three stages: intake (clean up the item, for example
transcribing speech or pulling text out of a scanned image, without deciding
where it goes), triage (pick a category and move the item to that category's
holding spot), and handle (run the category's procedure to reach the item's
final resting place). Each stage is a real step recorded in the box, so a
partially triaged item is visible, not stuck invisibly partway through.
Triage runs automatically during regular check-ins and other automated
passes, not only when you ask. The coding agent does the sorting by default.
A box can instead opt in to a small judging model (reached through OpenRouter)
that is given the prepared text of the item and your filing rules, may do a
bounded amount of research on unclear items, and leaves a record in the box of
what it decided and why. Earlier decisions can be replayed against a proposed
rule change before the change is kept. A filing destination can also carry a
follow-up question ("does this need follow-up?"); a yes adds an ordinary todo
for the agent, and authorizes nothing more.

**Limits**

The category rule set does not automatically rewrite itself from a low-
confidence answer today; you edit the category's card by hand when a pattern
emerges. An item the categorizer truly cannot place lands in an unhandled
holding area rather than being forced into the nearest category. With the
judging model, the item's text and your filing rules leave the machine, the
documentation says it asks the provider not to retain them without being able
to promise that, and the record it keeps in the box holds that prepared text
until you delete it. The documentation also says a large scan can still be
only partly read, and that the structured text is favored over details such as
stamps or signatures that extraction did not keep.

**Go deeper**

[../reference/triage.md](../reference/triage.md),
[../reference/cards/landmark.md](../reference/cards/landmark.md),
[questions.md](questions.md)
