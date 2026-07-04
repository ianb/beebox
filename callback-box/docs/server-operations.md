# Server Operations

Reference for the running callback-box server (production at `box.example.com`). For initial provisioning scripts see [`deploy/README.md`](../deploy/README.md); this doc covers operational knowledge about the already-provisioned system.

## Server architecture

Services run as the **`callback` user** (User/Group in systemd unit files), not root.

| Path | Owner | Purpose |
|------|-------|---------|
| `/opt/callback/` | root (read-only to `callback`) | Checked-out source code (callback-box) |
| `/home/callback/boxes/` | `callback` | Box data — each subdirectory is a box (inbox/, store/, config/, .callback-box/) |
| `/home/callback/.env` | `callback` | Environment variables for services (API keys, `CB_DIAG_API_KEY`, etc.) |
| `/home/callback/.claude/.credentials.json` | `callback` | Claude Code OAuth credentials (see below) |

Server IP is pinned at [`deploy/server-ip`](../deploy/server-ip). SSH as root for admin (`ssh root@$(cat deploy/server-ip)`); SSH as `callback` for manual data work.

## Connecting for debugging / inspection

For ad-hoc inspection of the running server (reading logs, checking box state, running `cb` commands, etc.) — **not** initial setup, which is covered in [`deploy/README.md`](../deploy/README.md).

**Always SSH to the IP, never the hostname.** `box.example.com` resolves to Cloudflare (the web proxy in front of the box), so `ssh root@box.example.com` fails with "No route to host." Use the pinned IP:

```bash
ssh root@$(cat deploy/server-ip)
# or for data work as the service user:
ssh callback@$(cat deploy/server-ip)
```

**Do not pass `-o StrictHostKeyChecking=no`.** That flag belongs in first-contact provisioning scripts (`add-box.sh`, `setup-server.sh`) where the host hasn't been seen yet. For ad-hoc work the host is already in `~/.ssh/known_hosts` and disabling the check just removes a real safety. If you get a host-key error, investigate it — don't suppress it.

**Common inspection targets** (run via `ssh root@<ip> '<cmd>'`):

| What | Where |
|------|-------|
| Box data | `/home/callback/boxes/<box>/` |
| Hub routing table (which boxes `cb hub` serves, and at what slug) | `/home/callback/.config/cb/hub.json` |
| Box manifest (which boxes the scheduler still sees — retirement deferred, see `docs/plans/boxes-as-packages-v2.md`'s "H4 deletions") | `/home/callback/.config/cb/boxes.json` |
| Service logs | `journalctl -u cb-hub -n 200 --no-pager` / `journalctl -u callback-scheduler -n 200 --no-pager` |
| Service status | `systemctl status cb-hub callback-scheduler --no-pager` |
| Client debug log per box | `/home/callback/boxes/<box>/.callback-box/client-debug.log` |
| Procedure runs | `/home/callback/boxes/<box>/procedure/runs/` |
| Claude Code update log | `/home/callback/claude-update.log` |
| Source the server is actually running | `/opt/callback/callback-box/src/` (rsynced `.ts`, no `dist/`) |

**Running `cb` commands on the server** — must be as the `callback` user so file ownership stays correct:

```bash
ssh root@$(cat deploy/server-ip) "su - callback -c 'cb boxes list'"
# or after sshing in as root:
su - callback -c "cd /home/callback/boxes/<box> && cb validate"
```

**Restart services after deploying or after manual config changes:**

```bash
ssh root@$(cat deploy/server-ip) "systemctl restart cb-hub callback-scheduler"
```

`hub.json` doesn't hot-reload — adding, removing, or re-pointing a box entry needs a `cb-hub`
restart, not just a config edit.

For helper `ssh-server.sh` see `deploy/`.

## Writing scripts that run on the server

Ad-hoc shell as above is fine, but **scripts** (anything in this repo that
shells out to the server programmatically) should go through the single
chokepoint at [`feedback-review/run-on-server.ts`](../../feedback-review/run-on-server.ts).
`runOnServer({ script, asUser, host })` SSHes in as `root` (the entry point
key auth is set up for), then immediately `su - callback` before running the
script, with the script piped via stdin so multi-line content and quotes work
without escaping. `asUser` defaults to `callback`; only set `asUser: "root"`
for operations that genuinely require root (systemctl, chown, package
installs) and leave a comment saying why.

Why this matters — historical bug: an earlier feedback-resolver script SSHed
as root and ran `git commit` directly. That created objects under
`/home/callback/boxes/<box>/.git/objects/<prefix>/` owned by root, and the
next `callback`-user commit that happened to hash into one of those prefixes
failed with `insufficient permission for adding an object to repository
database`. Same shape for the `mv` into `config/feedback/resolved/` — that
directory ended up root-owned too, blocking callback writes. The failures
were intermittent (hash-prefix-dependent) and never pointed back at the
original culprit; they just silently blocked the wakeup agent until someone
noticed. The chokepoint enforces the "never write as root inside callback's
home" invariant in one place so this doesn't drift back.

If you're writing a new dev tool that needs to talk to the server: either
import `runOnServer` from `feedback-review/`, or — if it's awkward to depend
on that path from where you are — promote the helper to a shared location
(suggested: `tools/run-on-server.ts` at the monorepo root) and update both
callers. Don't write a fresh `ssh root@... 'command'` line.

## Prod runs the bundled `dist/cli.mjs`

`cb serve` (spawned by `cb hub` per box, or run directly) runs the single-file esbuild bundle at `dist/cli.mjs` (built by `scripts/build-cli.mjs`), not tsx on source and not a per-file compiled tree. `deploy/deploy.sh` builds the bundle locally and rsyncs it — `bin/cb` sees the bundle is newer than every backend `.ts` (the deploy builds it last) and runs it directly; tsx is only the fallback if a build fails. `deploy/deploy.sh` also rsyncs the `.ts` sources, but they're not what the server executes. `cb hub` itself runs from the same bundle.

Consequences:

- The bundle lives at `dist/` — one level below the package root, **not** `dist/webapp/`. So `import.meta.dirname` inside the running code is `/opt/callback/callback-box/dist`. Resolve package-relative asset paths (frontend dist, templates, tsconfig) via `src/lib/package-root.ts` `PACKAGE_ROOT` (walks up to the `callback-box` package.json — correct under both the bundle and tsx), never a hardcoded `import.meta.dirname + "../.."` that assumes a 2-level layout. A `../..` path that worked under tsx silently overshoots under the bundle — this is what made the frontend serve its "not built yet" fallback for every box (fixed 2026-06-20).
- If a behavior seems not to have deployed, the source rsync isn't enough — confirm `dist/cli.mjs` rebuilt (its mtime should be newer than the sources). A stale bundle keeps serving old code even with fresh `.ts` on disk.

## Claude Code credentials

Claude Code stores OAuth credentials differently per platform:

- **macOS**: Keychain entry, service `Claude Code-credentials`.
- **Linux (server)**: File at `~/.claude/.credentials.json` containing `{ "claudeAiOauth": { "accessToken": "...", "refreshToken": "...", "expiresAt": ... } }`. File-mode `0600`, owner `callback:callback`.

### Headless auth doesn't work via the OAuth flow

`claude auth login` starts a localhost HTTP server to receive the OAuth callback. On the server, the browser (your laptop's browser) can't reach the server's localhost, so the flow never completes. **The Admin page's "Sign in" button spawns `claude auth login` and therefore does not work on production** — it shows the auth URL but the redirect has nowhere to land.

**Workaround** — transfer credentials from a local macOS login to the server:

```bash
# On macOS (where you've logged in Claude Code locally):
security find-generic-password -s "Claude Code-credentials" -w > /tmp/cc-creds.json

# Copy to server, install as the callback user:
scp /tmp/cc-creds.json root@$(cat deploy/server-ip):/tmp/
ssh root@$(cat deploy/server-ip) '
  install -m 0600 -o callback -g callback /tmp/cc-creds.json /home/callback/.claude/.credentials.json
  rm /tmp/cc-creds.json
'
rm /tmp/cc-creds.json
```

Tokens refresh automatically when the server uses them (Claude Code writes the file back with the new `expiresAt`). You only need to re-transfer if you explicitly log out of Claude Code on macOS.

### Nightly version updates

Claude Code's built-in auto-updater only fires reliably during long-running interactive sessions — server-side short-lived invocations drift behind. A systemd timer runs `claude update` as the `callback` user nightly around 04:00 UTC (with up to 30m jitter).

**Units** (installed by `setup-server.sh`):
- `claude-update.timer` — schedule (`OnCalendar=*-*-* 04:00:00`, `Persistent=true` so missed runs catch up at boot).
- `claude-update.service` — oneshot that invokes the wrapper below.
- `claude-update-failure.service` — triggered via `OnFailure=` if the wrapper can't record its own failure (e.g. script missing / disk full); logs to syslog `daemon.err`.

**Wrapper**: `deploy/claude-update.sh` (served from the checked-out tree at `/opt/callback/callback-box/deploy/claude-update.sh`, so `deploy.sh` rsync picks up edits). It:
- Appends `starting:` / `ok:` or `FAIL:` lines with UTC timestamps to `/home/callback/claude-update.log`.
- Also writes failures to syslog via `logger -t claude-update -p daemon.err`.
- Exits with claude's exit code so systemd marks the unit failed (triggering the belt-and-suspenders `OnFailure` unit).

**Where to look for evidence:**

```bash
# The wrapper's own log (every run appends a line)
ssh root@<server> tail -50 /home/callback/claude-update.log

# Systemd view (last run, next run, last 20 journal lines)
ssh root@<server> 'systemctl list-timers claude-update.timer --no-pager; \
  systemctl status claude-update.service --no-pager; \
  journalctl -u claude-update.service -n 20 --no-pager'

# Any failure messages tagged by the wrapper or belt-and-suspenders unit
ssh root@<server> 'journalctl -t claude-update --since "-7 days" --no-pager'
```

**Force an immediate run:** `ssh root@<server> systemctl start claude-update.service`.

**Periodic health check:** see [`health-checks.md`](./health-checks.md#claude-update-nightly-claude-code-self-update) — a weekly remote routine reminds the user to run that runbook.

## Diagnostic endpoints behind auth

In production, `/api/trpc/debugLog.get` and `/api/trpc/health.check` sit behind the Google OAuth cookie gate — `curl` without a browser cookie gets rejected.

**Bypass** for machine access: if `CB_DIAG_API_KEY` is set in `/home/callback/.env`, GET requests to those two endpoints are allowed with an `Authorization: Bearer <key>` header. The debug log returns the tRPC envelope (`{"result":{"data":{"entries":[…]}}}`):

```bash
curl -H "Authorization: Bearer $CB_DIAG_API_KEY" \
  https://box.example.com/<box>/api/trpc/debugLog.get | python3 -m json.tool
```

On localhost/dev (no `GOOGLE_OAUTH_CLIENT_ID` set), auth is disabled entirely — curl works without the header.

For SSH-only debugging: `ssh root@<server> tail /home/callback/boxes/<box>/.callback-box/client-debug.log`. See [`client-debug-log.md`](./client-debug-log.md) for the log file format.

## Related

- [`deploy/README.md`](../deploy/README.md) — provisioning scripts, DNS, initial setup.
- [`client-debug-log.md`](./client-debug-log.md) — full client-debug-log format and endpoints.
- [`adding-a-box.md`](./adding-a-box.md) — per-box setup (secrets, connectors, box directory layout).
