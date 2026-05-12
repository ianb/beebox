# Spec: Box as Linux User Account

**Status:** Draft.
**Relationship to other docs:** Builds on the [boxes-as-packages design exploration](boxes-as-packages.md), which proposed Option C (each box is its own code repo + process under its own OS user). This spec tightens that proposal by adopting **the OS user account as the unit of box identity**: there is no separate "box" entity maintained by callback-box; the OS user *is* the box.

---

## 1. Core principle

**`box ↔ user`.** One-to-one. Adding a box is `useradd`. Removing is `userdel`. The OS is the registry; callback-box does not maintain a separate boxes table on disk.

Consequences:
- All standard Unix tooling works: `sudo -u cb-test1 -i`, `ssh cb-test1@server`, `journalctl --user -u cb-server`, per-user cron, per-user systemd, per-user resource limits.
- Listing boxes is `getent passwd`.
- Backing up a box is backing up a home directory.
- Removing a box is `userdel -r` (or with a backup-then-delete safety wrapper).
- File-system isolation between boxes is enforced by kernel permissions, not by application code.

---

## 2. Naming and IDs

| Field | Convention | Example |
|-------|-----------|---------|
| Username | `cb-<boxname>` | `cb-test1` |
| Group | same as username (default `useradd`) | `cb-test1` |
| UID range | 2000–2999 (reserved for boxes) | 2007 |
| Home | `/home/cb-<boxname>/` | `/home/cb-test1/` |
| Shell | `/bin/bash` (so `sudo -u … -i` works for debugging) | |
| URL slug | matches `<boxname>` exactly | `box.example.com/test1/` |

Constraints:
- `<boxname>` is the URL slug (already in use today). Lowercase, alphanumeric + dashes, ≤ 28 chars (so the prefixed username stays ≤ 32, the Linux limit).
- UID range is reserved by convention; provisioning allocates the next free UID in the range.
- `cb-` prefix prevents collision with system users and human accounts.

---

## 3. Per-box home directory layout

```
/home/cb-<boxname>/
├── .env                          # secrets, mode 0600
├── .ssh/authorized_keys          # developer pubkeys for git push
├── .claude/.credentials.json     # bind-mount target, see §10
├── .config/systemd/user/
│   └── cb-server.service         # per-box backend service
├── .config/systemd/user/timers.target.wants/
│   └── cb-tick.timer             # per-box scheduler (optional)
├── box-repo.git/                 # bare repo for git push from laptop
│   └── hooks/post-receive        # runs cb upgrade
└── box-repo/                     # working tree — the actual box
    ├── package.json
    ├── node_modules/
    ├── src/                      # custom views, schemas, connectors
    ├── box/, store/, config/, .callback-box/   # the data side
    └── .git/
```

Permissions:
- Home dir mode `0700` (other boxes cannot read).
- `.env` and `.credentials.json` mode `0600`.
- `box-repo/` mode `0700` (the box owns its data; nothing else on the system reads it directly).

---

## 4. Process lifecycle: systemd --user

The per-box backend runs as a `systemd --user` service. Unit file installed at provision time:

```ini
# /home/cb-<boxname>/.config/systemd/user/cb-server.service
[Unit]
Description=callback-box server (%u)
After=network.target

[Service]
ExecStart=%h/box-repo/node_modules/.bin/cb serve --socket %t/cb.sock
WorkingDirectory=%h/box-repo
EnvironmentFile=%h/.env
Restart=on-failure
RestartSec=5
MemoryMax=512M
CPUQuota=50%
TasksMax=200

[Install]
WantedBy=default.target
```

`%h` = `$HOME`, `%t` = `$XDG_RUNTIME_DIR` (`/run/user/<uid>`), `%u` = username.

**Linger:** `loginctl enable-linger cb-<boxname>` is run at provision time so the user's systemd manager starts at boot without a login session. Without this, the service only runs while someone is logged in as that user — wrong for a server.

**Resource limits:** baked into the unit (`MemoryMax`, `CPUQuota`, `TasksMax`). Uniform defaults; per-box override by editing the unit file. Network egress limits are harder to do per-user without nftables; deferred.

---

## 5. nginx integration

**Decision: unix sockets, not TCP loopback ports.**

Each box's socket lives at `/run/user/<uid>/cb.sock`, owned by `cb-<boxname>:www-data`, mode `0660`. nginx (running as `www-data` and a member of every `cb-<boxname>` group via `www-data` group membership) can connect; nothing else on the system can.

Setup at provision time:
1. Add `www-data` to the `cb-<boxname>` group.
2. The backend opens its socket with `chmod 0660` and `chown :www-data` after binding (handled in `cb serve --socket`).

Per-box nginx fragment (rendered by `cb provision-box`, included from the main config):

```nginx
# /etc/nginx/sites-available/box.example.com.d/<boxname>.conf
upstream cb_<boxname> {
  server unix:/run/user/<uid>/cb.sock;
}
location /<boxname>/ {
  auth_request /auth/verify;          # delegates to identity service
  auth_request_set $auth_email $upstream_http_x_authenticated_email;
  proxy_set_header X-Authenticated-Email $auth_email;
  proxy_pass http://cb_<boxname>/;
  # ... standard proxy headers, websocket upgrade, etc.
}
```

URL shape (`box.example.com/<boxname>/`) is preserved. Subdomains are a deferred future phase.

---

## 6. Git push from laptop: bare repo + post-receive

Each box has a bare repo at `/home/cb-<boxname>/box-repo.git/`. The developer's laptop pushes to it; a `post-receive` hook checks out into `box-repo/`, installs deps if `package.json` changed, restarts the service if `src/` or `package.json` changed.

Setup at provision time:
1. `git init --bare /home/cb-<boxname>/box-repo.git`.
2. Install hook from template:

```bash
#!/bin/bash
# /home/cb-<boxname>/box-repo.git/hooks/post-receive
set -euo pipefail
WORK_TREE=$HOME/box-repo
GIT_DIR=$HOME/box-repo.git

# Detect what changed
PREV=$(git --git-dir=$GIT_DIR rev-parse HEAD~1 2>/dev/null || echo "")
NEW=$(git --git-dir=$GIT_DIR rev-parse HEAD)

# Update working tree
cd $WORK_TREE
git --git-dir=$GIT_DIR --work-tree=$WORK_TREE checkout -f main

CHANGED=$(git --git-dir=$GIT_DIR diff --name-only "$PREV" "$NEW" 2>/dev/null || echo "")

# Reinstall if package.json changed
if echo "$CHANGED" | grep -qx package.json; then
  pnpm install --prefer-offline
fi

# Restart if source or deps changed
if echo "$CHANGED" | grep -qE '^(src/|package\.json|pnpm-lock\.yaml)'; then
  systemctl --user restart cb-server.service
fi
```

3. Developer's pubkey added to `~/.ssh/authorized_keys`.

Laptop usage:
```bash
cd ~/src/boxes/<boxname>
git remote add prod ssh://cb-<boxname>@box.example.com/home/cb-<boxname>/box-repo.git
git push prod main
```

Pull (to receive agent-authored commits made on the server):
```bash
git pull prod main
```

---

## 7. The provisioning command

`cb provision-box <name>` — run as root (or via `sudo`). Idempotent.

```
# Pseudo-code
1. Validate <name>: matches /^[a-z][a-z0-9-]{0,27}$/, not already used.
2. Allocate UID: next free in 2000-2999.
3. useradd --uid <uid> --create-home --shell /bin/bash cb-<name>
4. usermod --append --groups cb-<name> www-data
5. mkdir -p ~cb-<name>/{.ssh,.config/systemd/user,.claude,box-repo.git}
6. Install .ssh/authorized_keys from --pubkey arg or operator's chosen file
7. git init --bare ~cb-<name>/box-repo.git
   Install post-receive hook from template (see §6)
8. Render and install ~cb-<name>/.config/systemd/user/cb-server.service from template
9. Render and install ~cb-<name>/.env from template (operator fills secrets after)
10. Bind-mount setup for ~cb-<name>/.claude/.credentials.json (see §10)
11. chown -R cb-<name>:cb-<name> ~cb-<name>/
    chmod 0700 ~cb-<name>/
    chmod 0600 ~cb-<name>/.env
12. loginctl enable-linger cb-<name>
13. sudo -u cb-<name> systemctl --user enable cb-server.service
    (Service won't start yet — no code in box-repo/ until first push.)
14. Render and install /etc/nginx/sites-available/box.example.com.d/<name>.conf
    nginx -t && systemctl reload nginx
15. Print to stdout the SSH push URL for the operator.
```

After provisioning, the operator pushes initial box content from their laptop (or runs `cb scaffold-box <name>` to clone a template). The service starts on the first push.

---

## 8. The decommissioning command

`cb remove-box <name>` — run as root.

```
1. systemctl --user --machine=cb-<name>@ stop cb-server.service
2. loginctl disable-linger cb-<name>
3. rm /etc/nginx/sites-available/box.example.com.d/<name>.conf
   nginx -t && systemctl reload nginx
4. mv ~cb-<name>/ /var/backups/cb-removed/<name>-$(date +%Y%m%d)/
5. userdel cb-<name>   # without -r, since we already moved
```

The home-dir backup gives a 30-day undo window before manual cleanup. Reversible up to that point.

---

## 9. Scheduled tasks

Today's `cb tick` becomes a per-box concern: each box runs its own scheduler internally (already largely true via `config/schedules/`).

Recommended: a `cb-tick.timer` + `cb-tick.service` pair as `systemd --user` units, installed alongside the main service unit at provision time. Calls `cb tick` once per minute. No cross-box scheduling intelligence — each box rate-limits itself.

```ini
# ~/.config/systemd/user/cb-tick.timer
[Timer]
OnBootSec=2min
OnUnitActiveSec=1min
[Install]
WantedBy=timers.target
```

```ini
# ~/.config/systemd/user/cb-tick.service
[Service]
Type=oneshot
ExecStart=%h/box-repo/node_modules/.bin/cb tick
EnvironmentFile=%h/.env
```

Per-user crontab is the alternative; systemd timers are preferred for symmetry with the service unit and for unified logging via `journalctl --user`.

---

## 10. Shared resources (NOT per-box)

Some things stay shared, owned by non-box system accounts:

| Resource | Where | Owner | Why |
|----------|-------|-------|-----|
| nginx | `/etc/nginx/` | root | One TLS endpoint, one process |
| Identity service | `/srv/callback-id/` | `callback-id` user (UID 1100 or similar) | Single login authority |
| Bare git repos for callback-box, cardworks | `/srv/git/` | `git` user, `git` group with read access for box users | Library distribution |
| pnpm content-addressed store | `/var/lib/pnpm/store/` | `pnpm` group (box users are members) | Disk dedup; safe because content-addressed |
| Claude Code credentials | `/var/lib/claude-shared/credentials.json` | root, 0640, group `cb-claude` (box users are members) | Shared agent identity (see below) |

**Claude Code credentials decision:** **shared, bind-mounted read-only.** The Claude Code account is the agent identity, not a per-box secret. Per-box would mean per-box auth flow, per-box token refresh, per-box revocation surface — operational burden disproportionate to the security benefit.

Bind-mount in each box's service unit:
```ini
[Service]
BindReadOnlyPaths=/var/lib/claude-shared/credentials.json:%h/.claude/.credentials.json
```

When Claude Code refreshes the token, it tries to write back. The bind-mount is read-only, so the write fails — handled by a separate refresher daemon running as root that updates `/var/lib/claude-shared/credentials.json` periodically. (Or: mount read-write and accept that any box can refresh the shared credential — also fine, since they share the credential anyway.)

If the threat model ever expands such that per-box Claude identity matters, this is the one part of the design that needs revisiting.

---

## 11. Inter-box communication: none

Enforced by:
- **Filesystem:** home dirs `0700`, no box can read another's files.
- **Process:** separate systemd users, no shared address space.
- **Network:** each box only listens on a `www-data`-restricted unix socket. A box can dial outbound but cannot reach another box's socket without `www-data` group membership (which it doesn't have).
- **Secrets:** each `.env` is per-user-readable only.

If cross-box features are ever wanted (shared people directory, federated chat), they go through a new shared API service, never through the filesystem.

---

## 12. Inventory and discovery

The OS is the registry.

```bash
# List all boxes
getent passwd | awk -F: '$3>=2000 && $3<3000 {print $1}'

# Per-box status
for u in $(getent passwd | awk -F: '$3>=2000 && $3<3000 {print $1}'); do
  echo "=== $u ==="
  systemctl --user --machine="$u@" status cb-server.service --no-pager | head -3
done

# Per-box disk usage
du -sh /home/cb-*/ 2>/dev/null
```

The supervisor (and identity service, for the box-picker page) read `getent passwd` on startup to build their routing/discovery tables. No separate registry to maintain.

---

## 13. Backup strategy

Per-box backup script (run as root, daily):

```bash
for u in $(getent passwd | awk -F: '$3>=2000 && $3<3000 {print $1}'); do
  tar --exclude='node_modules' --exclude='.pnpm-store' \
      --exclude='.callback-box/events.db-wal' \
      -czf "/var/backups/cb/$(date +%Y%m%d)-$u.tar.gz" \
      "/home/$u/"
done
```

Restore is `useradd` + `tar -x` + `chown` + `pnpm install` + `systemctl --user enable + start`. Effectively a manual re-provision with the data preserved.

The shared resources (claude credentials, bare git repos, pnpm store) need their own backup; one-off concerns at the system level.

---

## 14. Migration from the current shared model

For each of the 8 boxes currently at `/home/callback/boxes/<name>/`:

1. `cb provision-box <name>` — creates `cb-<name>` user, empty home, bare repo, systemd unit, nginx fragment.
2. As root: `cp -a /home/callback/boxes/<name>/. /home/cb-<name>/box-repo/`. Preserves working tree and `.git/`.
3. `chown -R cb-<name>:cb-<name> /home/cb-<name>/box-repo/`.
4. Generate per-box `.env` from the relevant subset of `/home/callback/.env` (manual: review which keys this box uses).
5. As `cb-<name>`: `cd ~/box-repo && pnpm install`.
6. As `cb-<name>`: `systemctl --user start cb-server.service`. Verify socket.
7. Update nginx: switch the `/`<name>`/` upstream from the shared port to the new socket. `nginx -t && systemctl reload nginx`.
8. Hit `box.example.com/<name>/` to verify.
9. Once stable: remove the box from the shared `cb serve`'s argv list.

Do this **one box at a time**, starting with `hearth-test` or `scenarios` (least active). Don't touch the shared service until all 8 have moved.

After all 8 are migrated:
- `systemctl stop callback-shared.service` (or whatever the shared unit is called).
- Remove its systemd unit.
- Move `/home/callback/boxes/` to `/var/backups/cb-shared-retired/`.
- Optionally `userdel callback`.

---

## 15. What this spec deliberately leaves out

- **Containers / namespaces.** Per-OS-user is the boundary. Containers add a layer; this spec doesn't preclude wrapping each box in a container later (each `cb-<boxname>` unit could run inside a podman container), but doesn't require it.
- **Per-box subdomains.** URL shape stays `/`<boxname>`/`. Subdomains are a later optional phase requiring wildcard TLS.
- **Multi-tenant / public hosting.** This spec is single-operator. Hosting other people's boxes adds: stronger isolation (containers), per-user resource accounting/billing, abuse handling, an account-creation flow. Out of scope.
- **Per-box network egress policy.** Possible via nftables `--gid-owner` rules; deferred.
- **Cross-server replication.** A box is one server's user account; if you want a box to span servers, you need a sync layer that doesn't exist today. Out of scope.

---

## 16. Acceptance checklist

A box has been successfully migrated to the user-account model when:

- [ ] `getent passwd cb-<name>` returns a row.
- [ ] `loginctl show-user cb-<name>` shows `Linger=yes`.
- [ ] `sudo -u cb-<name> systemctl --user is-active cb-server.service` returns `active`.
- [ ] `/run/user/<uid>/cb.sock` exists, owned `cb-<name>:www-data`, mode 0660.
- [ ] `box.example.com/<name>/` responds with the expected box page.
- [ ] `git push prod main` from a developer laptop triggers a service restart visible in `journalctl --user`.
- [ ] `sudo -u <other-cb-user> ls /home/cb-<name>/` is denied.
- [ ] `sudo -u <other-cb-user> cat /home/cb-<name>/.env` is denied.
- [ ] Removing this box does not affect any other box (`cb remove-box <name>`, then verify others still respond).
