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

# Do every conflict check before stopping anything, so a partial installation
# does not cause avoidable downtime.
assert_moveable_pair "$OLD_HOME" "$NEW_HOME" "home"
assert_moveable_pair "$OLD_INSTALL" "$NEW_INSTALL" "install"
if [[ -e "$OLD_INSTALL/callback-box" && -e "$OLD_INSTALL/beebox" ]]; then
  die "both checkout paths exist: $OLD_INSTALL/callback-box and $OLD_INSTALL/beebox"
fi
if [[ -e "$NEW_INSTALL/callback-box" && -e "$NEW_INSTALL/beebox" ]]; then
  die "both checkout paths exist: $NEW_INSTALL/callback-box and $NEW_INSTALL/beebox"
fi

# Stop both generations. callback-hub is included because it can have child
# processes whose cwd is inside the install while the filesystem is moved.
OLD_UNITS=(
  callback-hub
  callback-serve
  callback-scheduler
  callback-serve-recycle
  callback-serve-recycle.timer
)
NEW_UNITS=(
  beebox-hub
  beebox-serve
  beebox-scheduler
  beebox-serve-recycle
  beebox-serve-recycle.timer
)
echo "Stopping old and any partially installed Bee Box services..."
for unit in "${OLD_UNITS[@]}" "${NEW_UNITS[@]}"; do
  "$SYSTEMCTL_BIN" stop "$unit" 2>/dev/null || true
done
echo "Disabling retired services (they remain on disk for rollback review)..."
for unit in "${OLD_UNITS[@]}"; do
  "$SYSTEMCTL_BIN" disable "$unit" 2>/dev/null || true
done

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
  mkdir -p "$(dirname "$NEW_INSTALL")"
  mv "$OLD_INSTALL" "$NEW_INSTALL"
fi

# The moved install can still have the old checkout directory even when the
# repository itself has already been renamed upstream.
if [[ -d "$NEW_INSTALL/callback-box" ]]; then
  echo "Renaming the installed checkout to $NEW_INSTALL/beebox..."
  [[ ! -e "$NEW_INSTALL/beebox" ]] || die "checkout destination exists: $NEW_INSTALL/beebox"
  mv "$NEW_INSTALL/callback-box" "$NEW_INSTALL/beebox"
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

ENV_FILE="$NEW_HOME/.env"
if [[ -f "$ENV_FILE" ]]; then
  echo "Migrating environment keys and service PATH..."
  python3 - "$ENV_FILE" "$OLD_HOME" "$NEW_HOME" <<'PY'
import os
import re
import stat
import sys
import tempfile

env_path, old_home, new_home = sys.argv[1:]
assignment = re.compile(r"^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_]*)(=)(.*?)(\r?\n?)$")
lines = []
seen = {}

def canonical_key(key):
    if key.startswith("CALLBACK_"):
        return "BBX_" + key[len("CALLBACK_"):]
    if key.startswith("CB_"):
        return "BBX_" + key[len("CB_"):]
    return key

def migrate_path_value(value):
    quote = ""
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
        quote, value = value[0], value[1:-1]
    entries = [entry for entry in value.replace(old_home + "/.local/bin", new_home + "/.local/bin").split(":") if entry]
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

if [[ "$REHEARSAL" == 1 ]]; then
  mkdir -p "$NEW_HOME" "$NEW_INSTALL" "$LOCAL_BIN"
else
  "$CHOWN_BIN" -R "$NEW_USER:$NEW_USER" "$NEW_HOME"
  "$SU_BIN" - "$NEW_USER" -c 'git config --global user.email "beebox@box.example.com"'
  "$SU_BIN" - "$NEW_USER" -c 'git config --global user.name "Bee Box"'
fi

CLI_SOURCE="$NEW_INSTALL/beebox/bin/bbx"
WAIT_SOURCE="$NEW_INSTALL/beebox/deploy/server-bin/bbx-wait-quiet"
[[ -f "$CLI_SOURCE" ]] || die "new checkout is missing $CLI_SOURCE"
[[ -f "$WAIT_SOURCE" ]] || die "new checkout is missing $WAIT_SOURCE"
mkdir -p "$LOCAL_BIN"
ln -sfn "$CLI_SOURCE" "$LOCAL_BIN/bbx"
install -m 0755 "$WAIT_SOURCE" "$LOCAL_BIN/bbx-wait-quiet"

echo "Files migrated. Run setup-server.sh/deploy from the renamed checkout to install and start the new units. Verify service health and an authenticated request before removing account $OLD_USER or its retired unit files."
