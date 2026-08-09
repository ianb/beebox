#!/usr/bin/env bash
# Shared Terminal session launcher. Callers set the LS_* inputs below, then
# call launch_session_build followed by launch_session_open.

launch_session_build() {
  local model_arg="" rc_arg="" model_line=""
  LS_LAUNCHER="$LS_LAUNCH_DIR/launch.sh"

  if [ "$LS_AGENT" = "claude" ]; then
    [ -n "$LS_MODEL" ] && model_arg="--model $LS_MODEL"
    [ "$LS_REMOTE_CONTROL" = "1" ] && rc_arg="--remote-control $LS_WORKSTREAM"
    cat > "$LS_LAUNCHER" <<EOF
#!/usr/bin/env bash
printf '\033]0;%s\007' "$LS_SESSION_NAME"
cd "$LS_MONO"
. "$LS_MONO/bin/lib/session-registry.sh"
launch_patch=\$(jq -n \
  --arg branch "worktree-$LS_WORKSTREAM" \
  --arg emoji "$LS_EMOJI" \
  --arg agent "claude" \
  --arg model "$LS_MODEL" \
  --arg tty "\$(tty 2>/dev/null || true)" \
  --arg baseSha "\$(git -C "$LS_MONO" rev-parse main 2>/dev/null || true)" \
  --arg launchedAt "\$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  '{branch:\$branch, emoji:\$emoji, agent:\$agent, tty:\$tty, baseSha:\$baseSha, launchedAt:\$launchedAt}
   + if \$model == "" then {} else {model:\$model} end')
session_registry_merge "$LS_WORKSTREAM" "\$launch_patch" || true
if [ -s "$LS_PROMPT_FILE" ]; then
  exec claude --worktree "$LS_WORKSTREAM" --name "$LS_SESSION_NAME" $model_arg $rc_arg --dangerously-skip-permissions "\$(cat "$LS_PROMPT_FILE")"
else
  exec claude --worktree "$LS_WORKSTREAM" --name "$LS_SESSION_NAME" $model_arg $rc_arg --dangerously-skip-permissions
fi
EOF
  else
    [ -n "$LS_MODEL" ] && model_line="  -m \"$LS_MODEL\""
    cat > "$LS_LAUNCHER" <<EOF
#!/usr/bin/env bash
set -euo pipefail
printf '\033]0;%s\007' "$LS_SESSION_NAME"
cd "$LS_MONO"
wt_path=\$(./bin/workstreams create "$LS_WORKSTREAM")
if [ ! -f "\$wt_path/AGENTS.md" ]; then
  echo "launch-worktree-session: no AGENTS.md in \$wt_path (generation failed?) — refusing to launch codex without repo docs" >&2
  exit 1
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
  '{branch:\$branch, emoji:\$emoji, agent:\$agent, tty:\$tty, baseSha:\$baseSha, launchedAt:\$launchedAt}
   + if \$model == "" then {} else {model:\$model} end')
session_registry_merge "$LS_WORKSTREAM" "\$launch_patch" || true
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
if [ -s "$LS_PROMPT_FILE" ]; then
  codex "\${codex_args[@]}" "\$(cat "$LS_PROMPT_FILE")" || codex_status=\$?
else
  codex "\${codex_args[@]}" || codex_status=\$?
fi
trap - INT

teardown="$LS_MONO/bin/codex-session-end"
if [ -x "\$teardown" ]; then
  "\$teardown" "\$wt_path" || true
else
  echo "launch-worktree-session: no \$teardown — leaving \$wt_path for \\`bin/workstreams sweep\\`" >&2
fi
exit \$codex_status
EOF
  fi
  chmod +x "$LS_LAUNCHER"
}

launch_session_open() {
  local result
  result=$(osascript <<APPLESCRIPT 2>/dev/null
tell application "Terminal"
  activate
  do script "$LS_LAUNCHER"
end tell
APPLESCRIPT
  ) && result="new tab/window (per your Terminal tab preference)" || result="FAILED — Terminal not scriptable?"
  printf '%s\n' "$result"
}
