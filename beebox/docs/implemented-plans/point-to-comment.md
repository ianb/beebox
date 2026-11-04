---
title: "Point at a box document to attach it to chat"
status: implemented
workstream: point-to-comment
issues:
  - ../../../issues/closed/features/2026-11-01-point-to-comment.md
---
# Point at a box document to attach it to chat

The box lets a person select document text and press `+` to attach it to chat. The companion Select mode previews a document block on desktop hover and attaches it on click; on touch, a tap previews the block and the nearby `+` confirms it. This workstream initially changed the workstreams-app comment system by mistake; that implementation was removed after the boxholder clarified the destination.

**Issues addressed:** `2026-11-01-point-to-comment`, corrected by the boxholder's box screenshots. The related mobile text-selection problem is in `2026-10-09-mobile-long-press-paragraph-to-comment`; its tentative long-press gesture is outside this plan.

## Design

### Situations

- When reading a document beside chat on a phone, I want to tap its paragraph, so I can refer to it without selection handles.
- When a document shows an image or table, I want to point to it, so I can talk about that part with the box.
- When I only want to follow a link or copy a few words, I want ordinary gestures, so reading stays easy.

### Right place, right time

| Situation | Behavior | Surface and attention |
|---|---|---|
| Desktop document | Show Select in the companion top row; hover outlines a block and click attaches it | Box chat companion, findable |
| Touch document | Tap outlines a block and shows `+` beside it; `+` attaches it | Box chat companion, deliberate |
| Ordinary reading | Mode starts off; existing text selection and `+` remain | Box chat companion, quiet |

### Spirit

- **Serves:** `spirit.md`, “Feedback is everywhere, and it's not all commands”: a person points, then says anything in chat.
- **Risks:** “You should be able to see the gears”: the existing selection pill and inline token keep the attached reference visible and removable.

### Trust

On desktop, clicking the previewed target adds its reference to the draft. On touch, tapping previews it and pressing the nearby `+` adds its reference. Sending remains the person's explicit step; selecting does not authorize agent action.

### When it goes wrong or does nothing

The mode control appears only for rendered `.doc.card` and Markdown documents with a chat selection sink. Embedded PDFs, independent images, and opaque view frames are outside this first pass. Empty decorative targets do nothing. Escape or Done selecting exits. A link cannot navigate while the mode picks it; after leaving, it works normally. A wrong attachment can be removed with the existing selection pill. For a narrower text span, leave mode and use the existing text selection and `+`.

### Walkthrough

The person opens a document beside chat and presses Select. On desktop, hovering a paragraph outlines it; clicking adds the existing selection pill and `[selection#N]` token to the ordinary chat draft. On touch, tapping a paragraph outlines it and shows `+`; pressing `+` adds that same pill and token. They type or dictate a thought and send it. The existing serializer writes `<user-selection>` with source and position. During transcription the existing companion path places the pick at the speech position. No new composer or stored comment is created.

## Smallest fix and budget

Add a mode toggle and a picker that calls `FileView`'s existing `handleCapture` on desktop click or touch confirmation. Also restore the workstreams-app files changed earlier on this branch. Estimate 350–600 changed source/test lines for the box picker, plus mechanical removal of the mistaken branch changes. Authored docs: plan and issue correction. Generated output: none. The intended new work is below 2,000 changed lines.

## Stated preferences this plan trades against

The boxholder's screenshots show selected text and `+` becoming `[selection#1]` in the chat draft, with selection placed in transcription. They rejected a special input and target-enlarging control. `beebox/AGENTS.md` says “Work only on the requested problem”; this excludes a second composer and the workstreams comment store. `beebox/frontend.md` says ordinary cards render in the workspace, so the mode control belongs with the existing companion document.

## What already exists

- `beebox/src/frontend/src/components/FileView/view.tsx:237-249`: `selectionReceiver(...)` resolves the sink and `handleCapture` sends `onAddSelection({ ref, text: selection.text, position: selection.position })`. Reuse.
- `beebox/src/frontend/src/components/SelectionCapture.tsx:49-151`: a text selection displays `+` and calls `onCapture`. Preserve.
- `beebox/src/frontend/src/components/chat/everywhere/InteractiveChat/use-companion-selection.ts:39-54`: typed selection enters chat; transcription records `lastWords` and `countWords`. Reuse.
- `beebox/src/frontend/src/components/chat/everywhere/InteractiveChat/selections.ts:32-45`: typed picks insert `[selectionN]`; voice picks use a speech anchor. Reuse.
- `beebox/src/frontend/src/components/chat/workspace/WorkspaceCanvas/view.tsx:42-58`: the stable companion card has the chat sink and a header row. Add mode there, below the tabs to preserve mobile width.
- `beebox/src/frontend/src/lib/selection/position.ts:36-47`: `AddSelectionInput` carries `ref`, `text`, and a freeform `position`. Keep that shape.
- `beebox/src/frontend/src/components/Markdown/body.tsx:155-167`: prose paragraphs use `.bbx-paragraph` divs, so the picker must include them.

## Prior art (external)

No external premise is needed. The user's screenshots and shipped box flow determine the destination. The original issue's Claude artifact analogy does not govern draft behavior.

## Ontology

- **Selection:** existing `AddSelectionInput` (`position.ts:36-47`): a chat attachment with source ref, text, and rough position; it is not a workstreams document comment.
- **Select mode:** ephemeral view state that changes what a click or tap on document content selects; it is not saved comment state.
- **Target:** visible semantic block in the rendered document, producing one Selection.
- **Draft:** existing chat composer and selection list. No new data format.

## Tracks / scope

### Track 1: Restore the wrong branch change

Restore workstreams-app code and tests to the branch base and correct the issue's scope/status. Retain unrelated mainline changes. First chunk: mechanical restoration and issue correction, then a checkpoint commit.

### Track 2: Box picker

Add a labeled Select/Done selecting control just below the companion tabs for `.doc.card` and Markdown with a chat selection sink. Keep mode with its card and reset when the card hides. Pass mode into `FileView` and `SelectionCapture`. Target paragraphs including `.bbx-paragraph`, headings, list items, table cells/rows, figures/images, code blocks, and blockquotes. Nearest meaningful block wins; no widening control. Mouse hover previews the block; click calls existing `onCapture` immediately. Touch tap previews the block and positions the existing `+`; its click calls `onCapture`. Capture-phase click handling suppresses the underlying link or control while in mode. Touch mode disables native text selection while preserving scrolling. Outside mode, `+` behaves as before. Extract document text without nested interface controls: a code fence containing `hello` must attach `hello`, not `Copy hello`. Visual targets use caption, alt, or short source description; `position` carries a rough location. Empty/decorative targets are skipped. Keyboard text selection and `+` remain the precise keyboard path; no focus highlight is promised for unfocusable paragraphs. First chunk: extraction and interaction, then header wiring.

## Could this be simpler?

A double tap without a mode would avoid a button, but conflicts with ordinary links and text selection on a phone. The explicit mode makes changed tap behavior visible and reversible. Calling `onAddSelection` avoids a second persistence path, following the engineering principle of one way to do each thing.

## Subplans

None. The source and destination already exist in code.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Link activates instead of being picked | Browser check planned | Capture-phase click suppression | Clear |
| Inline span gives too narrow a target | Extraction test planned | Ascend to semantic block | Clear |
| Image has no text | Extraction test planned | Alt/caption/source fallback or skip | Clear |
| Switching cards leaves mode active | Browser check planned | Reset when card hides | Clear |
| A picked block changes before `+` | Browser check planned | Confirm the quote and position still match the visible target | Clear |
| Code fence includes its Copy button label | Extraction test planned | Exclude nested controls | Clear |

## Agent-flow / user-flow edge cases

- **ADDRESSED:** A touch target can be changed before pressing `+`; any attached target can be removed afterward by the existing selection pill (`ChatSelections.tsx:59`).
- **ADDRESSED:** No migration: existing `applySelections` serializes the same input (`serialize.ts:167-215`).
- **ADDRESSED:** Missing or moved source retains existing ref and quote; no claim of a canonical anchor.
- **DEFERRED:** Canonical anchors belong to `issues/features/2026-07-08-selection-provenance-canonical-anchors.md`.
- **DEFERRED:** Physical iOS WebView behavior requires device verification beyond Chromium touch emulation.

## NOT in scope

- Workstreams-app exhibits and `bin/comments`: the boxholder identified box chat.
- Embedded PDFs, independent image files, and opaque view frames: their content is not inspectable by the DOM block picker. Images inside rendered documents remain eligible.
- New comment store, markers, threads, or all-comments list: selections enter a chat draft.
- Screenshots, image point pins, and canonical anchors: they need new representation.
- Long press: its conflict with native selection motivated the explicit mode.

## Open design questions

An image point or screenshot may later be worthwhile; lean toward first using alt/caption and source. Standalone browse may later need a control; lean toward companion only, where the chat draft is visible.

## Knowledge audits

No new agent-facing format or instruction. Existing `<user-selection>` serialization remains.

## What will hold this after it ships

Focused tests cover block extraction, nested controls, desktop immediate attachment, and touch confirmation. Browser checks cover hover preview, click attachment, phone-width confirmation, link suppression, and draft token/pill. Existing serializer tests cover message format. No new test tier.

## Implementation order

1. Correct plan and issue; obtain Codex Astra plan review, per the boxholder's quota constraint.
2. Restore workstreams changes; commit correction.
3. Implement box picker, tests, typecheck, lint, layout check.
4. Verify with `bin/browse` against isolated test box at desktop and phone widths; present one exhibit. Actual touch gesture verification remains for a device.
5. Obtain Codex Astra diff review, adjudicate, commit. Do not merge.

## Rollout shape

No data migration or deployment. Done when desktop click attaches a hovered block immediately, a touch tap waits for `+`, text selection still works, taps do not navigate in mode, checks and browser evidence pass, and Codex review findings are resolved or reported.
