---
title: bulk-upload cancel route sometimes accepts a completed batch under suite load
workstream: flaky-tests
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-workstreams — full finish verification
resolution: implemented
priority: backlog
---

The full beebox suite intermittently failed the cancellation case in
`test/webapp/routes/bulk-upload-routes.doctest.md`:

```text
bulk-upload-routes.doctest.md:468
expected: 409
actual: 200
```

The failing testcase did not bind the `targetSessionId` to the in-memory history
before creation. The route's background worker could fail delivery with
`failed:*`, and the delete path intentionally treats those states as
retryable/discardable, producing `200`. The test now binds that target session
before create/finalize so the assertion remains a strict post-seal cancel
invariant (`409`) instead of racing an unrelated retryable failure mode.
