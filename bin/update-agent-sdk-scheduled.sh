#!/bin/bash
# Scheduled agent-SDK release monitor (macOS launchd shim).
#
#   bin/update-agent-sdk-scheduled.sh --install   # write + load the launchd job
#   bin/update-agent-sdk-scheduled.sh --chat      # open the persistent monitor session
#   bin/update-agent-sdk-scheduled.sh             # what the job runs
#
# Daily around noon (machine-local), resumes one persistent Opus session. The
# agent compares the exact SDK pin with upstream, filters every new release
# through callback-box's actual SDK usage, and prepends its findings to
# callback-box/docs/agent-sdk-notes.md. It never auto-bumps: the same session
# may perform the documented bump flow when the boxholder explicitly asks.
#
# launchd runs calendar jobs missed during sleep once on wake, so a closed
# laptop shifts the run rather than skipping the day. Logs:
# ~/Library/Logs/callback-box-sdk-update.log
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="com.callback-box.sdk-update"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/callback-box-sdk-update.log"
STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/callback-box"
SESSION_ID_FILE="$STATE_DIR/agent-sdk-monitor-session-id"

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
  <dict><key>Hour</key><integer>12</integer><key>Minute</key><integer>4</integer></dict>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
EOF
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$PLIST"
  echo "Installed $LABEL (daily 12:04 machine-local, repo: $REPO_ROOT)."
  echo "Logs: $LOG"
}

session_id() {
  mkdir -p "$STATE_DIR"
  if [ ! -s "$SESSION_ID_FILE" ]; then
    uuidgen | tr '[:upper:]' '[:lower:]' > "$SESSION_ID_FILE"
    chmod 600 "$SESSION_ID_FILE"
  fi
  tr -d '[:space:]' < "$SESSION_ID_FILE"
}

session_exists() {
  local id="$1"
  [ -d "$HOME/.claude/projects" ] &&
    find "$HOME/.claude/projects" -type f -name "$id.jsonl" -print -quit | grep -q .
}

if [ "${1:-}" = "--install" ]; then
  install_job
  exit 0
fi

if [ "${1:-}" = "--chat" ]; then
  cd "$REPO_ROOT"
  id="$(session_id)"
  if session_exists "$id"; then
    exec claude --name "Agent SDK monitor" --model opus --resume "$id"
  fi
  exec claude --name "Agent SDK monitor" --model opus --session-id "$id"
fi

echo "=== $(date) agent-sdk applicability check ==="
cd "$REPO_ROOT"

# Piggyback the Docling currency watch on this job's cadence and log: it is
# check-only, always exits 0, and prints nothing unless a settled newer release
# exists. It never changes whether the SDK monitor runs — a Docling bump is
# manual work (docs/plans/scanner-ingest-docling-decisions.md, D3).
node --import tsx bin/check-docling-update.ts || echo "docling check failed (ignored)"

id="$(session_id)"
claude_args=(
  -p
  --brief
  --name "Agent SDK monitor"
  --model opus
  --permission-mode bypassPermissions
)

# The first invocation creates the pre-minted session; every later invocation
# resumes it. Claude refuses --resume for an id with no transcript yet.
if session_exists "$id"; then
  claude_args+=(--resume "$id")
else
  claude_args+=(--session-id "$id")
fi

"${claude_args[@]}" "You are the persistent Agent SDK release monitor for callback-box. This is your daily check.

Your product is callback-box/docs/agent-sdk-notes.md: a cumulative, newest-first, callback-box-specific filtering of upstream Agent SDK changelog entries. It is not a generic changelog summary. Keep entries after their versions are applied: they are durable evidence for regressions, behavior changes, and opportunities elsewhere in callback-box.

For this turn:
1. Read the notes file and the current pin.
2. Fetch the current npm latest version and the authoritative release notes from anthropics/claude-agent-sdk-typescript. If an SDK release only says it reached Claude Code parity, read the matching anthropics/claude-code changelog entry too.
3. Find every published version newer than the latest version already recorded in the notes, including releases still inside the normal two-day settling window. Also revisit recorded versions newer than the pin while they remain pending.
4. Ground applicability in callback-box's current imports and usage of @anthropic-ai/claude-agent-sdk, especially callback-box/src/core/sdk-hooks.ts, callback-box/src/core/agent/, callback-box/src/core/chat/session/, callback-box/src/services/claude-chat.ts, and callback-box/src/services/scan-vision-claude.ts. Check for other imports too.
5. Prepend one entry for each newly published version to the release ledger; never delete or rewrite older entries merely because their versions were applied. For each version, preserve the upstream facts briefly, then state whether and how the release affects callback-box. Mark the entry applied or pending by comparing it with the current pin. Mark security, memory, and correctness fixes that affect us as act-now; distinguish those from changes that can finish the settling window. A version with nothing relevant needs only a brief nothing-relevant entry.
6. Update the current pin, latest reviewed version, recommendation, and applied/pending labels when the pin or upstream latest changes. Do not create churn merely to record that another daily check ran.
7. Never stage unrelated files. If the notes file already has uncommitted human edits, use SendUserMessage to report the collision and stop. Otherwise, if the notes changed, commit only callback-box/docs/agent-sdk-notes.md. Do not push.
8. If an unapplied release warrants the boxholder's attention, use SendUserMessage to explain the callback-box impact and whether to bump now or wait. Stay silent when no decision is needed.

The scheduled check is not authority to change the SDK pin. However, you are allowed and expected to perform the bump when the boxholder explicitly asks in this persistent session. Then follow callback-box/docs/maintenance.md: update the exact pin, install, typecheck, run the callback-box tests and steering probe, commit, and report the deploy status.

Stay on this task only."
