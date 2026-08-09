#!/usr/bin/env bash
# Resolve the workstream associated with a Claude lifecycle hook.

WT_SESSION_WORKSTREAM=""
WT_SESSION_TTY=""
WT_SESSION_HEADLESS=false

wt_session_parse_claude_command() {
  local command="$1" tty_value="${2:-}" token previous=""
  WT_SESSION_WORKSTREAM=""
  WT_SESSION_TTY=""
  WT_SESSION_HEADLESS=false

  for token in $command; do
    case "$token" in
      -p|--print) WT_SESSION_HEADLESS=true ;;
    esac
    if [ "$previous" = "--worktree" ]; then
      WT_SESSION_WORKSTREAM="$token"
    fi
    previous="$token"
  done
  case "$tty_value" in
    ""|"??") ;;
    /dev/*) WT_SESSION_TTY="$tty_value" ;;
    *) WT_SESSION_TTY="/dev/$tty_value" ;;
  esac
}

# Find the nearest Claude ancestor and parse its argv and tty. The test-only
# override lets the doctest provide a fake ancestor without relying on ps
# formatting differences between CI hosts.
wt_session_from_claude_ancestor() {
  local probe="${1:-$PPID}" comm command tty_value
  if [ "${SESSION_REGISTRY_TESTING:-}" = "1" ]; then
    [ -n "${SESSION_REGISTRY_TEST_ANCESTOR_COMMAND:-}" ] || return 1
    wt_session_parse_claude_command "$SESSION_REGISTRY_TEST_ANCESTOR_COMMAND" \
      "${SESSION_REGISTRY_TEST_ANCESTOR_TTY:-}"
    return 0
  fi

  while [ -n "$probe" ] && [ "$probe" != "0" ] && [ "$probe" != "1" ]; do
    comm=$(ps -o comm= -p "$probe" 2>/dev/null || true)
    if [ "$(basename "${comm:-none}")" = "claude" ]; then
      command=$(ps -o command= -p "$probe" 2>/dev/null || true)
      tty_value=$(ps -o tty= -p "$probe" 2>/dev/null | tr -d ' ' || true)
      [ -n "$command" ] || return 1
      wt_session_parse_claude_command "$command" "$tty_value"
      return 0
    fi
    probe=$(ps -o ppid= -p "$probe" 2>/dev/null | tr -d ' ' || true)
  done
  return 1
}

wt_session_workstream_from_transcript() {
  local transcript_path="$1" wt_root_encoded name candidate
  WT_SESSION_WORKSTREAM=""
  wt_root_encoded=$(printf '%s' "$WT_ROOT" | tr '/' '-')
  case "$transcript_path" in
    *"$wt_root_encoded-"*)
      name=${transcript_path#*"$wt_root_encoded-"}
      name=${name%%/*}
      candidate="$WT_ROOT/$name"
      if wt_paths_valid_name "$name" && [ -d "$candidate" ]; then
        WT_SESSION_WORKSTREAM="$name"
        return 0
      fi
      ;;
  esac
  return 1
}
