---
title: "Main runtime stays stale after a deploy rebuild"
workstream: dev-loop-lifecycle
area: router
filed-by: agent
discovered-by: Ian
discovered-in: worktree-codex-engine-plan — verifying a fresh Codex chat after landing
priority: important
resolution: implemented
---

> **Closed 2026-08-24** in
> [dev-loop-lifecycle](../../../beebox/docs/implemented-plans/dev-loop-lifecycle.md)
> — as *detection*, not as automatic replacement.
>
> The router records a token for `beebox/src` (excluding `src/frontend`,
> which Vite hot-reloads) plus `beebox/package.json` when it spawns a hub,
> rechecks it at most every 5s on the request path, and reports a mismatch as
> `staleSince` in `/__router/status` and `ready (stale)` in
> `bin/workstreams list`. Git `HEAD` was the first candidate and is wrong: the
> hub runs TypeScript from disk through tsx, so `HEAD` misses uncommitted edits
> and moves for commits touching nothing it loads.
>
> **Nothing restarts automatically, deliberately.** A quiet-window restart was
> designed and cut: `touch()` records HTTP activity only, and this router
> documents that WebSockets never count as worktree activity, so a live chat is
> indistinguishable from an idle worktree and there is no moment the router can
> prove is safe to cut. The reported cost here was an agent losing time to a fix
> that had landed and was not running — a cost paid because staleness was
> invisible. `bin/workstreams down <name>` remains the remedy, and when to run
> it stays a human call.

The main checkout can rebuild `beebox/dist/cli.mjs` without replacing an
already-running main hub generation or its `bbx serve` children. The router sees
the generation as healthy and continues to route requests to processes that
loaded the previous build.

This caused a fresh Codex chat to use pre-fix model-selection code after the fix
had merged and the deploy hook had produced a new build. The observed process
timeline was:

- The main hub and box child started before the merge.
- The merge hook rebuilt `dist/` successfully.
- The shared router remained alive and continued to reuse the old hub and child.
- `bin/workstreams down main` followed by an authenticated request started a new
  generation, which loaded the current build.

> **Checked 2026-08-18 — the box-child half is solved; the hub half is not.**
> The invalidation contract this issue asks for now exists, from
> [long-lived processes never reload the rebuilt bundle](2026-08-15-long-lived-processes-never-reload-the-rebuilt-bundle.md):
> `bin/bbx` stamps `BBX_DEV_BUNDLE_PATH`/`BBX_DEV_BUNDLE_ID` at spawn, identifying
> the exact artifact loaded by *identity* rather than mtime ordering, and
> `src/webapp/server.ts:359-383` polls for a replacement.
>
> The design is careful in the right places. A **hub child** drains before
> reloading — pausing chat schedules, waiting for no active mutations, idle chat
> runtimes, and idle schedule deliveries — then exits with
> `DEV_BUNDLE_RELOAD_EXIT_CODE` so its supervisor replaces it. A **standalone
> `bbx serve`** deliberately does *not* self-replace (its pidfile and orphan
> detector make overlapping parent/successor lifetimes destructive) and only
> warns.
>
> Verified on live processes: main's hub (pid 5722, 19:15:06) and its box child
> (5814, 19:15:10) both postdate the current bundle (18:13), the child carries
> both `BBX_HUB_SECRET` and `BBX_DEV_BUNDLE_ID` so it takes the self-reload
> branch, and the child's identity changed between two samples minutes apart —
> the supervisor is replacing children in practice. The reload was separately
> observed end to end on the scheduler: a forced rebuild produced a re-exec onto
> the new identity in ~75 seconds.
>
> **What remains, and why this stays open:**
>
> - **The hub itself is not covered.** It runs via `tsx` from source, spawned by
>   the router rather than through `bin/bbx`, so it is never stamped and never
>   checks. Hub-level code changes still require a router restart — and this
>   issue's scope is explicitly "the main hub generation *or* its `bbx serve`
>   children".
> - **A busy box can still run stale code.** The drain gives up after 10 minutes
>   and continues on the loaded bundle with a warning, by design — never wedge a
>   box. That is the right trade, but it means staleness is now *loud* rather
>   than impossible.

The deploy or router lifecycle needs an explicit invalidation contract for main
backend changes. Possible locations include the post-merge deploy hook, a build
generation marker checked by the router, or source/build watching in the hub
supervisor. The right mechanism must preserve the invariant that worktree
processes and the shared router are not restarted unnecessarily.
