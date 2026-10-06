---
title: "`MODEL_ID.sonnet` still resolves to `claude-sonnet-5`; Claude Code 2.1.284 made Sonnet 5.5 the default"
workstream: unattached
area: beebox
priority: normal
filed-by: agent
discovered-by: agent
discovered-in: worktree-sdk-update — reviewing Claude Code 2.1.284
labels: [sdk-update]
---

Claude Code 2.1.284: *"Added Claude Sonnet 5.5 (`claude-sonnet-5-5`), now the
default Sonnet model on the Anthropic API — 1M context, $2/$10 per Mtok with
$0.20/Mtok cache reads."*

`beebox/src/shared/model-ids.ts` resolves the alias itself:

```ts
sonnet: "claude-sonnet-5",
```

so a box agent or chat that asks for `sonnet` keeps running Sonnet 5. This is the
same case as `opus` a week ago
([closed](../closed/code-quality/2026-09-22-opus-alias-still-pins-opus-5.md)),
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
