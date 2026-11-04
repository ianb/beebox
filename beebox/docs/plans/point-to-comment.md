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

The Comment control is visible in the document or exhibit header. Picking happens only after the person enables it. The picked text appears inside the existing comment textarea as quoted lines, where the person can edit it or add speech. The list waits behind a control in the same header. Leaving the mode restores normal page gestures. Raw exhibits have a compact fixed control strip because they have no shared page header.

### Spirit, trust, and failure

This is a developer feedback surface, not a box behavior. Saving requires an explicit Comment press. A failed save leaves the draft and reports the error. A target that no longer resolves remains in the list with its quote.

### Walkthrough

The person enables Comment, hovers or taps an image, sees its outline, and sees its description inserted into the comment input. They type or dictate a note and save it. The comment gains a marker. The agent sees the quote and note through `bin/comments`; clearing it removes the marker after refresh.

## Smallest fix and budget

The initial implementation picks a block, adds a persistent element anchor and markers, and reads exhibit comments. This revision changes only the draft presentation and target set. Estimate: 180–300 changed source/test lines across the app, plus plan, issue, and exhibit-doc updates. No generated output.

## Stated preferences this plan trades against

The issue says “Keep what exists” and “Text selection stays available”; retain the current fields, always-on text highlights, and selection path. The boxholder then required the picked selection inside the existing comment textarea, with speech in the same draft, no separate input, no target-widening control, and a visible top-bar button. They confirmed the workstreams comment textarea is the destination. Desktop and mobile verification remain required. Screenshots remain optional because they require an attachment store beyond the existing comment fields.

## What already exists

- `workstreams-app/src/frontend/components/CommentLayer.tsx`: the current document draft floats beside the target and renders a separate blockquote. Move that existing textarea into the page header and put the picked quote inside its value.
- `workstreams-app/src/frontend/exhibits/CommentPanel.tsx`: exhibits use the same floating draft. Keep their request path and place the textarea in their existing top controls.
- `workstreams-app/src/frontend/lib/selection-anchor.ts`: element fragments and text fragments already resolve. Remove the target-widening helper and use semantic blocks as tap targets.
- `workstreams-app/src/shared/comments.ts:17`: the wire schema already permits string fragments and quotes. No store migration is needed.
- `workstreams-app/src/server/comments-service.ts`: the exhibit read path is already implemented in this branch; retain it.

## Prior art (external)

The issue records Claude artifact and Science behavior with source links. Adopt the mode toggle, target highlight, markers, and list. Do not adopt send-to-Claude, threads, or image pins: this app routes saved notes through workstreams. No other external premise determines the design.

## Ontology

- **Comment:** existing record in `src/shared/comments.ts:17`, identified by `id`; points to a document or exhibit and may carry a fragment.
- **Selection anchor:** existing `SelectionAnchor` in `src/frontend/lib/selection-anchor.ts:24`; identifies quoted text.
- **Element anchor:** same fields, with a typed element fragment and descriptive quote; identifies one rendered element without adding a stored field.
- **Target:** a rendered block or image within the content root. It is not the toolbar or composer.

## Tracks / scope

1. **Anchor and picker:** Keep semantic blocks and visual elements (`p`, headings, list items, table cells/rows/table, figure, image, pre, blockquote, svg, canvas, and `[role=img]`). Remove generic `div`, `section`, and `article` from automatic targets. A link or button is a fallback only when no enclosing block can be picked, so comment mode never swallows its click without a target. Keep `[data-comment-target]` for an authored page override. Remove `largerCommentTarget`; a text selection still identifies a smaller span.
2. **Document UI:** Move the Comment control and existing textarea above the document body. Picking fills the textarea with `> ` quoted lines followed by a blank line and focuses it, bringing the input into view on a phone. A very long element description is shortened in the input; the stored anchor remains complete. Speech appends after the quote. Save strips the unchanged leading quote block from the body, including if the person removes the blank line; the original anchor remains in `quoted` and `fragment`, so editing the draft text cannot move an existing marker. If the person changes the quote block, those changed lines become part of the body. Keep the chosen target outlined until save or cancel. Remove the floating card, separate quote block, and target-widening control.
3. **Exhibit UI:** Apply the same draft behavior to the container's existing top controls. Raw pages have no common header; move their fixed control strip to the top and keep it compact. Retain the existing read API, pins, list, and highlights.

## Could this be simpler?

Block picking alone would let the person write a note, but a saved image comment would have no in-page target, and an exhibit could not show existing comments. The additional read path and element fragment deliver the issue's markers and list while keeping the store shape. The header input needs no separate quote display or target-size control.

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
| A phone tap updates an offscreen input | Browser touch check | Focus brings the header input into view; chosen target stays outlined | Clear |
| Quote repeats in the agent's note | New pure helper test | Strip the unchanged quote prefix from the saved body | Clear |
| Dictation joins the quote line | New pure helper test | Preserve the blank line before appending speech | Clear |

## Agent-flow / user-flow edge cases

- **ADDRESSED:** Existing `bin/comments` presents the quote even if a target moves; no new field is required.
- **ADDRESSED:** The picker is confined to a content root so controls do not become targets.
- **ADDRESSED:** Existing workstream routing and CLI remain the only writer.
- **DEFERRED:** Screenshot attachment and image point pins need storage and a distinct presentation decision.

## NOT in scope

- Box-page commenting and long press gestures belong to the neighboring issue.
- Screenshot capture, uploads, and image point pins would add an attachment lifecycle without a settled need.
- A control for widening the picked target was explicitly rejected by the boxholder.
- Replies, threads, send-to-agent checkbox, and resolution state do not match the present comment workflow.

## Open design questions

Would cropped screenshots improve visual exhibit comments enough to justify an attachment store? Lean: try element quoting and location first, then decide from use. Would a point pin be more useful than selecting an image? Lean: image selection is sufficient for this pass.

## Knowledge audits

No new box-agent guidance. The agent still reads the same `bin/comments` records.

## What will hold this after it ships

Pure fragment-format tests cover the new encoding. Browser checks exercise DOM target choice and resolution without introducing a DOM test dependency. App API tests cover exhibit reads. Desktop, phone, and touch checks cover the interaction. No new test tier.

## Implementation order

1. Keep the implemented anchor and read API; narrow automatic targets and remove widening.
2. Put the selected quote into the existing document and exhibit textareas, remove floating drafts, and put Comment at the top of each page.
3. Check desktop, phone, and touch behavior, then update the exhibit and get cross-model diff review.

## Rollout shape

Run workstreams-app tests, typecheck, and lint. No migration: old text fragments and whole-document comments continue to parse. Ship as one worktree change after all tracks are complete; merging requires the boxholder's finish request.
