---
title: "Full-suite red: test/cli/lib/session.oversize-lines.doctest.md"
workstream: test-suite-health
area: beebox
priority: important
filed-by: agent
discovered-by: agent
discovered-in: worktree-codex-plugin-hooks — the hourly full-suite run on main
resolution: implemented
---

**Closed 2026-10-06 (test-suite-health, `50961ada5`).** Not caused by the codex-plugin-hooks landing: the test was a flake near its heap cap that failed about half the time. See [the oversize-lines flake](../../closed/bugs/2026-10-02-session-oversize-lines-flakes-under-load.md).

The hourly batched full-suite run (`schedules/full-suite/`) went red on `main` at
`5d7a909f`. Bisecting the landings since the last tested
commit (`2b327521`) over first-parent `main` blames one landing:

- **Landing:** `5d7a909f` — Merge branch 'worktree-codex-plugin-hooks'
- **Workstream:** codex-plugin-hooks
- **Failing file:** `test/cli/lib/session.oversize-lines.doctest.md`

Each file failed in the batched run and failed again on an isolated re-run, so
it is not a flake by the ledger's definition. Nothing has been fixed; this is a
report.

```
not ok 261 - test/cli/lib/session.oversize-lines.doctest.md # time=1782.96ms
  ---
  stdio: inherit
  cwd: /private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-lQddpb/checkout/beebox
  externalID: test/cli/lib/session.oversize-lines.doctest.md
  command: ~/.nvm/versions/node/v24.18.0/bin/node
  args:
    - --import=file:///private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-lQddpb/checkout/node_modules/@tapjs/mock/dist/esm/import.mjs
    - --enable-source-maps
    - --import=file:///private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-lQddpb/checkout/node_modules/@tapjs/processinfo/dist/esm/import.mjs
    - --disable-warning=DEP0040
    - --import=tsx
    - --import=./test/helpers/isolate-user-home.ts
    - --import=agent-doctest/tap
    - --import=agent-doctest/loader
    - --import=./test/helpers/isolate-secret-store.ts
    - --import=./test/helpers/isolate-auth-file.ts
    - --import=./test/helpers/isolate-origin-id.ts
    - --import=./test/helpers/isolate-codex-home.ts
    - /private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-lQddpb/checkout/beebox/test/cli/lib/session.oversize-lines.doctest.md
  jobId: 2
  exitCode: 1
  signal: null
  ...

# Subtest: test/cli/lib/session.self-note.doctest.md
    # Subtest: session.self-note.doctest.md:20 — const note = parseSelfNote('<self-note ref="_config/schedules/daily.card" commit="abc123">body text</self-note>');
        ok 1 - line 23: print(`body: ${note.body}`)
        1..1
    ok 1 - session.self-note.doctest.md:20 — const note = parseSelfNote('<self-note ref="_config/schedules/daily.card" commit="abc123">body text</self-note>'); # time=12.043ms
    
    # Subtest: session.self-note.doctest.md:33 — const note = parseSelfNote("<self-note>just a body</self-note>");
        ok 1 - line 36: print(`body: ${note.body}`)
        1..1
    ok 2 - session.self-note.doctest.md:33 — const note = parseSelfNote("<self-note>just a body</self-note>"); # time=0.397ms
    
    # Subtest: session.self-note.doctest.md:46 — const note = parseSelfNote('<self-note ref="foo.card">hello</self-note>');
        ok 1 - line 48: print(`commit: ${note.commit}`)
        1..1
    ok 3 - session.self-note.doctest.md:46 — const note = parseSelfNote('<self-note ref="foo.card">hello</self-note>'); # time=0.247ms
```

Reproduce at the blamed landing:

```bash
git log -1 5d7a909f
pnpm --dir beebox exec tap test/cli/lib/session.oversize-lines.doctest.md
```
