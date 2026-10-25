#!/usr/bin/env bash
#
# migrate-to-box-users.sh — move every box from the shared `beebox` user to its
# own user and unit (docs/plans/per-box-units.md, Track E; the identity split
# is per-box-units.subplan.md). Run ONCE, as root, on the server, after a
# snapshot, with the deploy that installed the units already live and the
# services stopped. Idempotent per slug: a slug whose home exists and whose old
# path is gone is skipped, so an interrupted run is finished by running again.
#
#   migrate-to-box-users.sh [--dry-run] [--hub-config /home/beebox/.config/beebox/hub.json]
#
# For each slug in hub.json: create group and user bbx-<slug> (UID from
# 2000-2999, home /var/lib/beebox/<slug>, 0751), move the box to
# /var/lib/beebox/<slug>/box, chown it, set the modes the hub relies on, copy
# that box's secret grants into the box user's own store and verify the copy,
# copy the box's push subscriptions, point the box's engine link at the install,
# rewrite hub.json (path + socket) and the scheduler manifest for the
# beebox-sched user, and enable the socket. The hub's own files
# (session secret, auth file, hub.json) stay in /home/beebox.
#
# Nothing here talks to GitHub; a box's push credential (its deploy key and
# ssh alias, deploy/add-box.sh) is copied from /home/beebox/.ssh into the box
# user's ~/.ssh so the box keeps pushing.
set -euo pipefail

[[ "$EUID" -eq 0 ]] || { echo "run as root" >&2; exit 1; }

DRY_RUN=""
HUB_CONFIG=/home/beebox/.config/beebox/hub.json
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --hub-config) HUB_CONFIG="$2"; shift 2 ;;
    *) echo "usage: $0 [--dry-run] [--hub-config <path>]" >&2; exit 64 ;;
  esac
done

BBX_HOME=/home/beebox
BOXES_DIR=/var/lib/beebox
HUB_ENV="$BBX_HOME/.env"
OLD_BOXES_JSON="$BBX_HOME/.config/beebox/boxes.json"
SCHED_HOME=/var/lib/beebox-sched
NEW_BOXES_JSON="$SCHED_HOME/.config/beebox/boxes.json"
BBX=/usr/local/bin/bbx

run() { if [[ -n "$DRY_RUN" ]]; then echo "  [dry-run] $*"; else "$@"; fi; }
say() { echo "== $*"; }

# ── Preconditions ───────────────────────────────────────────────────────
[[ -f "$HUB_CONFIG" ]] || { echo "no hub config at $HUB_CONFIG" >&2; exit 1; }
for unit in beebox-box@.socket beebox-box@.service beebox-pass@.service; do
  [[ -e "/etc/systemd/system/$unit" ]] || { echo "unit $unit is not installed; deploy first" >&2; exit 1; }
done
[[ -x "$BBX" ]] || { echo "no $BBX" >&2; exit 1; }
for svc in beebox-hub beebox-scheduler; do
  if systemctl is-active --quiet "$svc"; then
    echo "$svc is running; stop both services first (systemctl stop beebox-hub beebox-scheduler)" >&2
    exit 1
  fi
done
getent group beebox-boxes >/dev/null || run groupadd beebox-boxes
if ! id beebox-sched >/dev/null 2>&1; then
  run useradd --system --user-group -d "$SCHED_HOME" -m -s /usr/sbin/nologin beebox-sched
fi
# The hub joins the cache group (for /etc/beebox/box.env), never a box group.
run usermod -a -G beebox-boxes beebox
run install -d -o root -g beebox-boxes -m 2775 /etc/beebox
run install -d -o root -g beebox -m 0775 /run/beebox
run install -d -o root -g root -m 0755 "$BOXES_DIR" /var/cache/beebox
run install -d -o root -g beebox-boxes -m 2775 /var/cache/beebox/uv
run install -d -o root -g beebox-boxes -m 2775 /var/cache/beebox/hf
if [[ ! -f /etc/beebox/box.env ]]; then
  say "writing a first /etc/beebox/box.env (the hub rewrites it at each start)"
  run bash -c "printf 'BBX_UNIT_HOST=1\nPATH=/usr/local/bin:/usr/bin:/bin\nUV_CACHE_DIR=/var/cache/beebox/uv\nHF_HOME=/var/cache/beebox/hf\n' > /etc/beebox/box.env && chmod 0640 /etc/beebox/box.env && chgrp beebox-boxes /etc/beebox/box.env"
fi

# ── The slugs and their current paths, from hub.json ────────────────────
# The node program is quoted on purpose; the shell expands nothing in it.
# shellcheck disable=SC2016
mapfile -t ENTRIES < <(node -e '
  const cfg = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  for (const [slug, entry] of Object.entries(cfg.boxes)) process.stdout.write(`${slug}\t${entry.path}\t${entry.socket ?? ""}\n`);
' "$HUB_CONFIG")
[[ ${#ENTRIES[@]} -gt 0 ]] || { echo "hub.json names no boxes" >&2; exit 1; }

next_uid() {
  local uid
  for uid in $(seq 2000 2999); do
    getent passwd "$uid" >/dev/null || getent group "$uid" >/dev/null || { echo "$uid"; return; }
  done
  echo "no free UID in 2000-2999" >&2
  return 1
}

# Grants: the box's own store is its share of the hub user's master (values
# included), written 0600 into the box user's home and verified: the grant
# names in the copy equal the master's for this slug. A missing store reads as
# empty, so a copy that silently lost a grant is the failure this catches.
MASTER_STORE=$(sudo -u beebox -H bash -lc "set -a; source $HUB_ENV 2>/dev/null; set +a; echo \"\${BBX_SECRETS_FILE:-$BBX_HOME/.config/beebox/secrets.json}\"")
copy_grants() { # copy_grants <slug> <home>
  local slug="$1" home="$2"
  local store="$home/.config/beebox/secrets.json"
  run install -d -o "bbx-$slug" -g "bbx-$slug" -m 0700 "$home/.config" "$home/.config/beebox"
  run bash -c "sudo -u beebox -H bash -lc 'set -a; source $HUB_ENV 2>/dev/null; set +a; $BBX engine secrets export-box $slug --agent-confirmed' > '$store.tmp'"
  run install -o "bbx-$slug" -g "bbx-$slug" -m 0600 "$store.tmp" "$store"
  run rm -f "$store.tmp"
  # shellcheck disable=SC2016
  run node -e '
    const fs = require("fs");
    const [master, copy, slug] = process.argv.slice(1);
    const names = (file) => Object.keys(JSON.parse(fs.readFileSync(file, "utf8")).grants[slug] ?? {}).sort().join(",");
    if (names(master) !== names(copy)) { console.error(`grant mismatch for ${slug}: master [${names(master)}] copy [${names(copy)}]`); process.exit(1); }
  ' "$MASTER_STORE" "$store" "$slug"
}

HUB_JSON_EDITS=()
for entry in "${ENTRIES[@]}"; do
  IFS=$'\t' read -r slug old_path socket <<< "$entry"
  home="$BOXES_DIR/$slug"
  new_path="$home/box"
  say "$slug"
  if [[ ${#slug} -gt 28 ]]; then echo "  slug longer than 28 characters cannot be a user name; stop" >&2; exit 1; fi
  # Already migrated: hub.json names the new path and the socket (a box
  # add-box.sh created on the unit host, or an earlier run of this script).
  if [[ -n "$socket" && -d "$new_path" && ( "$old_path" == "$new_path" || ! -e "$old_path" ) ]]; then
    echo "  already migrated"; continue
  fi
  if [[ -d "$new_path" && -e "$old_path" && "$old_path" != "$new_path" ]]; then
    echo "  both $old_path and $new_path exist; finish by hand" >&2; exit 1
  fi
  if ! getent group "bbx-$slug" >/dev/null; then run groupadd -g "$(next_uid)" "bbx-$slug"; fi
  if ! id "bbx-$slug" >/dev/null 2>&1; then
    run useradd -u "$(getent group "bbx-$slug" | cut -d: -f3)" -g "bbx-$slug" -G beebox-boxes -d "$home" -M -s /bin/bash "bbx-$slug"
  fi
  run install -d -o "bbx-$slug" -g "bbx-$slug" -m 0751 "$home"
  if [[ -e "$old_path" && "$old_path" != "$new_path" ]]; then
    run mv "$old_path" "$new_path"
  fi
  run chown -R "bbx-$slug:bbx-$slug" "$home"
  # Modes the hub relies on: traversable root and .beebox, everything else private.
  # `! -type l`: chmod follows a symlink named on its command line, and
  # .beebox/engine points at the installed engine (the probe VM's /opt/beebox
  # went 0700 this way, 2026-10-24).
  run bash -c "find '$home' -mindepth 1 -maxdepth 1 ! -name box ! -type l -exec chmod go-rwx {} +"
  run chmod 0751 "$new_path"
  run bash -c "find '$new_path' -mindepth 1 -maxdepth 1 ! -name .beebox ! -type l -exec chmod -R go-rwx {} +"
  run install -d -o "bbx-$slug" -g "bbx-$slug" -m 0751 "$new_path/.beebox"
  run bash -c "find '$new_path/.beebox' -mindepth 1 ! -name hub-meta.json ! -type l -exec chmod go-rwx {} +"
  # The box user's own config and caches, all private.
  for d in .claude .codex .config .local .cache .ssh; do
    run install -d -o "bbx-$slug" -g "bbx-$slug" -m 0700 "$home/$d"
  done
  # Push subscriptions for this box; the store is split by the engine's own verb.
  run install -d -o "bbx-$slug" -g "bbx-$slug" -m 0700 "$home/.local/share" "$home/.local/share/beebox"
  run bash -c "sudo -u beebox -H bash -lc 'set -a; source $HUB_ENV 2>/dev/null; set +a; $BBX engine boxes export-push $slug' > '$home/.local/share/beebox/push-subscriptions.json.tmp'"
  run bash -c "chown bbx-$slug:bbx-$slug '$home/.local/share/beebox/push-subscriptions.json.tmp' && chmod 0600 '$home/.local/share/beebox/push-subscriptions.json.tmp' && mv '$home/.local/share/beebox/push-subscriptions.json.tmp' '$home/.local/share/beebox/push-subscriptions.json'"
  copy_grants "$slug" "$home"
  # Google tokens: the hub's centralized file (BBX_GOOGLE_TOKENS_FILE in .env)
  # is hidden from a box unit, and box.env does not name it. Each box gets a
  # copy at the per-box location the token store reads when the env var is
  # unset (src/google/token-store.ts), so connectors keep authenticating; the
  # probe decides whether boxes should instead authorize separately
  # (per-box-units.subplan.md, Google token row).
  google_tokens=$(grep -E '^BBX_GOOGLE_TOKENS_FILE=' "$HUB_ENV" 2>/dev/null | cut -d= -f2- || true)
  if [[ -n "$google_tokens" && -f "$google_tokens" ]]; then
    run install -d -o "bbx-$slug" -g "bbx-$slug" -m 0700 "$new_path/_config/connectors"
    run install -o "bbx-$slug" -g "bbx-$slug" -m 0600 "$google_tokens" "$new_path/_config/connectors/google.secret.json"
  fi
  # The box's push credential: its deploy key and ssh alias (deploy/add-box.sh).
  key="$BBX_HOME/.ssh/id_ed25519_box_${slug//-/_}"
  if [[ -f "$key" ]]; then
    run install -o "bbx-$slug" -g "bbx-$slug" -m 0600 "$key" "$home/.ssh/$(basename "$key")"
    run install -o "bbx-$slug" -g "bbx-$slug" -m 0644 "$key.pub" "$home/.ssh/$(basename "$key").pub"
    run bash -c "printf 'Host github.com-box-%s\n  HostName github.com\n  User git\n  IdentityFile %s\n  IdentitiesOnly yes\n' '$slug' '$home/.ssh/$(basename "$key")' > '$home/.ssh/config' && chown bbx-$slug:bbx-$slug '$home/.ssh/config' && chmod 0600 '$home/.ssh/config'"
  fi
  run bash -c "sudo -u bbx-$slug -H git config --global user.email beebox@box.example.com && sudo -u bbx-$slug -H git config --global user.name 'Bee Box'"
  # The hub reads one file from here; the engine writes it as the box user.
  run bash -c "cd '$new_path' && sudo -u bbx-$slug -H env BBX_UNIT_HOST=1 $BBX engine init . >/dev/null"
  run systemctl enable "beebox-box@$slug.socket"
  HUB_JSON_EDITS+=("$slug=$new_path")
done

# ── Manifests ───────────────────────────────────────────────────────────
say "hub.json: paths and sockets"
# shellcheck disable=SC2016
run node -e '
  const fs = require("fs");
  const [file, ...edits] = process.argv.slice(1);
  const cfg = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const edit of edits) {
    const [slug, path] = edit.split("=");
    cfg.boxes[slug] = { ...cfg.boxes[slug], path, socket: `/run/beebox/${slug}.sock` };
  }
  delete cfg.lazy; delete cfg.idleMs; delete cfg.keepRecent;
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n");
' "$HUB_CONFIG" "${HUB_JSON_EDITS[@]}"
say "boxes.json for the scheduler user"
run install -d -o beebox-sched -g beebox-sched -m 0700 "$SCHED_HOME/.config" "$SCHED_HOME/.config/beebox"
# shellcheck disable=SC2016
run node -e '
  const fs = require("fs");
  const [oldFile, newFile, ...edits] = process.argv.slice(1);
  const old = fs.existsSync(oldFile) ? JSON.parse(fs.readFileSync(oldFile, "utf8")) : { boxes: [] };
  const moved = new Map(edits.map((e) => { const [slug, path] = e.split("="); return [slug, path]; }));
  const boxes = old.boxes.map((p) => moved.get(require("path").basename(p)) ?? p);
  for (const path of moved.values()) if (!boxes.includes(path)) boxes.push(path);
  fs.writeFileSync(newFile, JSON.stringify({ ...old, boxes }, null, 2) + "\n");
' "$OLD_BOXES_JSON" "$NEW_BOXES_JSON" "${HUB_JSON_EDITS[@]}"
run chown beebox-sched:beebox-sched "$NEW_BOXES_JSON"

say "scheduler unit runs as beebox-sched (the versioned unit the deploy keeps current)"
run install -o root -g root -m 0644 /opt/beebox/beebox/deploy/systemd/beebox-scheduler.service /etc/systemd/system/beebox-scheduler.service
# The old ExecStart drop-in named the same command; the unit now says it itself.
run rm -f /etc/systemd/system/beebox-scheduler.service.d/exec-start.conf
run systemctl daemon-reload
run systemctl start 'beebox-box@*.socket' 2>/dev/null || true
for entry in "${HUB_JSON_EDITS[@]}"; do run systemctl start "beebox-box@${entry%%=*}.socket"; done

say "done; start the services: systemctl start beebox-hub beebox-scheduler"
echo "Then check: curl -s --unix-socket /run/beebox/<slug>.sock http://box/api/build-info (as beebox), and the hub's /healthz."
