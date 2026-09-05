---
title: "Codex 0.153.4 makes GPT-6-Astra the default model, and beebox chats that configure no model ride the default"
workstream: sdk-update
area: beebox
priority: normal
filed-by: agent
discovered-by: agent
discovered-in: worktree-sdk-update — reviewing Codex 0.153.1-0.153.4
labels: [sdk-update]
resolution: wontfix
---

> **Decided 2026-09-05 (boxholder):** inherit the binary's default; Astra as
> the default Codex model is fine. No explicit pin. The Codex pin advances to
> `0.153.4` on the monitor's normal two-day lane (clears 2026-09-06 ~23:30Z).
> The usage ledger's `codex-default` label stays as filed here; not blocking.

All four Codex releases published since the pin are GPT-6-Astra plumbing, and
the last one moves a default:

- `0.153.1` — configure Astra through the API without changing the default model
  or showing it in the picker.
- `0.153.2` — Astra Fast tier description text.
- `0.153.3` — Astra added to the Amazon Bedrock catalogs.
- **`0.153.4` — "Fixed Astra's visibility in the bundled model picker and made it
  the bundled default when no model is explicitly configured."**

beebox has that exact path. `codex-sdk-session.ts:149` spreads the model in only
when the caller supplies one:

```ts
...(options.model === undefined ? {} : { model: options.model }),
```

and `codex-chat.ts` passes `opts.model` straight through. A box whose Codex chat
has no model configured therefore runs on whatever the pinned binary defaults
to. Moving the pin to `0.153.4` moves those chats onto GPT-6-Astra — a different
model, different behavior, different price — with no beebox-side change and no
prompt.

**It would also be nearly invisible after the fact.** `codex-chat.ts:185`
records per-turn usage as `model: opts.model ?? "codex-default"`, so the usage
ledger keeps writing the same string before and after the switch. The one record
that could show which model actually ran a turn is the one that resolves the
default to a literal.

**The decision:** whether beebox should pin an explicit Codex model rather than
inherit the binary's default. Inheriting has been fine while the default was
stable, and it means new defaults arrive for free; but it also means an upstream
hotfix — `0.153.4` is a hotfix — can change which model answers a boxholder's
chat, and the version pin is the only thing standing between the two. Pinning
explicitly makes model changes a beebox decision at the cost of having to track
retirements.

Whichever way that goes, `codex-chat.ts:185` should record the model that
actually ran rather than the sentinel, since that is what makes the question
answerable from the data next time.

Until this is decided, **the Codex pin should not cross `0.153.4` incidentally**
on the settling path. None of the four had settled at the 2026-09-04 turn, so
nothing has moved yet.

Context: the Codex entry in `docs/agent-sdk-notes.md` for `0.153.1`-`0.153.4`.
