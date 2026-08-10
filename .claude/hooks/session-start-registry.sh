#!/usr/bin/env bash
# Record the latest interactive Claude session for a workstream. Registry
# failures are hints lost, never a reason to block SessionStart.

set -u
exec 1>&2

input=$(cat)
repo_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)

# shellcheck source=../../bin/lib/worktree-paths.sh
. "$repo_dir/bin/lib/worktree-paths.sh"
wt_paths_init "$repo_dir" || exit 0
# shellcheck source=../../bin/lib/session-workstream.sh
. "$repo_dir/bin/lib/session-workstream.sh"
# shellcheck source=../../bin/lib/session-registry.sh
. "$repo_dir/bin/lib/session-registry.sh"

cwd=$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null || true)
session_id=$(printf '%s' "$input" | jq -r '.session_id // empty' 2>/dev/null || true)
transcript_path=$(printf '%s' "$input" | jq -r '.transcript_path // empty' 2>/dev/null || true)
[ -n "$session_id" ] || exit 0

workstream=""
tty_value=""
if wt_session_from_claude_ancestor "$PPID"; then
  [ "$WT_SESSION_HEADLESS" = true ] && exit 0
  workstream="$WT_SESSION_WORKSTREAM"
  tty_value="$WT_SESSION_TTY"
fi

if [ -z "$workstream" ]; then
  case "$cwd" in
    "$WT_ROOT/"*)
      workstream=${cwd#"$WT_ROOT/"}
      workstream=${workstream%%/*}
      wt_paths_valid_name "$workstream" || workstream=""
      ;;
  esac
fi

if [ -z "$workstream" ] && wt_session_workstream_from_transcript "$transcript_path"; then
  workstream="$WT_SESSION_WORKSTREAM"
fi
[ -n "$workstream" ] || exit 0

patch=$(jq -n \
  --arg agent claude \
  --arg sessionId "$session_id" \
  --arg transcriptPath "$transcript_path" \
  --arg tty "$tty_value" \
  '{agent:$agent, sessionId:$sessionId, transcriptPath:$transcriptPath}
   + if $tty == "" then {} else {tty:$tty} end') || exit 0
session_registry_merge "$workstream" "$patch" || true
exit 0
