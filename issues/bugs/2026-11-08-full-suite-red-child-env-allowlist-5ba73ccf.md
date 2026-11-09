---
title: "Full-suite red: test/core/browser/card-shot/run.e2e.test.ts"
workstream: child-env-allowlist
area: beebox
priority: important
filed-by: agent
discovered-by: agent
discovered-in: worktree-child-env-allowlist — the hourly full-suite run on main
---

The hourly batched full-suite run (`schedules/full-suite/`) went red on `main` at
`5ba73ccf`. Bisecting the landings since the last tested
commit (`edb2fed8`) over first-parent `main` blames one landing:

- **Landing:** `5ba73ccf` — Merge branch 'worktree-child-env-allowlist'
- **Workstream:** child-env-allowlist
- **Failing file:** `test/core/browser/card-shot/run.e2e.test.ts`

Each file failed in the batched run and failed again on an isolated re-run, so
it is not a flake by the ledger's definition. Nothing has been fixed; this is a
report.

```
not ok 520 - test/core/browser/card-shot/run.e2e.test.ts # time=37647.376ms
  ---
  stdio: inherit
  cwd: /private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-oVX6lI/checkout/beebox
  externalID: test/core/browser/card-shot/run.e2e.test.ts
  command: ~/.nvm/versions/node/v24.18.0/bin/node
  args:
    - --import=file:///private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-oVX6lI/checkout/node_modules/@tapjs/mock/dist/esm/import.mjs
    - --enable-source-maps
    - --import=file:///private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-oVX6lI/checkout/node_modules/@tapjs/processinfo/dist/esm/import.mjs
    - --disable-warning=DEP0040
    - --import=tsx
    - --import=./test/helpers/isolate-user-home.ts
    - --import=@ianbicking/tap-check/tap
    - --import=./src/frontend/test/helpers/react-compiler-register.ts
    - --import=./test/helpers/isolate-secret-store.ts
    - --import=./test/helpers/isolate-auth-file.ts
    - --import=./test/helpers/isolate-origin-id.ts
    - --import=./test/helpers/isolate-codex-home.ts
    - --import=./test/helpers/quiet-chat-session-log.ts
    - /private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-oVX6lI/checkout/beebox/test/core/browser/card-shot/run.e2e.test.ts
  jobId: 4
  exitCode: 1
  signal: null
  ...

# Subtest: test/core/browser/card-shot/run.test.ts
    # Subtest: a card is named by /views/<path> or /chat?card=<path> on this box only
        ok 1 - (unnamed test)
        1..1
    ok 1 - a card is named by /views/<path> or /chat?card=<path> on this box only # time=1.661ms
    
    # Subtest: a card taller than its panel: grow, measure, capture, restore
        ok 1 - (unnamed test)
        ok 2 - (unnamed test)
        1..2
    ok 2 - a card taller than its panel: grow, measure, capture, restore # time=6.801ms
    
    # Subtest: a page with no card says how to open one
        ok 1 - (unnamed test)
```

Reproduce at the blamed landing:

```bash
git log -1 5ba73ccf
pnpm --dir beebox exec tap test/core/browser/card-shot/run.e2e.test.ts
```

## Note 2026-11-08 (child-env-allowlist follow-up)

Not resolved. Leave open.

- The hourly full-suite run failed `card-shot/run.e2e.test.ts` twice (runs 20261108-140134 and 20261108-160652) at the screenshot step: "Failed to read: Resource temporarily unavailable (os error 35)". One isolated re-run failed with "agent-browser did not finish within 120 s".
- It does not reproduce after 5ba73ccf. It passes in the worktree, under a stripped launchd-like env (`env -i` with the com.beebox.schedules PATH), in a fresh detached checkout under `$TMPDIR` with a clean pnpm install and pretest, and as a one-off launchd job (`launchctl submit`).
- Suspected change: b5dbd6b23 (browser host spawned with `agentAllowlistEnv` instead of `process.env`). It changes the host process env only by adding `BBX_SPAWN_PROFILE=agent` and dropping non-allowlisted names. agent-browser's own env (`dashboardEnv`) is unchanged (built from HOME and PATH, both kept).
- 16 agent-browser/Chrome processes were left running on the machine at the time. Unconfirmed whether they matter.
- The same alerts also count `test/services/codex-sdk-session.boundary.test.ts`. It fails from c1aeab168 (`native-store.ts` now imports `codex-history-server.js`), not from this workstream.
- Commit ed6a83a3c shortens the fixture's loading delay to 300 ms (test time ~12 s to ~4 s). It is not a fix for this failure. The next hourly run shows whether card-shot is still red.
