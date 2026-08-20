#!/usr/bin/env bash
# Shared Terminal session launcher. Callers set the LS_* inputs below, then
# call launch_session_build followed by launch_session_open.

launch_session_build() {
  local model_arg="" rc_arg="" model_line=""
  LS_LAUNCHER="$LS_LAUNCH_DIR/launch.sh"

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
. "$LS_MONO/bin/lib/session-registry.sh"
launch_patch=\$(jq -n \
  --arg branch "worktree-$LS_WORKSTREAM" \
  --arg emoji "$LS_EMOJI" \
  --arg agent "claude" \
  --arg model "$LS_MODEL" \
  --arg tty "\$(tty 2>/dev/null || true)" \
  --arg baseSha "\$(git -C "\$wt_path" merge-base main HEAD 2>/dev/null || true)" \
    --arg launchedAt "\$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg description "\$(if [ -n \"${LS_DESCRIPTION_FILE:-}\" ]; then cat \"${LS_DESCRIPTION_FILE:-}\"; fi)" \
    '{branch:\$branch, emoji:\$emoji, agent:\$agent, tty:\$tty, baseSha:\$baseSha, launchedAt:\$launchedAt}
     + if \$model == "" then {} else {model:\$model} end
     + if \$description == "" then {} else {description:\$description} end')
session_registry_merge "$LS_WORKSTREAM" "\$launch_patch" --preserve-base-sha || true
cd "\$wt_path"
if [ -s "$LS_PROMPT_FILE" ]; then
  exec claude --name "$LS_WORKSTREAM" $model_arg $rc_arg --dangerously-skip-permissions "\$(cat "$LS_PROMPT_FILE")"
else
  exec claude --name "$LS_WORKSTREAM" $model_arg $rc_arg --dangerously-skip-permissions
fi
EOF
  else
    [ -n "$LS_MODEL" ] && model_line="  -m \"$LS_MODEL\""
    cat > "$LS_LAUNCHER" <<EOF
#!/usr/bin/env bash
set -euo pipefail
printf '\033]0;%s\007' "$LS_SESSION_NAME"
cd "$LS_MONO"
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
. "$LS_MONO/bin/lib/session-registry.sh"
launch_patch=\$(jq -n \
  --arg branch "worktree-$LS_WORKSTREAM" \
  --arg emoji "$LS_EMOJI" \
  --arg agent "codex" \
  --arg model "$LS_MODEL" \
  --arg tty "\$(tty 2>/dev/null || true)" \
  --arg baseSha "\$(git -C "\$wt_path" rev-parse HEAD 2>/dev/null || true)" \
    --arg launchedAt "\$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg description "\$(if [ -n \"${LS_DESCRIPTION_FILE:-}\" ]; then cat \"${LS_DESCRIPTION_FILE:-}\"; fi)" \
    '{branch:\$branch, emoji:\$emoji, agent:\$agent, tty:\$tty, baseSha:\$baseSha, launchedAt:\$launchedAt}
     + if \$model == "" then {} else {model:\$model} end
     + if \$description == "" then {} else {description:\$description} end')
session_registry_merge "$LS_WORKSTREAM" "\$launch_patch" --preserve-base-sha || true
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
  local result
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
    echo "workstreams launch: Terminal automation failed" >&2
    return "$status"
  fi
}
