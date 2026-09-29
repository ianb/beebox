---
title: "Passing scan-upload tests invoke an unconfigured promotion CLI"
workstream: jev-triage
resolution: implemented
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-jev-triage — validating WebP and AVIF scan inputs
---

> Resolved in commit `cf575dae4`: the scan-upload HTTP fixture now injects an
> inert promotion pass while retaining separate orchestration coverage. Its
> previously noisy PNG case passes without invoking an unconfigured CLI.

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
[scan startup shape-error issue](2026-09-21-scan-startup-diagnostics-in-passing-route-tests.md):
that fix waits for in-flight passes before teardown. Here an existing upload
fixture starts a pass whose subprocess configuration is not valid.

Resolution evidence (2026-09-28): the test server now has an opt-in
`scanPromoteRun` seam that replaces only the lifecycle pass body; production
servers leave it unset. The scan-upload HTTP doctest uses an inert pass for its
annex-shaped fixture, so the quarantine sidecar and repeated check remain
`pending` while the test validates route behavior. The worker's upload, retry,
and wakeup orchestration remain covered separately by
`test/core/scan/promote.doctest.md` and `test/core/scan/promote-debounce.doctest.md`.

Before the change, `pnpm exec tap test/webapp/routes/scan-upload.doctest.md`
passed 36 assertions while the original PNG walk emitted the failed upload,
Claude authentication, missing `which bbx`, doctest-path EACCES wakeup, and
retry diagnostics described above. After the change, the same command passed
all 37 assertions with no promotion diagnostics, including a deterministic
check that the injected startup pass ran for the test box root. Both promotion
doctests passed their 34 assertions; their intentional failure cases still emit
their local failure diagnostics. ESLint passed on the modified server and
test-helper files, and `git diff --check` passed.
