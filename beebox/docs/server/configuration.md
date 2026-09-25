# Server configuration

## Environment variables (`/home/beebox/.env`)
Claude auth is **not** an env var here: `ANTHROPIC_API_KEY` is deliberately
stripped (`src/cli/bootstrap.ts`, `src/core/script-env.ts`) so a stray key
can't silently take over billing. The server authenticates via subscription
login instead — run `claude auth login` as the `beebox` user
(`su - beebox -c 'claude auth login'`) once after `setup-server.sh`
installs the CLI, then it persists in `~/.claude/` for that user.

Codex authentication uses the same service-account custody boundary and its
own CLI-managed store under `~/.codex/`. Bee Box deliberately does not reuse a
transcription/search API key or copy a developer's credentials. After the
workspace install creates `/usr/local/bin/codex`, the box owner normally starts
the provider-supported device flow from **Admin → Codex**. Bee Box displays the
short-lived verification URL and code while Codex owns token persistence and
refresh. For recovery when the web UI is unavailable, the equivalent operator
commands are:

```bash
su - beebox -c 'codex login --device-auth'
su - beebox -c 'codex login status'
```

The direct `@openai/codex` and `@openai/codex-sdk` dependencies are pinned to
the same version. Login, plugin management, and history resolve the direct
package runtime; SDK turns keep the SDK's version-matched vendored binary so
its bundled tools remain available. The symlink exists for operator commands.

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
Push notifications need a single server-wide VAPID keypair (not per-box). The setup
script does **not** seed these — add them as an explicit step:

1. Generate once: `npx web-push generate-vapid-keys`
2. Add `BBX_VAPID_PUBLIC_KEY` and `BBX_VAPID_PRIVATE_KEY` to `/home/beebox/.env`
   (private key stays server-only; it's excluded from the deploy rsync).
3. Restart **both** services so the server (serves the public key) and the
   scheduler/finalize (sends pushes) pick them up:
   `systemctl restart beebox-serve beebox-scheduler`

Subscriptions are stored server-side at `~/.local/share/beebox/push-subscriptions.json`
(gitignored, never committed). Boxholders enable push per-device from a box's Admin
page; on iOS the app must first be added to the Home Screen.

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

After the local owner account exists, the owner can create a 15-minute,
single-use invite from a box's Admin page. An invite can be pinned to a known
email or left open for its recipient to enter one; accepting it creates a
member account with the recipient's own password and grants access only to that
box. Open invites cannot claim an existing local user, the owner identity, or
an email already authorized for another box. Signed-in local users change their
own password from Settings. If a member forgets it, the owner can create a
15-minute reset link beside that member in the box's Allowed Users list; the
member chooses the new password, and all of their existing sessions are revoked.
Owner recovery still requires `bbx auth set-password` on the host. Local password and Google sign-in share one
case-insensitive email identity, so a verified Google login with the same email
uses the same account and box access.

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
1. Go to [Google Cloud Console - Credentials](https://console.cloud.google.com/apis/credentials?project=beebox)
2. Create an **OAuth 2.0 Client ID** (Web application type)
3. Add authorized redirect URI: `https://box.example.com/auth/callback`
4. Add to `/home/beebox/.env`:
   ```
   GOOGLE_OAUTH_CLIENT_ID=...
   GOOGLE_OAUTH_CLIENT_SECRET=...
   BBX_PUBLIC_URL=https://box.example.com
   ```
5. Restart services: `systemctl restart beebox-hub`

### Per-box access control
Each box can restrict access to specific email addresses via `config/box.json`:

```json
{
  "allowedEmails": ["someone@example.com", "another@example.com"]
}
```

**This is fail-closed, not open**: a missing or empty `allowedEmails` means *owner-only*
access — **not** "any authenticated user can access the box." (`src/webapp/box-access.ts` is
the source of truth; the owner is always allowed and is never listed here.) To open a box to
someone beyond the owner, list their email explicitly.

Webhooks (`/webhook/<box>/`) remain unauthenticated so external services (Telegram, etc.) still work.

## From server-operations.md (to reconcile)

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

## From adding-a-box.md (to reconcile)

## 3. Access control
Per-box access lives in the box's own `_config/box.json`, checked by
`src/webapp/box-access.ts`:

```json
{ "allowedEmails": ["someone@example.com"] }
```

**This is fail-closed, not open**: a missing or empty `allowedEmails` means
*owner-only* access, not "any authenticated user." The owner is always
allowed and is never listed. Login itself (Google OAuth) is terminated by
the hub, which forwards the authenticated identity to each box over a
trusted internal header — the box's own `allowedEmails` check runs
regardless, so hub auth and per-box authorization are independent layers.

Webhooks (`/webhook/<slug>/...`) are unauthenticated by design so external
services (Telegram, etc.) can reach them.
