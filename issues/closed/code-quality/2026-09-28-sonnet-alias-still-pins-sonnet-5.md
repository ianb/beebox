---
title: "`MODEL_ID.sonnet` still resolves to `claude-sonnet-5`; Claude Code 2.1.284 made Sonnet 5.5 the default"
workstream: unattached
area: beebox
priority: normal
filed-by: agent
discovered-by: agent
discovered-in: worktree-sdk-update — reviewing Claude Code 2.1.284
labels: [sdk-update]
resolution: implemented
---

**Closed 2026-10-17:** all three aliases moved. `sonnet` → `claude-sonnet-5-5` ("The sonnet alias names Sonnet 5.5"); `haiku` → `claude-haiku-5-5` and `sol` → `gpt-6.1-sol` ("The haiku and sol aliases name Haiku 5.5 and GPT-6.1 Sol"). The retired ids `claude-sonnet-5`, `claude-haiku-4-5-20251001`, and `gpt-6-sol` normalize to the new ones in `beebox/src/shared/model-ids.ts`. `gpt-6.1-sol` is in the pinned Codex binary's catalog and answered a `codex exec` on 2026-10-17; `claude-haiku-5-5` was verified on 2026-10-09 (below). Dev tooling keeps its own Codex default (`bin/cross-model-run.ts`, `gpt-6-sol`), which this issue does not cover.

Claude Code 2.1.284: *"Added Claude Sonnet 5.5 (`claude-sonnet-5-5`), now the
default Sonnet model on the Anthropic API — 1M context, $2/$10 per Mtok with
$0.20/Mtok cache reads."*

`beebox/src/shared/model-ids.ts` resolves the alias itself:

```ts
sonnet: "claude-sonnet-5",
```

so a box agent or chat that asks for `sonnet` keeps running Sonnet 5. This is the
same case as `opus` a week ago
([closed](../2026-09-22-opus-alias-still-pins-opus-5.md)),
which moved `opus` to `claude-opus-5-5`.

**No pin dependency.** Probed 2026-09-28 on the current pin (`0.3.283`, bundled
CLI 2.1.283): a `query()` with `model: "claude-sonnet-5-5"` started on that model
and answered normally. Unlike Opus 5.5, which needed the pin raised to `0.3.280`
first, the table can move now.

**The change:** point `MODEL_ID.sonnet` at `claude-sonnet-5-5` and add
`claude-sonnet-5` to the legacy-id map so stored selections normalize to it, as
the Opus change did.

## Codex side (2026-09-29)

Codex `0.159.1` makes GPT-6.1 Sol the default in its bundled catalog, while the
same table resolves `sol` to `gpt-6-sol`. Worth settling in the same change;
the Codex pin reaches `0.159.1` no earlier than 2026-10-01.

**2026-10-07:** Claude Code 2.1.293 adds Claude Haiku 5.5 (`claude-haiku-5-5`)
and makes it the default Haiku on the Anthropic API. The `haiku` alias in
`beebox/src/shared/model-ids.ts` still pins `claude-haiku-4-5-20251001`. Check
that `claude-haiku-5-5` runs on the pin before moving the alias; the Agent SDK
pin reaches 2.1.293 no earlier than 2026-10-09.

**2026-10-09:** `claude-haiku-5-5` verified on Agent SDK `0.3.293` (bundled
Claude Code 2.1.293): a `query()` with `model: "claude-haiku-5-5"` answered
from that model with a `success` result. Codex `0.161.0`, now pinned, makes
GPT-6.1 Sol its bundled default.

**2026-10-17:** Sonnet done on the bug-burndown branch ("The sonnet alias
names Sonnet 5.5"): `MODEL_ID.sonnet` is `claude-sonnet-5-5`, `claude-sonnet-5`
normalizes to it, and the picker reads "Sonnet 5.5". The `haiku` and `sol`
aliases are unchanged and keep this issue open.
