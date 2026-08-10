#!/bin/bash
# Scheduled agent-SDK release monitor (macOS launchd shim).
#
#   bin/update-agent-sdk-scheduled.sh --install   # write + load the launchd job
#   bin/update-agent-sdk-scheduled.sh             # what the job runs
#
# Daily around noon (machine-local), resumes one persistent Opus session. The
# agent compares the exact SDK pin with upstream, filters every new release
# through callback-box's actual SDK usage, and prepends its findings to
# docs/agent-sdk-notes.md. It automatically bumps releases after the normal
# settling window, or immediately for callback-box-relevant security, memory,
# and correctness fixes.
#
# It also reads the Claude Code changelog unconditionally, not only when an SDK
# release claims parity. Two reasons: most SDK entries say only "parity with
# Claude Code v2.1.N", so the itemized detail is only there; and Claude Code
# changes reach this repo through a channel the SDK never touches — the harness
# every worker session runs in (hooks, /finish, worktree tooling, permission and
# isolation rules). v2.1.218's worktree git-isolation tightening broke /finish's
# merge step with no SDK API surface at all, and went unnoticed until it failed.
#
# launchd runs calendar jobs missed during sleep once on wake, so a closed
# laptop shifts the run rather than skipping the day. Logs:
# ~/Library/Logs/callback-box-sdk-update.log
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="com.callback-box.sdk-update"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/callback-box-sdk-update.log"
STATE_DIR="$HOME/.local/state/callback-box"
SESSION_ID_FILE="$STATE_DIR/agent-sdk-monitor-session-id"

notify_shell_failure() {
  /usr/bin/osascript -e 'display notification "The daily Agent SDK monitor failed. See ~/Library/Logs/callback-box-sdk-update.log." with title "Callback-box maintenance"' >/dev/null 2>&1 || true
}

trap 'status=$?; if [ "$status" -ne 0 ]; then notify_shell_failure; fi' EXIT

# launchd starts with a minimal PATH; pick up the usual tool homes.
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
# Gate on `node`, not `pnpm`: pnpm comes from Homebrew (already on PATH above)
# but is a node script, so a found-pnpm/missing-node environment kills both the
# Docling check and any SDK update the agent runs.
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

echo "=== $(date) agent-sdk applicability check ==="
cd "$REPO_ROOT"

# Piggyback the Docling currency watch on this job's cadence and log: it is
# check-only, always exits 0, and prints nothing unless a settled newer release
# exists. It never changes whether the SDK monitor runs — a Docling bump is
# manual work (docs/plans/scanner-ingest-docling-decisions.md, D3).
node --import tsx bin/check-docling-update.ts || echo "docling check failed (ignored)"

id="$(session_id)"
claude_args=(
  claude
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

"${claude_args[@]}" "You are the persistent, unattended Agent SDK release monitor and updater for callback-box. This daily turn runs on the boxholder's laptop from the main checkout. Updating the SDK is part of your normal authority; do not wait for human approval.

Your durable product is docs/agent-sdk-notes.md: a cumulative, newest-first, callback-box-specific filtering of upstream Agent SDK changelog entries. It is not a generic changelog summary. Keep entries after their versions are applied: they are durable evidence for regressions, behavior changes, and opportunities elsewhere in callback-box.

For this turn:
1. Before changing anything, require branch main and no modified tracked files; untracked files are fine. If either check fails, use PushNotification to report the collision and stop. Then git pull --ff-only.
2. Read the notes file and the exact SDK pin in callback-box/package.json.
3. Query the npm registry for the complete list of stable published SDK versions and publish times. Starting at the ledger's explicit 0.3.220 floor, read the authoritative release notes from anthropics/claude-agent-sdk-typescript for every stable version missing from the ledger, even if it is already applied or still inside the normal two-day settling window. Also revisit recorded versions newer than the pin while they remain pending. Releases before 0.3.220 are out of scope. Separately and unconditionally, read the anthropics/claude-code changelog for every Claude Code version published since your last turn — not only when an SDK release claims parity. Most SDK releases say only \"parity with Claude Code v2.1.N\", so the itemized detail lives in the Claude Code changelog and is invisible from the SDK notes alone. Claude Code changes also affect this repo through a second channel the SDK never touches: the harness the boxholder and every worker session run in. A real miss to calibrate against — Claude Code v2.1.218 tightened worktree git isolation so a worktree session and its subagents can no longer run git against the main checkout, which silently broke /finish's merge step until it failed mid-run days later.
4. Ground applicability in two distinct channels. RUNTIME: callback-box's current imports and usage of @anthropic-ai/claude-agent-sdk, especially callback-box/src/core/sdk-hooks.ts, callback-box/src/core/agent/, callback-box/src/core/chat/session/, callback-box/src/services/claude-chat.ts, and callback-box/src/services/scan-vision-claude.ts. Search for other imports too. HARNESS: what a Claude Code change does to the workflow this repo is built on — the hooks in .claude/ (SessionStart/SessionEnd, WorktreeCreate/WorktreeRemove, PostToolUse), .claude/agents/finish.md and the /finish flow, bin/ worktree and session tooling, bin/land, and the permission/isolation rules worker sessions run under. A harness change with zero SDK API surface can still break the repo, so assess it on its own terms rather than dismissing it as not-SDK.
5. Prepend one entry for each newly reviewed version to the release ledger; never delete older entries merely because their versions were applied. A Claude Code version that changed harness behavior relevant to this repo gets its own entry too, labeled as a Claude Code release rather than an SDK pin — it has no pin to apply, so record what changed, what it affects here, and whether anything needs adjusting. Ledger entries whose real content is \"parity, see Claude Code vN\" should carry that version's actual itemized findings rather than restating the parity line. Preserve upstream facts briefly, then state whether and how each release affects callback-box. Mark each entry applied or pending by comparing it with the current pin. Mark callback-box-relevant security, memory, and correctness fixes act-now; distinguish those from releases that can finish the settling window. A version with nothing relevant needs only a brief nothing-relevant entry.
6. Bump at most once per turn, with act-now taking precedence. If any pending version has an act-now callback-box-relevant security, memory, or correctness fix, update the exact package.json pin to the newest required stable version, run pnpm install, then pnpm -C callback-box typecheck; do not stop at an older settled version. Otherwise, if a newer stable version has cleared the normal two-day settling window, run pnpm update-agent-sdk. Never install a prerelease.
7. After a bump, run pnpm -C callback-box test and node --import tsx callback-box/scripts/sdk-steering-probe.ts. Then update the ledger's pin, recommendation, and applied/pending labels to match the installed version. Commit exactly docs/agent-sdk-notes.md, callback-box/package.json, and pnpm-lock.yaml as applicable, push origin main, and use PushNotification to report the versions, callback-box relevance, verification, and that the post-commit deployment was triggered. Do not claim the background deployment completed unless you actually verified its per-run log.
8. If no bump is due but the notes changed, commit only docs/agent-sdk-notes.md and push origin main. This root-doc-only commit does not deploy callback-box. Stay silent.
9. If a pull, update, or validation step fails before commit, restore tracked SDK-update changes when doing so is safe, run pnpm install if needed to resynchronize node_modules, use PushNotification to report the failure, and stop. After commit, never rewrite or restore main: the post-commit deployment may already have started. If push or notification then fails, report that failure if possible and stop. Never stage or alter unrelated files. The shell wrapper independently raises a macOS notification for any nonzero agent exit.

Stay on this task only."
