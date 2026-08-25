#!/usr/bin/env bash
# Shared Terminal session launcher. Callers set the LS_* inputs below, then
# call launch_session_build followed by launch_session_open.
#
# Everything here opens a Terminal tab. The unattended counterpart —
# `claude -p` / `codex exec` in the foreground, briefing on stdin, for
# scheduled runs — is launch-headless.sh, sourced here so that a caller who
# sources this file has both launchers and neither duplicates the other's flag
# assembly (callback-box/docs/plans/scheduled-workstreams.md, Track B).

# shellcheck source=launch-headless.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/launch-headless.sh"

launch_session_build() {
  local model_arg="" rc_arg="" model_line=""
  LS_LAUNCHER="$LS_LAUNCH_DIR/launch.sh"
  LS_LAUNCH_TOKEN="${LS_LAUNCH_TOKEN:-$(uuidgen 2>/dev/null || printf '%s-%s-%s' "$(date +%s)" "$$" "$RANDOM")}"

  if [ "$LS_AGENT" = "codex" ] && [ -z "$LS_MODEL" ]; then
    LS_MODEL="gpt-5.6-sol"
  fi

  if [ "$LS_AGENT" = "claude" ]; then
    [ -n "$LS_MODEL" ] && model_arg="--model $LS_MODEL"
    [ "$LS_REMOTE_CONTROL" = "1" ] && rc_arg="--remote-control $LS_WORKSTREAM"
    cat > "$LS_LAUNCHER" <<EOF
#!/usr/bin/env bash
set -euo pipefail
printf '\033]0;%s\007' "$LS_SESSION_NAME"
cd "$LS_MONO"
. "$LS_MONO/bin/lib/session-registry.sh"
launch_pending=1
launch_on_exit() {
  launch_status=\$?
  if [ "\$launch_pending" = "1" ]; then
    session_registry_fail_launch "$LS_WORKSTREAM" "$LS_LAUNCH_TOKEN" "setup-exited-status-\$launch_status" >/dev/null || true
  fi
  return "\$launch_status"
}
trap launch_on_exit EXIT
if [ -n "${LS_WORKTREE_PATH:-}" ]; then
  wt_path="$LS_WORKTREE_PATH"
elif ! wt_path=\$(./bin/workstreams create "$LS_WORKSTREAM"); then
  echo "launch-worktree-session: failed to create or reattach $LS_WORKSTREAM" >&2
  exit 1
fi
if [ -z "\$wt_path" ] || [ ! -d "\$wt_path" ] || ! git -C "\$wt_path" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "launch-worktree-session: invalid worktree path for $LS_WORKSTREAM: '\$wt_path'" >&2
  exit 1
fi
if [ -n "${LS_ISSUE:-}" ]; then
  node --import tsx "$LS_MONO/bin/assign-issue-workstream.ts" "\$wt_path/${LS_ISSUE:-}" "$LS_WORKSTREAM"
fi
launch_patch=\$(jq -n \
  --arg branch "worktree-$LS_WORKSTREAM" \
  --arg emoji "$LS_EMOJI" \
  --arg agent "claude" \
  --arg model "$LS_MODEL" \
  --arg tty "\$(tty 2>/dev/null || true)" \
  --arg baseSha "\$(git -C "\$wt_path" merge-base main HEAD 2>/dev/null || true)" \
    --arg launchedAt "\$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg description "\$(if [ -s "${LS_DESCRIPTION_FILE:-}" ]; then cat "${LS_DESCRIPTION_FILE:-}"; fi)" \
    '{branch:\$branch, emoji:\$emoji, agent:\$agent, tty:\$tty, baseSha:\$baseSha, launchedAt:\$launchedAt, removed:null}
     + if \$model == "" then {} else {model:\$model} end
     + if \$description == "" then {} else {description:\$description} end')
cd "\$wt_path"
if session_registry_complete_launch "$LS_WORKSTREAM" "$LS_LAUNCH_TOKEN" "\$launch_patch" --preserve-base-sha; then
  launch_pending=0
else
  launch_registry_status=\$?
  if [ "\$launch_registry_status" = "2" ]; then
    launch_pending=0
    echo "launch-worktree-session: launch for $LS_WORKSTREAM was superseded — refusing to start a second agent" >&2
    exit 1
  fi
  echo "launch-worktree-session: could not complete launch registry for $LS_WORKSTREAM — starting agent with process liveness only" >&2
fi
claude_status=0
if [ -s "$LS_PROMPT_FILE" ]; then
  claude --name "$LS_WORKSTREAM" $model_arg $rc_arg --dangerously-skip-permissions "\$(cat "$LS_PROMPT_FILE")" || claude_status=\$?
else
  claude --name "$LS_WORKSTREAM" $model_arg $rc_arg --dangerously-skip-permissions || claude_status=\$?
fi
exit \$claude_status
EOF
  else
    [ -n "$LS_MODEL" ] && model_line="  -m \"$LS_MODEL\""
    cat > "$LS_LAUNCHER" <<EOF
#!/usr/bin/env bash
set -euo pipefail
printf '\033]0;%s\007' "$LS_SESSION_NAME"
cd "$LS_MONO"
. "$LS_MONO/bin/lib/session-registry.sh"
launch_pending=1
launch_on_exit() {
  launch_status=\$?
  if [ "\$launch_pending" = "1" ]; then
    session_registry_fail_launch "$LS_WORKSTREAM" "$LS_LAUNCH_TOKEN" "setup-exited-status-\$launch_status" >/dev/null || true
  fi
  return "\$launch_status"
}
trap launch_on_exit EXIT
if [ -n "${LS_WORKTREE_PATH:-}" ]; then
  wt_path="$LS_WORKTREE_PATH"
else
  wt_path=\$(./bin/workstreams create "$LS_WORKSTREAM")
fi
if [ ! -f "\$wt_path/AGENTS.md" ]; then
  echo "launch-worktree-session: no AGENTS.md in \$wt_path (generation failed?) — refusing to launch codex without repo docs" >&2
  exit 1
fi
if [ -n "${LS_ISSUE:-}" ]; then
  node --import tsx "$LS_MONO/bin/assign-issue-workstream.ts" "\$wt_path/${LS_ISSUE:-}" "$LS_WORKSTREAM"
fi
launch_patch=\$(jq -n \
  --arg branch "worktree-$LS_WORKSTREAM" \
  --arg emoji "$LS_EMOJI" \
  --arg agent "codex" \
  --arg model "$LS_MODEL" \
  --arg tty "\$(tty 2>/dev/null || true)" \
  --arg baseSha "\$(git -C "\$wt_path" rev-parse HEAD 2>/dev/null || true)" \
    --arg launchedAt "\$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg description "\$(if [ -s "${LS_DESCRIPTION_FILE:-}" ]; then cat "${LS_DESCRIPTION_FILE:-}"; fi)" \
    '{branch:\$branch, emoji:\$emoji, agent:\$agent, tty:\$tty, baseSha:\$baseSha, launchedAt:\$launchedAt, removed:null}
     + if \$model == "" then {} else {model:\$model} end
     + if \$description == "" then {} else {description:\$description} end')
for claude_skill in "\$wt_path"/.claude/skills/*/SKILL.md; do
  [ -f "\$claude_skill" ] || continue
  skill_name=\$(basename "\$(dirname "\$claude_skill")")
  if [ ! -L "\$wt_path/.agents/skills/\$skill_name" ] || [ ! -f "\$wt_path/.agents/skills/\$skill_name/SKILL.md" ]; then
    echo "launch-worktree-session: missing Codex mirror for skill \$skill_name — refusing to launch codex without repo skills" >&2
    exit 1
  fi
done
cd "\$wt_path"
codex_args=(
  -s danger-full-access -a never
  -c "projects.\"\$wt_path\".trust_level=\"trusted\""
  -c project_doc_max_bytes=131072
$model_line
)

if session_registry_record_launch_session "$LS_WORKSTREAM" "$LS_LAUNCH_TOKEN" "\$launch_patch" --preserve-base-sha; then
  :
else
  launch_registry_status=\$?
  if [ "\$launch_registry_status" = "2" ]; then
    launch_pending=0
    echo "launch-worktree-session: launch for $LS_WORKSTREAM was superseded — refusing to start a second agent" >&2
    exit 1
  fi
  echo "launch-worktree-session: could not record session metadata for $LS_WORKSTREAM — starting agent with launch-lease liveness" >&2
fi

trap 'true' INT
codex_status=0
if [ "${LS_CODEX_RESUME:-0}" = "1" ]; then
  if [ -s "$LS_PROMPT_FILE" ]; then
    codex resume --last "\${codex_args[@]}" "\$(cat "$LS_PROMPT_FILE")" || codex_status=\$?
  else
    codex resume --last "\${codex_args[@]}" || codex_status=\$?
  fi
elif [ -s "$LS_PROMPT_FILE" ]; then
  codex "\${codex_args[@]}" "\$(cat "$LS_PROMPT_FILE")" || codex_status=\$?
else
  codex "\${codex_args[@]}" || codex_status=\$?
fi
trap - INT

if session_registry_complete_launch "$LS_WORKSTREAM" "$LS_LAUNCH_TOKEN" "\$launch_patch" --preserve-base-sha; then
  launch_pending=0
else
  launch_registry_status=\$?
  if [ "\$launch_registry_status" = "2" ]; then
    launch_pending=0
    echo "launch-worktree-session: completed Codex session for $LS_WORKSTREAM no longer owns the launch token" >&2
  else
    echo "launch-worktree-session: could not clear launch registry for completed Codex session $LS_WORKSTREAM" >&2
  fi
fi

teardown="$LS_MONO/bin/codex-session-end"
if [ -x "\$teardown" ]; then
  "\$teardown" "\$wt_path" || true
else
  echo "launch-worktree-session: no \$teardown — leaving \$wt_path for \`bin/workstreams sweep\`" >&2
fi
exit \$codex_status
EOF
  fi
  chmod +x "$LS_LAUNCHER"
}

launch_session_default_emoji() {
  local name="$1" emoji_idx
  local palette=(🐛 🔍 🧪 📋 🚀 🧹 🔧 📦 🌱 🎯 🧭 🔒 📊 🎨 🪄 🧩 🔭 🧵 📮 🌊 🔥 🎁 🍀 🦉)
  emoji_idx=$(( $(printf '%s' "$name" | cksum | cut -d' ' -f1) % ${#palette[@]} ))
  printf '%s\n' "${palette[$emoji_idx]}"
}

launch_session_open() {
  local result launch_intent
  # Record intent before asking Terminal to start a shell. The generated script
  # owns this token until it reaches the agent boundary or reports setup failure.
  # shellcheck source=session-registry.sh
  . "$LS_MONO/bin/lib/session-registry.sh"
  case "${LS_AGENT:-}" in
    claude|codex) ;;
    *) echo "workstreams launch: agent must be claude or codex; Terminal was not opened" >&2; return 1 ;;
  esac
  launch_intent=$(jq -cn \
    --arg branch "worktree-$LS_WORKSTREAM" \
    --arg emoji "${LS_EMOJI:-}" \
    --arg agent "$LS_AGENT" \
    --arg model "${LS_MODEL:-}" \
    --arg description "$(if [ -s "${LS_DESCRIPTION_FILE:-}" ]; then cat "${LS_DESCRIPTION_FILE:-}"; fi)" \
    '{branch:$branch,agent:$agent}
     + if $emoji == "" then {} else {emoji:$emoji} end
     + if $model == "" then {} else {model:$model} end
     + if $description == "" then {} else {description:$description} end')
  if ! session_registry_begin_launch "$LS_WORKSTREAM" "$LS_LAUNCH_TOKEN" "$launch_intent"; then
    echo "workstreams launch: could not record launch intent; Terminal was not opened" >&2
    return 1
  fi
  if result=$(osascript <<APPLESCRIPT
tell application "Terminal"
  activate
  do script "$LS_LAUNCHER"
end tell
APPLESCRIPT
  ); then
    printf '%s\n' "new tab/window (per your Terminal tab preference)"
    return 0
  else
    local status=$?
    if ! session_registry_fail_launch "$LS_WORKSTREAM" "$LS_LAUNCH_TOKEN" "terminal-automation-failed"; then
      echo "workstreams launch: could not record Terminal automation failure" >&2
    fi
    echo "workstreams launch: Terminal automation failed" >&2
    return "$status"
  fi
}
