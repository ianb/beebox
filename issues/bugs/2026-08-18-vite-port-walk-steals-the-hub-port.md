---
title: "Vite's port-walk steals the hub's port, killing a worktree on start"
workstream: unattached
area: router
labels: [router, dev-server, lifecycle]
filed-by: agent
discovered-by: Ian
discovered-in: main session — iOS couldn't reach a box; `main` had been down for ~45 minutes
priority: normal
---

> **Checked 2026-08-18 — not fixed, on two counts.** Tagged `fixed`; removed.
> `--strictPort` landed in `c1c19dbd` at 14:23, and it is **partial by design**
> (see "Partially fixed" below): it stops the *wrong process* dying, and a
> worktree whose frontend port is taken at spawn still fails to start.
>
> Second, and more immediately: **the fix is not running.** The shared router
> process started Sun Aug 16 05:32 — two days before the commit — and it loads
> `bin/router-core.ts` at its own startup, so every worktree it spawns still
> uses the old arguments. Verified on the live process: the currently-running
> vite for `main` (spawned 17:58 today, *after* the commit) has no
> `--strictPort` in its argv. Picking it up needs a `pnpm dev` router restart,
> which is the boxholder's call — not something a session should do to the
> shared router.
>
> So the observable behavior is unchanged so far, and the remaining work in
> "What's left" is untouched.

A worktree can fail to start because **Vite takes the port the hub was going to
bind**. Observed on `main`, 2026-08-18 13:30:06, which then sat `failed` until
restarted by hand ~45 minutes later.

```
Port 52036 is in use, trying another one...
  ➜  Local:   http://127.0.0.1:52037/main/          ← Vite moved here
[…]
Error: listen EADDRINUSE: address already in use 127.0.0.1:52037   ← the hub
```

## Why the collision is structural, not bad luck

`bin/router-core.ts:373-377` allocates three ports in parallel:

```ts
const [frontendPort, backendPort, dashboardPort] = await Promise.all([
  effects.getPort(), effects.getPort(), effects.getPort(),
]);
```

Each `get-port` call binds `:0`, reads the assigned port, and closes. Run in
parallel, the OS hands back **sequential ephemeral ports** — so `backendPort`
is usually `frontendPort + 1`. And each port is only known-free at *probe*
time, not at bind time.

Vite's default behavior when its requested port is taken is to walk to the next
one. So the failure needs only one thing to go wrong — something takes the
frontend port between probe and bind — and the port Vite walks onto is, with
near-certainty, the hub's. Vite wins because the hub binds later.

## Partially fixed

`bin/router-core.ts` now passes `--strictPort`, so Vite fails instead of
walking. That converts a silent theft (hub dies, cause 30 lines up its log)
into a loud, correctly-attributed failure that the router's existing
failed-state and `/__router/retry/` path can handle.

**It does not stop the collision** — it stops the *wrong process* from dying.
A worktree whose frontend port is taken at spawn still fails to start.

## What's left

- **Probe-to-bind is a TOCTOU window**, and closing it properly means holding
  the port rather than probing it — bind-and-pass-the-handle, or retry the whole
  allocation on `EADDRINUSE` rather than failing the worktree.
- **Sequential allocation makes any walk land on a sibling.** Even with
  `--strictPort`, adjacent ports mean unrelated port pressure hits both
  processes of the same worktree together. Allocating serially, or spacing them,
  removes a whole class of interaction.
- **Retry on start failure.** Today a port collision leaves the worktree
  `failed` until a human intervenes. One automatic re-allocation would have
  turned this incident into a hiccup nobody noticed.
- **Frequency is about to rise.** Long-lived processes now re-exec themselves
  when the bundle changes
  ([stale bundle reload](../closed/bugs/2026-08-15-long-lived-processes-never-reload-the-rebuilt-bundle.md)),
  so restarts — and therefore port allocations — are more common than when this
  code was written.

## Diagnosis note worth keeping

The cause was 30 lines above the crash in
`~/.cache/callback-box/logs/main.log`, past a wall of unrelated Vite
deprecation warnings and box-resolution errors for boxes that don't exist
(`ai-class`, `scenarios`). Both of those are noise that made a clean
`EADDRINUSE` harder to find than it should have been, and the box-resolution
errors are their own small cleanup: the router is configured with box paths
that have no `.cb-box` marker.
