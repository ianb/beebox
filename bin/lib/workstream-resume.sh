#!/usr/bin/env bash
# Pure state and continuation helpers for `workstreams resume`.

workstream_resume_state() {
  local worktree_exists="$1" agent_state="$2" record="$3"
  if [ "$worktree_exists" = true ]; then
    case "$agent_state" in
      live) printf 'focus\n' ;;
      none) printf 'existing\n' ;;
      launching) printf 'launch-in-progress\n' ;;
      *) printf 'liveness-unknown\n' ;;
    esac
    return 0
  fi
  case "$agent_state" in
    launching) printf 'launch-in-progress\n'; return 0 ;;
    launch-failed|launch-expired) printf 'launch-retry\n'; return 0 ;;
    unknown) printf 'liveness-unknown\n'; return 0 ;;
  esac
  if [ -z "$record" ]; then
    printf 'unknown\n'
  elif [ "$(printf '%s' "$record" | jq -r '.removed.merged // empty' 2>/dev/null)" = "true" ]; then
    printf 'culled\n'
  elif printf '%s' "$record" | jq -e '.removed != null' >/dev/null 2>&1; then
    printf 'removed-unmerged\n'
  elif printf '%s' "$record" | jq -e '.kind == "scheduled"' >/dev/null 2>&1; then
    # Sticky record, disposable worktree: an absent scheduled workstream is
    # always recreatable, and never carries a `removed` block to prove it.
    printf 'scheduled\n'
  else
    printf 'unknown\n'
  fi
}

# The commit a record's last worktree ended at, wherever it was written down.
# An ordinary workstream records a cull under `removed`; a scheduled one records
# it under `culled` (it is never `removed` — see wt_removal_patch). Both mean the
# same thing to `resume`: recreate here, and say what landed since.
workstream_recovery_sha() {
  printf '%s' "$1" | jq -r '.removed.finalSha // .culled.finalSha // empty' 2>/dev/null || true
}

workstream_continuation_prompt() {
  local name="$1" record="$2" landed_log="${3:-}" final_sha session_id
  final_sha=$(workstream_recovery_sha "$record")
  session_id=$(printf '%s' "$record" | jq -r '.sessionId // empty' 2>/dev/null || true)
  printf 'Continue workstream `%s` in its newly attached worktree.\n' "$name"
  printf 'Inspect the current branch, git status, relevant plan/issues, and existing implementation before changing anything.\n'
  [ -n "$final_sha" ] && printf 'The previous worktree ended at commit `%s`.\n' "$final_sha"
  [ -n "$session_id" ] && printf 'The prior Claude session id was `%s` (picker/archaeology only; B2 proved direct resume loses worktree isolation).\n' "$session_id"
  if [ -n "$landed_log" ]; then
    printf 'Commits now on main since the previous worktree tip (at most 50):\n%s\n' "$landed_log"
  fi
}
