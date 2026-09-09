---
title: System theme selection and landmark overrides
status: active
workstream: paper-cards
issues: []
---
# System theme selection and landmark overrides

Add user-facing system-theme selection at box and landmark scope. A system theme
styles the toolbar, shared desk, chat slips, and floating system controls. A
card's theme remains independent.

## Stated preferences this plan trades against

The requested hierarchy is landmark override, box default, then built-in default.
The selection capture button belongs to the system theme and should feel raised.
Theme choices need visual swatches. Inspecting a card must not silently change the
current landmark or conversation. Existing box configuration remains compatible.

## What already exists

`src/shared/card-theme.ts` declares `chrome: true` for Plain and Paper, and
`chrome: false` for Sticky note. `PresentationConfigSchema` already accepts
`chrome: ThemeChoiceSchema.optional()`. Keep that stored name for compatibility;
use “System theme” in the interface and documentation.

`src/frontend/src/components/themes/ThemeSwatchPicker.tsx` is the card-specific
picker: `trpc.card.setTheme.useMutation`. `SettingsPage.tsx` composes settings
sections but has no appearance section. `BoxPresentationProvider.tsx` owns the
system material attributes. `SelectionCapture.tsx` now carries
`bbx-system-control`; `themes/chrome.css` gives it the system Paper material.

## Prior art (external)

No external dependency or design framework is needed. Extend the existing theme
catalog, material CSS, settings sections, and card Properties pattern.

## Tracks / scope

- Add optional landmark `system-theme: {name, stock?}`. This differs from its
  ordinary `theme`, which styles the landmark card itself.
- Extend presentation queries with an optional current directory. Resolve its
  nearest landmark and that landmark's override; otherwise use the box result.
  A nearest landmark with no override uses the box, not another landmark's value.
- Add owner-only box and landmark mutations using existing safe config/card
  update paths, preserving unrelated settings and reporting persistence failures.
- Add system swatches in box Settings and landmark Properties. Show inheritance,
  loading/saving failures, and a reset choice.
- In a workspace, derive the theme location from the selected conversation's
  context directory. In Browse use the browsed directory; global pages use the
  box default. Changing the inspected card never changes this input.
- Refetch on relevant configuration, schema, and landmark file changes.

## Could this be simpler?

Configuration-only support already exists for boxes but cannot satisfy the
requested user selection. A shared swatch picker and two existing edit surfaces
avoid a new settings route, theme registry, or independent global state owner.

## Subplans

This is a bounded extension to the existing card-theme and workspace work. No
further subplans are needed.

## Failure modes

Unknown themes, stocks, or non-system themes must not be silently written.
Malformed persisted overrides remain visible as problems with a safe fallback.
A failed write must retain the previous selection and expose retry/error state.
Non-owners cannot mutate themes. Invalid or escaping landmark paths are rejected.
Changing a card's appearance must not overwrite its landmark's system appearance.

## Agent-flow / user-flow edge cases

The box agent can edit the documented optional field. Absence means inheritance.
The UI should label Paper's system palettes by their visible colors while keeping
existing stock identifiers on disk. Reset removes only the scoped override.
Current theme location stays stable when chat is ambient or cards move/focus.
A landmark edit must refresh the active system even when that landmark's card is
not the foreground card. Root landmarks use the existing root-directory mapping.

## NOT in scope

No renamed stored `chrome` field, theme package loader, automatic ancestor-theme
cascade, landmark creation flow, new saved workspace, or changes to conversation
routing. The proposed alternate right edge for detached user messages remains a
separate visual choice; this extension does not implement it.

## Open design questions

None block implementation. Existing Plain and Paper families provide the initial
system choices; more families can be added through the same catalog capability.

## Review adjudication

Two cross-model rounds reviewed the implementation. The first found that strict
system-theme validation could erase a landmark's other roles, malformed overrides
could not be reset from the picker, nearest-landmark resolution repeated scanning
and parsing work, and workspace chrome could briefly use the box theme before its
conversation resolved. The implementation now preserves landmark roles while
reporting an invalid system theme, reports override presence separately from a
valid choice, reuses nearest-directory selection with one scan and parse, and
suppresses the presentation query only while conversation selection is resolving.
An unavailable conversation falls back to the box theme instead of leaving the
query disabled. Box-level diagnostics avoid attributing an invalid presentation
subtree to a valid system-theme override.

## Validation

- Backend and frontend type checks and focused ESLint passed.
- The presentation doctest covers resolution, malformed overrides, owner-only
  mutation, scoped reset, and preservation of unrelated configuration/card data.
- The landmark system-theme knowledge audit passed.
- Desktop and mobile tour checkpoints completed with no findings or accessibility
  violations.
- Browser verification showed a malformed landmark stock retaining its landmark
  navigation, rendering a Plain fallback and visible diagnostic, enabling reset,
  removing only the invalid field, and restoring the inherited Slate theme. The
  theme-tour fixture was restored to its Paper Blue override afterward.

## Knowledge audits

Document the landmark field and the distinction from card theme in the existing
on-demand card-theme guide. Keep schema instructions short and link that guide;
exercise this distinction through a targeted knowledge audit if prompt wording
changes beyond that field-level pointer.

## What will hold this after it ships

Focused schema/resolution/router tests cover fallback, unsupported choices,
permissions, persistence, and preservation of unrelated fields. Browser checks
cover box swatches, landmark override/reset, active-location stability while
inspecting cards, and narrow-screen layout. Capture visual evidence in an exhibit.
Cross-model review checks the final code against these ownership boundaries.

## Implementation order

Backend schema/resolution and frontend picker work proceed independently behind
one agreed API. Integrate active-location resolution, update documentation, then
run focused tests, typechecks/lint, real browser checks, and cross-model review.

## Rollout shape

The user authorized implementation. This is additive, with no card-file migration.
Keep it in the paper-cards worktree until a separate landing request. Existing
box choices and existing cards without the field continue loading normally.
