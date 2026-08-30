---
title: "An rrule/ical field convention with ref-like universal treatment — every consumer knows what a recurrence value is"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: Ian
discovered-in: main session — "not 100% sure we should do this"
---

Boxholder idea, explicitly tentative ("not 100% sure we should do this"):
the way `ref` is *always* a reference — one name, one meaning, and every
consumer (validation, inlining policy, rendering, `bbx mv` rewriting, the
frontmatter view's RefLink) treats it uniformly wherever it appears — do the
same for **recurrence/event values**: an `rrule` (or ical event) field name
that is a known quantity across the system.

What exists today, scattered:

- `src/schemas/scheduled-script-fields.ts` parse-checks `at`/`until`/`cron`/
  `rrule` with the `rrule` package — but only for scheduled-script cards;
  the validation and vocabulary live in that one schema.
- The `ref` machinery is the model: `src/cards/ref-fields.ts` gives schema
  authors a constructor, walks any card shape finding the fields, and hangs
  policy (inline vs opaque) plus tooling (move-rewrites, link rendering) off
  the one convention.

What universal treatment could buy, if adopted:

- **Validation everywhere**: any schema declaring the field gets RRULE parse
  checking for free, not just scheduled scripts.
- **Rendering**: the default card view could show a recurrence as prose
  ("every 2nd Tuesday") instead of `FREQ=MONTHLY;BYDAY=2TU` — same spirit as
  never showing a raw timestamp.
- **Query**: "what recurs in this box" becomes answerable generically
  (a Today view, the calendar connector reconciling box-declared recurrences,
  the listening/interview modes scheduling follow-ups).
- **One vocabulary decision** — `rrule:` string vs an ical-event object
  (`dtstart` + rrule + tz) — made once instead of per schema. Timezone
  handling is the swamp: a bare RRULE without dtstart/tz is underspecified,
  which may argue for the object form.

Boxholder refinement (same day): like refs, a recurrence value should
generally travel with **context** — an object envelope, e.g.
`{ note: "hours open", rrule: ... }` — so the value says what it *is*, not
just when it fires. (Their words: "maybe not `rrule`, I don't know what the
right envelope here is" — the inner key is open too.) This parallels how a
bare `ref:` string usually sits inside an object whose siblings say why the
ref is there, and it strengthens the object-form lean above: the envelope is
where note, dtstart, and tz all live. Rendering follows: the note is the
prose, the recurrence is the detail ("Hours open — every 2nd Tuesday").

Why the hesitation is warranted (the "minimize invented concepts" preference
cuts both ways): `ref`'s universality earns its keep because refs are
*everywhere*; recurrence fields today exist in one schema. Adopting the
convention before a second real consumer exists would be speculative
generality. The honest trigger: the **second** schema that wants a recurrence
field (studio class schedules in the pottery box are a live candidate; the
Today view issue `2026-05-11-today-view.md` is another) — build the shared
treatment then, from the scheduled-script implementation.
