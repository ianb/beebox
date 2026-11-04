---
title: "Point to comment in documents and exhibits"
status: active
workstream: point-to-comment
issues:
  - ../../../issues/features/2026-11-01-point-to-comment.md
---
# Point to comment in documents and exhibits

Comment mode lets a person pick a visible part of a document or exhibit with a click or tap. It preserves text selection for precise comments and the existing comment store.

**Issues addressed:** `2026-11-01-point-to-comment`. The related box-page long-press issue is a different surface.

## Design

### Situations

- When viewing an exhibit screenshot on a phone, I want to tap the picture, so I can describe the visual problem without selecting text.
- When reading a paragraph, I want to select a few words, so I can make a precise comment.
- When following a link in an exhibit, I want normal navigation when I am done commenting.

### Right place, right time

The Comment control is visible with the document or exhibit. Picking happens only after the person enables it. A draft opens next to the selected content; the list waits behind a control in the same toolbar. Leaving the mode restores normal page gestures.

### Spirit, trust, and failure

This is a developer feedback surface, not a box behavior. Saving requires an explicit Comment press. A failed save leaves the draft and reports the error. A target that no longer resolves remains in the list with its quote.

### Walkthrough

The person enables Comment, hovers or taps an image, sees its outline, writes a note in the nearby composer, and saves it. The comment gains a marker. The agent sees the quote and note through `bin/comments`; clearing it removes the marker after refresh.

## Smallest fix and budget

The smallest plausible change picks a block and opens the existing composer. The chosen version also adds a persistent element anchor, markers, and an exhibit read path so saved comments stay findable. Estimate: 650–1000 changed source/test lines across the app, plus this plan and a short exhibit-doc update. No generated output.

## Stated preferences this plan trades against

The issue says “Keep what exists” and “Text selection stays available”; retain the current fields, always-on text highlights, and selection path. The human handoff requires desktop and mobile verification. Screenshots remain optional because they require an attachment store beyond the existing comment fields.

## What already exists

- `workstreams-app/src/frontend/components/CommentLayer.tsx:194`: `captureSelection(root)` opens the document composer. Reuse it for precise text.
- `workstreams-app/src/frontend/exhibits/CommentPanel.tsx:181`: exhibits also capture selections and save via their own API. Reuse the composer and request path.
- `workstreams-app/src/frontend/lib/selection-anchor.ts:84`: the anchor holds `quoted`, optional `section`, and optional `fragment`; `:140` resolves text fragments. Extend the fragment interpretation for elements.
- `workstreams-app/src/shared/comments.ts:17`: the wire schema already permits string fragments and quotes. No store migration is needed.
- `workstreams-app/src/server/comments-service.ts:109`: the CLI can read a target, but the service currently exposes only document reads. Add an exhibit read method.

## Prior art (external)

The issue records Claude artifact and Science behavior with source links. Adopt the mode toggle, target highlight, markers, and list. Do not adopt send-to-Claude, threads, or image pins: this app routes saved notes through workstreams. No other external premise determines the design.

## Ontology

- **Comment:** existing record in `src/shared/comments.ts:17`, identified by `id`; points to a document or exhibit and may carry a fragment.
- **Selection anchor:** existing `SelectionAnchor` in `src/frontend/lib/selection-anchor.ts:24`; identifies quoted text.
- **Element anchor:** same fields, with a typed element fragment and descriptive quote; identifies one rendered element without adding a stored field.
- **Target:** a rendered block or image within the content root. It is not the toolbar or composer.

## Tracks / scope

1. **Anchor and picker:** Choose semantic blocks (`p`, headings, list items, table cells/rows/table, figure, image, pre, blockquote, and document sections). The closest eligible ancestor wins. An explicit “Larger target” control walks eligible ancestors. A typed element fragment records the element-child path plus tag and descriptive quote. Resolution verifies tag and quote; a moved or changed target is unresolved rather than pinned to a wrong element. An element's text, caption, alt, or image source becomes `quoted`. A text selection still uses the existing text fragment. First chunk: anchor utilities; browser verification supplies the DOM environment.
2. **Document UI:** Add pointer hover and tap picking, a nearby composer, mode button with open count, mode-only pins, and a list that can navigate to a comment. Existing text highlights stay always visible. A non-collapsed selection wins over picking. A drag never picks. Capture clicks before links activate while mode is on; leave native text selection enabled, including touch long press. Use a fixed overlay to outline targets and place pins without mutating rendered React DOM. First chunk: document component and CSS.
3. **Exhibit UI and read path:** Use the same picker and fixed overlay, including raw pages with a shadow-root toolbar. On desktop the raw-page composer sits beside the target; on a phone it is a bottom sheet. A text-highlight style is installed in the document head. Extend the exhibit API and comment service to read existing comments by exhibit target. First chunk: API read and tests, then panel and CSS.

## Could this be simpler?

Block picking alone would let the person write a note, but a saved image comment would have no in-page target, and an exhibit could not show existing comments. The additional read path and element fragment deliver the issue's markers and list while keeping the store shape.

## Subplans

None; both surfaces share the picker and anchor rules.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Text fragment cannot resolve after an edit | Existing coverage | Existing list remains | Clear |
| Element path points at changed markup | Browser check | Tag and quote verification; list retains quote; marker omitted | Clear |
| Tap on a link navigates | Browser touch check | Capture and prevent default | Clear |
| Exhibit read fails | New API test | Panel error while comments remain stored | Clear |
| Comment save fails | Existing API test | Draft and error remain | Clear |

## Agent-flow / user-flow edge cases

- **ADDRESSED:** Existing `bin/comments` presents the quote even if a target moves; no new field is required.
- **ADDRESSED:** The picker is confined to a content root so controls do not become targets.
- **ADDRESSED:** Existing workstream routing and CLI remain the only writer.
- **DEFERRED:** Screenshot attachment and image point pins need storage and a distinct presentation decision.

## NOT in scope

- Box-page commenting and long press gestures belong to the neighboring issue.
- Screenshot capture, uploads, and image point pins would add an attachment lifecycle without a settled need.
- Replies, threads, send-to-agent checkbox, and resolution state do not match the present comment workflow.

## Open design questions

Would cropped screenshots improve visual exhibit comments enough to justify an attachment store? Lean: try element quoting and location first, then decide from use. Would a point pin be more useful than selecting an image? Lean: image selection is sufficient for this pass.

## Knowledge audits

No new box-agent guidance. The agent still reads the same `bin/comments` records.

## What will hold this after it ships

Pure fragment-format tests cover the new encoding. Browser checks exercise DOM target choice and resolution without introducing a DOM test dependency. App API tests cover exhibit reads. Desktop, phone, and touch checks cover the interaction. No new test tier.

## Implementation order

1. Anchor utility and focused tests.
2. Exhibit read API and tests.
3. Both comment UIs and styles.
4. Browser checks, exhibit, cross-model diff review, and corrections.

## Rollout shape

Run workstreams-app tests, typecheck, and lint. No migration: old text fragments and whole-document comments continue to parse. Ship as one worktree change after all tracks are complete; merging requires the boxholder's finish request.
