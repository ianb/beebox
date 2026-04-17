# Server Operations

Reference for the running callback-box server (production at `box.example.com`). For initial provisioning scripts see [`deploy/README.md`](../deploy/README.md); this doc covers operational knowledge about the already-provisioned system.

## Server architecture

Services run as the **`callback` user** (User/Group in systemd unit files), not root.

| Path | Owner | Purpose |
|------|-------|---------|
| `/opt/callback/` | root (read-only to `callback`) | Checked-out source code (callback-box, cardworks, callback-clerk) |
| `/home/callback/boxes/` | `callback` | Box data — each subdirectory is a box (inbox/, store/, config/, .callback-box/) |
| `/home/callback/.env` | `callback` | Environment variables for services (API keys, `CB_DIAG_API_KEY`, etc.) |
| `/home/callback/.claude/.credentials.json` | `callback` | Claude Code OAuth credentials (see below) |

Server IP is pinned at [`deploy/server-ip`](../deploy/server-ip). SSH as root for admin (`ssh root@$(cat deploy/server-ip)`); SSH as `callback` for manual data work.

## Code runs from source, not dist

`cb serve` uses `node --import tsx` to execute TypeScript source directly. **Building to `dist/` and deploying that has no effect** — the server reads `.ts` files. `deploy/deploy.sh` rsyncs source files to `/opt/callback/callback-box/src/`.

Consequence: if a behavior seems not to have deployed, check that the file got rsynced as `.ts`, not that `dist/` is up to date.

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

## Diagnostic endpoints behind auth

In production, `/api/debug-log` and `/api/trpc/health.check` sit behind the Google OAuth cookie gate — `curl` without a browser cookie gets rejected.

**Bypass** for machine access: if `CB_DIAG_API_KEY` is set in `/home/callback/.env`, GET requests to those two endpoints are allowed with an `Authorization: Bearer <key>` header:

```bash
curl -H "Authorization: Bearer $CB_DIAG_API_KEY" \
  https://box.example.com/<box>/api/debug-log | python3 -m json.tool
```

On localhost/dev (no `GOOGLE_OAUTH_CLIENT_ID` set), auth is disabled entirely — curl works without the header.

For SSH-only debugging: `ssh root@<server> tail /home/callback/boxes/<box>/.callback-box/client-debug.log`. See [`client-debug-log.md`](./client-debug-log.md) for the log file format.

## Related

- [`deploy/README.md`](../deploy/README.md) — provisioning scripts, DNS, initial setup.
- [`client-debug-log.md`](./client-debug-log.md) — full client-debug-log format and endpoints.
- [`adding-a-box.md`](./adding-a-box.md) — per-box setup (secrets, connectors, box directory layout).
