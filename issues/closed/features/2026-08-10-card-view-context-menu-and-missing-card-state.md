---
title: "Card view needs a context menu (delete, history) and a real missing-card state"
workstream: card-menu
area: beebox
labels: [ui, cards]
resolution: implemented
---

Implemented in `7c37e0a3`. The card view now has an extensible actions menu,
path-filtered history, a recoverable trash flow with inbound-reference warnings,
and useful states for missing paths with and without history.

The card view has no per-card actions. Add a context menu beside the view
selector (the `Organizer | Card | Source` segmented control in the top-right of
`FileView`), starting with **delete** and **view history**. And when a card
doesn't exist, say so usefully instead of erroring.

## Delete

**`bbx rm` exists** and is the right primitive: *"Move one or more cards to the
trash"*, with `--reason`, `--commit`, and `--dry-run` (`src/cli/commands/trash.ts`).
Worth carrying into the UI wording — this is **trash, not destroy**, so the
affordance can be less frightening than a permanent delete.

### The dangling-reference problem

`bbx rm` does **nothing** about refs today. Other cards can point at the one
being trashed, and after it's gone those refs dangle.

**The scan for this already exists.** `bbx mv` solves the harder version of the
same problem: `src/core/rewrite-card-refs.ts` + `src/core/commands/move-operations.ts`
walk every other card *and* every plain `.md`, **resolve** each ref against the
card holding it (the same way the renderer and `bbx validate` resolve them), and
rewrite it in whatever style it was written — box-root-absolute stays absolute,
relative stays relative, `attach/` is left scoped to its owner. It covers three
ref-bearing forms.

So finding inbound refs to a card is that same traversal with a different
predicate ("does this resolve to the card being trashed?") and a different
action (report instead of rewrite). **Reuse it rather than writing a second
ref-scanner** — the module header records that a previous blind substring
approach missed relative refs, which is exactly the bug a fresh implementation
would reproduce.

### What to do when refs exist

Three different answers for three different callers, per the boxholder:

- **Agent (`bbx rm`)** — print the dangling references. The agent has the context
  to decide, and often to fix them.
- **UI** — warn before trashing. There's no resolution that's naturally apparent
  in a menu, so the honest affordance is "N cards link to this — trash anyway?"
  plus a way to see which ones. Don't invent a repair UI.
- **Ideally** — the agent fixes them up. Whether that's a `bbx rm` flag, a
  follow-up job, or something the chat agent does when asked is undecided.

Open: does `bbx rm` grow a `--check-refs`/`--force` shape, or does it always
report and let the caller decide? A `--dry-run` already exists and may be the
natural place for the report.

## View history

Straightforward in the menu, **but the backing query doesn't exist yet.**
`history.list`'s `filterSchema` (`src/webapp/trpc/routers/history.ts:54-60`)
takes `connectors`, `workflows`, `touchpoint`, `feedback`, and `session` — **no
path**. So "history for this card" needs either a path filter on that procedure
or a per-path history query.

Note this is also what makes the missing-card state below possible, so it's a
shared prerequisite rather than a separate feature.

## Missing-card state

Today: `FileView.tsx:391` renders a bare `File not found: {path}` line. It reads
like an error the user caused.

It should instead say the card doesn't exist and offer the two things that are
actually useful:

- **See history for this path** — a card that once existed has a git trail, and
  that trail is how you find out whether it was renamed, trashed, or never
  created. Depends on the path-history query above.
- **Close the tab.**

Worth distinguishing "never existed" from "existed and is gone" if the history
query makes that cheap — they want different words, and the second is the case
where history matters.

## Scope notes

- The menu belongs in `FileView.tsx`, which already owns the selector chrome and
  the `isCard` / card-data branching.
- Delete and history are the starting set; the menu is the durable thing and
  more actions will want in later. Don't build it so narrowly that a third item
  needs a redesign.
- Read `frontend.md` before building — `restrict-component-classes` applies, and
  there are existing `Dropdown` / `MenuItem` primitives (`components/ui/`) that
  the app bar's menus already use.
