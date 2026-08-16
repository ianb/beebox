---
title: "`cb serve` file-descriptor exhaustion made every SDK chat spawn fail with `EBADF`"
workstream: unknown
area: callback-box
filed-by: agent
discovered-in: main session — boxholder hit "internal server error" on a local box
resolution: implemented
---

> **✅ Fixed** in `9b2aa44d` (root cause) and `054cc4f4` (cross-model review
> hardening). The box file watcher used chokidar, which calls `fs.watch()` once
> per **file**; on macOS a file watch holds an open read descriptor for that
> file's whole life. It now watches directories only.

## Root cause

Not the upstream libuv spawn race this was first filed as, and not an unclosed
read handle in a store scan (the second, also wrong, diagnosis).

`core/box/file-watcher.ts` watched the whole box root with chokidar, started
lazily on the first `events.subscribe` WebSocket. chokidar watches every *file*
individually, and on macOS each file watch pins an open read descriptor. On a
box with ~9.4k files that was ~9.4k descriptors held for the life of the
process — which matches the `lsof` evidence exactly (~9,438 numbered read
handles on distinct `content/store/` paths, in whole-tree proportions rather
than "files chat happened to read").

The failure threshold is macOS's legacy per-process `OPEN_MAX` of **10240** —
not `ulimit -n` (1048576 on the affected machine) and not `kern.maxfilesperproc`
(61440). Past it *every* `spawn()` in the process fails with `EBADF`, so it was
never intermittent in the way it looked: a box just under the line failed
occasionally, and a box over it could not start the chat agent at all.

Measured directly:

| open FDs held | `spawnSync("/bin/echo")` |
|---|---|
| 10000 | ok |
| 10200 | ok |
| 10500 | `EBADF` |

And on a 1287-file box: chokidar `12 → 1254` open FDs; one `fs.watch` per
*directory* `12 → 12` for 213 directories. Only per-file watches cost
descriptors. Verified end-to-end against the real module and a real box:
`24 → 25` FDs for 208 watched directories.

## The fix

Three parts, all in `9b2aa44d`:

1. **Watch directories, not files.** A small recursive per-directory watcher
   replaces chokidar, keeping the dotfile and high-churn-tree exclusions
   (`procedure/runs`, `store/trash`) that Node's own
   `fs.watch(root, { recursive: true })` offers no hook for. Costs zero extra
   descriptors on macOS and ~7x fewer inotify watches on Linux. No consumer
   branched on chokidar's event names — all six read only `path`.
2. **Unwind a failed run start.** `ChatSession` was left in the `starting`
   phase when `backend.start()` threw, which reads as permanently busy, and
   neither `stop()` nor `restart()` could clear it (both need a live run to
   close). Every later message queued behind a turn that would never end —
   the "wedged agent". `openChatRun` now releases the chat-active lock,
   returns the session to `idle`, and rethrows.
3. **Record the user message after the send, not before.** `chat-user-message`
   is a *persisted* event, so emitting it first left messages in conversation
   history that the agent never received, while the 500 handed the text back
   for a retry that recorded it twice. A related edge was worse than the
   duplicate: the `messageId` claim was also taken pre-send and never
   released, so the client's same-id retry was answered `deduplicated: true`
   and the message was dropped outright. The claim is still taken up front (it
   guards a concurrent double-submit) and is now released when the send does
   not land.

`054cc4f4` then fixed six defects a cross-model (Codex) review found in that
work — directory replacement blinding the watcher, runtime symlinks being
followed, a message enqueued during a failed start never being scheduled, a
throwing `run.send()` wedging the lifecycle one layer down, files inside a
directory that appeared complete never being reported, and a failing lock
release skipping the state reset.

## Left alone

- `core/schema-watcher.ts` still uses chokidar, on the single `config/schemas`
  leaf. That is a handful of files, so its descriptor cost is negligible — but
  it is the same pattern, and worth converting if that directory ever grows.
- Persisting the user message after the send leaves a gap where a crash
  delivers a message without recording it. That is the inverse of the bug
  fixed above and was the deliberate trade.
