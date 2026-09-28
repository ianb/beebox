---
title: "Full-suite red: test/webapp/trpc-hq-preferences.doctest.md (moved to `beebox/test/webapp/trpc/routers/chat.hq-preferences.doctest.md`)"
workstream: notifications
area: beebox
priority: important
filed-by: agent
discovered-by: agent
discovered-in: worktree-notifications — the hourly full-suite run on main
---

The hourly batched full-suite run (`schedules/full-suite/`) went red on `main` at
`9b58dc80`. Bisecting the landings since the last tested
commit (`dc231150`) over first-parent `main` blames one landing:

- **Landing:** `9b58dc80` — Merge branch 'worktree-notifications'
- **Workstream:** notifications
- **Failing file:** `test/webapp/trpc-hq-preferences.doctest.md` (moved to `beebox/test/webapp/trpc/routers/chat.hq-preferences.doctest.md`)

Each file failed in the batched run and failed again on an isolated re-run, so
it is not a flake by the ledger's definition. Nothing has been fixed; this is a
report.

```
not ok 896 - test/webapp/trpc-hq-preferences.doctest.md # time=24539.578ms
  ---
  stdio: inherit
  cwd: /private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-pQmxwd/checkout/beebox
  externalID: test/webapp/trpc-hq-preferences.doctest.md
  command: ~/.nvm/versions/node/v24.18.0/bin/node
  args:
    - --import=file:///private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-pQmxwd/checkout/node_modules/@tapjs/mock/dist/esm/import.mjs
    - --enable-source-maps
    - --import=file:///private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-pQmxwd/checkout/node_modules/@tapjs/processinfo/dist/esm/import.mjs
    - --disable-warning=DEP0040
    - --import=tsx
    - --import=./test/helpers/isolate-user-home.ts
    - --import=agent-doctest/tap
    - --import=agent-doctest/loader
    - --import=./test/helpers/isolate-secret-store.ts
    - --import=./test/helpers/isolate-auth-file.ts
    - --import=./test/helpers/isolate-origin-id.ts
    - --import=./test/helpers/isolate-codex-home.ts
    - /private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-pQmxwd/checkout/beebox/test/webapp/trpc-hq-preferences.doctest.md
  jobId: 1
  exitCode: 1
  signal: null
  ...

# Subtest: test/webapp/trpc-landmarks-identity.doctest.md
    # Subtest: trpc-landmarks-identity.doctest.md:28 — const box = await makeTmpBox();
        ok 1 - (unnamed test)
        ok 2 - (unnamed test)
        1..2
    ok 1 - trpc-landmarks-identity.doctest.md:28 — const box = await makeTmpBox(); # time=141.279ms
    
    # Subtest: trpc-landmarks-identity.doctest.md:55 — const box2 = await makeTmpBox();
        ok 1 - (unnamed test)
        ok 2 - (unnamed test)
        1..2
    ok 2 - trpc-landmarks-identity.doctest.md:55 — const box2 = await makeTmpBox(); # time=188.745ms
    
    1..2
```

Reproduce at the blamed landing:

```bash
git log -1 9b58dc80
pnpm --dir beebox exec tap test/webapp/trpc-hq-preferences.doctest.md
```
