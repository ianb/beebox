---
read-when: Capturing, annotating, closing, querying, or reviewing a todo — the `{% todo %}` tag's attributes, `start`/`due` and the plate, your own follow-ups, `bbx query todos`, and the review sweep.
---

# Todos

The agent guide's TODOS section says when a todo is the right tool and
shows the inline `{% todo %}` form. This doc is the rest.

## Capturing one

Or, for an intention that doesn't belong to any particular sentence of the
body, a frontmatter entry (same attributes, as `text` + keys):

```yaml
todos:
  - text: "Renew the parking permit"
    due: "2026-08-15"
```

A bare `{% todo %}…{% /todo %}` with no attributes is a valid, honest open
todo — it just means "on the plate now, no date opinion." Absence of an
attribute is never a fabrication; only set what you actually know.

Attributes, all optional: `id` (a short slug for `{% see-also %}` cross-
reference — never a UUID), `status` (`open`/`done`/`dropped`/`parked`;
absent = `open`), `assigned` (absent = the boxholder; `"agent"` = yours to
chase; any other value names a person — a plain name such as `"Dana"` is
fine, and whether it should become a ref is not settled. Never write `user`,
`me`, `boxholder`, `you`, or `owner` for the boxholder: leave `assigned` off,
or lint warns), `by` (absent = boxholder-authored; `"agent"` = you wrote it), `due`,
and `start` (an absolute date or `-3d`/`-2w` relative to `due` — this is
the *surfacing* trigger: a todo is quiet before `start`, on the plate from
`start` on, regardless of `due`). **`created` is required whenever
`by="agent"`** — you always know the date, and the review sweep's staleness
math depends on it. Nest `{% see-also ref="..." %}...{% /see-also %}` inside
a todo (or a frontmatter `see-also:` list) to point at supporting evidence —
this is what proves a todo is done, not just claimed done.

## Your own follow-ups

You may open a todo for yourself — `by="agent" assigned="agent"`, with
`created` — whenever you notice work worth doing that isn't this turn's
job: a card that wants a second pass, a gap you spotted while doing
something else, a cleanup the boxholder never asked for. You don't need
permission for these and they don't go on the boxholder's plate, so they
cost the person nothing. Close your own with `done` and a
`{% see-also %}` pointing at the evidence, or `dropped` when you've
decided against it — and say why in the text.

Two limits. This is not a way to defer a decision that is really a question
(see above — that rule doesn't relax just because the list is yours). And an
agent todo you keep stepping over for months is noise: drop it, or raise it
as a real question. `bbx query todos --assigned agent` finds them again,
and the `todo-review` sweep brings the stale ones back to you.

## Querying

`bbx query todos` is your query path. `--here <dir>` asks about one
project: its own todos, plus todos elsewhere that link into it.
`--group plate` is the date view, `--assigned agent` your own follow-ups;
also `--status`, `--glob`, `--on-plate`, and `--json`. There is no
mutation command: to change a todo, edit its `{% todo %}` tag or frontmatter
entry directly, like any other card content — normal validation, git
history, and file-locking apply, nothing special.

Where you write a todo is how it reads back: headings and nesting group
todos, so put one under the heading it belongs to and under the todo it is
part of. A note written after the closing tag travels with the todo. A link
in a todo makes it show up on the linked place as well as its own.

## Tending

You may run a review pass yourself, and the daily `todo-review` procedure
also hands you a brief of escalated / newly-on-plate / stale todos to look
at. Either way, the same rule: **you judge, the boxholder decides.**
Suggest completion when you see evidence a todo is done; propose merging
duplicates; flag a stale one for `parked`/`dropped`/a real date — but
*ask*, in chat or a question card, rather than changing status yourself.
The one exception: an `assigned="agent"` todo you yourself finished — mark
that one `done`, with a `{% see-also %}` (nested tag or frontmatter list)
pointing at the evidence you did the work.

`recheck` is the review's bookkeeping: an ISO date before which the review
will not list the todo again, or `never` once it has stopped reviewing it.
It is not a reminder and changes nothing the boxholder sees on the plate.
You write it only while working a todo review, and there it is the one
attribute you may set on the boxholder's todos without asking. Never
write `never` yourself; the review sets it when a todo was pushed three
times with nothing changing.
