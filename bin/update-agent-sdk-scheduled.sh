#!/bin/bash
# Scheduled agent-SDK currency runner (macOS launchd shim).
#
#   bin/update-agent-sdk-scheduled.sh --install   # write + load the launchd job
#   bin/update-agent-sdk-scheduled.sh             # what the job runs
#
# Weekdays around noon (machine-local), runs `pnpm update-agent-sdk --check`
# in this repo. Up to date → exits silently (no tokens spent). Behind → spawns
# a headless `claude -p` session that performs the full update flow from
# callback-box/docs/maintenance.md ("Agent SDK update"): bump, test, steering
# probe, commit to main, push — or, on any failure, restores the tree and
# files an issue instead. Preconditions (clean main checkout) are enforced by
# the agent prompt, so a run that collides with in-progress work stops early.
#
# launchd runs calendar jobs missed during sleep once on wake, so a closed
# laptop shifts the run rather than skipping the day. Logs:
# ~/Library/Logs/callback-box-sdk-update.log
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="com.callback-box.sdk-update"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/callback-box-sdk-update.log"

# launchd starts with a minimal PATH; pick up the usual tool homes.
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
# Gate on `node`, not `pnpm`: pnpm comes from Homebrew (already on PATH above)
# but is a node script, so a found-pnpm/missing-node environment made every run
# die with `env: node: No such file or directory` — a non-zero exit the check
# below read as "behind", spawning a headless agent daily for nothing.
if ! command -v node >/dev/null 2>&1 && [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$HOME/.nvm/nvm.sh"
fi

install_job() {
  # Refuse to install from a git worktree: the plist embeds $REPO_ROOT, and a
  # worktree path evaporates when its session ends. Install from the main
  # checkout so the job survives.
  if [ "$(git -C "$REPO_ROOT" rev-parse --git-dir)" != "$(git -C "$REPO_ROOT" rev-parse --git-common-dir)" ]; then
    echo "Refusing to install from a worktree ($REPO_ROOT) — run this from the main checkout." >&2
    exit 1
  fi
  mkdir -p "$(dirname "$PLIST")"
  cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$REPO_ROOT/bin/update-agent-sdk-scheduled.sh</string>
  </array>
  <key>StartCalendarInterval</key>
  <array>
    <dict><key>Weekday</key><integer>1</integer><key>Hour</key><integer>12</integer><key>Minute</key><integer>4</integer></dict>
    <dict><key>Weekday</key><integer>2</integer><key>Hour</key><integer>12</integer><key>Minute</key><integer>4</integer></dict>
    <dict><key>Weekday</key><integer>3</integer><key>Hour</key><integer>12</integer><key>Minute</key><integer>4</integer></dict>
    <dict><key>Weekday</key><integer>4</integer><key>Hour</key><integer>12</integer><key>Minute</key><integer>4</integer></dict>
    <dict><key>Weekday</key><integer>5</integer><key>Hour</key><integer>12</integer><key>Minute</key><integer>4</integer></dict>
  </array>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
EOF
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$PLIST"
  echo "Installed $LABEL (weekdays 12:04 machine-local, repo: $REPO_ROOT)."
  echo "Logs: $LOG"
}

if [ "${1:-}" = "--install" ]; then
  install_job
  exit 0
fi

echo "=== $(date) sdk-update check ==="
cd "$REPO_ROOT"

if pnpm update-agent-sdk --check; then
  exit 0 # up to date — spend nothing
fi

echo "SDK is behind — launching headless update agent..."
claude -p --permission-mode bypassPermissions "You are a scheduled maintenance agent in the callback-box monorepo main checkout (your cwd). The agent SDK is behind; perform the update flow documented in callback-box/docs/maintenance.md under 'Agent SDK update':

1. Preconditions: the current branch must be main and 'git status --porcelain' must show no modified tracked files (untracked files are fine). If violated, print why and stop — do nothing else.
2. git pull --ff-only.
3. Run 'pnpm update-agent-sdk' (bumps @anthropic-ai/claude-agent-sdk, installs, typechecks). If SDK type changes break typecheck, make the minimal mechanical fixes per repo conventions (read CLAUDE.md first; never weaken or disable lint rules).
4. Run 'pnpm -C callback-box test', then 'node --import tsx callback-box/scripts/sdk-steering-probe.ts'.
5. Everything green: commit to main — include old and new SDK + bundled CLI versions in the message, end with the repo's Co-Authored-By trailer convention — and push origin main. The post-commit deploy hook firing is expected and correct.
6. Any failure you cannot confidently fix: restore the working tree ('git restore :/' and 'pnpm install' to resync node_modules), then file an issue under issues/bugs/ (frontmatter per issues/CLAUDE.md, filed-by: agent) with the failing output, commit only that issue file to main, and push.

Stay on this task only; do not start unrelated work."
