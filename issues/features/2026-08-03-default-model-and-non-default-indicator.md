---
title: "Default chat model + a settings indicator when the model is non-default (smarter vs dumber)"
workstream: unknown
needs: [design]
area: callback-box
filed-by: agent
discovered-in: main session — boxholder wants to see at a glance when a chat is off-default
priority: normal
---

Give the chat two related things: a **user-settable "default model"**, and an
**indicator on the settings button when the active chat model is not the default** —
with a **different indicator for a smarter vs. a dumber** model than the default.

## Job to be done

When the boxholder bumps a chat to a **smarter** model for a hard task and then
moves on, they want a glanceable cue that the chat is no longer on their default, so
they do not keep burning the expensive model by accident. And the inverse: after
dropping to a **cheaper/dumber** model, they want to notice they are running dumb
before it quietly degrades answers. The settings button is where the eye already
goes for model state, so the cue belongs there.

## What exists today

- The chat model **override** is a picker (`MODEL_OPTIONS` in
  `frontend/.../InteractiveChat-helpers.ts:97`), whose first entry is **"Default"
  (`model: null`)** — but "default" today means the box/procedure default, not a
  value the user chose.
- The override persists per box (`chat-model.json`; `Loaded model override` log).
- Canonical model ids + ordering live in `shared/model-ids.ts`.

So there is a "Default" concept but no user-set default, and no glanceable signal
when a chat has deviated from it.

## Design questions

- **Where the default lives.** A user/box setting for the preferred default model,
  vs. the current implicit default. Per box, or a global preference the user sets
  once? How it relates to the existing per-chat override picker.
- **The smarter/dumber ranking.** The indicator needs a capability order over the
  models (e.g. Fable > Opus > Sonnet > Haiku) to decide "smarter" vs. "dumber" than
  the default — derive it from `shared/model-ids.ts` rather than hardcoding in the
  UI. Ties (same tier, different family) need a rule.
- **The indicator.** On the settings button: nothing when on default; one style for
  smarter (e.g. an up/emphasis mark), another for dumber (a down/muted mark).
  Glanceable, not a full label. Consider a tooltip naming the active model.
