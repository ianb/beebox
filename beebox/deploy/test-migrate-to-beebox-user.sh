#!/usr/bin/env bash
set -euo pipefail

# Filesystem/service-order rehearsal for migrate-to-beebox-user.sh. It never
# calls a real user-management or systemd command.
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
ROOT=$(mktemp -d)
trap 'rm -rf "$ROOT"' EXIT
OLD_HOME="$ROOT/home/callback"

mkdir -p "$OLD_HOME/.config/cb" "$OLD_HOME/.local/share/cb"
mkdir -p "$ROOT/opt/callback/callback-box/bin" "$ROOT/opt/callback/callback-box/deploy/server-bin"
mkdir -p "$ROOT/fake-bin"
printf '%s\n' 'old state' > "$OLD_HOME/.config/cb/state.json"
printf '%s\n' 'old scheduler state' > "$OLD_HOME/.local/share/cb/scheduler.json"
printf '%s\n' 'secret' > "$OLD_HOME/.cb-session-secret"
printf '%s\n' '{}' > "$OLD_HOME/.cb-auth.json"
printf '%s\n' \
  'CALLBACK_DEEPGRAM_API_KEY=deepgram' \
  'CB_PUBLIC_URL=https://box.example.com' \
  "PATH=$OLD_HOME/.local/bin:/usr/local/bin:/usr/bin:/bin" \
  > "$OLD_HOME/.env"
printf '%s\n' '#!/bin/sh' > "$ROOT/opt/callback/callback-box/bin/bbx"
printf '%s\n' '#!/bin/sh' > "$ROOT/opt/callback/callback-box/deploy/server-bin/bbx-wait-quiet"

# The single-quoted argument below is fixture source, not a shell expansion.
# shellcheck disable=SC2016
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'printf "%s %s\\n" "$1" "$2" >> "$BBX_SYSTEMCTL_LOG"' \
  > "$ROOT/fake-bin/systemctl"
chmod +x "$ROOT/fake-bin/systemctl"
SYSTEMCTL_LOG="$ROOT/systemctl.log"

BBX_MIGRATION_ROOT="$ROOT" \
BBX_MIGRATION_REHEARSAL=1 \
SYSTEMCTL_BIN="$ROOT/fake-bin/systemctl" \
BBX_SYSTEMCTL_LOG="$SYSTEMCTL_LOG" \
bash "$SCRIPT_DIR/migrate-to-beebox-user.sh" >/dev/null

[[ -d "$ROOT/home/beebox" && ! -e "$ROOT/home/callback" ]]
[[ -d "$ROOT/home/beebox/.config/beebox" && ! -e "$ROOT/home/beebox/.config/cb" ]]
[[ -d "$ROOT/home/beebox/.local/share/beebox" && ! -e "$ROOT/home/beebox/.local/share/cb" ]]
[[ -f "$ROOT/home/beebox/.bbx-session-secret" && -f "$ROOT/home/beebox/.bbx-auth.json" ]]
[[ -d "$ROOT/opt/beebox/beebox" && ! -e "$ROOT/opt/callback" ]]
grep -q '^BBX_DEEPGRAM_API_KEY=deepgram$' "$ROOT/home/beebox/.env"
grep -q '^BBX_PUBLIC_URL=https://box.example.com$' "$ROOT/home/beebox/.env"
grep -q "^PATH=$ROOT/home/beebox/.local/bin:/usr/local/bin:/usr/bin:/bin$" "$ROOT/home/beebox/.env"
[[ "$(readlink "$ROOT/usr/local/bin/bbx")" == "$ROOT/opt/beebox/beebox/bin/bbx" ]]

first_disable=$(grep -n '^disable callback-hub$' "$SYSTEMCTL_LOG" | cut -d: -f1)
last_stop=$(grep -n '^stop beebox-serve-recycle.timer$' "$SYSTEMCTL_LOG" | cut -d: -f1)
[[ "$first_disable" -gt "$last_stop" ]]
grep -q '^stop callback-hub$' "$SYSTEMCTL_LOG"
grep -q '^disable callback-serve$' "$SYSTEMCTL_LOG"

# A second invocation is the expected post-cutover state: no old paths remain,
# and re-installing the wrappers does not conflict with the existing targets.
BBX_MIGRATION_ROOT="$ROOT" \
BBX_MIGRATION_REHEARSAL=1 \
SYSTEMCTL_BIN="$ROOT/fake-bin/systemctl" \
BBX_SYSTEMCTL_LOG="$SYSTEMCTL_LOG" \
bash "$SCRIPT_DIR/migrate-to-beebox-user.sh" >/dev/null

echo "migrate-to-beebox-user rehearsal passed"
