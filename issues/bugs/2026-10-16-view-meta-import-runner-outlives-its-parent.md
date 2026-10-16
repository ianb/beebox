---
title: "The view meta-import runner can outlive its parent and spin at full CPU for weeks"
workstream: unattached
area: beebox
labels: [views, process-hygiene]
filed-by: agent
discovered-by: Ian
discovered-in: main session — the developer's machine was slow, 2026-10-16
---

On 2026-10-16 one `extract-meta-runner.mjs` process from a `bbx-view-*` temp
directory had run at 100% CPU for 16 days and 18 hours (327 CPU hours). Its
parent was gone (`ppid` 1). It was killed by hand; the load average fell from
about 17 to about 5.

## Mechanism

`runInSubprocess` (`beebox/src/webapp/views/compiler/meta-import.ts:63`) starts
the runner with `spawn(..., { timeout: IMPORT_TIMEOUT_MS, killSignal: "SIGKILL" })`.
The timeout is enforced by the parent. When the parent exits first (a test
process that ends, a killed server, a restarted hub), nothing kills the child.
A view module with an infinite loop at import time then spins forever. That
case is the one the subprocess exists for (the file's own header says so).

Which view or process started it is not known; the temp directory's view files
were not kept.

## Fix direction

- The runner enforces its own limit: it starts a timer at the top and calls
  `process.exit` when it fires. A synchronous infinite loop blocks timers, so
  this alone is not enough.
- A hard limit that does not need the event loop: run the import in a
  `Worker` with the runner watching it, or have the runner exit when its
  stdin closes (the parent holds a pipe; a dead parent closes it), checked
  from a worker thread.
- Simplest robust form: a CPU-time limit on the child (`ulimit -t` through a
  shell wrapper, or `setrlimit` before exec). `ulimit -t 5` kills a spinning
  child with SIGXCPU whether or not the parent is alive.

A doctest can start the runner on a module with `while (true) {}`, kill the
parent, and assert the child is gone within a few seconds.
