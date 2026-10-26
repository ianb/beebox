# Server configuration

The service's environment file, the service user's engine logins, box login, and per-box access.

## Environment variables (`/home/beebox/.env`)

```
# Required
PUBLIC_URL=https://box.example.com

# Systemd doesn't source .bashrc, so PATH must include the native
# Claude Code install location for the Bee Box user.
PATH=/home/beebox/.local/bin:/usr/local/bin:/usr/bin:/bin

# Auth is ON by default (local password login + first-run setup). Google OAuth
# is an OPTIONAL additional method, enabled only when these are set.
GOOGLE_OAUTH_CLIENT_ID=...
GOOGLE_OAUTH_CLIENT_SECRET=...
BBX_PUBLIC_URL=https://box.example.com

# Local credential store for password login. Optional — defaults to
# ~/.bbx-auth.json (i.e. /home/beebox/.bbx-auth.json). Created 0600 by the
# first-run setup page or `bbx auth create-user`. Never commit it.
# BBX_AUTH_FILE=/home/beebox/.bbx-auth.json

# Google tokens — centralized file shared across all boxes (chmod 600)
BBX_GOOGLE_TOKENS_FILE=/home/beebox/.google-tokens.json

# Web Push (optional — enables browser/PWA push notifications)
# Generate once with: npx web-push generate-vapid-keys
BBX_VAPID_PUBLIC_KEY=...
BBX_VAPID_PRIVATE_KEY=...
# VAPID contact (optional — defaults to PUBLIC_URL). A mailto: or https: URI.
BBX_VAPID_SUBJECT=mailto:you@example.com

# APNs (optional — enables push to the paired iPhone app). See below.
BBX_APNS_KEY_PATH=/home/beebox/.apns/AuthKey_ABC123DEFG.p8
BBX_APNS_KEY_ID=ABC123DEFG
BBX_APNS_TEAM_ID=...
BBX_APNS_BUNDLE_ID=...

# Optional — Google sign-in for the fleet login surface. Login runs before any
# box exists, so this pair cannot come from a per-box grant; a box's own Google
# connectors read the store instead.
GOOGLE_OAUTH_CLIENT_ID=...
GOOGLE_OAUTH_CLIENT_SECRET=...
```

Connector credentials are not `.env` entries. They live in the machine secret
store — `bbx secrets set <name>` then `bbx secrets grant <box> <name>`, one copy
per machine with a per-box grant. See [`../docs/secrets.md`](../secrets.md).

After editing `.env`, restart services: `systemctl restart beebox-hub beebox-scheduler`

### Web Push (VAPID) keys

Push notifications need a single server-wide VAPID keypair (not per-box).
`deploy/deploy.sh` generates one on the first deploy that finds none in
`/home/beebox/.env` and appends it there, before the restart; it never
regenerates (a new keypair invalidates every browser subscription). To set the
keys by hand instead, or on a server the deploy script does not manage:

1. Generate once: `npx web-push generate-vapid-keys`
2. Add `BBX_VAPID_PUBLIC_KEY` and `BBX_VAPID_PRIVATE_KEY` to `/home/beebox/.env`
   (private key stays server-only; it's excluded from the deploy rsync).
3. Restart **both** services so both senders pick them up:
   `systemctl restart beebox-hub beebox-scheduler`. The box server serves the
   public key and sends (callouts, and `bbx notify` from a box agent, which goes
   through it); the scheduler daemon sends reminders and alerts. Every delivery
   attempt is logged to the box's `.beebox/notifications.jsonl`; see
   [notifications](../notifications.md).

Subscriptions are stored server-side at `~/.local/share/beebox/push-subscriptions.json`
(gitignored, never committed). Boxholders enable push per-device from a box's Admin
page; on iOS the app must first be added to the Home Screen.

### APNs (iPhone push) key

Push to the iPhone app needs one server-wide APNs token key (not per-box). The setup
script does **not** seed it — add it as an explicit step:

1. In the Apple Developer account, create a key with the Apple Push Notifications
   service enabled and download its `.p8` file (Apple offers the download once). Note
   its Key ID and the account's Team ID.
2. Copy the file to the server outside the deploy tree, readable by every box
   user and nobody else. The boxes send the pushes (their engines for
   callouts, their scheduler passes for reminders and alerts), and each runs
   as its own user in the `beebox-boxes` group, so the key cannot live under
   the hub's home:
   `install -d -o root -g beebox-boxes -m 0750 /etc/beebox/apns && install -o root -g beebox-boxes -m 0640 AuthKey_<KEYID>.p8 /etc/beebox/apns/`.
3. Add `BBX_APNS_KEY_PATH` (that file), `BBX_APNS_KEY_ID`, `BBX_APNS_TEAM_ID`, and
   `BBX_APNS_BUNDLE_ID` (the iOS app's bundle id) to `/home/beebox/.env`.
4. Restart the hub, which rewrites `/etc/beebox/box.env` from that file, then
   the box units so they load it: `systemctl restart beebox-hub` and
   `systemctl restart 'beebox-box@*.service'`. A box that cannot read the key
   logs `APNs push ... failed: Failed loading token key: EACCES` in its journal
   and sends nothing.

One key serves both APNs hosts; each phone reports whether its build is `sandbox` or
`production` when it registers, and the server sends to that host. With any of the four
unset, the `apns` channel is skipped as `unconfigured` and the Admin Notifications
section says so. Phones register themselves when the app opens; registered phones and
their environment are listed under Admin → Notifications → Phones.

## Service-user logins (Claude Code and Codex)

Claude auth is **not** an env var here: `ANTHROPIC_API_KEY` is deliberately
stripped (`src/cli/entry/bootstrap.ts`, `src/core/script-env/core.ts`) so a stray key
can't silently take over billing. Each box runs as its own user with no login
file; the boxes sign in with one long-lived subscription token held in the
secret store and granted to every box, described under "The long-lived token"
below. `claude auth login` cannot complete on the server (its OAuth callback
lands on a localhost port a laptop browser cannot reach), and the Admin page's
"Sign in" button runs the same flow, so neither works there.

Codex authentication uses the same service-account custody boundary and its
own CLI-managed store under `~/.codex/`. Bee Box deliberately does not reuse a
transcription/search API key or copy a developer's credentials. After the
workspace install creates `/usr/local/bin/codex`, the box owner normally starts
the provider-supported device flow from **Admin → Codex**. Bee Box displays the
short-lived verification URL and code while Codex owns token persistence and
refresh. For recovery when the web UI is unavailable, the equivalent operator
commands are:

```bash
su - bbx-<slug> -c 'set -a; . /etc/beebox/box.env; set +a; codex login --device-auth'
su - bbx-<slug> -c 'codex login status'
```

Each box user has its own `~/.codex/`, so a Codex login is per box.

The direct `@openai/codex` and `@openai/codex-sdk` dependencies are pinned to
the same version. Login, plugin management, and history resolve the direct
package runtime; SDK turns keep the SDK's version-matched vendored binary so
its bundled tools remain available. The symlink exists for operator commands.

### The long-lived token

The boxes sign in with one long-lived token. On a laptop with a browser,
`claude setup-token` prints a token good for about a year; store it under
`claude-oauth-token` and grant it to every box (`bbx secrets set
claude-oauth-token`, `bbx secrets grant <slug> claude-oauth-token`, or Admin →
Secrets). `add-box.sh` carries the grant into a new box's own store with the
rest of its share. The server puts the token in the agent's environment as
`CLAUDE_CODE_OAUTH_TOKEN` for first-party runs and in the `claude auth status`
probes, which then report `authMethod: "oauth_token"`
(`src/core/claude-oauth-token.ts`). When it expires, mint a new one and set it
again; nothing else changes. A box's health check says "signed in with the
box's long-lived token" when the grant is in place; it does not test the
token's validity, and a run reports an expired one.

Copying a laptop login file (`~/.claude/.credentials.json`) to the server does
not work: the refresh token rotates at its first use and the other copies are
revoked (measured 2026-10-25). The token is the one supported path.

## Authentication

Authentication is **on by default** — every box requires a logged-in identity, with no
"auth happens to be off" state to fall into. Two login methods:

- **Local password** (always available, no external service). The first account is the
  boxholder/owner; create it on the server with `bbx auth create-user` (interactive prompt or
  `--password-file`), or open the first-run setup URL the hub prints to its log on first boot
  (`First-run setup: <url>/auth/setup?token=…` — the token expires 15 minutes after boot and
  the page self-disables once an account exists). Credentials are scrypt-hashed in the local
  store (`BBX_AUTH_FILE`, default `~/.bbx-auth.json`, mode 0600).
- **Google OAuth** (optional additional method, enabled by the `GOOGLE_OAUTH_*` env below).

Invites, member passwords, and reset links work as described under
[box login](../install/docker.md#box-login-on-by-default); owner recovery is
`bbx auth set-password` on the host.

Invite and password-reset capabilities are stored only as SHA-256 hashes in a mode-0600 sibling
of the global credential store (`BBX_AUTH_FILE.invites.json`). If
`BBX_AUTH_FILE` is overridden, the hub passes the same path to every child;
credential and capability state therefore remain fleet-global.
The capability file upgrades from version 1 to version 2 on its next mutation.
Rolling back to a release that predates password resets requires restoring the
pre-upgrade capability file (or removing it, which invalidates outstanding links).

The hub terminates login and forwards the authenticated identity to each box child over a
trusted internal header (`x-bbx-authenticated-email`, verified by a per-boot `BBX_HUB_SECRET`
— see `src/webapp/auth.ts`); each box still runs its own per-box authorization check
independently (next section).

> **No unauthenticated mode.** Authentication is structurally always-on — the old
> `BBX_ALLOW_UNAUTHENTICATED` operator opt-out was removed (2026-07). No CLI flag, env var, or
> config field serves a box open; the only unauthenticated servers that can exist are
> test-constructed ones (an in-process `openAccess` construction option, used only by tests).

### Enabling Google OAuth (optional)

Create the OAuth client as in [Google setup](../connectors/google-auth.md) with the
redirect URI `https://box.example.com/auth/callback`, then add
`GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, and `BBX_PUBLIC_URL`
to `/home/beebox/.env` and `systemctl restart beebox-hub`.

## Per-box access control

Per-box access lives in the box's own `_config/box.json`, checked by
`src/webapp/box-access.ts`:

```json
{ "allowedEmails": ["someone@example.com"] }
```

**This is fail-closed, not open**: a missing or empty `allowedEmails` means
*owner-only* access, not "any authenticated user." The owner is always
allowed and is never listed. Login itself is terminated by
the hub, which forwards the authenticated identity to each box over a
trusted internal header — the box's own `allowedEmails` check runs
regardless, so hub auth and per-box authorization are independent layers.
