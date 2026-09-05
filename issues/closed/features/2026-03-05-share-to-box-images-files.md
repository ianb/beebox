---
title: "Share-to-box for images and files"
workstream: unknown
area: beebox
resolution: superseded
---

> Closed 2026-09-05 as `superseded` by the native share extension (`beebox/docs/plans/ios-share-extension-capture.md`, which names this proposal as the older Shortcut/upload route). The Shortcut mechanism is gone; images/files remain a follow-up tracked in that plan.

The iOS Shortcut share flow currently only handles URLs (opens a browser page with query params). For images, files, and plain text, the shortcut would need to POST data directly to an upload API endpoint using the "Get Contents of URL" action. The `bbx create` command already supports `--attachment` and `--attachment-mimetype`, so the backend card creation works — what's needed is a simple HTTP upload endpoint (multipart POST → create card with attachment, no SSE). This would let the share shortcut accept any share sheet type, not just URLs.
