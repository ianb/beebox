---
title: "bulk-upload attach blobs of arbitrary extension aren't gitignored"
workstream: unknown
needs: [design]
area: beebox
resolution: implemented
---

**Resolved (Track 1 chunk 2):** `src/core/bulk-upload/prepare.ts` now writes a
batch-local `.gitignore` inside each batch's `.attach/` scope that ignores
everything except `manifest.json` and the `.gitignore` itself, regardless of
extension. Documented in `docs/asset-manifests.md` ("Arbitrary-extension attach
scopes"). Chosen over broadening the box-wide extension list because the bulk
scope's extensions aren't known up front.

Surfaced building Track 1 chunk 1 of `docs/plans/bulk-file-upload.md`.

The asset-manifest gitignore (`docs/asset-manifests.md` → Gitignore section) is
**extension-based**: `**/*.attach/**/*.jpg`, `…/*.pdf`, `…/*.mp4`, etc. Capture
only ever lands media in that known set, so its blobs are always ignored.

Bulk upload lands **arbitrary** files (a `.txt`, `.zip`, `.docx`, `.csv`,
`.pptx`, an extensionless file) into `tmp-upload/<slug>/Batch.upload-batch.attach/`.
Those blobs are NOT covered by the current gitignore patterns.

`src/core/bulk-upload/prepare.ts` follows capture's write model exactly — it
stages only the card + `manifest.json`, never the blob paths — so prepare itself
never commits a blob. But an uncovered blob still shows up as **untracked** in
`git status` indefinitely, and a later stray `git add -A` (or a box tool that
does one) would commit it into history, which is exactly what the manifest model
exists to prevent.

Options to weigh (design):
- Broaden the box gitignore for the bulk landing zone specifically
  (`**/tmp-upload/**/*.attach/**` minus `manifest.json`), or
- Broaden attach-scope gitignoring to the whole `.attach/**` tree except
  `manifest.json` / committed sidecars (revisits the extension-list approach the
  asset-manifest doc's "Future review points" already flags), or
- Have `bbx attachments init-gitignore` add a bulk-specific rule.

Not blocking chunk 1 (prepare is correct in isolation); wire the gitignore
alongside the finalize route (chunk 2) or the docs/gitignore work (Track 4)
before bulk upload ships to a real box.
