---
title: "`MODEL_ID.opus` still resolves to `claude-opus-5`; Claude Code 2.1.280 made Opus 5.5 the flagship"
workstream: unattached
area: beebox
priority: normal
filed-by: agent
discovered-by: agent
discovered-in: worktree-sdk-update — reviewing Claude Code 2.1.280
labels: [sdk-update]
---

Claude Code 2.1.280: *"Added Claude Opus 5.5 (`claude-opus-5-5`), now the
default Opus model — 1M context, $4/$20 per Mtok with $0.20/Mtok cache reads."*

beebox resolves its `opus` alias itself, in `beebox/src/shared/model-ids.ts`:

```ts
opus: "claude-opus-5",
```

and passes the explicit id to the SDK, so a box agent or chat that asks for
`opus` keeps running on Opus 5 while Claude Code's own `opus` now means Opus 5.5.
The file's header states the intended contract: "`opus` tracks the current Opus
flagship — now Opus 5". By that contract the table is stale.

**The change:** point `MODEL_ID.opus` at `claude-opus-5-5`, and add
`claude-opus-5` to the table's legacy-id map beside the existing
`claude-opus-4-8` entries so stored selections of the old id normalize to the new
flagship the way earlier ones did. The frontend imports these values directly, so
the picker follows automatically.

**Worth checking while there:** paths that leave the model unset
(`claude-chat.ts` sets `model` only when a caller supplies one) inherit Claude
Code's default instead — which 2.1.280 also changed, moving Pro and Team Standard
plans from Sonnet to Opus. Accounts already on Opus by default are unaffected.
