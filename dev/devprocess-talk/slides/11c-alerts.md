# What an unattended run reports
## Supporting: two alert records and a release ruling
```text
workstream : full-suite           priority: fyi     closedBy: schedule
title      : full suite green after re-run: 1 flaky file
message    : **Nothing is broken.** 1 test file failed in the batched run and
             passed again on an isolated re-run, so the failure is recorded as a
             flake and no issue was filed.
condition  : flakes               occurrences: 1

workstream : sdk-update           priority: fyi
title      : Agent SDK 0.3.292 landed and deployed; background-command check passed
message    : - Gate cleared: 0.3.292 makes SDK runs wait for background commands…
             - Verified: typecheck, steering probe (4/4), pnpm -C beebox test
               (11,731 pass, 2 skip). The run waited about 10 min for host load to fall.
             - Issues: none new.
```

```markdown
### 0.3.294 / Claude Code 2.1.294 — pending, nothing relevant
SDK parity-only. 2.1.294 fixes `prompt` and `agent` hooks… Checked: `.claude/`
defines no `prompt` or `agent` hooks. Settled path; takeable 2026-10-10T16:36Z.
```

- 229 alerts: Aug 47, Sep 143, Oct 39 (8 days); closed by a person 172, by a schedule 30, by the digest 13
- Sep 18: conditions dedupe a standing problem; `important` interrupts, the rest wait for a 09:00 digest; a week-old condition becomes an issue

Notes:
The ledger line "v2.1.218's worktree git isolation silently broke /finish's merge step for days" is why the SDK monitor reads the harness changelog every day even when the SDK API did not change.
