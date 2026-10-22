---
title: "Full-suite red: test/webapp/routes/chat.send-fast-ack.doctest.md"
workstream: busy-send-rejection
area: beebox
priority: important
resolution: implemented
filed-by: agent
discovered-by: agent
discovered-in: worktree-busy-send-rejection — the hourly full-suite run on main
---

> **Closed 2026-10-16: fixed by `9099b2965`** ("Test: park the engine start, not
> send(), in the fast-ack doctest"). The busy-send change made the route ack
> only after the session admits a send; the doctest parked `send()` before
> admission, so the ack never came. The gate now parks the engine start. Later
> hourly full-suite runs on `main` passed. Commit IDs below predate the
> 2026-10-15 history rewrite and no longer resolve.

The hourly batched full-suite run (`schedules/full-suite/`) went red on `main` at
`ca25026f`. Bisecting the landings since the last tested
commit (`047306ba`) over first-parent `main` blames one landing:

- **Landing:** `97bead0a` — Merge branch 'worktree-busy-send-rejection'
- **Workstream:** busy-send-rejection
- **Failing file:** `test/webapp/routes/chat.send-fast-ack.doctest.md`

Each file failed in the batched run and failed again on an isolated re-run, so
it is not a flake by the ledger's definition. Nothing has been fixed; this is a
report.

```
not ok 918 - test/webapp/routes/chat.send-fast-ack.doctest.md # time=300822.344ms
  ---
  stdio: inherit
  cwd: /private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-OthljF/checkout/beebox
  externalID: test/webapp/routes/chat.send-fast-ack.doctest.md
  command: ~/.nvm/versions/node/v24.18.0/bin/node
  args:
    - --import=file:///private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-OthljF/checkout/node_modules/@tapjs/mock/dist/esm/import.mjs
    - --enable-source-maps
    - --import=file:///private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-OthljF/checkout/node_modules/@tapjs/processinfo/dist/esm/import.mjs
    - --disable-warning=DEP0040
    - --import=tsx
    - --import=./test/helpers/isolate-user-home.ts
    - --import=agent-doctest/tap
    - --import=agent-doctest/loader
    - --import=./test/helpers/isolate-secret-store.ts
    - --import=./test/helpers/isolate-auth-file.ts
    - --import=./test/helpers/isolate-origin-id.ts
    - --import=./test/helpers/isolate-codex-home.ts
    - /private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-OthljF/checkout/beebox/test/webapp/routes/chat.send-fast-ack.doctest.md
  jobId: 3
  exitCode: null
  signal: SIGALRM
  ...

# Subtest: test/webapp/routes/chat/audio-routes.transcribe.doctest.md
    # Subtest: audio-routes.transcribe.doctest.md:36 — const res = await postClip(ctx);
        ok 1 - line 43: JSON.stringify({ status: res.statusCode, code: res.body.code, permanent: res.body.permanent, namesTheSecret: /"openrouter"/.test(res.body.error) })
        1..1
    ok 1 - audio-routes.transcribe.doctest.md:36 — const res = await postClip(ctx); # time=2019.874ms
    
    1..1
```

Reproduce at the blamed landing:

```bash
git log -1 97bead0a
pnpm --dir beebox exec tap test/webapp/routes/chat.send-fast-ack.doctest.md
```
