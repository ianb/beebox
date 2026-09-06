/**
 * The `prominence:` bullet of the guide's "Frontmatter every card shares"
 * list (`cards.ts`). Its own module only for `cards.ts`'s line budget; the
 * vocabulary it teaches is the one settled with the boxholder on 2026-09-06
 * (`docs/implemented-plans/card-prominence.md`, Track A). One definition, one place: the
 * landmark section and the package docs point here rather than restate it.
 */

export const PROMINENCE_FIELD_BULLET = `- **\`prominence:\`** — who the card is for, and whether the box puts it in
  front of a reader who is looking around rather than looking for it. **Leave
  it absent for most cards**: absent is a level (*ordinary* — for the reader,
  if they look) and it is the right one by default. This is not access: every
  card, at every level, is readable and addressable. Three written values:
  - \`entry-point\` — *where a reader starts.* A card whose main job is to
    orient a reader to this directory or area and send them onward: an index,
    an overview, a dashboard, a roster, a gallery, a collection view. Not a
    card that is merely important; a recipe is never an entry point, the
    recipe index is. A landmark card is not one either: it marks a place, and
    the place's entry point is a visitable card inside it. Ask: *would a
    newcomer open this first to understand what is here?* Usually one per
    directory.
  - \`primary\` — *the thing itself.* The card a reader came to this directory
    for, as opposed to material toward it or about it: a project's plan is
    primary; its research notes, quotes, drafts, and call logs are not. Not
    "because it is good" but "because it is the thing." Ask: *is this the
    thing itself, or material toward it?* One piece of work produces one
    primary card. If everything here is the thing (forty recipes), mark
    nothing and give the directory an entry point instead.
  - \`background\` — *for you, not the reader.* Material you use but did not
    write for the boxholder to look at: logs, state, imports, scratch,
    generated intermediates, and anything already embedded in another card
    (an image that appears inside a primary document is background on its
    own; the document is where a reader sees it). Cards the box writes for
    itself (jobs, runs, chat threads) and landmark cards are background by
    type. On a landmark card, \`prominence: background\` is the one value to
    write: it marks the whole place as housekeeping and folds everything
    under it. Never write \`entry-point\` or \`primary\` on a landmark.

  \`prominence\` is not \`status\`: \`status\` is lifecycle, \`prominence\` is who
  the card is for. When you finish the thing a piece of work was for, mark
  that one card \`primary\` and what you wrote for yourself along the way
  \`background\`. Marking every output primary is the failure this field
  exists to avoid; \`bbx validate\` warns at a third entry point or an eighth
  primary card in one directory. To surface a card in a place that is not
  its own directory, or with a contextual label or a fixed position, use
  that place's landmark \`links:\` — the card cannot say that about itself.
  \`bbx ls --format "{prominence} {title}" <dir>\` shows what a directory has
  declared.`;
