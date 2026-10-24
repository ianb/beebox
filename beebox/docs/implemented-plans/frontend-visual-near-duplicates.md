---
title: "Merge the frontend's visual near-duplicates onto shared primitives"
status: implemented
workstream: dup-sweep-frontend
issues:
  - ../../../issues/closed/code-quality/2026-10-23-frontend-visual-near-duplicates.md
  - ../../../issues/code-quality/2026-10-23-frontend-smaller-near-duplicates.md
---
# Merge the frontend's visual near-duplicates onto shared primitives

The duplication sweep filed seven groups of repeated markup that look different
today, and a list of small behavior differences. The boxholder reviewed them in
an exhibit (2026-10-23, "Repeated pieces of the interface: what differs
today", figures A–G and Part 2) and chose what to merge. This plan carries out
those choices.

**Issues addressed:** the two in frontmatter. The smaller-near-duplicates issue
is only partly addressed (Part 2 rows not chosen stay open; see NOT in scope).

## Design

No design section: the visual choices were made by the boxholder on the
exhibit. Their answers (2026-10-23, quoted):

- A notice boxes: *"merge them, obviously different warning and error but same
  style. A12 is okay for instance."*
- B dialogs: *"merge"*. C pills: *"merge"*. D groups: *"Merge to D1 probably"*.
  E loading text: *"merge (no real preference)"*.
- F icon buttons: *"F1 or F4, depending on situation"*.
- G copy feedback: *"merge … maybe G1."*
- Part 2: confirmed on a follow-up question: *"Fix those three"* (capture
  wording, History image list, chip link encoding).
- B3–B5 modality, follow-up question: *"Native modal too"*.

Agent interpretations stated to the boxholder before planning: A follows the
A12 look without its drop shadow (the shadow marks a floating toast); B keeps a
dark tone for the capture-mode dialog that sits over the camera; D leaves the
Settings accordion (D4) alone; F adds a bubble variant to `CloseButton` for
attachment chips and uses the plain look elsewhere, all with an accessible
name.

## Smallest fix and budget

| Track | Changed lines (source + tests) |
|---|---|
| A Notice | 200 |
| B Dialog shell | 450 |
| C Phase pills | 120 |
| D Group rows | 200 |
| E Loading and empty text | 150 |
| F Icon buttons | 100 |
| G Copy flash | 120 |
| P Part 2 fixes | 150 |
| Total | about 1,500 |

Under the BIG CHANGE line. Before/after screenshots go in one exhibit; no docs
beyond this plan.

## Stated preferences this plan trades against

- Root `AGENTS.md`: reuse the existing primitive before inventing one. A, C, E,
  F and G extend `components/ui/` primitives that exist (`StatusMessage`,
  `Badge`, `CloseButton`, `Button`); B reuses `hooks/useModalDialog.ts`.
  `Notice` (A) and `ModalCard` (B) are new because no primitive exists.
- The theme studio depends on `bbx-` ids and ARIA (the sweep brief); every
  existing `bbx-` id stays on the same control.
- Boxholder memory "Minimize invented concepts": one new primitive per group,
  no variant matrix beyond the tones the figures show.

## What already exists

- `components/ui/ErrorText.tsx:15` (a red text line), `components/ui/ToastViewport.tsx:34`
  (A12: *"bg-danger-50 border border-danger-light text-danger-dark rounded-lg shadow-lg px-4 py-3 flex items-start gap-3 text-sm"*).
- `components/ui/StatusMessage.tsx` (`role="status"`, default `p-8`).
- `components/ui/Badge.tsx` tones neutral/info/success/warning/danger/accent.
- `components/ui/CloseButton.tsx` (aria-label, sizes sm/md, `onDark`).
- `components/ui/Button.tsx` `flash` (2000 ms label swap; no failure state).
- `hooks/useModalDialog.ts` (native `<dialog>`, focus restore) used by
  `DeleteChatDialog`, `CardActions`, `ImageLightbox`.
- `components/chat/InteractiveChat-layout/RemoveBubble.tsx` (F1, title only).
- `components/landmarks/ChevronIcon.tsx` (D chevron).

## Prior art (external)

No decision depends on an external premise. Native `<dialog>` `showModal()`
already ships in the app (`ImageLightbox`, `DeleteChatDialog`).

## Ontology

New nouns: **Notice** (an inline bordered message with tone `warning` or
`error`; not a toast, not a field error); **ModalCard** (the card inside a
modal `<dialog>`: title, body, action row; tone `light` or `dark`). Existing
nouns keep their names.

## Tracks / scope

### A — Notice

- **What:** `components/ui/Notice.tsx`, `tone: "warning" | "error"`. Classes from
  A12 minus `shadow-lg` (warning text is `text-warm-800`, not
  `text-warning-dark`: `InteractiveChat-layout/view.tsx:42` records the latter
  at 3.3:1 on `bg-warning-50`, below AA): `rounded-lg border px-4 py-3 text-sm`, warning
  `bg-warning-50 border-warning-light text-warm-800`, error
  `bg-danger-50 border-danger-light text-danger-dark`. `role="alert"` for error,
  `role="status"` for warning. Accepts `id` and `className` (layout only).
- **Callers:** the issue's list: `DriveMountForms.tsx:21`, `DriveMountRow.tsx:211`,
  `DriveSection/view.tsx:43`, `CalendarSection.tsx:80`, `PdfStatusNotice.tsx:41`,
  `GoogleServicesSection/view.tsx:100,128,173,183`, `GmailFiltersSection/view.tsx:73,227`,
  `ClaudeCodeSection.tsx:89`, `NotificationsSection/view.tsx:170`,
  `FigureView/view.tsx:158`, `chat-delete/ArchiveChatSection.tsx:51`. Keep each
  existing `id` (e.g. `bbx-admin-google-drive-docs-api`). The toast keeps its
  own shadow and position but takes its colors from the same tone map.
- **First chunk:** `Notice` with a DOM test of tone → role and classes.

### B — Dialog shell

- **What:** `components/ui/ModalCard.tsx`: renders a native `<dialog>` opened
  through `useModalDialog`, with the B1 card surface and sizing (`rounded-lg
  bg-white p-5 shadow-xl backdrop:bg-black/60`, the B1 size rules). Callers
  supply their own heading, body and action layout (B1 reverses its buttons on
  mobile, B4 stacks full-width choices, B5 has none). Props: `open`,
  `labelledBy` id, `tone: "light" | "dark"`, `onCancel`, `onBackdropClick`,
  `initialFocus`, `id`.
- **Cancellation contract, per caller:** the native `cancel` event (Escape) is
  the one Escape path; `ModalCard` calls `preventDefault` and then `onCancel`.
  B1 and B2 pass an `onCancel` that ignores Escape while their mutation is
  pending (today's rule, `DeleteChatDialog.tsx:76`, `CardActions.tsx:94`). B3's
  `onCancel` and `onBackdropClick` call `decline`, which must check its
  once-only guard before posting (move the guard ahead of `declineViaPopup`,
  `ScreenshotConsentPopup.tsx:63`); its `useDismiss` is removed. B4 passes no
  `onCancel`: Escape does nothing, as today (only resume, submit or discard).
  B5's input-level Escape handler is removed; `onCancel` closes.
- **Control ids:** B4 and F2 keep their `includeControlIds` switch (dev
  specimens render without ids); tests cover both.
- **Callers:** B1 `DeleteChatDialog`, B2 `CardActions` trash confirm, B3
  `ScreenshotConsentPopup` (Escape and click-away still decline; it gains the
  native focus trap), B4 `CaptureResumeDialog` (`tone="dark"`), B5
  `QuickSearchOverlay` (its result list and Escape-to-close stay; the card
  takes the shell's look).
- **Behavior changes (intended):** B3–B5 become native modals: focus is trapped
  and returns to the opener on close; the page behind is inert. B3 and B5 drop
  their custom backdrops for the shell's. Click on the backdrop closes B3 and B5
  as today (the shell exposes `onBackdropClick`).
- **First chunk:** `ModalCard` with a DOM test (opens, Escape calls `onCancel`,
  backdrop click calls `onBackdropClick`, focus restores); convert B1 and B2.

### C — Phase pills

- **What:** one phase → tone map in `components/history/HistoryViewCard/phase-tone.ts`
  covering both vocabularies seen in C1 and C2 (intake, transcribe, summarize,
  extract, archive, refresh, triage, analyze, brief); unknown phases neutral.
  C1, C2 and C3's phase chip render `<Badge size="sm" tone=…>`. C3's tick chip,
  C4 file-stat pills, C5 and C6 move onto `Badge` tones (raw blue and violet
  become `info` and `accent`).
- **First chunk:** the map with a test; C1 and C2 on it.

### D — Group rows

- **D3 contracts to keep:** `defaultOpen`, an actionable "+N more" (`onMore`),
  external links, missing-link marking, link detail text, in-pane navigation,
  and "None yet" (`LandmarkSection.tsx:188-300`). The shared rows take a child
  renderer and an optional `onMore`; D3's child renderer keeps the tile's
  contents in a D1-style row. Removing tile detail is not intended.
- **What:** `components/landmarks/LandmarkGroupRows.tsx` from D1
  (`PlacePill-here.tsx` HereGroupRows): header row with chevron, label, count;
  indented children with a left rule; "+N more". Props: the group, the child
  row renderer. D2 (`LandmarkLinksPanel` MenuGroup, `py-3.5`) and D3
  (`LandmarkSection` LandmarkGroup) use it. D3's link tiles become D1-style
  rows. D4 Accordion unchanged.
- **First chunk:** extract from D1 with no visible change; then D2; then D3.

### E — Loading and empty text

- **What:** `StatusMessage` gains `variant: "pane" | "menu"`. `pane` keeps
  `p-8 text-warm-700`; `menu` is the E1 row `px-3 py-2 text-sm text-warm-700`.
  Both keep `role="status"`. E1–E4 use `menu`; E5–E10 use `pane`; E11's pulse
  is dropped for `pane`. E4's folder icon stays as a child.
- **First chunk:** variant and test; E1–E4.

### F — Icon buttons

- **What:** `CloseButton` gains `variant: "plain" | "bubble"`; `bubble` is the F1
  look (20 px red circle, white ×, positioned by the caller's `className`).
  `RemoveBubble` is deleted; its callers use `CloseButton variant="bubble"
  label="Remove attachment"` (or "Remove selection"). F2 dictation cancel (both
  desktop and mobile ids) and F3 keyboard close use plain `CloseButton` with
  their ids and labels ("Cancel dictation (Esc)", "Close keyboard").
- **Behavior change:** each gains an accessible name; F2 and F3 change look.

### G — Copy flash


- **What:** `Button`'s `flash` gains `failLabel`: when `onClick` rejects, the label
  shows `failLabel` for the same 2000 ms. `PropertiesFace.tsx:111` CopyButton and
  `SourceViewOverlay.tsx:167` use `Button` with `flash={{ label: "Copied",
  failLabel: "Copy failed" }}`. SourceViewOverlay's copy now reports a failure
  instead of swallowing it. Both handlers return the clipboard promise (today
  they return void, `PropertiesFace.tsx:114`); `Button` treats a synchronous
  throw as a rejection; the flash label sits in an `aria-live="polite"` region
  as G2's does today (`PropertiesFace.tsx:121`). G3's control keeps its
  `data-bbx-does` (`SourceViewOverlay.tsx:221`).

### P — Part 2 fixes

- **Capture wording:** one summarizer in `components/chat/capture-message.ts`
  used by the bubble (`capture-bubble.tsx:134`), the chip (`capture-message.ts:50`)
  and the resume dialog (`CaptureResumeDialog.tsx:17`): "2 photos, 1 recording"
  order photos, recordings, files; empty reads "nothing yet". The chip's
  recording length stays where it shows today.
- **History image list:** the nine-extension set moves to a filename predicate
  `isImageFileName(name)` in `lib/binary-files.ts` (no `?`/`#` stripping;
  those can be literal filename characters). `message-parsing.ts` `isImagePath`
  strips its URL parts and calls it; `CommitDetail-tabs.tsx:15` and the Browse
  list (`BrowseSidebarList.tsx:35`) call it on the basename (fixes
  `a.attach/README`).
- **Chip links:** `CaptureChip.tsx:23` and `UploadChip.tsx:18` build the browse URL
  with `encodePathForUrl` (as `cardBrowseUrl` does), so `#` and `%` survive.

## Could this be simpler?

The simplest version of each group is a shared class-string constant. It
fails on the parts the boxholder cares about that are not classes: A's role,
B's focus trap, F's accessible name, G's failure state. Each primitive below
carries one of those. What the plan does not do: no theme tokens, no new
`Badge` tones, no change to `Accordion`, no rework of the toast's placement.

## Subplans

none

## Failure modes

> **Critical gap:** B3–B5 changing from div overlays to native modals. A
> native modal makes the rest of the page inert; QuickSearch's input must keep
> focus on open, and ScreenshotConsentPopup must still resolve on Escape. Both
> get DOM tests; a browser check covers each before commit.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| A theme hook (`bbx-` id) lost when markup moves into a primitive | add: id assertions in each track's DOM test | primitives take `id` | silent (theme breaks) |
| Escape in QuickSearch closes the dialog and the native cancel double-closes | add | `onCancel` preventDefault | clear |
| Capture-mode dialog renders light over the camera | browser check | `tone="dark"` | visible |
| `Button` `failLabel` shown when the click handler throws synchronously | add | treat as rejection | clear |
| D3 rows lose the "None yet" empty text | add | prop | visible |
| Encoded chip link double-encodes a path already encoded | add | `encodePathForUrl` input is raw path | clear |

## Agent-flow / user-flow edge cases

- Wrong tag / wrong field: none; no agent-facing vocabulary. ADDRESSED.
- Stale ref: chip link to a renamed document: unchanged (404 as today). DEFERRED.
- Two agents touching the same card: not applicable.
- Hand-edit drift: not applicable.
- Fabricated free-form value: not applicable.
- Validation error UX: notices keep their messages. ADDRESSED.
- Partial migration: none; each track converts all its callers in one commit.

## NOT in scope

- Part 2 rows not chosen: upload-with-progress pair, breakpoint mechanism,
  background-tab intervals, retry backoff, raw external links. They stay in
  the smaller-near-duplicates issue, which stays open.
- Accordion (D4) and toast placement (A12).
- Theme-studio documentation: ids are preserved, so nothing to update.

## Open design questions

None; the boxholder's answers are in Design.

## Knowledge audits

Skip: no agent-facing concept.

## What will hold this after it ships

DOM tests (`test/helpers/dom-harness.ts`) for `Notice`, `ModalCard`,
`StatusMessage` variants, `CloseButton` variants, `Button` `failLabel`; unit
tests for the phase map, the capture summarizer and the image-extension check.
Before/after screenshots in one exhibit for the boxholder.

## Implementation order

1. A, E, F (small primitives), each a commit.
2. G, C, P, each a commit.
3. D (three commits: extract, D2, D3).
4. B (two commits: shell with B1/B2, then B3–B5).
5. Browser check and the after-exhibit; cross-model diff review.

## Rollout shape

Done when each track's tests pass, `pnpm test:changed` passes, the browser
check of B3–B5 and the capture-mode dialog passes, and the exhibit shows each
merged group after the change. No data or storage change.

## Plan review (2026-10-23, codex gpt-6-sol)

- Part 2 lacked a choice; B3–B5 modality was an interpretation: both put to the
  boxholder, both confirmed (Design).
- Per-caller cancellation, caller-owned action layout, warning-text contrast,
  D3 contracts, `includeControlIds` and `data-bbx-does`, G's promise and live
  region, the filename image predicate, and two caller references: accepted;
  folded into the tracks above.
