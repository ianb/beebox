---
title: "Stack silently does not stack, and the UI primitives push presentation onto every call site"
workstream: unattached
area: beebox
labels: [ui, frontend]
filed-by: agent
discovered-by: Ian
discovered-in: main — after a Codex admin block rendered as one run-together paragraph
---

A review of `beebox/src/frontend/src/components/ui/` prompted by a layout bug
(`b0bd513c8`): the Codex device-code block's prompt, code, link and note all
ran together on one line although the markup was a `Stack` with four children.

## 1. `Stack` does not stack inline children

`Stack` spaces children with Tailwind `space-y-*`
(`components/ui/Stack.tsx:16-22`), which sets top margin on every child after
the first. Margin does nothing to an inline element. `Text` renders a `<span>`
by default (`components/ui/Text.tsx:17`) and links are anchors, so a `Stack`
whose children are all `Text` produces one paragraph of run-together text.

Nothing fails: no type error, no lint, no visual hint in the source. The fix
at each site is to remember `as="p"` on every child.

**Scale:** 164 `<Stack>` call sites. In `components/admin/` alone, 21 have an
inline element as the first child, so each is a candidate for the same defect
(some will look fine by accident — one child, or children that fill the width).

## 2. `Column` already does it correctly, and is barely used

`Column` is `flex flex-col` with real `gap-*`
(`components/ui/Column.tsx:68`), which stacks regardless of what the children
are. It has 13 call sites against `Stack`'s 164. Two components for one
concept, and the dominant one is the broken one.

The cheap repair is to give `Stack` `flex flex-col` and gap classes, making it
correct by construction. That changes how children size themselves (flex items
stretch on the cross axis), so it needs a visual pass over the main pages, not
a blind swap. The durable repair is to keep one of the two.

## 3. Presentation lives at the call sites, not in components

The boxholder's objection: these read as presentational attributes where the
component should own the decision. 484 `<Text>` call sites, and the recurring
combinations are roles, not styling choices:

| Pattern | Sites | The role it encodes |
|---|---|---|
| `size="sm"/"xs"` + `tone="muted"` | 144 | a hint or secondary line |
| `tone="danger"` (with varying size/element) | 74 | an error message |
| `as="h2"/"h3"` + size + weight | 49 | a section heading |
| `as="div" tone="subtle" className="p-8"` | 11 | an empty state |

The inconsistency proves the point: section headings are written both
`as="h2" size="lg" weight="semibold"` (18 sites) and
`as="h2" size="lg" weight="bold"` (10 sites). Nobody decided that; two
spellings of one idea drifted apart because the decision is re-made at every
call site.

Named components — `SectionHeading`, `Hint`, `ErrorText`, `EmptyState` — put
the decision in one place, make the element correct by default (a heading is a
heading, an error message is a block), and leave `Text` for genuine one-offs.
That also removes most of the inline-children trap in §1: a role component
renders the right element without the caller thinking about it.

Supporting evidence that the props do not cover the need: 182 literal
`className="…"` strings in `components/admin/` and `components/settings/`
alone, and 16 `<Stack className="…">`. When a component's API is a set of
knobs, callers reach past it as soon as a knob is missing.

## Sequencing

1. Fix `Stack` itself (flex column), with a visual check of the main pages.
   This closes the silent-failure class.
2. Introduce the role components and convert the four patterns above. Each
   conversion is mechanical and verifiable by grep.
3. Then decide `Stack` versus `Column`; after step 1 they are the same
   component and one should go.

Not proposed here: a general styling-props purge. `Text` still needs its knobs
for the cases a role does not cover, and the boxholder's preference is fewer
invented concepts, so the role set stays small and named after things that
already exist in the UI.
