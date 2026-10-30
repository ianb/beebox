---
title: "Review component reuse: dialogs, overlays and inputs are hand-made where no primitive exists"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: Ian
discovered-in: worktree-devprocess-talk — the developer asked whether the components rule holds, and a quick scan found the gaps
---

The frontend rule says to reach for a primitive in
`beebox/src/frontend/src/components/ui/` before writing appearance inline, and
to put a page's own supporting components under `pages/<x>/components/`
([frontend guidance](../../beebox/frontend.md#frontend-ui-primitives)). The
developer's worry: a component can be rewritten instead of reused, and nothing
measures that. A quick scan on 2026-10-13 says the rule holds where a primitive
exists and breaks where none does.

What holds:

- The 36 primitives are imported widely: Text in 113 files, Stack 103, Button
  83, Row 60, Card 49. The styled Button appears 169 times against 122 raw
  `<button>` elements, and most raw ones are bare icon buttons in chat and
  history; 30 carry their own appearance classes.
- The `restrict-component-classes` lint rule has no disables, so page code is
  not styling components.
- The primitives are stable: since mid-July, 83 file touches in `components/ui/`
  against 1,899 in the rest of `components/`.

What does not:

- There is no Dialog or Modal primitive. Eight components set `role="dialog"`
  themselves (place-pill landmarks, capture resume, chat ack badge, screenshot
  consent, audio overlay badge, card actions, quick search, delete chat), and
  six of them re-implement Escape and modal handling.
- There is no text input or select primitive beyond `ui/fields/`; ten files
  write raw `<input>`, two `<select>`, one `<textarea>`.
- Four components build their own full-screen overlay (`fixed inset-0`): the
  image lightbox, capture overlay, screenshot consent, quick search.
- No issue has ever been filed about a duplicated or ad hoc component, so the
  rule is enforced only at the moment of writing.

The review:

1. Read the eight dialogs and four overlays for real behavior differences, and
   decide what one Dialog primitive (focus trap, Escape, backdrop, labelled
   title) and one Overlay primitive must cover.
2. Decide the text input and select primitives, or extend `ui/fields/`.
3. Migrate the sites, keeping any deliberate difference as a prop, not a copy.
4. Add a check that reports new `role="dialog"`, `fixed inset-0`, and raw form
   controls outside `components/ui/`, so the next copy is filed instead of
   merged quietly. A count in the frontend health report would do.

The scan counted with grep; it did not read the components, so some of the
eight dialogs may differ on purpose.

Re-reviewed 2026-10-30: the Dialog half shipped as ModalCard (91aec1ffe); input/select primitives, the two remaining overlays and the reporting check remain.

Out of date in the body above: Mark step 1 done for modals (ModalCard, 91aec1ffe). Update counts: role="dialog" in 5 non-modal components, fixed inset-0 in ImageLightbox and CaptureOverlay, raw <input> in 13 files and <select> in 3. Keep steps 2 and 4.
