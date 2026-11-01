---
title: "access-log test fails when UTC is in a later month than its fixed date"
workstream: shared-browser
area: beebox
priority: normal
filed-by: agent
discovered-by: agent
discovered-in: shared-browser landing, 2026-11-01
resolution: implemented
---

**Closed (implemented, 2026-10-31):** Fixed in the access-log test: the prune check uses its own directory, so a month boundary no longer changes the result.

`test/core/secrets/access-log.test.ts` failed in `pnpm test:changed` on
2026-11-01 UTC: it found `2026-11.jsonl` in the log directory where it expects
only the October file.

The finish agent read the test: it writes an entry with the real clock and
prunes against a fixed 17 October date. Not confirmed by a run on `main`.

The shared-browser work did not touch this code or test, and landed with the
failure.
