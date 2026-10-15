---
title: "A bodied card with an empty body never goes stale when its fields change"
workstream: unattached
area: beebox
filed-by: agent
resolution: implemented
discovered-by: agent
discovered-in: worktree-place-shows-cards — reading `computeContainsBasis` while reviewing journey-walk findings
---

The `contains` staleness check ignores frontmatter fields on any card whose
type has a body field, even when the body is empty. An edit to the fields then
never marks `contains` stale.

## Mechanism

`computeContainsBasis` (`beebox/src/core/search/contains-state.ts:104-123`)
reads the body field. If the value is a string, it hashes only that string
(`:112-114`). It hashes the remaining fields only when the body is not a
string (`:116`), which holds for types with no body field.

A card of a bodied type always has a string body. `parseCardText`
(`beebox/src/core/card-io.ts:141-146`) sets the body field to the parsed
result of `split.body`. `splitCardContent`
(`beebox/src/cards/frontmatter.ts:58`) returns `content.slice(prefixLength)`,
so a card with frontmatter and no body text gives `""`. The body schema parses
`""` to `""`: for example, `inventory` uses `body(z.string())`
(`beebox/src/schemas/inventory.ts:10`). `validateCardBody`
(`card-io.ts:331-351`) returns `undefined` only for types with no body field.

So for a bodied card with an empty body, the basis is the hash of `""`. It
does not change when any frontmatter field changes. The header comment at
`contains-state.ts:11-12` states the rule as "Bodied cards hash their body".
It does not say what happens when the body is empty.

## Affected cards

Types whose real content sits in frontmatter and whose body holds optional
notes. `person` is one: identity, contact info, and aliases are frontmatter
fields, and the body is "notes" (`beebox/src/schemas/person.tsx:3-6`). A
person card without notes never shows `contains` as stale after its fields
change. The same holds for any bodied type left with an empty body.

## Not verified

No test was run. The claim comes from reading the code path above. A test would
write a bodied card with an empty body, record its `contains`, edit a
frontmatter field, refresh the index, and check the stale flag.

## Options

- Hash the canonical fields together with the body for bodied cards.
  `BASIS_EXCLUDED_FIELDS` (`contains-state.ts:47-53`) already removes the
  derived fields. Every existing sidecar entry would re-base once (`STATE_VERSION`
  bump).
- Hash the fields only when the body is empty. This keeps today's basis for
  cards that have a body, so no re-base is needed for them.

The comment at `contains-state.ts:40-46` says the derived-field exclusion is
"policy, not a live bug" for bodied cards. The fix must keep that exclusion.

## Resolution (2026-10-11)

Fixed with the second option: `computeContainsBasis` hashes the fields when
the body is empty or whitespace, and the body otherwise. `STATE_VERSION` went
to 3, so existing sidecars rebuild fresh instead of flagging every empty-body
card stale at once. Doctest: `beebox/test/core/search/contains-update.evidence.doctest.md`.
