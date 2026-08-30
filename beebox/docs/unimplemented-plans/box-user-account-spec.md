---
title: "Spec: Box as Linux User Account"
status: superseded
workstream: unknown
issues: []
---
# Spec: Box as Linux User Account

---

## 1. Core principle

**`box ↔ user`.** One-to-one. Adding a box is `useradd`. Removing is `userdel`. The OS is the registry; beebox does not maintain a separate boxes table on disk.

Consequences:
- All standard Unix tooling works: `sudo -u bbx-test1 -i`, `ssh bbx-test1@server`, `journalctl --user -u bbx-server`, per-user cron, per-user systemd, per-user resource limits.
- Listing boxes is `getent passwd`.
- Backing up a box is backing up a home directory.
- Removing a box is `userdel -r` (or with a backup-then-delete safety wrapper).
- File-system isolation between boxes is enforced by kernel permissions, not by application code.

---

## 2. Naming and IDs

| Field | Convention | Example |
|-------|-----------|---------|
| Username | `bbx-<boxname>` | `bbx-test1` |
| Group | same as username (default `useradd`) | `bbx-test1` |
| UID range | 2000–2999 (reserved for boxes) | 2007 |
| Home | `/home/bbx-<boxname>/` | `/home/bbx-test1/` |
| Shell | `/bin/bash` (so `sudo -u … -i` works for debugging) | |
| URL slug | matches `<boxname>` exactly | `box.example.com/test1/` |

Constraints:
- `<boxname>` is the URL slug (already in use today). Lowercase, alphanumeric + dashes, ≤ 28 chars (so the prefixed username stays ≤ 32, the Linux limit).
- UID range is reserved by convention; provisioning allocates the next free UID in the range.
- `bbx-` prefix prevents collision with system users and human accounts.

---

## 3. Per-box home directory layout

```
/home/bbx-<boxname>/
├── .env                          # secrets, mode 0600
├── .ssh/authorized_keys          # developer pubkeys for git push
├── .claude/.credentials.json     # bind-mount target, see §10
├── .config/systemd/user/
│   └── bbx-server.service         # per-box backend service
├── .config/systemd/user/timers.target.wants/
│   └── bbx-tick.timer             # per-box scheduler (optional)
├── box-repo.git/                 # bare repo for git push from laptop
│   └── hooks/post-receive        # runs bbx upgrade
└── box-repo/                     # working tree — the actual box
    ├── package.json
    ├── pnpm-lock.yaml
    ├── node_modules/
    ├── src/                      # custom views, schemas, connectors, tricks
    │   ├── views/
    │   ├── schemas/
    │   ├── tricks/
    │   └── connectors/
    ├── data/                     # the box itself — cards, configs, runtime state
    │   ├── .bbx-box               # marker
    │   ├── box/, store/, config/, people/, procedure/, ...
    │   └── .beebox/        # runtime state, sqlite, logs
    └── .git/
```

Permissions:
- Home dir mode `0700` (other boxes cannot read).
- `.env` and `.credentials.json` mode `0600`.
- `box-repo/` mode `0700` (the box owns its data; nothing else on the system reads it directly).

The `src/` ↔ `data/` split inside the box repo is the layout adopted in [boxes-as-packages-v1-superseded.md §2.3](boxes-as-packages-v1-superseded.md). Code on one side, the box's actual content on the other.

---

## 4. Process lifecycle: systemd --user

The per-box backend runs as a `systemd --user` service. Unit file installed at provision time:

```ini
# /home/bbx-<boxname>/.config/systemd/user/bbx-server.service
[Unit]
Description=beebox server (%u)
After=network.target

[Service]
ExecStart=%h/box-repo/node_modules/.bin/bbx serve --socket %t/bbx.sock --data %h/box-repo/data
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

**Linger:** `loginctl enable-linger bbx-<boxname>` is run at provision time so the user's systemd manager starts at boot without a login session. Without this, the service only runs while someone is logged in as that user — wrong for a server.

**Resource limits:** baked into the unit (`MemoryMax`, `CPUQuota`, `TasksMax`). Uniform defaults; per-box override by editing the unit file. Network egress limits are harder to do per-user without nftables; deferred.

---

## 5. nginx + oauth2-proxy integration

**Decision: unix sockets, not TCP loopback ports.**

Each box's socket lives at `/run/user/<uid>/bbx.sock`, owned by `bbx-<boxname>:www-data`, mode `0660`. nginx (running as `www-data`, member of every `bbx-<boxname>` group) can connect; nothing else on the system can.

Setup at provision time:
1. Add `www-data` to the `bbx-<boxname>` group.
2. The backend opens its socket with `chmod 0660` and `chown :www-data` after binding (handled in `bbx serve --socket`).

**Authentication flow:** oauth2-proxy sits in front of the per-box backends, handling Google OAuth and session cookies. nginx uses `auth_request` to delegate authentication to oauth2-proxy and injects `X-Authenticated-Email` into the upstream request. See [boxes-as-packages-v1-superseded.md §3.5](boxes-as-packages-v1-superseded.md) for the rationale on using oauth2-proxy rather than rolling our own.

```nginx
# /etc/nginx/sites-available/box.example.com.d/<boxname>.conf
upstream bbx_<boxname> {
  server unix:/run/user/<uid>/bbx.sock;
}

location /<boxname>/ {
  auth_request /oauth2/auth;
  auth_request_set $auth_email $upstream_http_x_auth_request_email;
  error_page 401 = /oauth2/sign_in;

  proxy_set_header X-Authenticated-Email $auth_email;
  proxy_pass http://bbx_<boxname>/;
  # ... standard proxy headers, websocket upgrade, etc.
}
```

oauth2-proxy itself runs on a loopback port (e.g., 4180) under its own `oauth2-proxy` system user, fronted by an nginx `location /oauth2/` block.

URL shape (`box.example.com/<boxname>/`) is preserved. Subdomains are a deferred future phase.

---

## 6. Git push from laptop: bare repo + post-receive

Each box has a bare repo at `/home/bbx-<boxname>/box-repo.git/`. The developer's laptop pushes to it; a `post-receive` hook checks out into `box-repo/`, installs deps if `package.json` changed, restarts the service if `src/` or `package.json` changed.

Setup at provision time:
1. `git init --bare /home/bbx-<boxname>/box-repo.git`.
2. Install hook from template:

```bash
#!/bin/bash
# /home/bbx-<boxname>/box-repo.git/hooks/post-receive
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

# Reinstall if package.json or lockfile changed
if echo "$CHANGED" | grep -qE '^(package\.json|pnpm-lock\.yaml)$'; then
  pnpm install --prefer-offline
fi

# Restart if source or deps changed (data/ changes never restart)
if echo "$CHANGED" | grep -qE '^(src/|package\.json|pnpm-lock\.yaml)'; then
  systemctl --user restart bbx-server.service
fi
```

3. Developer's pubkey added to `~/.ssh/authorized_keys`.

Laptop usage:
```bash
cd ~/src/boxes/<boxname>
git remote add prod ssh://bbx-<boxname>@box.example.com/home/bbx-<boxname>/box-repo.git
git push prod main
```

Pull (to receive agent-authored commits made on the server):
```bash
git pull prod main
```

The hook's restart-on-`src/`-change behaviour is Stance A from [boxes-as-packages-v1-superseded.md §7.4](boxes-as-packages-v1-superseded.md). Under Stance B (recommended start), plugin file changes (views, schemas, tricks) trigger an in-process hot reload rather than a systemd restart — the hook would skip the restart for changes confined to `src/views/`, `src/schemas/`, `src/tricks/`.

---

## 7. The provisioning command

`bbx provision-box <name>` — run as root (or via `sudo`). Idempotent.

```
# Pseudo-code
1. Validate <name>: matches /^[a-z][a-z0-9-]{0,27}$/, not already used.
2. Allocate UID: next free in 2000-2999.
3. useradd --uid <uid> --create-home --shell /bin/bash bbx-<name>
4. usermod --append --groups bbx-<name> www-data
5. mkdir -p ~bbx-<name>/{.ssh,.config/systemd/user,.claude,box-repo.git}
6. Install .ssh/authorized_keys from --pubkey arg or operator's chosen file
7. git init --bare ~bbx-<name>/box-repo.git
   Install post-receive hook from template (see §6)
8. Render and install ~bbx-<name>/.config/systemd/user/bbx-server.service from template
9. Render and install ~bbx-<name>/.env from template (operator fills secrets after)
10. Bind-mount setup for ~bbx-<name>/.claude/.credentials.json (see §10)
11. chown -R bbx-<name>:bbx-<name> ~bbx-<name>/
    chmod 0700 ~bbx-<name>/
    chmod 0600 ~bbx-<name>/.env
12. loginctl enable-linger bbx-<name>
13. sudo -u bbx-<name> systemctl --user enable bbx-server.service
    (Service won't start yet — no code in box-repo/ until first push.)
14. Render and install /etc/nginx/sites-available/box.example.com.d/<name>.conf
    nginx -t && systemctl reload nginx
15. Print to stdout the SSH push URL for the operator.
```

After provisioning, the operator pushes initial box content from their laptop (or runs `bbx scaffold-box <name>` to clone a template). The service starts on the first push.

---

## 8. The decommissioning command

`bbx remove-box <name>` — run as root.

```
1. systemctl --user --machine=bbx-<name>@ stop bbx-server.service
2. loginctl disable-linger bbx-<name>
3. rm /etc/nginx/sites-available/box.example.com.d/<name>.conf
   nginx -t && systemctl reload nginx
4. mv ~bbx-<name>/ /var/backups/bbx-removed/<name>-$(date +%Y%m%d)/
5. userdel bbx-<name>   # without -r, since we already moved
```

The home-dir backup gives a 30-day undo window before manual cleanup. Reversible up to that point.

---

## 9. Scheduled tasks

Today's `bbx tick` becomes a per-box concern: each box runs its own scheduler internally (already largely true via `config/schedules/`).

Recommended: a `bbx-tick.timer` + `bbx-tick.service` pair as `systemd --user` units, installed alongside the main service unit at provision time. Calls `bbx tick` once per minute. No cross-box scheduling intelligence — each box rate-limits itself.

```ini
# ~/.config/systemd/user/bbx-tick.timer
[Timer]
OnBootSec=2min
OnUnitActiveSec=1min
[Install]
WantedBy=timers.target
```

```ini
# ~/.config/systemd/user/bbx-tick.service
[Service]
Type=oneshot
ExecStart=%h/box-repo/node_modules/.bin/bbx tick --data %h/box-repo/data
EnvironmentFile=%h/.env
```

Per-user crontab is the alternative; systemd timers are preferred for symmetry with the service unit and for unified logging via `journalctl --user`.

---

## 10. Shared resources (NOT per-box)

Some things stay shared, owned by non-box system accounts:

| Resource | Where | Owner | Why |
|----------|-------|-------|-----|
| nginx | `/etc/nginx/` | root | One TLS endpoint, one process |
| oauth2-proxy | `/etc/oauth2-proxy/` | `oauth2-proxy` user | Single forward-auth gate |
| Box-picker service | `/srv/callback-id/` | `callback-id` user (UID 1100 or similar) | Per-user box discovery + server-level allow-list |
| Bare git repos for beebox, cardworks | `/srv/git/` | `git` user, `git` group with read access for box users | Library distribution |
| pnpm content-addressed store | `/var/lib/pnpm/store/` | `pnpm` group (box users are members) | Disk dedup; safe because content-addressed |
| Claude Code credentials | `/var/lib/claude-shared/credentials.json` | root, 0640, group `bbx-claude` (box users are members) | Shared agent identity (see below) |

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
  systemctl --user --machine="$u@" status bbx-server.service --no-pager | head -3
done

# Per-box disk usage
du -sh /home/bbx-*/ 2>/dev/null
```

The box-picker service reads `getent passwd` on startup (and re-reads periodically) to build its routing/discovery tables. It also reads each box's `data/config/box.json` to compute per-user access. No separate registry to maintain.

---

## 13. Backup strategy

Per-box backup script (run as root, daily):

```bash
for u in $(getent passwd | awk -F: '$3>=2000 && $3<3000 {print $1}'); do
  tar --exclude='node_modules' --exclude='.pnpm-store' \
      --exclude='box-repo/data/.beebox/events.db-wal' \
      -czf "/var/backups/bbx/$(date +%Y%m%d)-$u.tar.gz" \
      "/home/$u/"
done
```

Restore is `useradd` + `tar -x` + `chown` + `pnpm install` + `systemctl --user enable + start`. Effectively a manual re-provision with the data preserved.

The shared resources (claude credentials, bare git repos, pnpm store) need their own backup; one-off concerns at the system level.

---

## 14. Migration from the current shared model

For each of the 8 boxes currently at `/home/beebox/boxes/<name>/`:

1. `bbx provision-box <name>` — creates `bbx-<name>` user, empty home, bare repo, systemd unit, nginx fragment.
2. As root: copy the box content into the new layout — its current `box/`, `store/`, `config/`, etc. go into `/home/bbx-<name>/box-repo/data/`, and a scaffold provides `package.json`, `tsconfig.json`, `pnpm-lock.yaml`, and an empty `src/` at the repo root. Preserves `.git/` history.
3. `chown -R bbx-<name>:bbx-<name> /home/bbx-<name>/box-repo/`.
4. Generate per-box `.env` from the relevant subset of `/home/beebox/.env` (manual: review which keys this box uses).
5. As `bbx-<name>`: `cd ~/box-repo && pnpm install`.
6. As `bbx-<name>`: `systemctl --user start bbx-server.service`. Verify socket.
7. Update nginx: switch the `/`<name>`/` upstream from the shared port to the new socket. `nginx -t && systemctl reload nginx`.
8. Hit `box.example.com/<name>/` to verify.
9. Once stable: remove the box from the shared `bbx serve`'s argv list.

Do this **one box at a time**, starting with `hearth-test` or `scenarios` (least active). Don't touch the shared service until all 8 have moved.

After all 8 are migrated:
- `systemctl stop callback-shared.service` (or whatever the shared unit is called).
- Remove its systemd unit.
- Move `/home/beebox/boxes/` to `/var/backups/bbx-shared-retired/`.
- Optionally `userdel callback`.

---

## 15. What this spec deliberately leaves out

- **Containers / namespaces.** Per-OS-user is the boundary. Containers add a layer; this spec doesn't preclude wrapping each box in a container later (each `bbx-<boxname>` unit could run inside a podman container), but doesn't require it.
- **Per-box subdomains.** URL shape stays `/`<boxname>`/`. Subdomains are a later optional phase requiring wildcard TLS.
- **Multi-tenant / public hosting.** This spec is single-operator. Hosting other people's boxes adds: stronger isolation (containers), per-user resource accounting/billing, abuse handling, an account-creation flow. Out of scope.
- **Per-box network egress policy.** Possible via nftables `--gid-owner` rules; deferred.
- **Cross-server replication.** A box is one server's user account; if you want a box to span servers, you need a sync layer that doesn't exist today. Out of scope.
- **Data migration during library updates.** See [boxes-as-packages-v1-superseded.md §7.7](boxes-as-packages-v1-superseded.md) — deferred to its own design pass.

---

## 16. Acceptance checklist

A box has been successfully migrated to the user-account model when:

- [ ] `getent passwd bbx-<name>` returns a row.
- [ ] `loginctl show-user bbx-<name>` shows `Linger=yes`.
- [ ] `sudo -u bbx-<name> systemctl --user is-active bbx-server.service` returns `active`.
- [ ] `/run/user/<uid>/bbx.sock` exists, owned `bbx-<name>:www-data`, mode 0660.
- [ ] `box.example.com/<name>/` responds with the expected box page (via oauth2-proxy login flow).
- [ ] `git push prod main` from a developer laptop triggers a service restart visible in `journalctl --user`.
- [ ] `sudo -u <other-bbx-user> ls /home/bbx-<name>/` is denied.
- [ ] `sudo -u <other-bbx-user> cat /home/bbx-<name>/.env` is denied.
- [ ] Removing this box does not affect any other box (`bbx remove-box <name>`, then verify others still respond).
