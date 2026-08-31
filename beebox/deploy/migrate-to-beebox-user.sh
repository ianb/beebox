#!/usr/bin/env bash
set -euo pipefail

# One-time production migration from the retired service account and install
# paths to the Bee Box identity. Old names here are intentional migration
# inputs and are covered by the retired-name scanner's migration allowlist.

OLD_USER="callback"
NEW_USER="beebox"

# These overrides make a local rehearsal safe: no test process needs access to
# /home, /opt, /etc/systemd, or a real account. Production leaves the root
# override unset and requires root.
MIGRATION_ROOT="${BBX_MIGRATION_ROOT:-}"
REHEARSAL="${BBX_MIGRATION_REHEARSAL:-0}"

under_root() {
  local absolute_path="$1"
  if [[ -n "$MIGRATION_ROOT" ]]; then
    printf '%s%s\n' "${MIGRATION_ROOT%/}" "$absolute_path"
  else
    printf '%s\n' "$absolute_path"
  fi
}

OLD_HOME="${OLD_HOME:-$(under_root /home/callback)}"
NEW_HOME="${NEW_HOME:-$(under_root /home/beebox)}"
OLD_INSTALL="${OLD_INSTALL:-$(under_root /opt/callback)}"
NEW_INSTALL="${NEW_INSTALL:-$(under_root /opt/beebox)}"
LOCAL_BIN="${LOCAL_BIN:-$(under_root /usr/local/bin)}"
SYSTEMD_DIR="${SYSTEMD_DIR:-$(under_root /etc/systemd/system)}"
STAGED_CHECKOUT="$OLD_INSTALL/beebox"
NEW_CHECKOUT="$NEW_INSTALL/beebox"
RETIRED_CHECKOUT="$NEW_INSTALL/callback-box-retired"

SYSTEMCTL_BIN="${SYSTEMCTL_BIN:-systemctl}"
USERADD_BIN="${USERADD_BIN:-useradd}"
CHOWN_BIN="${CHOWN_BIN:-chown}"
SU_BIN="${SU_BIN:-su}"

die() {
  echo "Migration refused: $*" >&2
  exit 1
}

if [[ "$REHEARSAL" != 1 && "$(id -u)" -ne 0 ]]; then
  echo "Run this migration as root." >&2
  exit 1
fi
if [[ "$REHEARSAL" == 1 && -z "$MIGRATION_ROOT" ]]; then
  die "BBX_MIGRATION_REHEARSAL requires BBX_MIGRATION_ROOT"
fi

path_nonempty() {
  [[ -d "$1" ]] && [[ -n "$(find "$1" -mindepth 1 -maxdepth 1 -print -quit)" ]]
}

assert_moveable_pair() {
  local old_path="$1"
  local new_path="$2"
  local description="$3"
  if [[ -e "$old_path" && -e "$new_path" ]]; then
    # useradd -m or an interrupted first run can leave an empty destination.
    # It is safe to remove that residue; never merge two generations.
    if [[ -d "$new_path" ]] && ! path_nonempty "$new_path"; then return; fi
    die "both $description paths exist: $old_path and $new_path"
  fi
}

echo "=== Migrating production to the Bee Box identity ==="

FIRST_CUTOVER=0
if [[ -e "$OLD_HOME" || -e "$OLD_INSTALL" ]]; then FIRST_CUTOVER=1; fi

# Do every conflict check before stopping anything, so a partial installation
# does not cause avoidable downtime.
assert_moveable_pair "$OLD_HOME" "$NEW_HOME" "home"
assert_moveable_pair "$OLD_INSTALL" "$NEW_INSTALL" "install"
if [[ "$FIRST_CUTOVER" == 1 ]]; then
  [[ -f "$STAGED_CHECKOUT/bin/bbx" ]] || die "stage the renamed checkout at $STAGED_CHECKOUT before migration"
  [[ -f "$STAGED_CHECKOUT/deploy/server-bin/bbx-wait-quiet" ]] || die "staged checkout is missing bbx-wait-quiet"
  [[ ! -e "$RETIRED_CHECKOUT" ]] || die "retired checkout destination exists: $RETIRED_CHECKOUT"
fi

# Key collisions are knowable before downtime. Refuse conflicting old/new
# spellings rather than silently choosing one during the rewrite.
PREFLIGHT_ENV="$OLD_HOME/.env"
[[ -f "$PREFLIGHT_ENV" ]] || PREFLIGHT_ENV="$NEW_HOME/.env"
if [[ -f "$PREFLIGHT_ENV" ]]; then
  python3 - "$PREFLIGHT_ENV" <<'PY'
import re, sys
assignment = re.compile(r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$")
seen = {}
for line in open(sys.argv[1], encoding="utf-8"):
    match = assignment.match(line.rstrip("\r\n"))
    if not match:
        continue
    old_key, value = match.groups()
    if old_key.startswith("CALLBACK_"):
        key = "BBX_" + old_key[len("CALLBACK_"):]
    elif old_key.startswith("CB_"):
        key = "BBX_" + old_key[len("CB_"):]
    else:
        key = old_key
    if key in seen and seen[key] != value:
        raise SystemExit(f"conflicting values for migrated environment key {key}")
    seen[key] = value
PY
fi

PREFLIGHT_HOME="$OLD_HOME"
[[ -d "$PREFLIGHT_HOME" ]] || PREFLIGHT_HOME="$NEW_HOME"
python3 - "$PREFLIGHT_HOME" <<'PY'
import json, pathlib, sys
home = pathlib.Path(sys.argv[1])
config = home / ".config/cb"
if not config.is_dir():
    config = home / ".config/beebox"
paths = [config / "hub.json", config / "boxes.json"]
paths.extend(sorted((home / "boxes").glob("*/package.json")))
for path in paths:
    if not path.is_file():
        continue
    value = json.loads(path.read_text(encoding="utf-8"))
    for section in ("dependencies", "devDependencies", "optionalDependencies"):
        deps = value.get(section) if isinstance(value, dict) else None
        if isinstance(deps, dict) and "callback-box" in deps and "beebox" in deps:
            raise SystemExit(f"both retired and canonical dependencies exist in {path}")
PY

# Stop both generations. callback-hub is included because it can have child
# processes whose cwd is inside the install while the filesystem is moved.
OLD_UNITS=(
  callback-hub
  callback-serve
  callback-scheduler
  callback-serve-recycle
  callback-serve-recycle.timer
  claude-update.timer
)
NEW_UNITS=(
  beebox-hub
  beebox-serve
  beebox-scheduler
  beebox-serve-recycle
  beebox-serve-recycle.timer
)
if [[ "$FIRST_CUTOVER" == 1 ]]; then
  echo "Stopping old and any partially installed Bee Box services..."
  for unit in "${OLD_UNITS[@]}" "${NEW_UNITS[@]}"; do
    "$SYSTEMCTL_BIN" stop "$unit" 2>/dev/null || true
  done
  echo "Disabling retired services (they remain on disk for rollback review)..."
  for unit in "${OLD_UNITS[@]}"; do
    "$SYSTEMCTL_BIN" disable "$unit" 2>/dev/null || true
  done
fi

user_exists() {
  if [[ "$REHEARSAL" == 1 ]]; then
    [[ -f "$MIGRATION_ROOT/.users/$1" ]]
  else
    id -u "$1" >/dev/null 2>&1
  fi
}

create_user() {
  if [[ "$REHEARSAL" == 1 ]]; then
    mkdir -p "$MIGRATION_ROOT/.users"
    : > "$MIGRATION_ROOT/.users/$NEW_USER"
  else
    # -M is deliberate: useradd -m creates a non-empty home before the guard
    # can move the retired home into place.
    "$USERADD_BIN" -M -s /bin/bash "$NEW_USER"
  fi
}

if ! user_exists "$NEW_USER"; then
  echo "Creating user '$NEW_USER' without an automatically-created home..."
  create_user
fi

if [[ -d "$OLD_HOME" ]]; then
  echo "Moving $OLD_HOME to $NEW_HOME..."
  if [[ -d "$NEW_HOME" ]]; then rmdir "$NEW_HOME"; fi
  mkdir -p "$(dirname "$NEW_HOME")"
  mv "$OLD_HOME" "$NEW_HOME"
elif [[ ! -d "$NEW_HOME" ]]; then
  mkdir -p "$NEW_HOME"
fi

if [[ -d "$OLD_INSTALL" ]]; then
  echo "Moving $OLD_INSTALL to $NEW_INSTALL..."
  if [[ -d "$NEW_INSTALL" ]]; then rmdir "$NEW_INSTALL"; fi
  mkdir -p "$(dirname "$NEW_INSTALL")"
  mv "$OLD_INSTALL" "$NEW_INSTALL"
fi

# Preserve the old checkout as a directly reversible rollback artifact. The
# renamed checkout was staged alongside it before downtime.
if [[ -d "$NEW_INSTALL/callback-box" ]]; then
  echo "Retaining the old checkout at $RETIRED_CHECKOUT..."
  mv "$NEW_INSTALL/callback-box" "$RETIRED_CHECKOUT"
fi

migrate_path() {
  local old_path="$1"
  local new_path="$2"
  if [[ -e "$old_path" ]]; then
    if [[ -e "$new_path" ]]; then
      if [[ -d "$new_path" ]] && ! path_nonempty "$new_path"; then
        rmdir "$new_path"
      else
        die "both persisted paths exist: $old_path and $new_path"
      fi
    fi
    mkdir -p "$(dirname "$new_path")"
    mv "$old_path" "$new_path"
  fi
}

# Move credentials and machine state after the home move, preserving bytes and
# modes. The runtime has the same pairs as a fallback, but services should not
# have to depend on a later CLI invocation to complete their cutover.
migrate_path "$NEW_HOME/.config/cb" "$NEW_HOME/.config/beebox"
migrate_path "$NEW_HOME/.local/share/cb" "$NEW_HOME/.local/share/beebox"
migrate_path "$NEW_HOME/.cb-session-secret" "$NEW_HOME/.bbx-session-secret"
migrate_path "$NEW_HOME/.cb-auth.json" "$NEW_HOME/.bbx-auth.json"
migrate_path "$NEW_HOME/.cb-auth.json.invites.json" "$NEW_HOME/.bbx-auth.json.invites.json"

ENV_FILE="$NEW_HOME/.env"
if [[ -f "$ENV_FILE" ]]; then
  echo "Migrating environment keys and service PATH..."
  [[ -f "$ENV_FILE.pre-beebox-rename" ]] || cp -p "$ENV_FILE" "$ENV_FILE.pre-beebox-rename"
  python3 - "$ENV_FILE" "$OLD_HOME" "$NEW_HOME" "$OLD_INSTALL" "$NEW_INSTALL" <<'PY'
import os
import re
import stat
import sys
import tempfile

env_path, old_home, new_home, old_install, new_install = sys.argv[1:]
assignment = re.compile(r"^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_]*)(=)(.*?)(\r?\n?)$")
lines = []
seen = {}

def canonical_key(key):
    if key.startswith("CALLBACK_"):
        return "BBX_" + key[len("CALLBACK_"):]
    if key.startswith("CB_"):
        return "BBX_" + key[len("CB_"):]
    return key

def migrate_value(value):
    quote = ""
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
        quote, value = value[0], value[1:-1]
    value = value.replace(old_install + "/callback-box", new_install + "/beebox")
    value = value.replace(old_home, new_home).replace(old_install, new_install)
    value = value.replace("/.config/cb", "/.config/beebox")
    value = value.replace("/.local/share/cb", "/.local/share/beebox")
    value = value.replace("/.cb-session-secret", "/.bbx-session-secret")
    value = value.replace("/.cb-auth.json", "/.bbx-auth.json")
    return quote + value + quote

def migrate_path_value(value):
    value = migrate_value(value)
    quote = ""
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
        quote, value = value[0], value[1:-1]
    entries = [entry for entry in value.split(":") if entry]
    local_bin = new_home + "/.local/bin"
    entries = [entry for entry in entries if entry != local_bin]
    entries.insert(0, local_bin)
    result = ":".join(entries)
    return quote + result + quote

for line in open(env_path, encoding="utf-8"):
    match = assignment.match(line)
    if not match:
        lines.append(line)
        continue
    prefix, old_key, equals, value, newline = match.groups()
    key = canonical_key(old_key)
    if key == "PATH":
        value = migrate_path_value(value)
    else:
        value = migrate_value(value)
    prior = seen.get(key)
    if prior is not None and prior != value:
        raise SystemExit(f"conflicting values for migrated environment key {key}")
    seen[key] = value
    lines.append(prefix + key + equals + value + newline)

mode = stat.S_IMODE(os.stat(env_path).st_mode)
fd, tmp_path = tempfile.mkstemp(prefix=".env.bbx-", dir=os.path.dirname(env_path), text=True)
try:
    os.chmod(tmp_path, mode)
    with os.fdopen(fd, "w", encoding="utf-8", newline="") as output:
        output.writelines(lines)
    os.replace(tmp_path, env_path)
except BaseException:
    try:
        os.unlink(tmp_path)
    except FileNotFoundError:
        pass
    raise
PY
fi

echo "Rewriting persisted paths and box package dependencies..."
python3 - "$NEW_HOME" "$OLD_HOME" "$NEW_HOME" "$OLD_INSTALL" "$NEW_INSTALL" <<'PY'
import json, os, pathlib, shutil, sys, tempfile

home = pathlib.Path(sys.argv[1])
old_home, new_home, old_install, new_install = sys.argv[2:]
paths = [home / ".config/beebox/hub.json", home / ".config/beebox/boxes.json"]
paths.extend(sorted((home / "boxes").glob("*/package.json")))

def rewrite(value):
    if isinstance(value, str):
        value = value.replace(old_install + "/callback-box", new_install + "/beebox")
        value = value.replace(old_home, new_home).replace(old_install, new_install)
        value = value.replace("/.config/cb", "/.config/beebox")
        value = value.replace("/.local/share/cb", "/.local/share/beebox")
        value = value.replace("/.cb-session-secret", "/.bbx-session-secret")
        return value.replace("/.cb-auth.json", "/.bbx-auth.json")
    if isinstance(value, list):
        return [rewrite(item) for item in value]
    if isinstance(value, dict):
        result = {key: rewrite(item) for key, item in value.items()}
        for section in ("dependencies", "devDependencies", "optionalDependencies"):
            deps = result.get(section)
            if isinstance(deps, dict) and "callback-box" in deps:
                old_value = deps.pop("callback-box")
                new_value = rewrite(old_value).replace("callback-box", "beebox")
                if "beebox" in deps and deps["beebox"] != new_value:
                    raise SystemExit(f"conflicting beebox dependency in {path}")
                deps["beebox"] = new_value
        return result
    return value

for path in paths:
    if not path.is_file():
        continue
    if path.name == "package.json" and path.parent.parent == home / "boxes":
        backup = home / ".beebox-rename-backups" / path.parent.name / path.name
        backup.parent.mkdir(parents=True, exist_ok=True)
    else:
        backup = path.with_name(path.name + ".pre-beebox-rename")
    if not backup.exists():
        shutil.copy2(path, backup)
    original = json.loads(path.read_text(encoding="utf-8"))
    updated = rewrite(original)
    fd, temporary = tempfile.mkstemp(prefix=path.name + ".bbx-", dir=path.parent, text=True)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as output:
            json.dump(updated, output, indent=2)
            output.write("\n")
        os.chmod(temporary, path.stat().st_mode)
        os.replace(temporary, path)
    except BaseException:
        pathlib.Path(temporary).unlink(missing_ok=True)
        raise
PY

if [[ "$REHEARSAL" == 1 ]]; then
  mkdir -p "$NEW_HOME" "$NEW_INSTALL" "$LOCAL_BIN"
else
  "$CHOWN_BIN" -R "$NEW_USER:$NEW_USER" "$NEW_HOME"
  "$SU_BIN" - "$NEW_USER" -c 'git config --global user.email "beebox@box.example.com"'
  "$SU_BIN" - "$NEW_USER" -c 'git config --global user.name "Bee Box"'
fi

CLI_SOURCE="$NEW_CHECKOUT/bin/bbx"
WAIT_SOURCE="$NEW_CHECKOUT/deploy/server-bin/bbx-wait-quiet"
[[ -f "$CLI_SOURCE" ]] || die "new checkout is missing $CLI_SOURCE"
[[ -f "$WAIT_SOURCE" ]] || die "new checkout is missing $WAIT_SOURCE"
mkdir -p "$LOCAL_BIN"
ln -sfn "$CLI_SOURCE" "$LOCAL_BIN/bbx"
install -m 0755 "$WAIT_SOURCE" "$LOCAL_BIN/bbx-wait-quiet"

echo "Installing canonical Bee Box service units..."
mkdir -p "$SYSTEMD_DIR"
cat > "$SYSTEMD_DIR/beebox-hub.service" <<EOF
[Unit]
Description=Bee Box Hub (per-box supervisor + router)
After=network.target

[Service]
Type=simple
User=$NEW_USER
Group=$NEW_USER
ExecStart=/usr/local/bin/bbx hub
WorkingDirectory=$NEW_HOME
EnvironmentFile=$NEW_HOME/.env
KillMode=mixed
TimeoutStopSec=60
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

cat > "$SYSTEMD_DIR/beebox-scheduler.service" <<EOF
[Unit]
Description=Bee Box Scheduler
After=network.target

[Service]
Type=simple
User=$NEW_USER
Group=$NEW_USER
ExecStart=/usr/local/bin/bbx scheduler start
WorkingDirectory=$NEW_HOME/boxes
EnvironmentFile=$NEW_HOME/.env
KillMode=mixed
TimeoutStopSec=60
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

if [[ -f "$SYSTEMD_DIR/claude-update.service" ]]; then
  [[ -f "$SYSTEMD_DIR/claude-update.service.pre-beebox-rename" ]] || \
    cp -p "$SYSTEMD_DIR/claude-update.service" "$SYSTEMD_DIR/claude-update.service.pre-beebox-rename"
  sed -e "s|User=$OLD_USER|User=$NEW_USER|" \
      -e "s|Group=$OLD_USER|Group=$NEW_USER|" \
      -e "s|$OLD_HOME|$NEW_HOME|g" \
      -e "s|$OLD_INSTALL/callback-box|$NEW_CHECKOUT|g" \
      "$SYSTEMD_DIR/claude-update.service" > "$SYSTEMD_DIR/claude-update.service.bbx-new"
  mv "$SYSTEMD_DIR/claude-update.service.bbx-new" "$SYSTEMD_DIR/claude-update.service"
fi

"$SYSTEMCTL_BIN" daemon-reload
"$SYSTEMCTL_BIN" enable beebox-hub beebox-scheduler
if [[ -f "$SYSTEMD_DIR/claude-update.timer" ]]; then
  "$SYSTEMCTL_BIN" enable --now claude-update.timer
fi

echo "Files and units migrated. Run deploy.sh from the renamed checkout to sync code, converge boxes, start the new units, and verify health. Keep account $OLD_USER and its retired unit files until rollback is no longer needed."
