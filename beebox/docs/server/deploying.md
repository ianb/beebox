# Deploying

Shipping a commit to the production server, what the deploy does to a running fleet, and how to roll back.

## `deploy.sh`

The everyday deploy (also fired automatically by the root husky
`post-commit`/`post-merge` hooks on `main`) deploys a Git commit. It builds in the
persistent detached checkout `<main-repo-root>/.deploy-checkout` and transfers
the result to a separate server staging directory. `--skip-restart` stops there:
the running installation has not been activated.

The staged CLI's maintenance controller then closes admission for affected
boxes, waits for accepted work, and records Git recovery snapshots. It stays
alive outside the services while the activation script stops them, copies the
staged release into `/opt/beebox`, installs dependencies, converges boxes,
restarts services, and checks readiness. Ordinary requests do not acquire the
controller's maintenance permissions. `deploy-info.json` records the shipped
commit; final deployment success is written only after the checks finish.

The controller runs as root and holds no gate file itself: it groups the boxes
by owner and starts one holder (`bbx engine maintenance hold`) per owner, as
that owner, which closes and later reopens its boxes. On the old layout that
is one holder as `beebox`; on a unit host it is one per box user. A host with
no box runs the activation alone.

Per-box convergence invokes `bbx migrate --sweep --within-maintenance --json`
under the existing controller. That single operation handles deterministic
migrations and generated guidance with snapshots and changed-path commits.
Dirty input is accepted, and no repair agent runs inside that shared downtime.
Its separate ten-minute command limit remains. A box needing repair is reported
and stays closed; restarting its process does not clear failed convergence.
When convergence fails, the deploy then runs the same bounded repair the hourly
`box-convergence` schedule runs (`bbx engine migrate --sweep --repair`, 25-minute
limit) for each box that still has a pending migration, after the other boxes
are serving again, and still reports the deploy as failed. A chained deploy waits
for it. The repair runs only when the activation reached its restart and both
services are up. A failure before the restart starts the services again on the live tree as it
stands (new code, possibly old dependencies), skips the repair, and fails the
deploy at once. The hourly schedule retries anything the repair leaves. See
[migrations](../cards/migrations.md) for recovery, questions, and timeout limits.

The shared drain accounts for gate-aware writers. The first rollout from older
code needs an explicitly quiesced fleet; a new controller alone cannot register
work already running in an older server or CLI. External editors and raw Git
commands also remain outside admission enforcement.

The healthcheck has two depths, both diag-key-gated and run on the server's
localhost (see [`../docs/health-checks.md`](health-checks.md)): it polls
the hub's `/healthz` for up to 180s and **fails the deploy** unless the verdict
is `ok` (the hub is up and no box is crash-looping), then hits `/healthz/canary`
to cold-start one real box and confirm it serves — so a child-only startup
failure (e.g. a native-module ABI mismatch that leaves the hub itself green)
fails the deploy instead of shipping silently. The 180s window replaces an old
30s poll that raced the hub's cold boot; the endpoints now require the bearer
key, so an unauthenticated external monitor gets 401.

```bash
./deploy/deploy.sh                 # deploy HEAD of this checkout
./deploy/deploy.sh --ref <sha>     # deploy (or roll back to) any commit
./deploy/deploy.sh --skip-restart  # stage only; leave the live installation unchanged
```

Concurrent deploys collapse latest-wins: a run that finds another deploy in
progress records its request and exits; the running deploy chains to the
newest request when it finishes. Hook-triggered runs each log to
`deploy/.deploy-logs/`, with `deploy/.last-deploy.log` symlinked to the newest
(see `deploy/AGENTS.md` for the wait/poll pattern).

While the services are stopped, nginx serves a deploy page instead of its bare
502. The activation script puts it up before the stop and takes it down from
its EXIT trap (`server-bin/bbx-deploy-window`); the page's presence in
`/run/beebox-deploy/` is what tells nginx the 502 is a deploy
(`nginx/beebox.conf`). The page is public, so it states only the start time and
the median of recent downtime windows, and it says so when a deploy runs past
ten minutes or an hour. Nothing that identifies the change appears on it.
Timing records: the server appends each window to
`/var/lib/beebox-deploy/windows.tsv`; the laptop appends one line per deploy
(start, end, outcome, measured downtime) to `deploy/.deploy-logs/deploys.jsonl`,
and each progress line in the log carries a UTC time.

A deploy that fails because `ssh` could not reach the server (exit 255) is
reported as a failure, not an interruption, and still hands off to a queued
deploy. Only a signal the deploy itself received counts as an interrupt.

The hook records its requested SHA synchronously before launching through
`bin/lib/detach.ts`, so an agent command ending cannot kill the deploy by
process group. That ordered hook request stays authoritative: a late-starting
older child cannot overwrite newer intent.

## A unit host

On a host migrated to one user and one unit per box
([per-box units](../plans/per-box-units.md)), the deploy also: stops every
`beebox-box@*` socket and service with the hub and scheduler, so a request
during the window cannot wake a box onto a half-copied tree; installs the
versioned units (`deploy/systemd/beebox-box@.socket`, `beebox-box@.service`,
`beebox-pass@.service`) and the `box-sandbox.conf` drop-in both templates
include; installs `bbx-box-run` and its one sudoers line for `beebox-sched`;
converges each box as its own user with the units' `/etc/beebox/box.env`;
runs `bbx host sync` for each box as root, installing the distro packages the
box recorded since the last deploy (a sandboxed box cannot install, it records);
reconciles each box's `node_modules` as its owner; and starts the sockets again
after the services. The one-time migration is
`deploy/server-bin/migrate-to-box-users.sh`, run by hand as root after a
snapshot with the services stopped; `--dry-run` prints every step. A host
provisioned before `cloud-init.yaml` needs what that file gives a fresh one
first: `claude` and `uv` in `/usr/local/bin` (a box unit cannot see
`/home/beebox/.local/bin`), a system git identity, and the `claude-update`
unit running as root; the script refuses until the first two are there. After
the run a deploy writes the scheduler's sudoers entry. Box users have no login
file: before the run, store a `claude setup-token` token under
`claude-oauth-token` and grant it to every box, so the migration's secret
export carries it into each box's store ([configuration](configuration.md),
"The long-lived token").

## The maintenance boundary

Migration, deployment, and supervised development reload use the same per-box
admission boundary: close admission, drain accepted work, perform the change,
verify readiness, then reopen. New mutating requests receive a retryable 503;
new independent CLI actions are refused. Accepted agents keep permission for
their descendant tool calls, so draining does not cut off the tools they need
to finish. Queued turns and due timers remain pending. Read-only health and
`bbx migrate --status --json` remain available for diagnosis.

The gate lives under the Git directory at `bbx-maintenance/`, outside box data.
Its phase and held owner/work locks are shared across processes. The normal
drain limit is ten minutes. A drain timeout does not force active work to stop.
After changes begin, an owner crash or failed conversion keeps admission closed
until recovery verifies completion; deleting a lock or phase file does not
repair the box. Recovery snapshots and unanswered migration questions are
explained in [migrations](../cards/migrations.md).

The deployment controller outlives the hub and scheduler it replaces. For a
supervised development bundle reload, the child asks the hub supervisor to own
the drain and replacement; reopening waits for the replacement's successful
readiness response. A 503 does not count as ready. A standalone `bbx serve`
process reports that its bundle changed and requires an explicit restart; it
cannot promise a supervised handoff by exiting itself. Older processes that
predate this protocol and external editors need explicit quiescence during the
first rollout.

## What production executes

`bbx serve` (spawned by `bbx hub` per box, or run directly) runs the single-file esbuild bundle at `dist/cli.mjs` (built by `src/scripts/build-cli/build/bundle.ts`), not tsx on source and not a per-file compiled tree. `deploy/deploy.sh` builds the bundle in its local build checkout (a detached git worktree at the deployed ref, see `deploy.sh` above) and rsyncs it — `bin/bbx` sees the bundle is newer than every backend `.ts` (the deploy builds it last) and runs it directly; tsx is only the fallback if a build fails. `deploy/deploy.sh` also rsyncs the `.ts` sources, but they're not what the server executes. `bbx hub` itself runs from the same bundle.

Consequences:

- The bundle lives at `dist/` — one level below the package root, **not** `dist/webapp/`. So `import.meta.dirname` inside the running code is `/opt/beebox/beebox/dist`. Resolve package-relative asset paths (frontend dist, templates, tsconfig) via `src/lib/package-root.ts` `PACKAGE_ROOT` (walks up to the `beebox` package.json — correct under both the bundle and tsx), never a hardcoded `import.meta.dirname + "../.."` that assumes a 2-level layout. A `../..` path that worked under tsx silently overshoots under the bundle — this is what made the frontend serve its "not built yet" fallback for every box (fixed 2026-06-20).
- If a behavior seems not to have deployed, the source rsync isn't enough — confirm `dist/cli.mjs` rebuilt (its mtime should be newer than the sources). A stale bundle keeps serving old code even with fresh `.ts` on disk.

## Rolling back

Any commit in history redeploys with one command from a local checkout:

```bash
./deploy/deploy.sh --ref <old-sha>
```

This runs the FULL pipeline (build from that commit in the deploy build
checkout, frozen install, restart, healthcheck), so a rollback is exactly as
safe as a deploy. Pick the target from `deploy-history.json` on the server
(`/opt/beebox/beebox/deploy-history.json` — newest first; entries
carry `requestedRef`, so previous rollbacks are recognizable). Rolling forward
again is the same command with the newer sha. Note a rollback across a
`pnpm-lock.yaml`/`patches/` change triggers a clean reinstall in the build
checkout, so it takes a few minutes instead of seconds.
