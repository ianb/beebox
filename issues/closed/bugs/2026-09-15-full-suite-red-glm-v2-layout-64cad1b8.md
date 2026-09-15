---
title: "Full-suite red: test/core/chat/session/reserve.doctest.md, test/core/command-streaming.doctest.md, test/core/commands/answer-command.doctest.md"
workstream: glm-v2-layout
area: beebox
priority: important
resolution: wontfix
filed-by: agent
discovered-by: agent
discovered-in: worktree-glm-v2-layout — the hourly full-suite run on main
---

**Closed 2026-09-15 — diagnosed as load-contention timeouts, not a defect.**
Evidence gathered the same day:

- All three files failed with `signal: SIGALRM` at ~1,000,000ms — the batch
  runner's per-file ceiling — inside the schedule's temp checkout, while a
  second full test battery (the landing workstream's own finish-verify) ran
  concurrently on the same host. Nine other files flaked in the same batch.
- The three pass in isolation on both checkouts (`worktree-glm-v2-layout` and
  the main checkout), twice each, before and after the blamed merge.
- A full `pnpm test` on the main checkout on a quiet host: one failure, the
  known environmental `scan-vision-claude-integration` login test — none of
  these three.

The landing was blamed because it was newest and graph-reachable; the trigger
was two test batteries sharing the host. If the three-timeout-under-load shape
recurs, the lever is scheduling (don't overlap full-suite with finish-verify)
or raising the per-file ceiling for the slowest files — not any GLM change.

The hourly batched full-suite run (`schedules/full-suite/`) went red on `main` at
`64cad1b8`. Bisecting the landings since the last tested
commit (`089c4466`) over first-parent `main` blames one landing:

- **Landing:** `64cad1b8` — Merge branch 'worktree-glm-v2-layout'
- **Workstream:** glm-v2-layout
- **Failing files:** `test/core/chat/session/reserve.doctest.md`, `test/core/command-streaming.doctest.md`, `test/core/commands/answer-command.doctest.md`

Each file failed in the batched run and failed again on an isolated re-run, so
it is not a flake by the ledger's definition. Nothing has been fixed; this is a
report.

```
not ok 184 - test/core/chat/session/reserve.doctest.md # time=1003967.815ms
  ---
  stdio: inherit
  cwd: /private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-4cRVHS/checkout/beebox
  externalID: test/core/chat/session/reserve.doctest.md
  command: ~/.nvm/versions/node/v24.18.0/bin/node
  args:
    - --import=file:///private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-4cRVHS/checkout/node_modules/@tapjs/mock/dist/esm/import.mjs
    - --enable-source-maps
    - --import=file:///private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-4cRVHS/checkout/node_modules/@tapjs/processinfo/dist/esm/import.mjs
    - --disable-warning=DEP0040
    - --import=tsx
    - --import=./test/helpers/isolate-user-home.ts
    - --import=agent-doctest/tap
    - --import=agent-doctest/loader
    - --import=./test/helpers/isolate-secret-store.ts
    - --import=./test/helpers/isolate-auth-file.ts
    - --import=./test/helpers/isolate-origin-id.ts
    - --import=./test/helpers/isolate-codex-home.ts
    - /private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-4cRVHS/checkout/beebox/test/core/chat/session/reserve.doctest.md
  jobId: 1
  exitCode: null
  signal: SIGALRM
  ...

# Subtest: test/core/chat/session/transcript-paths.doctest.md
    # Subtest: transcript-paths.doctest.md:23 — print(`private tmp: ${isTaskOutputPathForBox({ boxRoot: BOX_ROOT, filePath: taskPath({}) })}`);
        ok 1 - (unnamed test)
        ok 2 - (unnamed test)
        ok 3 - (unnamed test)
        ok 4 - (unnamed test)
        ok 5 - (unnamed test)
        1..5
    ok 1 - transcript-paths.doctest.md:23 — print(`private tmp: ${isTaskOutputPathForBox({ boxRoot: BOX_ROOT, filePath: taskPath({}) })}`); # time=2.222ms
    
    1..1

not ok 190 - test/core/command-streaming.doctest.md # time=1001893.527ms
  ---
  stdio: inherit
  cwd: /private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-4cRVHS/checkout/beebox
  externalID: test/core/command-streaming.doctest.md
  command: ~/.nvm/versions/node/v24.18.0/bin/node
  args:
    - --import=file:///private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-4cRVHS/checkout/node_modules/@tapjs/mock/dist/esm/import.mjs
    - --enable-source-maps
    - --import=file:///private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-4cRVHS/checkout/node_modules/@tapjs/processinfo/dist/esm/import.mjs
    - --disable-warning=DEP0040
    - --import=tsx
    - --import=./test/helpers/isolate-user-home.ts
    - --import=agent-doctest/tap
    - --import=agent-doctest/loader
    - --import=./test/helpers/isolate-secret-store.ts
    - --import=./test/helpers/isolate-auth-file.ts
    - --import=./test/helpers/isolate-origin-id.ts
    - --import=./test/helpers/isolate-codex-home.ts
    - /private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-4cRVHS/checkout/beebox/test/core/command-streaming.doctest.md
  jobId: 2
  exitCode: null
  signal: SIGALRM
  ...

# Subtest: test/core/commands/answer-command.doctest.md
    # Subtest: answer-command.doctest.md:87 — const box = await makeTmpBox({ git: true });
        ok 1 - (unnamed test)
        ok 2 - (unnamed test)
        ok 3 - (unnamed test)
        ok 4 - (unnamed test)
        ok 5 - (unnamed test)
        ok 6 - (unnamed test)
        ok 7 - (unnamed test)
        1..7
    ok 1 - answer-command.doctest.md:87 — const box = await makeTmpBox({ git: true }); # time=1560.401ms
    
    # Subtest: answer-command.doctest.md:126 — const box = await makeTmpBox({ git: true });
        not ok 1 - timeout!
          ---

not ok 191 - test/core/commands/answer-command.doctest.md # time=1001800.941ms
  ---
  stdio: inherit
  cwd: /private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-4cRVHS/checkout/beebox
  externalID: test/core/commands/answer-command.doctest.md
  command: ~/.nvm/versions/node/v24.18.0/bin/node
  args:
    - --import=file:///private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-4cRVHS/checkout/node_modules/@tapjs/mock/dist/esm/import.mjs
    - --enable-source-maps
    - --import=file:///private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-4cRVHS/checkout/node_modules/@tapjs/processinfo/dist/esm/import.mjs
    - --disable-warning=DEP0040
    - --import=tsx
    - --import=./test/helpers/isolate-user-home.ts
    - --import=agent-doctest/tap
    - --import=agent-doctest/loader
    - --import=./test/helpers/isolate-secret-store.ts
    - --import=./test/helpers/isolate-auth-file.ts
    - --import=./test/helpers/isolate-origin-id.ts
    - --import=./test/helpers/isolate-codex-home.ts
    - /private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-4cRVHS/checkout/beebox/test/core/commands/answer-command.doctest.md
  jobId: 0
  exitCode: null
  signal: SIGALRM
  ...

# Subtest: test/core/commands/attachments-unignore.doctest.md
    # Subtest: attachments-unignore.doctest.md:57 — const box = await makeTmpBox({ git: true });
        ok 1 - (unnamed test)
        ok 2 - (unnamed test)
        ok 3 - (unnamed test)
        ok 4 - (unnamed test)
        ok 5 - (unnamed test)
        ok 6 - (unnamed test)
        ok 7 - (unnamed test)
        ok 8 - (unnamed test)
        ok 9 - (unnamed test)
        1..9
    ok 1 - attachments-unignore.doctest.md:57 — const box = await makeTmpBox({ git: true }); # time=1242.377ms
    
    # Subtest: attachments-unignore.doctest.md:169 — const fresh = await makeTmpBox();
```

Reproduce at the blamed landing:

```bash
git log -1 64cad1b8
pnpm --dir beebox exec tap test/core/chat/session/reserve.doctest.md test/core/command-streaming.doctest.md test/core/commands/answer-command.doctest.md
```
