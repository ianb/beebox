---
title: "The box file watcher watches every directory in the box — 69k watches on a real box, and it OOMs the whole server"
area: callback-box
filed-by: agent
discovered-in: ios-capture-upload-diag worktree — heap snapshot of the live prod box-family child, 2026-08-05
resolution: implemented
---

> **Fixed.** The watcher is now bounded (`90ededb8` "Bound box file watcher scale",
> `19fdd325` notification-work bound, `7bc48388` streamed bounded traversal,
> `054cc4f4` Codex-review hardening): a hard `MAX_WATCHED_DIRS = 1024` cap it
> refuses to exceed with a loud limit-reported log and graceful degradation (the
> over-cap subtree stops live-updating instead of OOMing), plus the `HIGH_CHURN_DIRS`
> exclusion and a `MAX_NOTIFICATION_WORK` bound. The 69k-directory box caps to
> 1024 — the OOM cause is gone.

> **Job to be done:** *When one part of my box is huge or pathological, I want
> that to degrade that part — not take down the whole server for every other
> thing the box does.*

`core/box/file-watcher.ts` recursively walks the entire box root and installs an
`fs.watch` on **every** directory it finds. On a real box that is unbounded:

| box | watchable directories |
|---|---|
| **box-family** | **69,048** (68,869 under `box/` — the email inbox) |
| estate | 793 |
| personal | 200 |

A live heap snapshot of prod's box-family `cb serve` (taken at 1.5GB RSS by a
threshold watcher, mid-climb) shows **69,013 `native:Node / FSEventWrap` +
69,014 `object:FSWatcher`** — a 1:1 match with the directory count, so this is
**scale, not a leak**. Plus the walk itself: `addDir` recurses with
`Promise.all(entries.map(...))` (unbounded concurrency) over 69k directories,
which is a large transient allocation spike on top of the persistent watcher
cost. The process reached 2.5GB RSS; V8 heap OOMs followed.

## Why this is the box-family OOM

Five `cb serve` heap OOMs 2026-08-03/04/05, all on box-family only. This
explains every discriminator the investigation kept hitting:

- **Only box-family.** 87× the directories of the next box. Estate has 32GB of
  annex media but 793 directories and has never crashed.
- **Only with a client attached.** The watcher starts lazily on the first
  `events.subscribe` — i.e. when a chat page (or the iOS webview) connects.
  Crashes cluster ~10s after `[ChatSession:init] Loaded session`.
- **Started 2026-08-03.** The per-directory watcher shipped 2026-08-02
  (`9b2aa44d`, the fix for
  [spawn-EBADF FD exhaustion](2026-08-03-intermittent-spawn-ebadf-sdk-chat-run.md));
  the first heap OOM is the next evening. The rewrite was correct for the FD bug
  — per-file watching was worse — but it moved an unbounded cost rather than
  bounding it.
- Not the chat-history parse cost
  ([that item](2026-08-04-chat-history-parse-transient-oom.md) was a real,
  separately-verified bottleneck: +216MB→+0.04MB on a fetch storm — but fixing
  it did not stop the crashes).

## Two problems, deliberately separate

1. **Isolation (the general lesson).** A subsystem that can be pathological on
   one box should not be able to kill `cb serve` for everything else. The
   watcher currently has no budget, no failure mode short of process death, and
   no visibility — nothing logs "I just installed 69,000 watches." Whatever the
   scale fix is, the watcher should also be *containable*: a cap it refuses to
   exceed, a loud log when it does, and degradation (that subtree stops
   live-updating) rather than an OOM.
2. **Scale (this box's shape).** Even bounded, watching 69k directories to serve
   a chat page is the wrong shape. Candidate directions, not yet decided:
   watch only what a client is actually looking at (the chat's context dir, the
   browsed path, `tmp-capture`) rather than the whole box; a depth/count budget
   with LRU eviction; extending the existing `HIGH_CHURN_DIRS` exclusion
   (`procedure/runs`, `store/trash`) to cover bulk-import trees like the email
   inbox; or Node's `fs.watch(root, { recursive: true })` (the module doc
   rejects it for lacking a per-path filter — re-evaluate that tradeoff against
   69k handles).

The email inbox being 68,869 directories is its own problem — see
[email connector needs volume limiters](2026-08-05-email-connector-needs-volume-limiters.md)
and [file-based email doesn't scale to a real inbox](../decisions/2026-08-05-email-storage-api-vs-file-based.md).
Fixing those shrinks this box but does not bound the watcher, which is why this
is filed separately.

## Reproduction / evidence

- Live snapshot technique (no pre-arming needed): `kill -USR1 <pid>` opens the
  inspector; a small script over the builtin `WebSocket` drives
  `HeapProfiler.takeHeapSnapshot`. A threshold watcher that snapshots at 1.25GB
  is what caught this — `--heapsnapshot-near-heap-limit` wrote a **0-byte** file
  (the process is too far gone at the limit to serialize 1.9GB), so don't rely
  on it alone.
- Analysis: parse the snapshot's `nodes`/`strings` arrays and histogram
  `self_size` by constructor — the 69k `FSWatcher`/`FSEventWrap` count is
  immediately visible at the top.
- `find <box>/content -type d -not -path "*/.*" | wc -l` gives the watch count a
  box will install.
