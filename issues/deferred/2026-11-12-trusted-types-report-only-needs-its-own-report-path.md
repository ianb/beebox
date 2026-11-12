---
title: "Trusted Types in Report-Only needs a separate report path or a larger CSP log"
workstream: unattached
area: beebox
activate-on: 2027-02-12
category: exploration
filed-by: agent
discovered-by: agent
discovered-in: worktree-web-guidance-scan — modern-web-guidance-adoption F4 held
---

The modern-web-guidance adoption plan
([implemented](../../beebox/docs/implemented-plans/modern-web-guidance-adoption.md),
item F4) proposed a Trusted Types policy in the Report-Only CSP. It was held:
Trusted Types violation reports would fill the 200 KB rolling CSP report log
(`beebox/src/webapp/routes/api-csp-report.ts`, `MAX_LOG_FILE_BYTES`) and push
out the `script-src` violations that CSP promotion is judged by.

To do F4: send Trusted Types reports to a separate endpoint or file, or raise
the log cap, then add `require-trusted-types-for 'script'` to the Report-Only
header. Read `beebox/docs/content-security-policy.md` first.
