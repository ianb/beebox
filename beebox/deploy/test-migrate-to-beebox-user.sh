#!/usr/bin/env bash
set -euo pipefail

# Filesystem/service-order rehearsal for migrate-to-beebox-user.sh. It never
# calls a real user-management or systemd command.
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
ROOT=$(mktemp -d)
trap 'rm -rf "$ROOT"' EXIT
OLD_HOME="$ROOT/home/callback"

mkdir -p "$OLD_HOME/.config/cb" "$OLD_HOME/.local/share/cb"
mkdir -p "$OLD_HOME/boxes/birch" "$ROOT/etc/systemd/system"
mkdir -p "$ROOT/opt/callback/callback-box/bin"
mkdir -p "$ROOT/opt/callback/beebox/bin" "$ROOT/opt/callback/beebox/deploy/server-bin"
mkdir -p "$ROOT/fake-bin"
printf '%s\n' 'old state' > "$OLD_HOME/.config/cb/state.json"
printf '%s\n' 'old scheduler state' > "$OLD_HOME/.local/share/cb/scheduler.json"
printf '%s\n' 'secret' > "$OLD_HOME/.cb-session-secret"
printf '%s\n' '{}' > "$OLD_HOME/.cb-auth.json"
printf '%s\n' '{"invites":[]}' > "$OLD_HOME/.cb-auth.json.invites.json"
printf '%s\n' '{"boxes":{"birch":{"path":"'"$OLD_HOME"'/boxes/birch"}}}' > "$OLD_HOME/.config/cb/hub.json"
printf '%s\n' '{"boxes":["'"$OLD_HOME"'/boxes/birch/content"]}' > "$OLD_HOME/.config/cb/boxes.json"
printf '%s\n' '{"dependencies":{"callback-box":"link:'"$ROOT"'/opt/callback/callback-box"}}' > "$OLD_HOME/boxes/birch/package.json"
printf '%s\n' \
  'CALLBACK_DEEPGRAM_API_KEY=deepgram' \
  'CB_PUBLIC_URL=https://box.example.com' \
  "CB_GOOGLE_TOKENS_FILE=$OLD_HOME/.google-tokens.json" \
  "PATH=$OLD_HOME/.local/bin:/usr/local/bin:/usr/bin:/bin" \
  > "$OLD_HOME/.env"
printf '%s\n' '#!/bin/sh' > "$ROOT/opt/callback/callback-box/bin/cb"
printf '%s\n' '#!/bin/sh' > "$ROOT/opt/callback/beebox/bin/bbx"
printf '%s\n' '#!/bin/sh' > "$ROOT/opt/callback/beebox/deploy/server-bin/bbx-wait-quiet"
cat > "$ROOT/etc/systemd/system/claude-update.service" <<EOF
[Service]
User=callback
Group=callback
Environment=PATH=$OLD_HOME/.local/bin:/usr/local/bin
ExecStart=$ROOT/opt/callback/callback-box/deploy/claude-update.sh
EOF
: > "$ROOT/etc/systemd/system/claude-update.timer"

# The single-quoted argument below is fixture source, not a shell expansion.
# shellcheck disable=SC2016
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'printf "%s\\n" "$*" >> "$BBX_SYSTEMCTL_LOG"' \
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
[[ -f "$ROOT/home/beebox/.bbx-auth.json.invites.json" ]]
[[ -d "$ROOT/opt/beebox/beebox" && ! -e "$ROOT/opt/callback" ]]
[[ -d "$ROOT/opt/beebox/callback-box-retired" ]]
grep -q '^BBX_DEEPGRAM_API_KEY=deepgram$' "$ROOT/home/beebox/.env"
grep -q '^BBX_PUBLIC_URL=https://box.example.com$' "$ROOT/home/beebox/.env"
grep -q "^BBX_GOOGLE_TOKENS_FILE=$ROOT/home/beebox/.google-tokens.json$" "$ROOT/home/beebox/.env"
grep -q "^PATH=$ROOT/home/beebox/.local/bin:/usr/local/bin:/usr/bin:/bin$" "$ROOT/home/beebox/.env"
grep -q "$ROOT/home/beebox/boxes/birch" "$ROOT/home/beebox/.config/beebox/hub.json"
grep -q "$ROOT/home/beebox/boxes/birch/content" "$ROOT/home/beebox/.config/beebox/boxes.json"
grep -q '"beebox": "link:.*/opt/beebox/beebox"' "$ROOT/home/beebox/boxes/birch/package.json"
if grep -q 'callback-box' "$ROOT/home/beebox/boxes/birch/package.json"; then
  echo "retired dependency survived package migration" >&2
  exit 1
fi
[[ -f "$ROOT/home/beebox/.env.pre-beebox-rename" ]]
[[ -f "$ROOT/home/beebox/.config/beebox/hub.json.pre-beebox-rename" ]]
[[ -f "$ROOT/home/beebox/.beebox-rename-backups/birch/package.json" ]]
[[ ! -e "$ROOT/home/beebox/boxes/birch/package.json.pre-beebox-rename" ]]
[[ "$(readlink "$ROOT/usr/local/bin/bbx")" == "$ROOT/opt/beebox/beebox/bin/bbx" ]]
grep -q '^User=beebox$' "$ROOT/etc/systemd/system/claude-update.service"
grep -q "$ROOT/opt/beebox/beebox/deploy/claude-update.sh" "$ROOT/etc/systemd/system/claude-update.service"

first_disable=$(grep -n '^disable callback-hub$' "$SYSTEMCTL_LOG" | cut -d: -f1)
last_stop=$(grep -n '^stop beebox-serve-recycle.timer$' "$SYSTEMCTL_LOG" | cut -d: -f1)
[[ "$first_disable" -gt "$last_stop" ]]
grep -q '^stop callback-hub$' "$SYSTEMCTL_LOG"
grep -q '^disable callback-serve$' "$SYSTEMCTL_LOG"
grep -q '^daemon-reload$' "$SYSTEMCTL_LOG"
grep -q '^enable beebox-hub beebox-scheduler$' "$SYSTEMCTL_LOG"
grep -q '^enable --now claude-update.timer$' "$SYSTEMCTL_LOG"
grep -q '^User=beebox$' "$ROOT/etc/systemd/system/beebox-hub.service"
grep -q '^ExecStart=/usr/local/bin/bbx hub$' "$ROOT/etc/systemd/system/beebox-hub.service"
grep -q "^WorkingDirectory=$ROOT/home/beebox$" "$ROOT/etc/systemd/system/beebox-hub.service"
grep -q '^ExecStart=/usr/local/bin/bbx scheduler start$' "$ROOT/etc/systemd/system/beebox-scheduler.service"

# A second invocation is the expected post-cutover state: no old paths remain,
# and re-installing the wrappers does not conflict with the existing targets.
stop_count_before=$(grep -c '^stop ' "$SYSTEMCTL_LOG")
BBX_MIGRATION_ROOT="$ROOT" \
BBX_MIGRATION_REHEARSAL=1 \
SYSTEMCTL_BIN="$ROOT/fake-bin/systemctl" \
BBX_SYSTEMCTL_LOG="$SYSTEMCTL_LOG" \
bash "$SCRIPT_DIR/migrate-to-beebox-user.sh" >/dev/null
stop_count_after=$(grep -c '^stop ' "$SYSTEMCTL_LOG")
[[ "$stop_count_after" -eq "$stop_count_before" ]]

echo "migrate-to-beebox-user rehearsal passed"
