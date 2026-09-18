---
title: "Stack stacks by construction; role components replace recurring Text props"
status: draft
workstream: ui-stack-roles
issues:
  - ../../../issues/code-quality/2026-09-18-stack-and-the-presentational-ui-layer.md
  - ../../../issues/bugs/2026-09-02-admin-available-engines-label-runs-into-description.md
---
# Stack stacks by construction; role components replace recurring Text props

`Stack` silently fails to stack inline children, and `Text` call sites
re-decide the same look (heading, hint, error, loading pane) at every use.
This plan makes `Stack` a flex column, adds four small role components, and
folds `Column` into `Stack`, so one layout component and a few named roles own
decisions that callers currently spell out by hand.

**Issues addressed:**
`issues/code-quality/2026-09-18-stack-and-the-presentational-ui-layer.md`
(the review this plan implements) and
`issues/bugs/2026-09-02-admin-available-engines-label-runs-into-description.md`
(one instance of the Stack defect). Searched the queue for `space-y`,
`<Stack`, `<Column`, "run together", "empty state", "heading weight": no other
matches bear on this work.

## Smallest fix and budget

The smallest fix is Track 1 alone: change `Stack`'s classes from `space-y-*`
to `flex flex-col gap-*`, and repair the call sites where flex stretching or
child margins change the result. About 100 changed lines.

Chosen design, three tracks, all in `beebox/src/frontend/src/`:

| Track | Changed lines (est.) |
|---|---|
| 1. Stack is a flex column | ~100 (Stack.tsx, ~30 `self-start` sites, ~4 margin sites) |
| 2. Role components + conversion | ~1,000 (4 components ~120; ~330 call sites, 1–3 lines each, plus imports) |
| 3. Fold Column into Stack | ~200 (Stack gains Column's props; 16 call sites; delete Column.tsx) |
| Tests | ~80 (one doctest file) |
| Docs (`beebox/frontend.md`) | ~30, reported separately |

Total about 1,400 changed lines. This is under the 2,000-line BIG CHANGE
threshold. The boxholder saw this estimate before conversion and approved the
role names, semibold headings, and keeping `Stack` over `Column`
(workstream session, 2026-09-18).

What the fuller design buys: Track 1 closes the silent-failure class. Tracks 2
and 3 remove the drift that the review measured (two heading weights, two
error sizes, two vertical-layout components) by putting each decision in one
file.

## Stated preferences this plan trades against

- The boxholder's objection, quoted in the issue: *"I'm not a fan of how
  presentational these are in the attributes, seems like more should be built
  into the underlying components"*. Tracks 2 and 3 answer it.
- Minimize invented concepts, prefer platform primitives (boxholder memory).
  The role names follow HTML/ARIA: `Heading` renders `h2`/`h3`,
  `StatusMessage` renders `role="status"`. The set stays at four.
- Consolidate over blast-radius fear (boxholder memory). Track 3 removes
  `Column` although it touches every `Column` call site.
- `beebox/frontend.md:180-186` *"Adding a new UI primitive … Is the pattern
  used 3+ times with uniform look? If so, extract a primitive."* Every role
  has 10+ uniform sites.
- Components own their accessibility elements (boxholder memory and
  `bbx-frontend`: *"A component that is a nav, a region, or a list renders its
  own …"*). `Heading` renders a real heading; `StatusMessage` owns its
  `role="status"`.

## What already exists

- `components/ui/Stack.tsx:16-22` — `GAP_CLASSES` maps gaps to `space-y-1`
  … `space-y-4`. Rebuild in place (Track 1).
- `components/ui/Column.tsx:68` — `"flex flex-col"` with `gap-*`, `align`,
  `overflow`, `hideOnMobile`, `focusable`. Its props move into `Stack`
  (Track 3); its `OVERFLOW_CLASSES` comment on `relative` moves with them.
- `components/ui/Text.tsx:83` — `as = as ?? "span"`. `Text` stays; the role
  components render their own elements and do not wrap `Text` (wrapping would
  expose `Text`'s knobs again).
- `lib/cn.ts` — `cn()` with `tailwind-merge`; caller `className` wins
  (`frontend.md:163`). The role components use it, so a caller's `p-4`
  overrides `StatusMessage`'s default padding.
- `eslint.config.ts:148-158` — `restrict-component-classes` limits
  `className` outside `components/` to outer layout. `self-start` is a flex
  item class and passes.
- `test/frontend/components/image.doctest.md` — renders a primitive with
  `renderToStaticMarkup` and asserts on markup. The new doctest reuses this
  pattern.
- `test/tours/nav-pages.tour.ts`, `browse-walk.tour.ts`,
  `workspace-panes.tour.ts` — tours that capture desktop and mobile
  screenshots. The visual pass runs them before and after Track 1.

Searched `src/frontend/src` for existing `Heading`, `SectionHeading`,
`EmptyState`, `Hint`, `ErrorText`, `ErrorMessage` components: none exist.

## Prior art (external)

One external premise matters: flex items stretch on the cross axis by default
(`align-items: normal` behaves as `stretch`), and absolutely positioned or
`display: none` children do not take part in `gap`.
https://developer.mozilla.org/en-US/docs/Web/CSS/align-items and
https://developer.mozilla.org/en-US/docs/Web/CSS/gap. Margins of flex items do
not collapse, so a child's own `mt-*`/`mb-*` adds to the gap. Tailwind's
`space-y-*` targets `:not([hidden]) ~ :not([hidden])` and so overrides a
non-first child's own `mt-*` today; under `gap` that `mt-*` starts to apply.

## Tracks / scope

### Track 1 — Stack is a flex column

- **What.** `Stack` renders `flex flex-col` plus `gap-1/2/3/4`, with the
  same `gap` and `as` props.
- **Why.** `space-y-*` is top margin, and top margin has no effect on an
  inline element. A `Stack` of `<Text>` spans renders one run-together line
  (`b0bd513c8`; `issues/bugs/2026-09-02-…`). An AST audit
  (`scratch/stack-audit.ts`, 189 `<Stack>` elements) found 82 with an inline
  direct child: 58 `Text` spans, and 24 inline-level controls (`Button` ×11,
  `ExternalLink` ×7, `button` ×4, `StatusBadge` ×3, `code` ×4, `Link` ×2,
  `TextLink`, `label`).
- **Direction.** Default cross-axis alignment is `stretch`, the flex
  equivalent of block flow, so block children (cards, fields) keep their full
  width. The consequence is that inline-level controls now stretch to full
  width. Each such site gets `className="self-start"` on the child, or the
  children move into a `Row` when they belong on one line. The audit's list
  is the work list; the tours confirm it. Child `mt-*`/`mb-*` inside a Stack
  (4 sites) are removed or changed to the intended gap. The 3 Stacks whose
  own `className` includes flex-item classes (`flex-1 min-w-*`) need no change:
  those classes size the Stack in its parent.
- **Vocabulary lock-ins.** None. The props do not change.
- **First chunk.** Change `Stack.tsx`; fix the audit's inline-control and
  margin sites; take before/after tour screenshots; revert the local
  `as="p"` workarounds only where they are now redundant (they are harmless,
  so leave them if unsure).

### Track 2 — Role components

- **What.** Four components in `components/ui/`, then a codemod that
  converts the call sites whose props match a role exactly.
- **Why.** The review counted the recurring combinations (re-counted
  2026-09-18): 53 `h2`/`h3` headings in two weights (`h2 lg semibold` ×22,
  `h2 lg bold` ×10); 96 `tone="danger"` sites, 34 of them spans; ~70
  `size="sm" tone="muted"` block hints; ~15 `as="div" tone="subtle" p-4/p-8`
  panes, most of which say "Loading…".
- **Direction.**

  | Component | Props | Renders |
  |---|---|---|
  | `Heading` | `level: 2 \| 3`, `children`, `className?` | `h2`: `text-lg font-semibold text-warm-900`; `h3`: `text-sm font-semibold text-warm-900` |
  | `Hint` | `children`, `className?` | `<p class="text-sm text-warm-500">` |
  | `ErrorText` | `children`, `className?` | `<p class="text-sm text-danger-dark">` |
  | `StatusMessage` | `children`, `className?` | `<div role="status" class="p-8 text-warm-600">` |

  The caller chooses only the heading level, which is document structure.
  The look follows the level. Bold `h2` headings become semibold.
  All `danger` errors become `text-sm`; ten `as="p"` base-size errors shrink
  one step.

  Conversion rules (codemod over the TypeScript AST, exact prop sets only):
  - `Text as="h2" size="lg" weight="semibold|bold"` → `Heading level={2}`;
    `Text as="h3" size="sm" weight="semibold"` → `Heading level={3}`.
    `className` is kept. Any other prop (tone, uppercase, center, a computed
    size) leaves the site as `Text`.
  - `Text size="sm" tone="muted"` (any `as` of span/p/div) → `Hint`, only in
    block context: the parent element is `Stack`, `Column`, `Card`, `div`,
    `section`, `li`, `form`, or a fragment/return root. Inside `Row`, `span`,
    `button`, `label`, `p`, or another `Text`, the site stays `Text`.
    `size="xs" tone="muted"` stays `Text`: those are mostly inline metadata.
  - `Text tone="danger"` with only `size`, `as`, `className` → `ErrorText`,
    with the same block-context rule.
  - `Text as="div" tone="subtle" className="p-4|p-8"` whose text is a
    loading, empty, or not-found message → `StatusMessage`. Pane-level
    errors in this shape become `ErrorText` instead.
  The codemod prints every skipped near-match so they can be judged by hand.
- **Vocabulary lock-ins.** `Heading`, `Hint`, `ErrorText`, `StatusMessage`,
  and `Heading`'s `level` prop. Documented in `beebox/frontend.md` under
  Display.
- **First chunk.** Add the four components and their doctest; convert
  headings.

### Track 3 — Fold Column into Stack

- **What.** `Stack` gains `align`, `overflow`, `hideOnMobile`, `focusable`
  from `Column`; the 16 `<Column>` sites become `<Stack>`; `Column.tsx` is
  deleted.
- **Why.** After Track 1 they are one component with two names.
- **Direction.** `Stack`'s `gap` default stays `"md"`. `Column`'s default was
  `"none"`, so a converted site with no `gap` gets `gap="none"` explicitly.
  `as` stays on `Stack`; `focusable` sets `tabIndex` on whatever element
  `as` selects. `frontend.md`'s Stack/Column entries become one entry.
- **Vocabulary lock-ins.** `Column` is removed from the primitive catalog.
- **First chunk.** Move the props, convert the sites, delete the file.

## Could this be simpler?

The simplest version is Track 1 alone. It fixes every run-together Stack. It
does not fix the drift: headings keep two weights, errors keep three sizes,
and the next heading written by hand re-decides the look. Per the boxholder's
stated objection, the decision belongs in the component, so Track 2 stays.

A cruder Track 2 would add a `role` prop to `Text` (`<Text role="hint">`).
That is one more knob on the component the boxholder called too
presentational, and it cannot make a heading's level required. Separate
components can.

Track 3 could wait. Keeping both names means every future caller picks between
two identical components, which is the drift this plan exists to remove.
It is ~200 lines, so it stays.

## Subplans

None. The role names and the Stack/Column choice were settled with the
boxholder before this plan was written.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| A `Button`/link directly in a `Stack` stretches to full width after Track 1 | Tour screenshots (Track 1) | Audit list + `self-start` per site | Visible in screenshots; silent in tests |
| A child's own `mt-*` inside a `Stack` now adds to the gap | Audit flags 4 sites | Fixed per site | Visible |
| A `Stack` with fixed height and many children: flex items do not shrink below content (`min-height: auto`) | No | Same as `Column` today, which has no reports | Visible (overflow) |
| Codemod converts a `Hint`/`ErrorText` inside inline context, producing `<p>` inside `<span>`/`<p>` | Parent-context rule; React warns on invalid nesting in dev | Codemod skips non-block parents | React dev warning; would be silent in prod |
| A converted `h2` was intentionally bold for emphasis | No | Accepted: boxholder chose semibold | Visible, minor |
| `StatusMessage` given to an error pane, announcing an error as polite status | No | Codemod routes panes by text; manual review of the list | Silent |
| A `Column` site relied on `gap="none"` default and gains `md` gap | Codemod adds `gap="none"` | Yes | Visible |
| Stale `space-y-*` on a Stack's `className` doubles spacing with `gap` | grep before/after | Removed per site | Visible |

No critical gap: every silent row has handling in the codemod or a manual
review step.

## Agent-flow / user-flow edge cases

- **Wrong one of two similar things.** ADDRESSED by Track 3: one vertical
  layout component remains. `Hint` versus `Text size="xs" tone="muted"` is
  a remaining choice; `frontend.md` states when each applies.
- **Stale ref.** Not applicable: no card or data references.
- **Two agents on the same card.** Not applicable: frontend components only.
- **Hand-edit drift.** A future author can still write
  `<Text as="h2" size="lg" weight="bold">`. See NOT in scope (enforcement).
- **Fabricated free-form value.** Not applicable.
- **Validation error UX.** `Heading`'s `level` is a required union
  `2 | 3`; a missing or wrong level is a type error at the call site.
- **Partial migration.** Each track leaves the tree correct at every commit:
  roles coexist with `Text`, and Track 3 converts and deletes in one commit.

## NOT in scope

- A general purge of `Text`'s styling props. `Text` keeps its knobs for sites
  no role covers (per the issue).
- `h1` page titles (12 sites, five looks). They are a separate role
  (page title) with no majority look; converting them means choosing one.
- `size="xs" tone="muted"` metadata text. It is mostly inline beside other
  content; a role for it is a separate decision.
- Enforcement that stops new hand-written headings (removing `h2`/`h3` from
  `TextAs`, or a lint rule). Some variant headings (uppercase small labels,
  danger headings) still need `Text`. Revisit once the variants are counted
  after conversion.
- `role="alert"` on `ErrorText`. Many error texts render on mount with the
  page; an alert on each would interrupt screen-reader users. Live-region
  behavior belongs to the component that knows the error is new.
- The 182 literal `className` strings in `admin/` and `settings/`. They
  are evidence for the review, not part of this change.

## Open design questions

None open. Settled with the boxholder 2026-09-18: role names as in Track 2;
headings semibold; `Stack` survives, `Column` goes.

## Knowledge audits

Skipped: this is dev-repo frontend code. Box agents never see these
components, so no box-loaded guidance changes.

## What will hold this after it ships

- `test/frontend/components/stack-and-roles.doctest.md` renders `Stack` and
  each role with `renderToStaticMarkup` and asserts the element and classes:
  `Stack` has `flex flex-col` and a `gap-*` class and no `space-y`; `Heading
  level={2}` renders `<h2`; `Hint` and `ErrorText` render `<p`;
  `StatusMessage` has `role="status"`; `Stack focusable` has `tabindex="0"`.
- The weekly tours (`nav-pages`, `browse-walk`, `workspace-panes`) keep
  screenshots of the main pages; their reviews caught the 2026-09-02 instance.
- Typecheck enforces `Heading`'s `level`.

## Implementation order

1. Track 1: `Stack.tsx`, audit-listed sites, tour screenshots before and
   after. Commit.
2. Track 2a: four components, doctest, `frontend.md`. Commit.
3. Track 2b: codemod conversions, one commit per role, each with the
   skipped-near-match list reviewed.
4. Track 3: fold `Column` into `Stack`. Commit.
5. Tour screenshots again; exhibit to the boxholder (`confirm`).
6. Cross-model review of the branch diff.

## Rollout shape

Done when: the new doctest passes; `pnpm typecheck` and frontend ESLint pass;
the tours run clean and the before/after screenshots show no unintended
change besides the fixed run-together text, full-width controls restored to
natural width, and the chosen heading weight and error size. No data
migration. No knowledge audits. The plan ships in one piece through `/finish`.
