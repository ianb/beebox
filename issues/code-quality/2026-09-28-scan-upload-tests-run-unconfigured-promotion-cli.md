---
title: "Passing scan-upload tests invoke an unconfigured promotion CLI"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-jev-triage — validating WebP and AVIF scan inputs
---

The existing PNG full-walk block in
`beebox/test/webapp/routes/scan-upload.doctest.md` passes its assertions but
sometimes starts background scan promotion with an unconfigured CLI. Isolating
that original block reproduced the diagnostics independently of the new
WebP/AVIF input block, which passed without them.

Observed diagnostics include `Promote of 2 file(s) from scan-upload/owner
failed: upload failed`, a Claude authentication failure, a failed `which bbx`,
an EACCES retry that tries to execute the doctest path, and `Promote pass left 2
file(s) in promoting; will retry`. These are test-fixture subprocess failures;
changing real credentials or hiding production diagnostics is not the remedy.

Make the HTTP validation fixture keep promotion inert, or provide a proper
fake promotion CLI if the block is intended to test that behavior. Keep a
separate test for real promotion orchestration. Expected failures should be
asserted locally, not emitted as unexplained background errors in a green run.

This differs from the resolved
[scan startup shape-error issue](../closed/code-quality/2026-09-21-scan-startup-diagnostics-in-passing-route-tests.md):
that fix waits for in-flight passes before teardown. Here an existing upload
fixture starts a pass whose subprocess configuration is not valid.
