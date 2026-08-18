---
title: "A hand-launched Chrome for Testing is invisible to process cleanup — one burned 21h of CPU"
workstream: unattached
area: router
labels: [process-lifecycle, agent-browser]
filed-by: agent
discovered-by: Ian
discovered-in: main session — boxholder noticed a Chrome helper eating a core
priority: normal
---

The boxholder noticed a "Chrome for Testing Helper (Renderer)" pegging a core.
It had been running **15 hours** and had consumed **21 hours of CPU time**
(1259 minutes across its threads), holding 1 GB resident, in state `U`. Not a
zombie — a live renderer in a busy loop.

Its ancestry:

```
codex  (workstreams worktree)
 └─ bash -c: chrome --headless=new --dump-dom \
      'http://127.0.0.1:<port>/workstreams/issues?needs=manual-testing' | head -100
     └─ Google Chrome for Testing
        └─ Renderer            ← 85% CPU for 15h
```

A codex worker scraped the issues page with a throwaway headless Chrome and the
browser never exited. A second one from the same session, a minute earlier, was
still alive too (idle). Both survived until killed by hand.

## The reapability gap

`bin/process-cleanup.ts` is the backstop for browser processes that pidfiles
cannot see, and it matches agent-browser by binary path:

```
const ab = r.command.match(/(\/\S+)\/node_modules\/agent-browser\//);
```

That matches the **daemon** — `<root>/node_modules/agent-browser/bin/agent-browser-*`.
It does not match a raw
`~/.agent-browser/browsers/chrome-<version>/…/Google Chrome for Testing`, which
is what you get when an agent invokes the downloaded browser binary directly
instead of going through `bin/browse`. So `bin/workstreams panic` — the command
whose whole job is reclaiming stray browsers — would never have touched this
one, and nothing else would either. It was reachable only by `ps` and a manual
kill.

This is a real hole in a guard that reads as complete. The module's own header
says it exists because "agent-browser daemons are invisible to pidfile-based
cleanup"; the same argument applies with more force to a browser nothing
tracked at all.

## Two things to fix, and they are separable

**1. Make the cleanup match the browser, not just the daemon.** A pattern for
the `~/.agent-browser/browsers/` path would have caught this. The care needed:
the daemon's own Chrome children live under that same path, and sparing them is
the existing "current daemon" rule — so the match must be by process tree or by
profile dir, not blanket. A hand-launched one is identifiable by its
`--user-data-dir` pointing at a `mktemp` directory rather than a worktree
socket dir.

**2. Find out why the renderer spun.** `--dump-dom` should print and exit. It
did not, and the renderer burned CPU rather than sitting idle, which points at
the page rather than at Chrome. Unverified — the reproduction needs the
workstreams app on a port that skips router auth, which is how the codex
session reached it. Worth checking whether
`/workstreams/issues?needs=manual-testing` has something that never settles: a
perpetual animation, a render loop, or a subscription that retries forever.
Compare
[browse daemon wedges on animated canvas](2026-07-14-browse-daemon-wedges-on-animated-canvas.md)
— same family, and if the cause is "an animation keeps the page from ever
reaching a quiet state," it is the same bug wearing different clothes.

The `| head -100` in the invocation is a contributing factor worth naming
separately: it closes the pipe after 100 lines, so even a Chrome that wanted to
exit cleanly is left writing into a closed pipe. An agent reaching for
`--dump-dom | head` is reasonable; the shape just has no exit path when the
page misbehaves.

## Prevention

Agents should use `bin/browse`, which is tracked, socket-managed, and reapable.
That is documented, and this session's worker went around it anyway — probably
because `--dump-dom` is the obvious one-liner for "just give me the HTML." If
`bin/browse` has no equally short way to dump a page's DOM, that gap is the
actual cause of the workaround, and closing it is worth more than a warning.
