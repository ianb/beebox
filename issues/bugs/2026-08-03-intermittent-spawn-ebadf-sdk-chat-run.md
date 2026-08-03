---
title: "Intermittent `spawn EBADF` starting the SDK chat run (local macOS dev) — chat send 500, recovers on retry"
area: callback-box
filed-by: agent
discovered-in: main session — boxholder hit "internal server error" on a local box, twice
---

> **🔎 Root cause found: a file-descriptor LEAK in `cb serve` (not the upstream
> race).** The logging from `66352beb` fired on the next occurrence (2026-08-03
> 01:06) and reported **`openFDs=11227`** — FD exhaustion, not a spawn race.
> `lsof` on the box's `cb serve` process showed **~9,600 open regular-file read
> descriptors, ~9,438 of them under `content/store/`** (a mix of cards + their
> image assets: 4,749 `.webp`, 3,641 `.card`, 618 `.md`, 383 `.jpg`, 171 `.png`
> — each distinct path, opened once, never closed). So a store-wide scan in
> `cb serve` holds a file handle for every file it reads. It **accumulates
> slowly over the process's multi-hour life** (independent of load — the box's
> `generate-image` trick auto-commits were ~8h prior and NOT responsible). Not
> urgent (local-only, self-recovers on retry); boxholder is watching it.
>
> **Next: find the unclosed open.** Leads: `core/asset-manifest.ts` `sha256File`
> (`createReadStream` to hash assets — though modern Node auto-closes on
> end/error, so verify), and whatever re-indexes / rebuilds a manifest or
> refresh-map after a commit and streams/opens every store file. The fd is a
> numbered read handle (`Nr`), so it's an open descriptor a scan is holding, not
> a memory-map.

A chat send occasionally 500s with `spawn EBADF` at the moment the SDK subprocess
is spawned. It **recovers on retry** — the box cold-restarts and the next send
works.

```
[ChatSession:start] Starting SDK chat run
[http] POST /<box>/api/chat/send failed (500): spawn EBADF
```

## Evidence

- **2 occurrences**, both on **one local box** (2026-08-02T04:46, 2026-08-03T00:51,
  ~20h apart), none on any other local box or worktree clone. Almost certainly
  because it is the most-exercised local box (the manual playground →
  most SDK spawns → first to hit a rare spawn flake), not because it's special.
- **Node v24.18.0, macOS.** Local dev only (dev router → `cb hub` → `cb serve` →
  SDK spawns `claude`). Prod is Linux and has not shown it.
- First occurrence coincided with an unstable-environment window (a `node_modules`
  desync); it was initially written off as one-off collateral. The **second**
  occurrence on a healthy environment falsified that — it is a real intermittent.

## Root cause: known upstream, not our code

`spawn EBADF` (also EMFILE/ENFILE) on **macOS + Node 22+** is a documented libuv
file-descriptor **race/exhaustion** in `uv_spawn` — pipe handles closed/invalidated
before the spawn completes, or the process hitting the FD limit. Widely reported
(nodejs/node; OpenClaw has the same bug filed — issues #8038, #12181). A common
concrete trigger is a **file watcher exhausting the FD limit** (macOS default soft
limit is a low ~256) — plausible in our dev setup (Vite watchers + the router +
multiple worktrees all in one process tree).

## What was done (this issue's headline)

`session/start-run.ts` `startBackendRun()` now wraps `backend.start()` and, on
failure, logs the **open-FD count** (`readdir("/dev/fd")`) plus the errno:

```
[ChatSession:spawn-failed] SDK subprocess spawn failed (code=EBADF, openFDs=NNN). ...
```

## Next step (on recurrence — read the openFDs count)

- **High openFDs (near ~256)** → FD **exhaustion**. Fixes: find/fix an FD leak
  (a watcher without a `node_modules`/ignore pattern is the classic culprit),
  and/or raise the soft `ulimit -n` for the dev processes.
- **Low openFDs** → a pure **spawn race** (the libuv/posix_spawn CLOEXEC window).
  Fixes: a single bounded spawn-retry on EBADF at the `startBackendRun` seam, or
  wait on the upstream Node fix. Retrying one time here would make the failure
  invisible to the user (it already succeeds on the *next* send).

Low user impact today (local-only, self-recovers on retry), so this is
data-gathering, not urgent.
</content>
