---
title: "Cancelling a bulk batch loses the composer photos it folded in"
workstream: composer-intake
area: callback-box
filed-by: agent
discovered-in: cross-model review of the add-files-menu work
priority: important
needs: [manual-testing]
---

> **⏳ Awaiting manual testing** — fixed in `305c3a2a`; cancel a batch that
> folded in composer photos and check the photos and their tokens come back.
> Only the developer clears this. See [Manual testing](#manual-testing).
>
> The fold is now written as a reversible pair
> (`components/chat/composer-fold.ts`): it returns everything needed to undo
> itself, and every exit that does not deliver — Cancel batch, the confirm-discard
> step, Escape, the close button — restores the photos and the text that anchored
> them. Object URLs are no longer revoked at fold time, which is what previously
> left a cancelled batch holding live bytes behind dead previews; `onDelivered`
> releases them once the photos have actually landed. Round trip is doctested at
> the store level (`test/frontend/chat/composer-fold.doctest.md`); the wiring
> through the overlay's exits is what needs a human.

When a file set routes to the bulk-upload batch
(`src/frontend/src/components/chat/file-routing.ts`), the composer's existing
inline photos are folded into the same batch so one selection act has one
destination: `use-bulk-upload-launch.ts` `openWithFiles` decodes each inline
image back to a `File`, removes it from the emission store (stripping its
`[imageN]` token) and revokes its object URL — **before** the overlay opens.

If the user then cancels or discards the batch, `BulkUploadOverlay`'s exit path
cancels the server-side batch and closes. Nothing restores the folded photos, so
they are gone from the composer with no way back. The user cancelled an upload;
they did not ask to discard the photos they had already attached.

The folding predates the Add-files merge (it applied to an over-limit photo
selection), but that change makes it far easier to reach: dropping a single PDF
while photos are inline now routes to batch and folds them.

Fix directions:

- Keep the folded images in the `BulkUploadLaunch` object and restore them (with
  their tokens) when the overlay exits without delivering.
- Or defer the removal until finalize succeeds, and reconcile on delivery
  instead — the composer then shows the photos until they've actually landed.

Related: [attach-vs-upload-menu-confusing](../closed/features/2026-08-03-attach-vs-upload-menu-confusing.md).

## Re-checked 2026-08-25

Still true as filed: `use-bulk-upload-launch.ts` removes each folded image from
the emission store and revokes its object URL before the overlay opens, and no
commit has touched that file since this was filed.

One detail that makes the first fix direction smaller than it reads: the folded
`File` objects are **not** discarded — `setLaunch` keeps them in
`seedFiles: [...folded, ...files]`. The data needed to restore the composer is
already held by the launch object for as long as the overlay is open. What is
missing is only the restore path on a cancel/discard exit, plus re-minting the
`[imageN]` tokens and object URLs.

## Manual testing

1. **Attach two or three photos** to the chat composer, and type something
   around them so the `[image#N]` tokens sit mid-sentence.
2. **Drop a PDF in.** That routes the whole selection to the bulk-upload batch,
   which folds the photos in — the composer should empty out and the overlay
   should open holding the photos *and* the PDF.
3. **Cancel batch** (and confirm the discard if it asks). The photos should come
   back, their thumbnails should still render — not broken images — and the text
   should read exactly as it did in step 1, tokens in their original positions.
   The PDF should **not** come back; you cancelled that upload.
4. **Repeat, but finish the batch instead.** The photos should stay gone and the
   composer text should clear — the batch carried it as its introduction.
5. **Escape out of an overlay** rather than clicking Cancel: same restore.
