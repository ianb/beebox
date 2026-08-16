---
title: bulk-upload cancel route sometimes accepts a completed batch under suite load
workstream: unattached
area: callback-box
filed-by: agent
discovered-by: agent
discovered-in: worktree-workstreams — full finish verification
---

The full callback-box suite intermittently fails the cancellation case in
`test/webapp/routes/bulk-upload-routes.doctest.md`. After the fixture completes
the batch, the late `DELETE /api/bulk/sessions/:sessionId` request sometimes
returns 200 instead of the expected 409.

The failure appeared under parallel suite load with this exact assertion:

```text
bulk-upload-routes.doctest.md:468
expected: 409
actual: 200
```

An immediate isolated run of the file passed all 25 checks. The workstreams
branch touched neither this test nor bulk-upload code. Investigate whether the
completion worker and cancellation route race over the persisted batch state,
and make the test synchronize on the completed state it intends to exercise.
