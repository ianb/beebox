# Health Checks

Manual runbooks for periodic checks on the deployed beebox server. Each section is self-contained — follow the steps, report the verdict, and suggest a next action if unhealthy. These are designed to be driven by a local Claude Code agent that has SSH access to `box.example.com`.

## Hub health endpoints (`/healthz`, `/healthz/canary`)

The hub exposes two diagnostic endpoints, both requiring the `BBX_DIAG_API_KEY` bearer token (`Authorization: Bearer <key>`). An unauthenticated caller gets 401 — the endpoints used to be open and leaked slugs/PIDs/ports, so they're now gated like the box server's own `/healthz`. Both run on the server's localhost (`http://localhost:3210`); externally they're reachable at `https://box.example.com/...` with the same key.

**`GET /healthz` — passive verdict.** Reports `status: "ok"` (HTTP 200) or `status: "unhealthy"` (HTTP 503), plus per-box supervisor state. The verdict is **liveness**, not readiness: it's `unhealthy` only if a box is *broken* — crash-looping (`starting` with `consecutiveFailures > 0`) or crash-budget-latched (`unhealthy`). A `stopped` box is a lazy hub's normal resting state and is **not** a fault, so an idle fleet reads `ok`. `restarts` is a lifetime counter shown for information; the verdict never keys on it (a box that blipped once long ago would otherwise pin the hub red forever). Derivation lives in `src/hub/hub-health.ts`. This endpoint has no side effects — safe for an uptime monitor to poll.

**`GET /healthz/canary` — active child check.** Cold-starts one box (via the supervisor's `ensureRunning`), then fetches that box's *own* root `/healthz` (authenticated) and returns 200 only if the box answers 200 — otherwise 503, naming the slug. The box-healthz step matters: the supervisor's readiness probe treats *any* HTTP response as "ready", so a child that opens its port but whose health handler is broken would pass a socket-only check; requiring the box's healthz 200 makes "canary ok" mean the box actually answered. This is what catches a **fleet-wide startup break** — e.g. a native-module ABI mismatch after a Node major bump — that the passive verdict can't see, because on a lazy hub most boxes rest `stopped` and report nothing. `?box=<slug>` names the box to canary; unset picks the first configured slug. **It wakes a box** (leaving it resident for `idleMs`), so it's a deploy-time / on-demand check, not something a monitor should poll. The deploy runs it automatically (see [`deploy/README.md`](../deploy/README.md)).

Why the canary exists at all: during the 2026-07-16 Node 22→24 upgrade every box child crash-looped on a better-sqlite3 ABI mismatch while the old `/healthz` returned a constant 200 — the deploy verified "healthy" while no box could serve a request. The passive verdict now catches a crash-looping box; the canary catches a break on boxes that were never started.

## Engine quota (`waiting` is not `failing`)

When `bbx health` shows tasks as `waiting` plus an `engine: waiting on
<provider> quota until <t>` line, the box's agent engine (Claude or Codex) is
out of usage quota — a deferred-recoverable condition, not a fault. Nothing
needs fixing: scheduled work skips until the reset time, `consecutiveFailures`
does not accrue, and the boxholder was notified once with the reset time. The
machine-level record lives at `~/.local/share/beebox/engine-availability.json` and
self-expires at the reset. Investigate only if `waiting` persists well past
the stated time (the store then shows a fresh episode — quota was exhausted
again immediately, which is a capacity problem, not a code problem).

## Inconclusive (`?` is not `✗`)

When `bbx health` shows a task as `?  <name>  inconclusive` with
`last run's check reached no verdict; the work itself completed`, the run did
its work and its **checker** fell short — typically a procedure's `validate`
review hitting its turn cap. Nothing found a defect. Do not redo the work on
this signal, and do not read it as a failure: `consecutiveFailures` does not
accrue, no alert fires, and `bbx health` does not exit 1 for it. The error line
under the task names the procedure, the step, and the reason.

What to do with it: if the same task reads `inconclusive` repeatedly, the fix
is a budget or prompt fix on the *judge* (a turn cap set too low, or a review
prompt that wanders), not a fix to the work. The reason tags distinguish the
cases — see `docs/procedure-implementation.md` → Instructions.

## `health.check` snapshot vs fresh

The box-level checks (`runHealthChecks` — permissions, API keys, annex, nav card, engine) are deep and slow: a subprocess `claude auth status`, the git-annex doctor over the attachment trees, a `tmp-capture/` walk, a dozen serial fs probes. Measured 580–650 ms on prod, and they rode in the dashboard's tRPC batch, so every dashboard load waited on them.

`GET /api/trpc/health.check` therefore answers from a **stale-while-revalidate snapshot** (`src/webapp/trpc/routers/health-snapshot.ts`), per box, per `bbx serve` process:

- first call computes and caches;
- calls within 60 s answer from the snapshot;
- a call past 60 s answers from the snapshot **and** kicks a background refresh — that request still gets the *old* report; the refreshed one is visible to the *next* reader.

**What the staleness bound actually is:** a change shows up two requests after the TTL expires, not one, and only if something asks again. A client that stops polling never sees the new verdict — which is fine, since nothing is displaying it either, but it means "worst case 60 s" is wrong. For the dashboard (which refetches on every visit) it is 60 s plus one page view. Two things bound the damage: writes are ordered by when each computation *started*, so a slow background refresh can never overwrite a newer result; and a background refresh that *throws* is latched, so the next reader recomputes in the foreground and gets the error rather than another serving of the last-known-good report.

Anything that must not be stale asks for a live run:

- `GET /api/trpc/health.check?input={"fresh":true}` (URL-encoded) — bypasses the cache, computes now, and re-seeds the snapshot. Use this in any post-deploy or post-fix verification. Curl form in [`server-operations.md`](./server-operations.md#diagnostic-endpoints-behind-auth).
- `bbx health` and the box server's `/api/health` route call `runHealthChecks` directly and never touch the cache — they are always fresh.

A hub restart (every deploy restarts the children) empties the cache, so a deploy never serves a pre-deploy verdict.

## Box growth (files, directories, and Git history)

The scheduler measures each box at most hourly and stores the latest baseline in
`.beebox/box-growth-health.json`. A native `find` subprocess streams
NUL-delimited type/path pairs so the Node scheduler does not reopen every
directory or retain every path. The scan counts files and directories
separately, records the largest subtrees, and samples Git commit/object growth.
Directories are a first-class signal because very large directory trees can
exhaust watcher and traversal capacity even when their byte size is modest.
It counts symlink entries as files but does not follow them, and excludes
`.git`, `.beebox`, and `node_modules` directories at any depth.
The filesystem walk has a 10-second budget. If it reaches that deadline or
encounters a traversal error, the state retains the counts and attribution
already streamed, marks them as incomplete lower bounds, and warns. Absolute
limits still apply to those lower bounds; rate checks pause until two complete
samples are available, so partial traversal does not look like new growth.

The dashboard warns on either kind of anomaly:

- absolute size: more than 250 directories or 1,000 files;
- hourly rate: at least 10 new directories, 25 new files, or 10 commits;
- connector subtree rate: at least 5 new directories or 10 new files for a
  recognized connector-owned path such as `_content/inbox/email`.

Rate checks require two complete samples 30–120 minutes apart. A partial scan,
first measurement, long scheduler outage, or longer measurement gap still gets
absolute checks, but that sample does not infer an hourly rate.

The filesystem path is the authoritative source attribution. Git history is a
supporting signal only: older commits do not consistently carry a `Created-By`
trailer, while connector-owned paths remain identifiable regardless of the
commit message or trailer coverage. The check reports anomalies but never
deletes, prunes, or moves box content. If Git cannot be sampled but filesystem
growth is healthy, the check remains healthy and reports that history detail as
unavailable; Git failure is appended to a real growth warning when both occur.

The dashboard offers two different owner decisions:

- **Acknowledge this growth** records the current size and comparison baseline.
  It does not change rate limits. The next absolute-size milestone is the larger
  of the initial limit or twice the acknowledged size.
- **Expect these rates** stores 150% of each currently warning rate as its new
  durable threshold, then performs the same acknowledgement. Box-wide rates
  remain box-wide; connector rates are stored separately by connector path.

Neither action disables monitoring. Expected ongoing growth still crosses and
warns at later cumulative-size milestones.

If the warning is unexpected, inspect the named subtree before accepting it:

```bash
find content -type d | wc -l
find content -type f | wc -l
git count-objects -v
```

Then identify the producing connector, import, capture, or procedure and stop
the source of unintended growth. Do not remove content merely to clear the
warning. An incomplete scan, a failed scan, or a measurement older than 26
hours is itself a warning;
inspect `.beebox/scheduler.jsonl` for `box-growth-scan` errors. A local box
that has never run the scheduler reports monitoring as not yet run without
degrading health. Do not delete the state file to dismiss a warning: use one of
the explicit dashboard actions. If the state file is corrupt, monitoring leaves it
untouched and reports the validation error so an operator can inspect or remove
it deliberately. If state disappears while the scheduler is running, the
in-process hourly backoff prevents a rescan loop and the replacement baseline
is surfaced as a warning until an owner accepts it.

## template-updates (a fix that never reached the box)

`bbx health`'s box-checks section carries a `template-updates` check reporting
upstream template changes that were **parked** rather than written: the box's
copy of a shipped procedure, guide, or schedule card had diverged, so the new
version went to `_config/_template-updates/<path>` for review instead of
clobbering the local edit. The message lists the parked paths and ends with the
same resolution sentence `bbx status` prints — copy the parked file over the live
one, or discard the parked copy.

Severity is normally `warning`: a parked update is a pending choice, not a
defect, and must not fail a deploy. It escalates to **`error`** when a parked
path is the procedure card or task card behind a scheduled task that currently
reads `failing` or `inconclusive`. That combination is the trap this check
exists for — the task's own fix is already on disk and unread. The message says
which of the two it is (`…belongs to a task that is failing: X` /
`…belongs to a task whose last check reached no verdict: X`): both escalate,
but a failing task is broken and an inconclusive one is only unjudged. The scheduled-task
list prints the same association under the affected task:

```
  ✗ refresh-maps          failing ×5     last attempt 7h ago, never succeeded
      error: step refresh failed
      parked update: _config/_template-updates/_config/procedures/refresh-maps.procedure.card — the fix may already be on disk
```

The association also rides on `TaskHealth.parkedTemplateUpdates`, so `bbx health
--json`, the dashboard, the session-start snapshot, and proactive health alerts
all carry it. Escalation needs the schedule evaluation, which only `bbx health`
loads — the dashboard and `/api/health` report the un-escalated `warning`.

## google-auth (is the Google grant still alive?)

`bbx health`'s box-checks section and the dashboard's health warnings both carry a
`google-auth` check. It reports one of three things: nothing at all (Google isn't
configured for this deployment, or this box never connected it), `Google
authorization is live (last verified …)`, or a **warning** that the authorization
expired or was revoked with a `/<box>/admin?reconnect=google` link. It's a
`warning`, not an `error`: Google features pause, the rest of the box works, and
`bbx health`'s exit code stays 0.

The check is a pure reader — it never makes a network call, so it's safe to poll.
What keeps it honest is a forced token refresh (`probeGoogleAuthIfStale`) that
the scheduler daemon runs at most about **once a day**; the freshness stamp lives
in the shared token record, so on a multi-box server the first box to tick each
day probes and the rest skip. Ordinary Google usage refreshes the stamp for free.
A box with no scheduler running will show a stale `last verified` rather than a
wrong verdict.

On a flip to broken, the boxholder gets one notification per breakage over
Telegram/Web Push. Reconnecting (admin page, or `bbx google-auth --reauth`) clears
the state and re-arms the alert for a future relapse. Operator-facing detail is
in [`google-setup.md`](google-setup.md#token-expired--invalid_grant); design
notes in [`implemented-plans/google-auth-reauth-health.md`](implemented-plans/google-auth-reauth-health.md).

## claude-update (nightly Claude Code self-update)

### Why this exists

The server runs `claude update` nightly via `claude-update.timer` → `claude-update.service` → `deploy/claude-update.sh` (wrapper). If the timer or wrapper ever breaks silently, the server's Claude Code could drift far behind upstream. The system has three evidence trails (wrapper log, syslog tag `claude-update`, and per-unit journalctl) — this check verifies all three are alive and consistent. See [`server-operations.md`](./server-operations.md) for the underlying design.

### Run this

```bash
deploy/prod-ssh 'bash -s' <<'EOF'
  echo "=== wrapper log (last 40 lines) ==="
  tail -n 40 /home/beebox/claude-update.log
  echo
  echo "=== timer ==="
  systemctl list-timers claude-update.timer --no-pager
  echo
  echo "=== service status ==="
  systemctl status claude-update.service --no-pager | head -20
  echo
  echo "=== syslog (tag=claude-update, last 8 days) ==="
  journalctl -t claude-update --since "-8 days" --no-pager
  echo
  echo "=== installed version ==="
  sudo -u beebox /home/beebox/.local/bin/claude --version
EOF
```

### Success criteria

All of these must be true:

1. The wrapper log's most recent `ok:` line has a UTC timestamp within the last **48 hours**.
2. No `FAIL:` lines in the wrapper log within the last 8 days.
3. No entries in `journalctl -t claude-update` within the last 8 days (both the wrapper and the OnFailure unit only emit syslog on failure, so any entry = a failure).
4. `systemctl list-timers` shows "Last" within the last 48h and "Next" within the next 24h.
5. `systemctl status claude-update.service` shows the last run as `status=0/SUCCESS` (the service is `Type=oneshot`, so "inactive (dead)" with status 0 is the expected idle state).
6. `claude --version` returns a plausibly recent version (≥ 2.1.119 as of the time this doc was written; just sanity-check it isn't wildly stale).

### Report format

One line:
- **Healthy:** `healthy — last ok: <timestamp>, version <x.y.z>`
- **Unhealthy:** `UNHEALTHY — <one-line reason>. Next step: <concrete command>`

Then a short paragraph with the supporting evidence if unhealthy.

### Recovery actions

If the check is unhealthy, try these in order:

1. **Force a run:** `ssh root@<ip> systemctl start claude-update.service` — then re-inspect the wrapper log and `journalctl -u claude-update.service -n 50`.
2. **Look for auth failure:** Claude Code credentials can expire if the user logged out locally (see `server-operations.md` → "Claude Code credentials"). If `claude update` itself is failing, re-transfer credentials from macOS keychain.
3. **Look for a moved/missing wrapper:** `ls -la /opt/beebox/beebox/deploy/claude-update.sh` — should be executable and owned so the callback user can read+execute. `setup-server.sh` handles this but a bad deploy could leave it wrong.
4. **Look for a disabled timer:** `systemctl is-enabled claude-update.timer` — should be `enabled`. If someone disabled it, `systemctl enable --now claude-update.timer`.
5. **Check disk space** on `/home/beebox` — a full disk would prevent the log from being written, which would silently mask failures.
