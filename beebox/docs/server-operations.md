# Server Operations

Reference for the running beebox server (production at `box.example.com`). For initial provisioning scripts see [`deploy/README.md`](../deploy/README.md); this doc covers operational knowledge about the already-provisioned system.

## Server architecture

Services run as the **`beebox` user** (User/Group in systemd unit files), not root.

| Path | Owner | Purpose |
|------|-------|---------|
| `/opt/beebox/` | root (read-only to `beebox`) | Checked-out source code (beebox) |
| `/home/beebox/boxes/` | `beebox` | Box data — each subdirectory is a v2 (package-layout) box; operational data (inbox/, store/, config/, .beebox/) lives under its `content/` subdirectory |
| `/home/beebox/.env` | `beebox` | Environment variables for services (API keys, `BBX_DIAG_API_KEY`, etc.) |
| `/home/beebox/.claude/.credentials.json` | `beebox` | Claude Code OAuth credentials (see below) |

The server is named in gitignored `deploy/target.env` (see
`deploy/target.env.example`). Use `deploy/prod-ssh` for root administration; it
finds the main checkout's copy when invoked from a worktree. SSH as the service
user (`beebox`) for manual data work.

## Connecting for debugging / inspection

For ad-hoc inspection of the running server (reading logs, checking box state, running `bbx` commands, etc.) — **not** initial setup, which is covered in [`deploy/README.md`](../deploy/README.md).

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
| Client debug log per box | `/home/beebox/boxes/<box>/content/.beebox/client-debug.log` |
| Procedure runs | `/home/beebox/boxes/<box>/content/procedure/runs/` |
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
>   "su - beebox -c 'set -a; . /home/beebox/.env; bbx health --box /home/beebox/boxes/<box>/content'"
> ```
>
> (This produced a bogus "two boxes have missing connectors" health report on
> 2026-07-14 — the connectors were healthy; the bare invocation was the bug.)

> **Point `--box` at the operational tree.** Prod boxes are v2 packages, so their
> cards/config/schedules live under `content/` — pass
> `--box /home/beebox/boxes/<box>/content`. Passing the package root
> (`/home/beebox/boxes/<box>`) makes `bbx health` see zero schedules and report a
> misleadingly empty/`never` state.

**Restart services after deploying or after manual config changes:**

```bash
deploy/prod-ssh "systemctl restart beebox-hub beebox-scheduler"
```

`hub.json` doesn't hot-reload — adding, removing, or re-pointing a box entry needs a `beebox-hub`
restart, not just a config edit. To *add* a box, run `deploy/add-box.sh` rather than editing
`hub.json`: it does the clone, both manifest registrations, the restart, and a canary check
([`deploy/README.md`](../deploy/README.md)). To register a box that is already on disk,
`bbx hub add-box <slug> <path>` is the validated single step.

For IP-resolution details, see `deploy/README.md`.

## Writing scripts that run on the server

Ad-hoc shell as above is fine, but **scripts** (anything in this repo that
shells out to the server programmatically) should go through the single
chokepoint at [`feedback-review/run-on-server.ts`](../../feedback-review/run-on-server.ts).
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

## Prod runs the bundled `dist/cli.mjs`

`bbx serve` (spawned by `bbx hub` per box, or run directly) runs the single-file esbuild bundle at `dist/cli.mjs` (built by `scripts/build-cli.ts`), not tsx on source and not a per-file compiled tree. `deploy/deploy.sh` builds the bundle in its local build checkout (a detached git worktree at the deployed ref — see `deploy/README.md`) and rsyncs it — `bin/bbx` sees the bundle is newer than every backend `.ts` (the deploy builds it last) and runs it directly; tsx is only the fallback if a build fails. `deploy/deploy.sh` also rsyncs the `.ts` sources, but they're not what the server executes. `bbx hub` itself runs from the same bundle.

Consequences:

- The bundle lives at `dist/` — one level below the package root, **not** `dist/webapp/`. So `import.meta.dirname` inside the running code is `/opt/beebox/beebox/dist`. Resolve package-relative asset paths (frontend dist, templates, tsconfig) via `src/lib/package-root.ts` `PACKAGE_ROOT` (walks up to the `beebox` package.json — correct under both the bundle and tsx), never a hardcoded `import.meta.dirname + "../.."` that assumes a 2-level layout. A `../..` path that worked under tsx silently overshoots under the bundle — this is what made the frontend serve its "not built yet" fallback for every box (fixed 2026-06-20).
- If a behavior seems not to have deployed, the source rsync isn't enough — confirm `dist/cli.mjs` rebuilt (its mtime should be newer than the sources). A stale bundle keeps serving old code even with fresh `.ts` on disk.

## Rolling back a bad deploy

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

## Claude Code credentials

Claude Code stores OAuth credentials differently per platform:

- **macOS**: Keychain entry, service `Claude Code-credentials`.
- **Linux (server)**: File at `~/.claude/.credentials.json` containing `{ "claudeAiOauth": { "accessToken": "...", "refreshToken": "...", "expiresAt": ... } }`. File-mode `0600`, owner `beebox:beebox`.

### Headless auth doesn't work via the OAuth flow

`claude auth login` starts a localhost HTTP server to receive the OAuth callback. On the server, the browser (your laptop's browser) can't reach the server's localhost, so the flow never completes. **The Admin page's "Sign in" button spawns `claude auth login` and therefore does not work on production** — it shows the auth URL but the redirect has nowhere to land.

**Workaround** — transfer credentials from a local macOS login to the server:

```bash
# On macOS (where you've logged in Claude Code locally):
security find-generic-password -s "Claude Code-credentials" -w > /tmp/cc-creds.json

# Copy to server, install as the callback user:
scp /tmp/cc-creds.json "$(beebox/deploy/deploy-target.sh ssh-target)":/tmp/
deploy/prod-ssh '
  install -m 0600 -o callback -g callback /tmp/cc-creds.json /home/beebox/.claude/.credentials.json
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

**Periodic health check:** see [`health-checks.md`](./health-checks.md#claude-update-nightly-claude-code-self-update) — a weekly remote routine reminds the user to run that runbook.

## Diagnostic endpoints behind auth

In production, `/api/trpc/debugLog.get` and `/api/trpc/health.check` sit behind the Google OAuth cookie gate — `curl` without a browser cookie gets rejected.

**Bypass** for machine access: if `BBX_DIAG_API_KEY` is set in `/home/beebox/.env`, GET requests to those two endpoints are allowed with an `Authorization: Bearer <key>` header. The debug log returns the tRPC envelope (`{"result":{"data":{"entries":[…]}}}`):

```bash
curl -H "Authorization: Bearer $BBX_DIAG_API_KEY" \
  https://box.example.com/<box>/api/trpc/debugLog.get | python3 -m json.tool
```

`health.check` answers from a cached snapshot by default (see [`health-checks.md`](./health-checks.md#healthcheck-snapshot-vs-fresh)). A machine caller that needs the box's state *right now* — post-deploy verification, "did that fix land?" — must ask for a live run:

```bash
curl -H "Authorization: Bearer $BBX_DIAG_API_KEY" \
  'https://box.example.com/<box>/api/trpc/health.check?input=%7B%22fresh%22%3Atrue%7D' | python3 -m json.tool
```

(The `input` is the URL-encoded JSON `{"fresh":true}`. The diag-key bypass keys on the procedure name only, so the query string doesn't affect it.)

On localhost/dev (no `GOOGLE_OAUTH_CLIENT_ID` set), auth is disabled entirely — curl works without the header.

For SSH-only debugging: `ssh root@<server> tail /home/beebox/boxes/<box>/.beebox/client-debug.log`. See [`client-debug-log.md`](./client-debug-log.md) for the log file format.

## Prod git-annex migration (manifest → annex cutover)

`docs/plans/scanner-ingest.md` Track 0 needs both prod boxes (`estate`,
`box-family`) moved from the manifest asset scheme onto git-annex before
scan-import ships — it stages raw asset bytes and assumes annex
unconditionally (no manifest-writing code path exists). Track 2's upload
routes 503 (logged `error`) at registration if a box isn't annex-shaped yet,
so a sequencing mistake fails loud rather than silently corrupting a
manifest-scheme box. Background and the full local-conversion precedent:
[`assets.md`](./assets.md).

**Status as of 2026-08-01: only rehearsed against already-converted copies,
NOT against a manifest-scheme prod box.** The two boxes at `~/src/boxes/`
that looked like plausible rehearsal targets (`estate`, `box-family`) turned
out to already be the *local* post-conversion boxes from `assets.md`'s
2026-07-31 migration — `git log` on both shows `Claim assets into manifests
(pre-annex)` immediately followed by `Move assets onto git-annex`, dated
2026-07-31; `git config --get-regexp '^annex\.'` shows `annex.thin false` /
`annex.version 10`; there are zero `manifest.json` files anywhere in either
tree; and annex objects on disk hold real bytes (checked several
multi-megabyte `.jpg` objects under `.git/annex/objects/`, not ~100-byte
pointers). This directly contradicts a same-day claim that these were fresh
backups of the *unconverted* prod boxes — if they were, they'd show
`manifest.json` files and no annex commit. **Whatever `estate`/`box-family`
under `~/src/boxes/` are, they are not unconverted prod copies**; treat that
claim as false until a fresh rsync from the server proves otherwise. Prod
itself may or may not already be on annex — nothing available locally
answers that; the pre-checks below settle it before the real cutover starts.

**Update (2026-08-01, checked on the server): prod IS already converted.**
Both prod boxes carry the "Claim assets into manifests (pre-annex)" → "Move
assets onto git-annex" commit pair dated 2026-07-31, `annex.version 10` /
`annex.thin false`, and real annex objects on disk (estate: 1,359 objects;
box-family: 12). So the cutover reduces to the verification pass — **run 2026-08-01, both
boxes pass**: `bbx doctor annex --check` 7/7 on both (including `hook` — the
pre-commit hook IS installed on prod, unlike the rsync'd rehearsal copies);
`bbx doctor annex-fsck` "no bad content" on both (estate ~60s, box-family
~2s); `to-annex --dry-run` no-op on box-family, and on estate correctly
refused by the dirty-tree guard (an in-flight photo-upload batch was staged
— the guard working as designed, with conversion already proven by the
migration commits and annex objects). Track 0 is DONE. One post-conversion
anomaly found and filed
(`issues/bugs/2026-08-01-prod-photo-uploads-bypass-annex.md`): the
photo-batch-upload flow committed raw JPEG blobs + old-scheme manifests on
estate AFTER the conversion — likely the missing annex pre-commit hook plus
a manifest-writing upload path. Note the box also has unrelated small
metadata sidecars named `manifest.json` (`{"filename","captured","source"}`)
— do not mistake them for asset manifests when running the pre-checks.

### What was and wasn't rehearsed

Rehearsed against `rsync -a` copies of both local boxes under a scratch
directory (never against `~/src/boxes/` in place — those are read-only):

- `bbx doctor annex --check` on both — all checks pass (`binary`,
  `initialized`, `thin`, `largefiles`, `content-present`, `journal`); the
  `hook` check fails on both copies because a plain rsync doesn't run
  `bbx init` to install the pre-commit hook, not a real defect.
- `bbx doctor annex-fsck` on both — `annex fsck: no bad content`. `box-family`
  (~50 MB) finished in under a second; `estate` (~9.8 GB of annexed content)
  took **43.5s**.
- `bbx attachments to-annex --dry-run` against the `box-family` copy —
  `Would annex 0 asset(s) (0 MB). Nothing changed.` confirming the migration
  is a safe no-op against an already-converted box (no `manifest.json` to
  claim), not a destructive re-run — useful defense-in-depth if prod turns
  out to already be converted by the time of cutover.
- `rsync -a` copy timing for planning the real cutover: `estate` (~29 GB
  total, ~9.8 GB of that being `content/`) took **3m12s** locally; a
  server-side full-box backup should be sized against that, adjusted for
  network/disk speed.

**NOT rehearsed, because no manifest-scheme box was available locally:** the
actual `manifest.json` → git-annex conversion path in
`src/core/annex/to-annex.ts` (`bbx attachments to-annex` with a real manifest
scope to migrate) — the preflight manifest-vs-disk hash check, the LFS
takeover, the `git add -A` + `--renormalize` two-pass staging, the
post-conversion manifest-vs-annex-key comparison, and the final commit. All
of the failure modes `to-annex-errors.ts` guards against (dirty tree, stray
`.gitignore` rules, gitignored LFS-pointer content masquerading as an asset,
insufficient disk) are exercised by that code's own test suite, not by this
rehearsal.

**Before the real cutover, whoever runs it must:**

1. Confirm from the server itself, not from a local copy, whether `estate`
   and `box-family` are still manifest-scheme (`find <box>/content -name
   manifest.json`, `git -C <box>/content config --get-regexp '^annex\.'` —
   an empty result plus present manifests means still-unconverted; if annex
   config and zero manifests turn up instead, someone already migrated prod
   and this runbook's dry-run step will confirm it as a no-op).
2. `rsync` a **fresh** copy of the actual prod box from the server to a
   scratch machine (not this worktree — no server access from here) and
   rehearse the real `bbx attachments to-annex` (not `--dry-run`) against
   that copy first, verifying with the checklist below, before touching the
   live box.

### Cutover procedure (per box)

Run once per box (`estate`, then `box-family`, or the reverse — independent).

**1. Pre-checks**

```bash
# Disk: conversion roughly doubles resident asset bytes (annex.thin=false
# keeps the working-tree copy AND the annex object as separate copies) —
# to-annex.ts's own preflight refuses below 1.1x headroom, but confirm before
# starting so a mid-migration abort isn't the first sign of the problem.
ssh beebox@$(beebox/deploy/deploy-target.sh get BBX_DEPLOY_HOST) "df -h /home/beebox/boxes/<box>"

# Backup freshness: confirm today's automated backup exists and is recent
# before wedging the box, since it is the entire rollback story (see Rollback
# below) — check whatever backup mechanism is currently configured for the
# server; there is no maintained reverse migration.
ssh beebox@$(beebox/deploy/deploy-target.sh get BBX_DEPLOY_HOST) "ls -la <backup-location>"

# Working tree must be clean — to-annex.ts refuses otherwise (DirtyTreeError)
ssh beebox@$(beebox/deploy/deploy-target.sh get BBX_DEPLOY_HOST) "cd /home/beebox/boxes/<box>/content && git status --porcelain"
```

**2. Stop the box's serve child**

There is no per-box stop command today — `Supervisor.stopBox` is private and
only fires from the lazy-mode idle timer (`src/hub/supervisor.ts`). The
supported lever is a full `beebox-hub` stop, which SIGTERMs the hub process,
whose `SIGTERM` handler (`src/cli/commands/hub.ts`) calls
`supervisor.stopAll()` and cleanly tears down every box child before
exiting — this briefly wedges **every** box on the server, not just the one
being migrated, so coordinate timing with the boxholder as the plan calls
for:

```bash
deploy/prod-ssh "systemctl stop beebox-hub"
```

(A future improvement — a targeted `bbx hub stop <slug>` or admin endpoint —
would narrow this blast radius; it doesn't exist yet.)

**3. Run the migration**

As the `callback` user, against the box's operational (`content/`) root:

```bash
deploy/prod-ssh "su - beebox -c '
  cd /home/beebox/boxes/<box>/content &&
  bbx attachments to-annex --dry-run
'"
# Review the reported asset count/bytes against expectations, then:
deploy/prod-ssh "su - beebox -c '
  cd /home/beebox/boxes/<box>/content &&
  bbx attachments to-annex
'"
```

This is the same command exercised (as a no-op) in the local rehearsal
above; on a real manifest-scheme box it performs, in order: preflight
manifest-vs-disk verification, LFS takeover, annex init/config, un-ignoring
the asset gitignore block, two-pass `git add`, post-conversion
manifest-vs-annex-key verification, manifest removal, and a single commit
(`Move assets onto git-annex`, `--no-verify`). Any failure at any step
leaves the manifests in place and nothing committed — see
`src/core/annex/to-annex-errors.ts` for the specific refusal messages
(dirty tree, stray gitignore rules, LFS-pointer content, insufficient
space, post-conversion hash mismatch).

**4. Verify**

```bash
deploy/prod-ssh "su - beebox -c '
  cd /home/beebox/boxes/<box>/content &&
  bbx doctor annex --check &&
  bbx doctor annex-fsck &&
  find . -name manifest.json &&
  git status --porcelain
'"
```

Checklist — all must hold before calling the box converted:

- [ ] `bbx doctor annex --check` reports all checks passing (`hook` will now
      also pass, since `to-annex.ts` doesn't touch hooks but the box's
      existing pre-commit hook already invokes `git annex pre-commit` per
      `bbx init` — confirm this on the specific box; if it fails, `bbx init`
      regenerates it)
- [ ] `bbx doctor annex-fsck` reports `annex fsck: no bad content`
- [ ] `find . -name manifest.json` returns nothing
- [ ] `git status --porcelain` is empty (the migration's own commit landed
      cleanly)
- [ ] Spot-check a handful of cards whose `sources[]`/asset refs point into
      `.attach/` scopes still resolve (open a few in the browse UI once the
      box is back up, or `git annex whereis <path>` on a sample of paths)

**5. Restart**

```bash
deploy/prod-ssh "systemctl start beebox-hub"
```

Confirm both `/healthz` and the migrated box's `health.check` (see
[Diagnostic endpoints behind auth](#diagnostic-endpoints-behind-auth) above)
come back healthy before considering the box done.

### Rollback

No maintained reverse migration exists (`assets.md`). If verification fails
after step 3:

```bash
deploy/prod-ssh "su - beebox -c '
  cd /home/beebox/boxes/<box>/content &&
  git annex uninit &&
  git reset --hard HEAD^
'"
```

then restore the pre-migration backup taken in step 1 if `git annex uninit`
plus reverting the migration commit doesn't fully recover (e.g. if the
migration partially committed intermediate state some other way). The local
backup is the rollback story end to end — there is no annex remote to fetch
lost content from (`assets.md`'s "Not yet" section: `numcopies` is 1,
nothing to drop to or restore from except the backup).

## Related

- [`deploy/README.md`](../deploy/README.md) — provisioning scripts, DNS, initial setup.
- [`client-debug-log.md`](./client-debug-log.md) — full client-debug-log format and endpoints.
- [`adding-a-box.md`](./adding-a-box.md) — per-box setup (secrets, connectors, box directory layout).
