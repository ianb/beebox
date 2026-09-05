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

# A Claude session id. Deliberately the same shape `launch_session_build` will
# demand later: a record that passes here and is refused there would mean no
# session at all, since the refusal happens after `resume` has already committed
# to continuing. Two checks rather than one shared helper because the launcher
# guards a different surface — anything that sets LS_CLAUDE_RESUME_SESSION —
# and that one stands in front of an unquoted interpolation.
workstream_is_session_id() {
  [[ "$1" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]]
}

# Where Claude keeps a conversation's transcript. Every project directory is
# searched rather than the one encoding this worktree's path, so a transcript
# still resolves when the recorded session was started somewhere else.
#
# Non-empty, not merely present: a zero-byte `.jsonl` is a session killed before
# it wrote anything, and `--resume` on one fails inside the Terminal tab, where
# there is nothing left to fall back to.
workstream_claude_transcript() {
  local session_id="$1" projects_root="${2:-$HOME/.claude/projects}" candidate
  workstream_is_session_id "$session_id" || return 1
  for candidate in "$projects_root"/*/"$session_id.jsonl"; do
    [ -s "$candidate" ] || continue
    printf '%s\n' "$candidate"
    return 0
  done
  return 1
}

# continue-or-fresh, decided before the Terminal tab opens. Prints
# `continue <session-id>` or `fresh <reason>`.
#
# Claude Code keys transcripts by directory, so a recreated worktree at the same
# path still has its history — that is what makes continuing possible at all.
# The recorded id is the only address used: the project directory can hold
# several transcripts (a culled workstream that was resumed fresh once already
# has two), and the newest is not the one that did the work.
workstream_resume_session_mode() {
  local agent="$1" fresh="$2" record="$3" projects_root="${4:-}" session_id
  if [ "$agent" != claude ]; then printf 'fresh agent-not-claude\n'; return 0; fi
  if [ "$fresh" = true ]; then printf 'fresh forced\n'; return 0; fi
  session_id=$(printf '%s' "$record" | jq -r '.sessionId // empty' 2>/dev/null || true)
  if [ -z "$session_id" ]; then printf 'fresh no-recorded-session\n'; return 0; fi
  if ! workstream_is_session_id "$session_id"; then printf 'fresh invalid-session-id\n'; return 0; fi
  if ! workstream_claude_transcript "$session_id" ${projects_root:+"$projects_root"} >/dev/null; then
    printf 'fresh transcript-missing\n'
    return 0
  fi
  printf 'continue %s\n' "$session_id"
}

workstream_continuation_prompt() {
  local name="$1" record="$2" landed_log="${3:-}" final_sha
  final_sha=$(workstream_recovery_sha "$record")
  printf 'Continue workstream `%s` in its newly attached worktree.\n' "$name"
  printf 'Inspect the current branch, git status, relevant plan/issues, and existing implementation before changing anything.\n'
  [ -n "$final_sha" ] && printf 'The previous worktree ended at commit `%s`.\n' "$final_sha"
  if [ -n "$landed_log" ]; then
    printf 'Commits now on main since the previous worktree tip (at most 50):\n%s\n' "$landed_log"
  fi
}

# The first message of a CONTINUED session. It already holds the conversation,
# so this says only what changed while it was gone.
workstream_continued_prompt() {
  local name="$1" record="$2" landed_log="${3:-}" final_sha
  final_sha=$(workstream_recovery_sha "$record")
  printf 'Your worktree for workstream `%s` was reattached and this conversation resumed.\n' "$name"
  [ -n "$final_sha" ] && printf 'It was culled at commit `%s` and has been recreated at the same path; re-check git status and the branch before trusting anything you remember about the tree.\n' "$final_sha"
  if [ -n "$landed_log" ]; then
    printf 'Commits that landed on main since then (at most 50):\n%s\n' "$landed_log"
  fi
}
