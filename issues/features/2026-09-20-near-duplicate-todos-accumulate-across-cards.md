---
title: "Near-duplicate todos accumulate across cards, and nothing relates them"
workstream: unattached
area: beebox
needs: [design]
labels: [todos, cards]
filed-by: agent
discovered-by: Ian
discovered-in: worktree-collection-views — reading the todos of a working box as design material
---

In a working box, one real task appears as a `{% todo %}` in several cards. Of
about 150 open todos in that box, at least five tasks appear two to four times
each, with different wording and different `id` values. The box-wide plate
shows each copy as a separate item. Marking one copy done leaves the others
open.

## How the copies arise

- **Several areas care about one task.** A document to locate is a todo in the
  accounts document, in the tax document, and in the general list. Each copy is
  correct where it is: the capture rule is "note the intention where it
  arises", and it arises in three places.
- **Import.** A list that people kept elsewhere was imported, with each line as
  a todo. The box already held todos for some of those lines. A second import
  of the same list would add a third set. Nothing compares incoming todos with
  existing ones.
- **An agent review adds items.** A sweep that writes "open items" sections
  restates tasks that other cards already carry.

## Why the answer is not obvious

- **Culling loses the context.** The copy in the tax document says why taxes
  need the item. The copy in the accounts document says which account. Deleting
  all but one removes that from the places where the boxholder reads it.
- **Identity is judgment.** The copies do not share text. No query can derive
  that two todos are one task. The todo-annotation plan already gives this job
  to the agent (goal 4: "deduplicate — surfacing and asking, never silently
  auto-resolving"), and the shipped review sweep does not do it. The sweep
  computes date sets only (`src/core/todo/review-sweep.ts`).
- **The collector treats a shared `id` as an error** (`duplicate-id`,
  `src/core/todo/collect-types.ts`), so "give the copies one id" is not
  available today.

## Options

1. **Cull.** The agent merges copies into one todo and deletes the others. It
   is simple. It loses local context, and the next import or sweep makes the
   copies again.
2. **One todo and pointers.** One card holds the todo. The other places keep a
   plain line that links to it and carry no tag. Status has one home. This
   needs an address for a single todo; see
   [addressable URIs for cards](2026-05-11-addressable-uris-for-cards.md). The
   pointer line needs a rendering that shows the target's status.
3. **Related copies.** Each copy stays a todo. A relation marks them as one
   task: `{% see-also %}` to the other copy, or a deliberate shared `id`. Lists
   fold the copies into one item that names its locations. Completing one
   offers to complete the rest.
4. **Prevent at the source.** Import and review compare a new todo with
   existing ones and ask before they add it. This helps whichever of 1 to 3 is
   chosen. It does not replace them.

The boxholder's first reaction (2026-09-20): not sure of the answer; "just
culling? Pointers?"

## Related

- [Collection views](2026-08-19-collection-views-are-badly-defined.md) and its
  [design notes](../../beebox/docs/plans/collections-design-notes.md): a list of todos over
  a whole box is where the copies become visible, and a scope that follows
  references makes them more visible.
- [Todos as inline things to think about](2026-08-30-todos-inline-things-to-think-about.md):
  if todos are read in place and not in one list, local copies cost less.
