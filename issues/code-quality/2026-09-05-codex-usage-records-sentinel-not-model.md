---
title: "Codex usage records `codex-default` instead of the model that actually ran the turn"
workstream: unattached
area: beebox
priority: normal
filed-by: agent
discovered-by: agent
discovered-in: worktree-sdk-update — reviewing Codex 0.153.4
labels: [sdk-update]
---

`codex-chat.ts:185` writes each turn's usage row as:

```ts
model: opts.model ?? "codex-default",
```

So every turn on an unconfigured box records the literal string
`codex-default` rather than the model that answered it.

That was tolerable while the default was stable. It is not, now that keeping the
inherited default is settled policy
([decided 2026-09-05](../closed/decisions/2026-09-04-codex-default-model-becomes-astra.md)):
Codex `0.153.4` changed the bundled default to GPT-6-Astra, and the pin moving
is enough to change which model answers a boxholder's chat. The usage ledger —
the one record that could show the switch, its cost, and where a behavior change
began — writes the same six characters on both sides of it.

**What it costs.** Token usage is already recorded per turn; models differ in
price and in speed. A row that names `codex-default` cannot be priced, cannot be
compared across a pin bump, and cannot answer "when did this box's chats start
behaving differently" — which is exactly the question a default-model change
produces.

**Where the real value is.** The Codex SDK reports the model on the turn (the
session's completed turn carries it), so this is a matter of reading it off the
response rather than reconstructing it from the request. Reconstructing it from
the pin would be wrong for the same reason the sentinel is: it re-derives what
the response already states.

Worth keeping the sentinel's one virtue — a row is still written when the model
is unknown — rather than dropping rows that cannot be attributed.
