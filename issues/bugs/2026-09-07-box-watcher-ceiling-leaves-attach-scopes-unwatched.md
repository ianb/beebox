---
title: "A box with thousands of .attach scopes exhausts the file watcher's 1,024-directory ceiling, so most of its content gets no live updates"
workstream: unattached
area: beebox
priority: important
labels: [box-shape, performance, chat]
filed-by: agent
discovered-by: Ian
discovered-in: main session — chat images that never recovered from a first 404
---

`src/core/box/file-watcher.ts` watches directories one by one (zero FDs on
macOS via FSEvents; one inotify watch each on Linux) and stops at
`MAX_WATCHED_DIRS = 1024`, logging which subtree lost live updates. A
personal box on this machine has 5,948 directories, 5,564 of them `.attach`
scopes (one per image card), so the walk fills the budget partway through
`_content/activities/…` and everything after it is silent:

```
[box-watcher] directory watch limit of 1,024 reached for <box>; live updates below _content/<area>/… are disabled
```

What that costs: `file-change` never fires for those paths, so the chat's
image refresh (`lib/file-version.ts`), the browse sidebar's live refresh,
`FileView` reloads, and the agent-view refetch all go stale there. The
visible symptom that surfaced it: an image the agent posts in chat before the
file exists fails once and never recovers
(`2026-08-08-chat-embedded-image-404-stuck-until-reload.md`, reopened).

The ceiling exists for a real reason (the chokidar-era per-file watches
pushed `bbx serve` past macOS's `OPEN_MAX` and broke every spawn;
`2026-08-03-intermittent-spawn-ebadf-sdk-chat-run.md`), and directory
watches were the fix for ~200 directories. Attach scopes changed the
magnitude: they are one directory per image, and they are exactly the
directories whose files the UI waits on.

Directions:

- **Recursive `fs.watch` on macOS.** `fs.watch(root, { recursive: true })`
  is FSEvents-backed, FD-free, unlimited, and verified to open on this box;
  the file's own comment rejects it only because it has no per-path filter
  for the high-churn trees (`_bookkeeping/procedure/runs`, trash). Filtering
  those on the event path in JS is a volume cost, not a correctness one;
  measure it. Linux recursive `fs.watch` is inotify underneath and keeps the
  per-directory cost, so the ceiling would stay there.
- **Or watch attach scopes through their parent.** An `.attach` scope's
  files change only when its owning card's directory is touched by the same
  write; a watch on the parent plus a targeted stat of the scope on each
  event covers the chat case without a watch per scope.
- Either way, the ceiling breach should be visible in `bbx health` /
  Admin, not only a stderr line.
