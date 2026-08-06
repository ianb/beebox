#!/bin/bash
# Weekly runner for callback-box tests that are deliberately excluded from the
# default suite because they use real services or fixed wall-clock delays.
#
#   bin/manual-tests-scheduled.sh --install   # write + load the launchd job
#   bin/manual-tests-scheduled.sh             # what the job runs
#
# Runs Sunday at 11:17 machine-local. launchd runs a calendar job missed during
# sleep once when the machine wakes. Successful runs write only to the log;
# failures also raise a macOS notification.
# Logs: ~/Library/Logs/callback-box-manual-tests.log
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="com.callback-box.manual-tests"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/callback-box-manual-tests.log"

notify_failure() {
  local message
  if [ "$failure_kind" = "tests" ]; then
    message="The weekly manual tests failed. See ~/Library/Logs/callback-box-manual-tests.log."
  else
    message="The weekly manual-test runner failed. See ~/Library/Logs/callback-box-manual-tests.log."
  fi
  /usr/bin/osascript -e "display notification \"$message\" with title \"Callback-box maintenance\"" >/dev/null 2>&1 || true
}

# launchd starts with a minimal PATH; pick up the usual tool homes.
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null 2>&1 && [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$HOME/.nvm/nvm.sh"
fi

install_job() {
  # The plist must point at the durable main checkout, not an ephemeral
  # worktree that disappears when its session ends.
  if [ "$(git -C "$REPO_ROOT" rev-parse --git-dir)" != "$(git -C "$REPO_ROOT" rev-parse --git-common-dir)" ]; then
    echo "Refusing to install from a worktree ($REPO_ROOT) — run this from the main checkout." >&2
    exit 1
  fi
  mkdir -p "$(dirname "$PLIST")" "$(dirname "$LOG")"
  cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$REPO_ROOT/bin/manual-tests-scheduled.sh</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Weekday</key><integer>0</integer>
    <key>Hour</key><integer>11</integer>
    <key>Minute</key><integer>17</integer>
  </dict>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
EOF
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$PLIST"
  echo "Installed $LABEL (weekly Sunday 11:17 machine-local, repo: $REPO_ROOT)."
  echo "Logs: $LOG"
}

if [ "${1:-}" = "--install" ]; then
  install_job
  exit 0
fi

failure_kind="runner"
trap 'status=$?; if [ "$status" -ne 0 ]; then notify_failure; fi' EXIT

echo "=== $(date) callback-box manual tests ==="
cd "$REPO_ROOT"
echo "repo: $(git rev-parse --short HEAD) branch=$(git branch --show-current)"
failure_kind="tests"
pnpm --dir callback-box test:manual
