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
> `cb serve` holds a file handle for every file it reads.
>
> **Corrections from a 3rd occurrence (2026-08-03 01:31, `openFDs=10583`):** the
> leak is **FAST under active use, not a slow drip** — a freshly restarted
> `cb serve` accumulated **~9,300 open handles in under 5 minutes** of chat
> activity, then EBADF'd. So a box in use hits this within minutes; more reachable
> than first framed. And it does **NOT cleanly "recover on retry"** — see the two
> downstream effects below. (The image-generation trick was ~8h prior and not
> responsible.) Local-only; boxholder is watching it, but the retry/wedge effects
> raise it above "cosmetic".
>
> **Next: find the unclosed open.** Leads: `core/asset-manifest.ts` `sha256File`
> (`createReadStream` to hash assets — though modern Node auto-closes on
> end/error, so verify), and whatever re-indexes / rebuilds a manifest or
> refresh-map after a commit and streams/opens every store file. The fd is a
> numbered read handle (`Nr`), so it's an open descriptor a scan is holding, not
> a memory-map.

## Two downstream effects of a failed run-start (independent bugs, worth their own fixes)

When the spawn fails, the chat-send path handles it badly — and these are really
about run-start failure handling, not the FD leak specifically (any run-start
failure would trip them):

- **Wedged session (no cleanup).** The spawn fails fast (~120 ms, not a hang), but
  the `ChatSession` registry entry is left with an **unresolved turn** — no
  `[ChatSession:done]` / `[ChatSession:close]` event ever follows, and nothing
  auto-recovers it. The session sits mid-turn. That's the boxholder's "wedged
  agent". The run-start failure path should mark the turn failed / reset the
  session to idle so the next send starts clean.
- **Duplicate-send risk (data integrity).** The user message is **persisted to
  `events.db` (`chat-user-message`) BEFORE the SDK run starts** — so it's durably
  in the conversation history — but the spawn failure returns a 500 that the client
  treats as "unsent" and **restores the text into the composer**. Retrying then
  logs a **second** `chat-user-message` → a duplicate in history. So the send does
  NOT cleanly self-recover on retry; it risks duplication. Either the message
  should be persisted only after the run successfully starts, or the client's retry
  must be idempotent against the already-recorded message.

## The primary symptom

A chat send 500s with `spawn EBADF` at the moment the SDK subprocess is spawned.

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
