---
title: The dev router's main thread stalls in a blocking write to its terminal
workstream: unattached
area: workstreams-app
labels: [router, smoke, flake]
filed-by: agent
discovered-by: agent
discovered-in: "shared-browser — smoke timeout investigation, 2026-10-30"
---

The shared dev router sometimes stops answering, and `bin/smoke` goes red with "the dev router is not answering on its socket". On 2026-10-30, 8 of 24 smoke runs on one worktree went red in two episodes of about a minute (13:52 to 13:53, 13:59 to 14:00 UTC): 2 page `open` calls timed out at about 30 s, and each was followed by runs that failed with that message (6 runs). The first of those followed a lockfile change, which also makes Vite re-optimize. The router recovered without action. The next ten runs were green.

One shorter stall, of over 3 s, was sampled with `sample` on the router process. The main thread was in `write` (3063 of 3148 samples: `uv__try_write` from `LibuvStreamWrap`, reached after a file handle closed). The router's stdout and stderr are `/dev/ttys000`, the terminal running `pnpm dev`, and Node writes to a terminal synchronously. So while that terminal is slow or not draining, every request through the router waits.

Not established: that the minute-long stalls have the same cause (only the short one was sampled), what the router was writing, and why the terminal was slow.

Done when the router does not block on its terminal, for example by keeping per-request output in `router.log` only, or when the long stalls are shown to have another cause. Restarting the shared router needs the boxholder's yes.
