---
title: "Full-suite red: test/core/capture/resume.doctest.md"
workstream: siri-app-intents
resolution: implemented
area: beebox
priority: important
filed-by: agent
discovered-by: agent
discovered-in: worktree-siri-app-intents — the hourly full-suite run on main
---

Resolved in `80ee9b015` on 2026-10-12. The new pending session-identity
observer held a referenced ten-minute interval. The fake backend never
assigned an identity, so the assertions passed but Node did not exit.
A local isolated run reproduced the timeout with a reduced TAP budget.

The observer now uses an unreferenced awake timeout. Other timeout callers
retain their existing default behavior. The resume fixture also shuts down
its registry and closes its event bus before deleting the box.

Focused verification passed 21 assertions across resume, observer lifecycle,
and awake-timeout command tests. The observer regression arms the real
listener in a child without detaching it, then verifies normal process exit.
It also checks that unrelated assignments are ignored and the matching
identity is persisted once. Full backend/frontend typecheck and changed-file
lint passed. Physical iPhone testing is unrelated to this process-lifetime fix.

## Original report


The hourly batched full-suite run (`schedules/full-suite/`) went red on `main` at
`ee2ec3be`. Bisecting the landings since the last tested
commit (`bfd65c06`) over first-parent `main` blames one landing:

- **Landing:** `949f78e6` — Merge branch 'worktree-siri-app-intents'
- **Workstream:** siri-app-intents
- **Failing file:** `test/core/capture/resume.doctest.md`

Each file failed in the batched run and failed again on an isolated re-run, so
it is not a flake by the ledger's definition. Nothing has been fixed; this is a
report.

```
not ok 382 - test/core/capture/resume.doctest.md # time=301620.917ms
  ---
  stdio: inherit
  cwd: /private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-43Mnn2/checkout/beebox
  externalID: test/core/capture/resume.doctest.md
  command: ~/.nvm/versions/node/v24.18.0/bin/node
  args:
    - --import=file:///private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-43Mnn2/checkout/node_modules/@tapjs/mock/dist/esm/import.mjs
    - --enable-source-maps
    - --import=file:///private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-43Mnn2/checkout/node_modules/@tapjs/processinfo/dist/esm/import.mjs
    - --disable-warning=DEP0040
    - --import=tsx
    - --import=./test/helpers/isolate-user-home.ts
    - --import=agent-doctest/tap
    - --import=agent-doctest/loader
    - --import=./test/helpers/isolate-secret-store.ts
    - --import=./test/helpers/isolate-auth-file.ts
    - --import=./test/helpers/isolate-origin-id.ts
    - --import=./test/helpers/isolate-codex-home.ts
    - /private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-43Mnn2/checkout/beebox/test/core/capture/resume.doctest.md
  jobId: 5
  exitCode: null
  signal: SIGALRM
  ...

# Subtest: test/core/capture/staging-store.doctest.md
    # Subtest: staging-store.doctest.md:45 — const box = await makeTmpBox();
        ok 1 - line 47: session.state
        ok 2 - line 50: stagingSessionIsEmpty(session)
        ok 3 - line 74: JSON.stringify(afterAudio.segments.map((s) => ({ id: s.id, chunks: s.chunks })))
        ok 4 - line 77: afterAudio.segments.map((s) => s.format).join(",")
        ok 5 - line 96: JSON.stringify(staged.photos)
        ok 6 - line 99: JSON.stringify(staged.files)
        ok 7 - line 102: stagingSessionIsEmpty(staged)
        ok 8 - line 109: await box.read(`_tmp/capture-staging/${session.id}/audio-0-001.webm`)
        ok 9 - line 113: (await readStagingSession({ boxRoot: box.root, id: session.id })).state
        ok 10 - line 121: await readStagingSession({ boxRoot: box.root, id: session.id })
        1..10
    ok 1 - staging-store.doctest.md:45 — const box = await makeTmpBox(); # time=114.94ms
```

Reproduce at the blamed landing:

```bash
git log -1 949f78e6
pnpm --dir beebox exec tap test/core/capture/resume.doctest.md
```
