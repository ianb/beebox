---
title: "Chat-agent system instructions' worked example for pointing at the attach control names a control ('paperclip') that does not exist in the product"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: main — production box feedback triage (bbx feedback)
priority: important
---

A chat agent told a user to "attach them here with the paperclip" when asking
for photos. There is no paperclip in the composer: the attach control is a
button labeled "Add" (`control:bbx-composer-add`), which opens the attach
menu. The user had to correct the agent.

## Mechanism

`beebox/src/core/chat/session/prompts.ts:101` is the system-instruction
section that teaches agents how to point at on-screen controls. Its one
worked example is:

```
[the paperclip](control:bbx-composer-add?action=reveal&description=capture%2C%20attach%2C%20upload)
```

The example's link text, "the paperclip," names an icon shape that isn't
this product's actual label ("Add"). The same instructions do correctly say
"never name a screen location you have not seen in a dump" — the agent that
filed this feedback also reported not having followed that rule before
guessing — but the example itself supplies "paperclip" as a plausible-looking
control name, which primes exactly the wrong guess even for an agent that
otherwise reasons carefully. It also happens to match a common icon
convention in other chat apps, compounding the prime.

Running `bbx chat ui` (the sanctioned way to check) returns the real label
for this control: `button [Add] — opens the attach menu — capture, attach
file, upload files...`.

## Why the fix is not obvious

- The fix can't be "hardcode the real label" in the shared instructions,
  because `bbx-composer-add`'s label is UI copy that could change, and the
  instructions are shared across every box regardless of what that box's
  frontend currently calls the button.
- The safer fix is likely to make the worked example itself generic (describe
  the control by its function — "the attach control" — rather than by an
  icon name that may not match any given build), or to have the instructions
  explicitly warn that the example's wording is illustrative and not the
  product's real copy. Either choice is a judgment call about how examples in
  agent-facing instructions should be written so they model good behavior
  without accidentally supplying wrong facts.
