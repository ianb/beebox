---
title: "Full-suite red: test/scripts/release-manifest.doctest.md"
workstream: install-remaining
area: callback-box
priority: important
filed-by: agent
discovered-by: agent
discovered-in: worktree-install-remaining — the hourly full-suite run on main
---

The hourly batched full-suite run (`schedules/full-suite/`) went red on `main` at
`f8691505`. Bisecting the landings since the last tested
commit (`4e5a0c0e`) over first-parent `main` blames one landing:

- **Landing:** `dcdaa0eb` — Merge branch 'worktree-install-remaining'
- **Workstream:** install-remaining
- **Failing file:** `test/scripts/release-manifest.doctest.md`

Each file failed in the batched run and failed again on an isolated re-run, so
it is not a flake by the ledger's definition. Nothing has been fixed; this is a
report.

```
not ok 521 - test/scripts/release-manifest.doctest.md # time=828.896ms
  ---
  stdio: inherit
  cwd: /private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-kaTvcY/checkout/callback-box
  externalID: test/scripts/release-manifest.doctest.md
  command: ~/.nvm/versions/node/v24.18.0/bin/node
  args:
    - --import=file:///private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-kaTvcY/checkout/node_modules/@tapjs/mock/dist/esm/import.mjs
    - --enable-source-maps
    - --import=file:///private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-kaTvcY/checkout/node_modules/@tapjs/processinfo/dist/esm/import.mjs
    - --disable-warning=DEP0040
    - --import=tsx
    - --import=agent-doctest/tap
    - --import=agent-doctest/loader
    - --import=./test/helpers/isolate-secret-store.ts
    - --import=./test/helpers/isolate-auth-file.ts
    - --import=./test/helpers/isolate-origin-id.ts
    - --import=./test/helpers/isolate-codex-home.ts
    - /private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-kaTvcY/checkout/callback-box/test/scripts/release-manifest.doctest.md
  jobId: 3
  exitCode: 1
  signal: null
  ...

# Subtest: test/service-openai-embeddings.doctest.md
    # Subtest: service-openai-embeddings.doctest.md:28 — const fake = createFakeEmbeddings();
        ok 1 - (unnamed test)
        ok 2 - (unnamed test)
        ok 3 - (unnamed test)
        ok 4 - (unnamed test)
        ok 5 - (unnamed test)
        ok 6 - (unnamed test)
        ok 7 - (unnamed test)
        ok 8 - (unnamed test)
        ok 9 - (unnamed test)
        ok 10 - (unnamed test)
        ok 11 - (unnamed test)
        ok 12 - (unnamed test)
        ok 13 - (unnamed test)
        ok 14 - (unnamed test)
```

Reproduce at the blamed landing:

```bash
git log -1 dcdaa0eb
pnpm --dir callback-box exec tap test/scripts/release-manifest.doctest.md
```
