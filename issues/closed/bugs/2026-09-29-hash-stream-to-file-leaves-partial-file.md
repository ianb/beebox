---
title: "hashStreamToFile can leave an empty partial file after a failure"
workstream: doctest-usability
area: beebox
labels: [uploads]
filed-by: agent
discovered-by: agent
discovered-in: worktree-doctest-usability — a test subject writing a doctest for the module
resolution: implemented
---

Fixed: on failure, `hashStreamToFile` now waits for the write stream to close before removing the file. The 200-attempt reproduction went from 41 leftover files to 0; `beebox/test/lib/hash-stream-to-file.doctest.md` runs the race 100 times and fails on the old code.

`beebox/src/lib/hash-stream-to-file.ts` promises that "the partial file is
removed on any failure, so a caller never has to clean up after a throw". That
is not always true.

When the source fails before the write stream has opened its file (for
example, the first chunk is already over `maxBytes`), the `catch` block runs
`fs.rm(destPath, { force: true })` first. The write stream then finishes
opening and creates an empty file after the removal.

Reproduction: call `hashStreamToFile` 200 times with
`Readable.from([Buffer.alloc(20)])` and `maxBytes: 10`, wait 5 ms, and check
`existsSync(destPath)`. On 2026-09-29, 41 of 200 attempts left the file.

Both callers (bulk-upload staging and scan-upload quarantine) rely on the
promise. A leftover empty file in staging or quarantine is the likely effect.
The fix probably waits for the write stream to close (or opens the file before
the pipeline starts) before removing it.
