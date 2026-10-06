---
title: "Full-suite red: test/webapp/trpc/routers/chat.hq-preferences.doctest.md"
workstream: card-view-fixes
area: beebox
priority: important
filed-by: agent
discovered-by: agent
discovered-in: worktree-card-view-fixes — the hourly full-suite run on main
---

The hourly batched full-suite run (`schedules/full-suite/`) went red on `main` at
`c71e1344`. Bisecting the landings since the last tested
commit (`4a14673c`) over first-parent `main` blames one landing:

- **Landing:** `c71e1344` — Merge branch 'worktree-card-view-fixes'
- **Workstream:** card-view-fixes
- **Failing file:** `test/webapp/trpc/routers/chat.hq-preferences.doctest.md`

Each file failed in the batched run and failed again on an isolated re-run, so
it is not a flake by the ledger's definition. Nothing has been fixed; this is a
report.

```
not ok 928 - test/webapp/trpc/routers/chat.hq-preferences.doctest.md # time=40676.603ms
  ---
  stdio: inherit
  cwd: /private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-mNWo9V/checkout/beebox
  externalID: test/webapp/trpc/routers/chat.hq-preferences.doctest.md
  command: ~/.nvm/versions/node/v24.18.0/bin/node
  args:
    - --import=file:///private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-mNWo9V/checkout/node_modules/@tapjs/mock/dist/esm/import.mjs
    - --enable-source-maps
    - --import=file:///private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-mNWo9V/checkout/node_modules/@tapjs/processinfo/dist/esm/import.mjs
    - --disable-warning=DEP0040
    - --import=tsx
    - --import=./test/helpers/isolate-user-home.ts
    - --import=agent-doctest/tap
    - --import=agent-doctest/loader
    - --import=./test/helpers/isolate-secret-store.ts
    - --import=./test/helpers/isolate-auth-file.ts
    - --import=./test/helpers/isolate-origin-id.ts
    - --import=./test/helpers/isolate-codex-home.ts
    - /private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-mNWo9V/checkout/beebox/test/webapp/trpc/routers/chat.hq-preferences.doctest.md
  jobId: 4
  exitCode: 1
  signal: null
  ...

# Subtest: test/webapp/trpc/routers/chat.mark-done.doctest.md
    # Subtest: chat.mark-done.doctest.md:54 — await caller(box.root).chat.markDone({ sessionId: SESSION, done: true })
        ok 1 - line 59: await caller(box.root).chat.markDone({ sessionId: SESSION, done: true })
        ok 2 - line 62: await box.read("_content/chat/web/2026-07-28_aaaa1111.chat.card")
        ok 3 - line 71: await listed(box.root)
        ok 4 - line 79: await caller(box.root).chat.label({ session: SESSION })
        ok 5 - line 89: await box.read("_content/chat/web/2026-07-28_aaaa1111.chat.card")
        ok 6 - line 98: await listed(box.root)
        1..6
    ok 1 - chat.mark-done.doctest.md:54 — await caller(box.root).chat.markDone({ sessionId: SESSION, done: true }) # time=1512.363ms
    
    # Subtest: chat.mark-done.doctest.md:112 — const box = await makeTmpBox();
        ok 1 - line 113: await caller(box.root).chat.label({ session: SESSION })
        ok 2 - line 120: await caller(box.root).chat.markDone({ sessionId: SESSION, done: true }).catch((e) => e.message)
        1..2
```

Reproduce at the blamed landing:

```bash
git log -1 c71e1344
pnpm --dir beebox exec tap test/webapp/trpc/routers/chat.hq-preferences.doctest.md
```
