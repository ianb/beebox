---
title: "A composer file attachment is dropped on page reload — the draft's [file#N] can never be verified"
workstream: add-files-inline
area: beebox
priority: normal
labels: [chat, composer, uploads]
filed-by: agent
discovered-by: agent
discovered-in: add-files-inline workstream — verifying the restored inline-file path in the browser
---

Attach a file to the composer, reload the page, and the attachment is gone: its
chip disappears and its `[file#N]` token is stripped from the restored text. An
inline photo in the same draft survives.

The upload itself is fine — the bytes are in the box's `_tmp/`, and sending
without reloading works end to end. What fails is the restore's liveness check.

`useEmissionPersistence.fileExists` HEADs `apiRawFileUrl(base, path)` —
`/api/files/<path>` — and `partitionFiles` treats a non-`ok` answer as "the
`_tmp/` sweep took it", drops the file, and strips its token. But
`/api/chat/upload-file` returns its path as `tmp/<name>` while the file is
written to the box's `_tmp/` dir, and `/api/files/` answers **403** for
`tmp/...` and **404** for `_tmp/...`:

```
403  /api/files/tmp/2026-09-07T03-10-26.982Z_quarterly-report.pdf
404  /api/files/_tmp/2026-09-07T03-10-26.982Z_quarterly-report.pdf
```

So the check can never succeed for a chat upload, and every restored file
attachment is judged dead. The sweep-detection this was written for
(`_tmp/` is cleared after 7 days) has never actually been exercised — it has
only ever reported false.

Not a regression from the inline-file fix, but newly reachable because of it:
between `5336b291` and that fix the web composer created no `[file#N]` at all,
so no web draft ever held one. The native composer persists its own draft and
uploads to the same route, so it likely has the same hole.

Two shapes of fix, and the choice is a judgment call:

- **Don't verify.** `_tmp/` is deliberately not served (that 403 looks like the
  guard working, not an accident), so a path under it is unverifiable by
  design. Treat an `uploaded` file as live on restore and let the send fail
  loudly if the file really was swept.
- **Make it verifiable.** Give the owner a HEAD on `_tmp/` (or a small
  `chat/upload-exists` probe), and fix the `tmp/` vs `_tmp/` mismatch in the
  route's response so the two halves agree on one spelling.

The path mismatch is worth settling either way: the route advertises `tmp/` for
something stored at `_tmp/`, and only the backend's own resolution hides it.
