---
title: "Admin has no control for the small model; it is set only in _config/box.json"
workstream: unattached
area: beebox
labels: [providers]
filed-by: agent
discovered-by: Ian
discovered-in: worktree-background-provider — background runs follow an OpenRouter default
---

`smallModel` in `_config/box.json` picks the model for chat titles, chat
reviews, retro observation, and triage. On a box whose default is an
OpenRouter model, it also picks the model for `efficient` and `balanced`
procedure steps ([background runs follow an OpenRouter default](../../beebox/docs/implemented-plans/background-runs-follow-openrouter-default.md)).
Admin → Agent engine and model shows the Default model only. To change the
small model, the owner edits the file or asks the box agent.

The cross-model plan review cut a picker from that plan: the boxholder's
decision reused the existing setting and did not ask for a control.

## Tension

- A picker makes the cost choice visible. The quick passes run on every chat
  turn, so a cheaper small model than the default saves the most spend.
- A second model select next to Default model asks the owner to understand
  two slots and, on an OpenRouter box, which procedure steps follow which.
- The admin hint for an OpenRouter default is static text, because the
  `admin.boxConfig` query does not return `smallModel`. A picker would carry
  the value, and the hint could name what is in force.

## Shape if built

A select under Default model: "Automatic" (unset; the efficient tier, or the
default on an OpenRouter box), the engine's tier models, and added OpenRouter
models. Write through `admin.updateBoxConfig`, validated by
`isConfigurableModel` as `agentModel` is.

## Related

- [Background runs ignore the OpenRouter default](../closed/bugs/2026-10-15-background-runs-ignore-box-openrouter-default.md).
- [Small-model slot (closed)](../closed/features/2026-08-25-small-model-slot.md).
