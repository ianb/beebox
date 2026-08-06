#!/bin/bash
# Weekly runner for callback-box tests that are deliberately excluded from the
# default suite because they use real services or fixed wall-clock delays.
#
#   bin/manual-tests-scheduled.sh --install   # write + load the launchd job
#   bin/manual-tests-scheduled.sh             # what the job runs
#
# Runs Sunday at 11:17 machine-local. launchd runs a calendar job missed during
# sleep once when the machine wakes. Successful runs write only to the log;
# failures also create a local issue and raise a macOS notification.
# Logs: <main checkout>/logs/manual-tests/latest.log
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="com.callback-box.manual-tests"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$REPO_ROOT/logs/manual-tests"
LAUNCHD_LOG="$LOG_DIR/launchd.log"
RUN_ID="$(date -u +%Y-%m-%dT%H%M%SZ)-$$"
RUN_LOG="$LOG_DIR/$RUN_ID.log"
LATEST_LOG="$LOG_DIR/latest.log"
OSASCRIPT="${MANUAL_TESTS_OSASCRIPT:-/usr/bin/osascript}"
failure_kind="runner"
run_commit="unknown"
run_branch="unknown"
failure_log="logs/manual-tests/launchd.log"

notify_failure() {
  local issue_path="$1" message
  if [ "$failure_kind" = "tests" ]; then
    message="The weekly manual tests failed."
  else
    message="The weekly manual-test runner failed."
  fi
  if [ -n "$issue_path" ]; then
    message="$message Issue: $issue_path. Log: $failure_log."
  else
    message="$message Issue creation also failed. Log: $failure_log."
  fi
  "$OSASCRIPT" \
    -e 'on run argv' \
    -e 'display notification (item 1 of argv) with title "Callback-box maintenance"' \
    -e 'end run' \
    "$message" >/dev/null 2>&1 || true
}

find_open_failure_issue() {
  local candidate
  while IFS= read -r -d '' candidate; do
    if grep -Eq '^labels: \[[^]]*scheduled-manual-tests[^]]*\]$' "$candidate"; then
      printf '%s\n' "${candidate#"$REPO_ROOT"/}"
      return
    fi
  done < <(find "$REPO_ROOT/issues" -mindepth 2 -maxdepth 2 -type f -name '*.md' \
    ! -path "$REPO_ROOT/issues/closed/*" -print0)
}

record_failure_issue() {
  local status="$1" issue_path issue_date failure_label
  issue_path="$(find_open_failure_issue)"
  if [ "$failure_kind" = "tests" ]; then
    failure_label="test suite"
  else
    failure_label="runner"
  fi
  if [ -z "$issue_path" ]; then
    issue_date="$(date +%Y-%m-%d)"
    issue_path="issues/bugs/$issue_date-manual-tests-scheduled-failure.md"
    if [ -e "$REPO_ROOT/$issue_path" ] || [ -e "$REPO_ROOT/issues/closed/bugs/$(basename "$issue_path")" ]; then
      issue_path="issues/bugs/$issue_date-$(date +%H%M%S)-manual-tests-scheduled-failure.md"
    fi
    mkdir -p "$REPO_ROOT/issues/bugs" || return
    if ! cat > "$REPO_ROOT/$issue_path" <<'EOF'
---
title: "Weekly manual tests failed"
area: callback-box
labels: [scheduled-manual-tests]
filed-by: agent
discovered-in: main checkout — weekly manual-test launchd job
---

The weekly manual-test job failed. The scheduler created this local issue
automatically. It deliberately left the file uncommitted because
maintenance automation must not mutate Git history.

Inspect the local log and reproduce the failure before changing code. While
this labeled issue remains open, later failures append observations here instead
of creating duplicates. Close it after the cause is resolved or the failure is
confirmed as transient.

## Observations
EOF
    then
      return 1
    fi
  fi
  if ! printf -- '\n- %s — %s failure; exit %s; commit `%s`; branch `%s`; log `%s`\n' \
    "$(date)" "$failure_label" "$status" "$run_commit" "$run_branch" \
    "$failure_log" >> "$REPO_ROOT/$issue_path"
  then
    return 1
  fi
  printf '%s\n' "$issue_path"
}

report_failure() {
  local status="$1" issue_path
  set +e
  issue_path="$(record_failure_issue "$status")"
  if [ -n "$issue_path" ]; then
    printf 'Failure recorded in %s\n' "$issue_path" >&2
  else
    printf 'Failed to create or update the scheduled-test issue\n' >&2
  fi
  notify_failure "$issue_path"
}

handle_interruption() {
  local signal="$1" status="$2"
  printf 'Manual-test run interrupted by %s; no failure issue created\n' "$signal" >&2
  trap - EXIT
  exit "$status"
}

setup_run_log() {
  mkdir -p "$LOG_DIR"
  ln -sfn "$(basename "$RUN_LOG")" "$LATEST_LOG"
  exec >> "$RUN_LOG" 2>&1
  failure_log="logs/manual-tests/$RUN_ID.log"
}

install_job() {
  # The plist must point at the durable main checkout, not an ephemeral
  # worktree that disappears when its session ends.
  if [ "$(git -C "$REPO_ROOT" rev-parse --git-dir)" != "$(git -C "$REPO_ROOT" rev-parse --git-common-dir)" ]; then
    echo "Refusing to install from a worktree ($REPO_ROOT) — run this from the main checkout." >&2
    exit 1
  fi
  mkdir -p "$(dirname "$PLIST")" "$LOG_DIR"
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
  <key>StandardOutPath</key><string>$LAUNCHD_LOG</string>
  <key>StandardErrorPath</key><string>$LAUNCHD_LOG</string>
</dict>
</plist>
EOF
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$PLIST"
  echo "Installed $LABEL (weekly Sunday 11:17 machine-local, repo: $REPO_ROOT)."
  echo "Run logs: $LOG_DIR (latest: $LATEST_LOG)"
}

# Lets the Node regression test source the reporting functions and exercise
# several outcomes in one shell process without running the paid manual suite.
if [ "${MANUAL_TESTS_SOURCE_ONLY:-}" = "1" ]; then
  return 0 2>/dev/null || exit 0
fi

if [ "${1:-}" = "--install" ]; then
  install_job
  exit 0
fi

trap 'status=$?; if [ "$status" -ne 0 ]; then report_failure "$status"; fi' EXIT
trap 'handle_interruption SIGINT 130' INT
trap 'handle_interruption SIGTERM 143' TERM
setup_run_log

# launchd starts with a minimal PATH; pick up the usual tool homes.
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null 2>&1 && [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$HOME/.nvm/nvm.sh"
fi

echo "=== $(date) callback-box manual tests ==="
cd "$REPO_ROOT"
run_commit="$(git rev-parse --short HEAD)"
run_branch="$(git branch --show-current)"
echo "repo: $run_commit branch=$run_branch"
echo "log: logs/manual-tests/$RUN_ID.log"
failure_kind="tests"
node --import tsx --test bin/manual-tests-scheduled.manual.ts
pnpm --dir callback-box test:manual
