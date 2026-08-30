---
title: "Two vocabularies for how input arrived: emission `origin: typed|voice` vs memo `source: text|voice|email`"
workstream: dev-comments
area: beebox
needs: [decision]
filed-by: agent
discovered-by: Ian
discovered-in: worktree-dev-comments — aligning the document-comments schema with the box's
labels: [vocabulary]
---

The box describes "how did this text arrive" in two places, with two field names
and two spellings of the same value:

| Where | Field | Values |
|---|---|---|
| Interactive input / emission | `origin` | `typed` \| `voice` |
| Memo cards | `source` | `text` \| `voice` \| `email` \| … |

Emission: `src/frontend/src/input/emission.ts:44`, mirrored at
`src/frontend/src/components/chat/native-emission.ts:16` and
`src/frontend/src/lib/chat-send-diagnostics.ts:150`, and on the wire at
`docs/mobile-contract.md:262` (*"an unknown/absent `origin` coerces to
`typed`"*). Memo: `src/schemas/memo.ts:42,55` — *"`source:` — origin of the memo:
`text`, `voice`, `email`"*, whose own prose calls the field "origin" while the
field is named `source`.

`voice` is the one token that holds across both. `typed` and `text` mean the
same thing and are spelled differently.

## Why it is worth settling rather than tolerating

Neither is wrong in isolation, and they are arguably different concepts — an
emission is one interactive act, a memo's `source` is a provenance class that
also covers `email` and has no interactive sense. But an agent writing a new
surface has to pick one and has no rule for choosing, which is how a third
spelling gets added. That already nearly happened: the dev-repo
[document-comments](../../beebox/docs/plans/document-comments.md) plan
initially invented `kind: typed | spoken`, a third field name and a third value
word, before being aligned to the emission model.

## What a decision would look like

- **Leave it, and write the rule down.** They are different concepts: `origin`
  for an interactive act, `source` for an artifact's provenance class. Cheapest,
  and mostly needs a line in `docs/glossary.md` so the next agent chooses
  deliberately instead of guessing.
- **Converge the value words** (`text` → `typed` in memo, or the reverse) and
  keep the two field names. A card-shape change, so it needs a migration.
- **Converge fully.** Almost certainly not worth it — `source: email` has no
  emission counterpart.

Filed rather than fixed: this is a vocabulary decision for the boxholder, and no
current behaviour is broken by it.
