# Health Checks

Manual runbooks for periodic checks on the deployed callback-box server. Each section is self-contained — follow the steps, report the verdict, and suggest a next action if unhealthy. These are designed to be driven by a local Claude Code agent that has SSH access to `box.example.com`.

## Hub health endpoints (`/healthz`, `/healthz/canary`)

The hub exposes two diagnostic endpoints, both requiring the `CB_DIAG_API_KEY` bearer token (`Authorization: Bearer <key>`). An unauthenticated caller gets 401 — the endpoints used to be open and leaked slugs/PIDs/ports, so they're now gated like the box server's own `/healthz`. Both run on the server's localhost (`http://localhost:3210`); externally they're reachable at `https://box.example.com/...` with the same key.

**`GET /healthz` — passive verdict.** Reports `status: "ok"` (HTTP 200) or `status: "unhealthy"` (HTTP 503), plus per-box supervisor state. The verdict is **liveness**, not readiness: it's `unhealthy` only if a box is *broken* — crash-looping (`starting` with `consecutiveFailures > 0`) or crash-budget-latched (`unhealthy`). A `stopped` box is a lazy hub's normal resting state and is **not** a fault, so an idle fleet reads `ok`. `restarts` is a lifetime counter shown for information; the verdict never keys on it (a box that blipped once long ago would otherwise pin the hub red forever). Derivation lives in `src/hub/hub-health.ts`. This endpoint has no side effects — safe for an uptime monitor to poll.

**`GET /healthz/canary` — active child check.** Cold-starts one box (via the supervisor's `ensureRunning`) and returns 200 once it serves, or 503 (naming the slug) if it can't. This is what catches a **fleet-wide startup break** — e.g. a native-module ABI mismatch after a Node major bump — that the passive verdict can't see, because on a lazy hub most boxes rest `stopped` and report nothing. `?box=<slug>` names the box to canary; unset picks the first configured slug. **It wakes a box** (leaving it resident for `idleMs`), so it's a deploy-time / on-demand check, not something a monitor should poll. The deploy runs it automatically (see [`deploy/README.md`](../deploy/README.md)).

Why the canary exists at all: during the 2026-07-16 Node 22→24 upgrade every box child crash-looped on a better-sqlite3 ABI mismatch while the old `/healthz` returned a constant 200 — the deploy verified "healthy" while no box could serve a request. The passive verdict now catches a crash-looping box; the canary catches a break on boxes that were never started.

## claude-update (nightly Claude Code self-update)

### Why this exists

The server runs `claude update` nightly via `claude-update.timer` → `claude-update.service` → `deploy/claude-update.sh` (wrapper). If the timer or wrapper ever breaks silently, the server's Claude Code could drift far behind upstream. The system has three evidence trails (wrapper log, syslog tag `claude-update`, and per-unit journalctl) — this check verifies all three are alive and consistent. See [`server-operations.md`](./server-operations.md) for the underlying design.

### Run this

```bash
ssh root@$(cat ~/src/callback-box/callback-box/deploy/server-ip) 'bash -s' <<'EOF'
  echo "=== wrapper log (last 40 lines) ==="
  tail -n 40 /home/callback/claude-update.log
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
  sudo -u callback /home/callback/.local/bin/claude --version
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
3. **Look for a moved/missing wrapper:** `ls -la /opt/callback/callback-box/deploy/claude-update.sh` — should be executable and owned so the callback user can read+execute. `setup-server.sh` handles this but a bad deploy could leave it wrong.
4. **Look for a disabled timer:** `systemctl is-enabled claude-update.timer` — should be `enabled`. If someone disabled it, `systemctl enable --now claude-update.timer`.
5. **Check disk space** on `/home/callback` — a full disk would prevent the log from being written, which would silently mask failures.
