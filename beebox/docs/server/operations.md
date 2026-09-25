# Server operations

Reference for the running beebox server (production at `box.example.com`). For initial provisioning scripts see [`deploy/README.md`](../../deploy/README.md); this doc covers operational knowledge about the already-provisioned system.

## Connecting for debugging / inspection
For ad-hoc inspection of the running server (reading logs, checking box state, running `bbx` commands, etc.) — **not** initial setup, which is covered in [`deploy/README.md`](../../deploy/README.md).

**Always SSH to the IP, never the hostname.** `box.example.com` resolves to Cloudflare (the web proxy in front of the box), so `ssh root@box.example.com` fails with "No route to host." Use the pinned IP:

```bash
deploy/prod-ssh
# or for data work as the service user:
ssh beebox@$(beebox/deploy/deploy-target.sh get BBX_DEPLOY_HOST)
```

**Do not pass `-o StrictHostKeyChecking=no`.** That flag belongs in first-contact provisioning scripts (`add-box.sh`, `setup-server.sh`) where the host hasn't been seen yet. For ad-hoc work the host is already in `~/.ssh/known_hosts` and disabling the check just removes a real safety. If you get a host-key error, investigate it — don't suppress it.

**Common inspection targets** (run via `deploy/prod-ssh '<cmd>'`):

| What | Where |
|------|-------|
| Box data | `/home/beebox/boxes/<box>/` |
| Hub routing table (which boxes `bbx hub` serves, and at what slug) | `/home/beebox/.config/beebox/hub.json` |
| Box manifest (which boxes the scheduler still sees — retirement deferred, see `docs/implemented-plans/boxes-as-packages-v2.md`'s "H4 deletions") | `/home/beebox/.config/beebox/boxes.json` |
| Service logs | `journalctl -u beebox-hub -n 200 --no-pager` / `journalctl -u beebox-scheduler -n 200 --no-pager` |
| Service status | `systemctl status beebox-hub beebox-scheduler --no-pager` |
| Client debug log per box | `/home/beebox/boxes/<box>/.beebox/client-debug.log` |
| Procedure runs | `/home/beebox/boxes/<box>/_bookkeeping/procedure/runs/` |
| Claude Code update log | `/home/beebox/claude-update.log` |
| Source the server is actually running | `/opt/beebox/beebox/src/` (rsynced `.ts`, no `dist/`) |

**Running `bbx` commands on the server** — must be as the `callback` user so file ownership stays correct:

```bash
deploy/prod-ssh "su - beebox -c 'bbx boxes list'"
# or after sshing in as root:
su - beebox -c "cd /home/beebox/boxes/<box> && bbx validate"
```

> ⚠️ **Source `/home/beebox/.env` for env-dependent commands.** The systemd
> services load it via `EnvironmentFile=/home/beebox/.env`, but an ad-hoc SSH
> invocation does **not** inherit it. Most visibly, `bbx health`'s connector-presence
> probe reads `BBX_GOOGLE_TOKENS_FILE` (the centralized Google-OAuth token path) from
> that env; without it the probe falls back to a legacy `google.secret.json` that
> prod doesn't use and reports a **false** `blocked: missing connectors` for
> `google`/`gmail` — even when both are syncing fine. Always source it so an ad-hoc
> check sees what the services see:
>
> ```bash
> deploy/prod-ssh \
>   "su - beebox -c 'set -a; . /home/beebox/.env; bbx health --box /home/beebox/boxes/<box>'"
> ```
>
> (This produced a bogus "two boxes have missing connectors" health report on
> 2026-07-14 — the connectors were healthy; the bare invocation was the bug.)

**Administrative restart after manual config changes:**

Normal code deployment uses the controller in `deploy/deploy.sh`; it already
restarts and verifies the services. A direct systemd restart does not establish
the shared admission/drain boundary. Use the following only after work is
explicitly quiesced:

```bash
deploy/prod-ssh "systemctl restart beebox-hub beebox-scheduler"
```

`hub.json` doesn't hot-reload — adding, removing, or re-pointing a box entry needs a `beebox-hub`
restart, not just a config edit. To *add* a box, run `deploy/add-box.sh` rather than editing
`hub.json`: it does the clone, both manifest registrations, the restart, and a canary check
([`deploy/README.md`](../../deploy/README.md)). To register a box that is already on disk,
`bbx hub add-box <slug> <path>` is the validated single step.

For IP-resolution details, see `deploy/README.md`.

## Writing scripts that run on the server
Ad-hoc shell as above is fine, but **scripts** (anything in this repo that
shells out to the server programmatically) should go through the single
chokepoint at [`feedback-review/run-on-server.ts`](../../../feedback-review/run-on-server.ts).
`runOnServer({ script, asUser, host })` SSHes in as `root` (the entry point
key auth is set up for), then immediately `su - beebox` before running the
script, with the script piped via stdin so multi-line content and quotes work
without escaping. `asUser` defaults to `callback`; only set `asUser: "root"`
for operations that genuinely require root (systemctl, chown, package
installs) and leave a comment saying why.

Why this matters — historical bug: an earlier feedback-resolver script SSHed
as root and ran `git commit` directly. That created objects under
`/home/beebox/boxes/<box>/.git/objects/<prefix>/` owned by root, and the
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

### Nightly version updates
Claude Code's built-in auto-updater only fires reliably during long-running interactive sessions — server-side short-lived invocations drift behind. A systemd timer runs `claude update` as the `callback` user nightly around 04:00 UTC (with up to 30m jitter).

**Units** (installed by `setup-server.sh`):
- `claude-update.timer` — schedule (`OnCalendar=*-*-* 04:00:00`, `Persistent=true` so missed runs catch up at boot).
- `claude-update.service` — oneshot that invokes the wrapper below.
- `claude-update-failure.service` — triggered via `OnFailure=` if the wrapper can't record its own failure (e.g. script missing / disk full); logs to syslog `daemon.err`.

**Wrapper**: `deploy/claude-update.sh` (served from the checked-out tree at `/opt/beebox/beebox/deploy/claude-update.sh`, so `deploy.sh` rsync picks up edits). It:
- Appends `starting:` / `ok:` or `FAIL:` lines with UTC timestamps to `/home/beebox/claude-update.log`.
- Also writes failures to syslog via `logger -t claude-update -p daemon.err`.
- Exits with claude's exit code so systemd marks the unit failed (triggering the belt-and-suspenders `OnFailure` unit).

**Where to look for evidence:**

```bash
# The wrapper's own log (every run appends a line)
ssh root@<server> tail -50 /home/beebox/claude-update.log

# Systemd view (last run, next run, last 20 journal lines)
ssh root@<server> 'systemctl list-timers claude-update.timer --no-pager; \
  systemctl status claude-update.service --no-pager; \
  journalctl -u claude-update.service -n 20 --no-pager'

# Any failure messages tagged by the wrapper or belt-and-suspenders unit
ssh root@<server> 'journalctl -t claude-update --since "-7 days" --no-pager'
```

**Force an immediate run:** `ssh root@<server> systemctl start claude-update.service`.

**Periodic health check:** see [`health-checks.md`](health-checks.md#claude-update-nightly-claude-code-self-update) — a weekly remote routine reminds the user to run that runbook.

## Diagnostic endpoints behind auth
In production, `/api/trpc/debugLog.get` and `/api/trpc/health.check` sit behind the Google OAuth cookie gate — `curl` without a browser cookie gets rejected.

**Bypass** for machine access: if `BBX_DIAG_API_KEY` is set in `/home/beebox/.env`, GET requests to those two endpoints are allowed with an `Authorization: Bearer <key>` header. The debug log returns the tRPC envelope (`{"result":{"data":{"entries":[…]}}}`):

```bash
curl -H "Authorization: Bearer $BBX_DIAG_API_KEY" \
  https://box.example.com/<box>/api/trpc/debugLog.get | python3 -m json.tool
```

`health.check` answers from a cached snapshot by default (see [`health-checks.md`](health-checks.md#healthcheck-snapshot-vs-fresh)). A machine caller that needs the box's state *right now* — post-deploy verification, "did that fix land?" — must ask for a live run:

```bash
curl -H "Authorization: Bearer $BBX_DIAG_API_KEY" \
  'https://box.example.com/<box>/api/trpc/health.check?input=%7B%22fresh%22%3Atrue%7D' | python3 -m json.tool
```

(The `input` is the URL-encoded JSON `{"fresh":true}`. The diag-key bypass keys on the procedure name only, so the query string doesn't affect it.)

On localhost/dev (no `GOOGLE_OAUTH_CLIENT_ID` set), auth is disabled entirely — curl works without the header.

For SSH-only debugging: `ssh root@<server> tail /home/beebox/boxes/<box>/.beebox/client-debug.log`. See [`client-debug-log.md`](../client-debug-log.md) for the log file format.

## Git-annex health
The current annex model, checks, and repair commands are in
[`assets.md`](../assets.md). Periodic operational checks belong in
[`health-checks.md`](health-checks.md). The production conversion and its
one-time cutover procedure are retained only as a
[dated historical report](../reports/git-annex-conversion-2026-08-01.md); do not
use that report as a current runbook or as current production evidence.

## Related
- [`deploy/README.md`](../../deploy/README.md) — provisioning scripts, DNS, initial setup.
- [`client-debug-log.md`](../client-debug-log.md) — full client-debug-log format and endpoints.
- [`adding-a-box.md`](boxes.md) — per-box setup (secrets, connectors, box directory layout).

## From deploy/README.md (to reconcile)

### `prod-ssh` — SSH into the production server
```bash
# Interactive shell
./deploy/prod-ssh

# Run a command
./deploy/prod-ssh systemctl status beebox-hub
```

Uses agent forwarding (`-A`) so your local SSH key works for GitHub operations on the server.
In a worktree, the command falls back to the main checkout's gitignored
`deploy/target.env`; a non-empty local copy takes precedence. This fallback is
for diagnostics only: `deploy.sh` intentionally requires `target.env` in the
invoking checkout.

### Production app diagnostics
`prod-curl` and `prod-browse` authenticate as the configured owner
(`BBX_OWNER_EMAIL`) to inspect production behind the OAuth wall. This grants no
new access: both commands require the boxholder's existing root SSH key, and
must never be modified to mint a session for another identity without the
boxholder's express, in-the-moment permission.

```bash
# Fetch HTML or an API response; extra arguments pass through to remote curl.
./deploy/prod-curl /test1/ -sI

# Open the rendered app in bin/browse's clean browser profile.
./deploy/prod-browse /test1/
bin/browse screenshot --slug prod
```

`prod-curl` keeps the signed session cookie on the server. `prod-browse` puts it
in the local isolated browser profile and also requires `BBX_DEPLOY_PUBLIC_URL`
in `deploy/target.env`; from a worktree it falls back to the main checkout's
copy like everything else there. Never print or persist either cookie or URL in
tracked files.
