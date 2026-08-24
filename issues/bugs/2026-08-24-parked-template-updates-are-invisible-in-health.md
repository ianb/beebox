---
title: "A parked template update is invisible in `cb health`, so a fix can land upstream five times and never reach the box"
workstream: unattached
area: callback-box
priority: important
labels: [templates, health, boxes]
filed-by: agent
discovered-by: Ian
discovered-in: main session — a scheduled task kept failing after repeated upstream fixes
---

A boxholder watched the same scheduled task fail across roughly five rounds of
fixing. Each fix was correct and each one shipped. None of them ever reached the
box.

## What actually happens

`install-template-file.ts` parks an update rather than overwriting when the
local file has diverged from the last recorded stock version — outcome
`"parked"`, written to `config/_template-updates/<path>` "for review". That is
the right call: a hand-edited card must not be clobbered.

The failure is that **nothing tells anyone it happened.**

Observed on a real box: the live procedure card carried an old value, and the
corrected version sat parked, unread:

```
config/procedures/refresh-maps.procedure.card                     ← in use, stale
config/_template-updates/config/procedures/refresh-maps.procedure.card  ← the fix, parked
```

Four updates were parked in total (a briefing card, two guide/personality cards,
and the procedure). **`cb health` mentions templates zero times.** Only
`cb status` reports them (`cli/commands/status.ts:74-84`), and health is what a
boxholder actually reads — it is the surface that lists failing schedules, and
it lists them without ever saying the fix is already sitting on disk.

So the loop is: task fails → upstream diagnosis → fix ships → template syncs →
**parks** → task fails identically → repeat. From the boxholder's side this looks
like the fixes not working, which is corrosive in a way a plain bug is not.

## Why the card diverged, which matters for the fix

The live card had been hand-edited to add a `SANITY-CHECK PATHS` block telling
the agent to skip map targets containing a duplicated path segment — a local
workaround for the doubled-subtree problem. A reasonable edit. From the moment
it was made, every future update to that template parked, silently and forever.

That is the general shape: **one local edit permanently detaches a file from
upstream**, with no signal and no path back. Accepting the parked copy wholesale
would discard the local edit; keeping the local copy forgoes every upstream fix.
Nothing offers a merge, and nothing says a choice is pending.

## What to fix

- **Surface parked updates in `cb health`.** They are exactly the kind of
  "something needs a human" state health exists to report, and their absence
  turned a one-line fix into five rounds. This is the minimum.
- **Say it where the symptom appears.** A failing schedule whose own procedure
  card has a parked update should say so in the failure, not leave the
  connection to be discovered.
- **Give parked updates a resolution path.** Today `cb status` says to copy the
  file over by hand or delete it. A three-way merge, or at minimum a
  `cb template accept <path>` / `diff` pair, would make the choice takeable.
  Note the parked copy usually carries *other* improvements too — this one had
  new MAP.md guidance the box never received.
- **Consider whether some fields should be box-owned rather than diverging the
  whole file.** `install-template-file.ts` already has a `boxOwnedFields`
  concept; a card that only needs a local paragraph should not lose the file's
  upstream lineage.

## Related

- [Procedure model pins are Claude-only](../closed/bugs/2026-08-23-procedure-model-pins-are-claude-only.md)
  — the fix that could not land. It shipped as `model: efficient` in the stock
  template on 2026-08-23 and the box still runs `model: haiku`.
