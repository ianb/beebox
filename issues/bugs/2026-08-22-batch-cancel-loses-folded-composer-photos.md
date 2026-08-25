---
title: "Cancelling a bulk batch loses the composer photos it folded in"
workstream: composer-intake
area: callback-box
filed-by: agent
discovered-in: cross-model review of the add-files-menu work
priority: important
---

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
