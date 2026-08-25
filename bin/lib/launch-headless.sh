#!/usr/bin/env bash
# Headless agent invocation — the unattended counterpart to launch-session.sh,
# which is Terminal-tab-specific end to end (it writes a launcher script and
# hands it to osascript). A scheduled run has no Terminal: it needs an argv it
# can spawn in the foreground, with the briefing on stdin and the output going
# to the run log.
#
# ONE place assembles these flags. Source this file for launch_headless_argv,
# or execute it to print the argv (one element per line) — that is how
# bin/lib/schedules-workstream.ts gets it, and how the tests read it.
#
#   LH_AGENT=claude LH_WORKSTREAM=knip-sweep ... bin/lib/launch-headless.sh
#
# Inputs (all environment, the LS_* convention next door):
#   LH_AGENT              claude | codex                                (required)
#   LH_WORKSTREAM         schedule/workstream name                      (required)
#   LH_MODEL              passed through to the agent CLI               (optional)
#   LH_EFFORT             low|medium|high|xhigh|max, --effort           (claude)
#   LH_PERMISSION_MODE    bypassPermissions | dontAsk                   (required)
#   LH_SYSTEM_PROMPT_FILE schedules/<name>/prompt.md                    (claude)
#   LH_TOOLS              newline-separated --tools list                (optional)
#   LH_ALLOWED_TOOLS      newline-separated --allowedTools list         (optional)
#   LH_DISALLOWED_TOOLS   newline-separated --disallowedTools list      (optional)
#   LH_MAX_BUDGET_USD     --max-budget-usd                              (optional)
#   LH_SESSION            fresh | persistent                            (required)
#   LH_SESSION_ID         pre-minted uuid for `persistent` claude       (claude)
#   LH_SESSION_RESUME     1 when that session already has a transcript
#   LH_CWD                the checkout or worktree the session runs in  (codex)
#
# The prompt is NEVER an argv element: both CLIs read it from stdin, and a
# briefing carrying a failure log is exactly the string a shell would mangle.

# Split a newline-separated environment value into the named array.
launch_headless_list() {
  local value="$1" line
  LH_LIST=()
  [ -n "$value" ] || return 0
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    LH_LIST+=("$line")
  done <<<"$value"
}

launch_headless_require() {
  local name="$1" value="$2"
  [ -n "$value" ] && return 0
  echo "launch-headless: $name is required" >&2
  return 2
}

launch_headless_claude() {
  local -a argv
  launch_headless_require LH_WORKSTREAM "${LH_WORKSTREAM:-}" || return 2
  launch_headless_require LH_PERMISSION_MODE "${LH_PERMISSION_MODE:-}" || return 2
  launch_headless_require LH_SYSTEM_PROMPT_FILE "${LH_SYSTEM_PROMPT_FILE:-}" || return 2
  if [ ! -f "${LH_SYSTEM_PROMPT_FILE:-}" ]; then
    echo "launch-headless: no system prompt file at ${LH_SYSTEM_PROMPT_FILE:-}" >&2
    return 2
  fi
  argv=(claude -p --brief --name "$LH_WORKSTREAM")
  [ -n "${LH_MODEL:-}" ] && argv+=(--model "$LH_MODEL")
  [ -n "${LH_EFFORT:-}" ] && argv+=(--effort "$LH_EFFORT")
  # --setting-sources user is load-bearing, not decoration: a nested claude -p
  # without it fires this repo's SessionEnd hook (.claude/skills/cross-model
  # records the worktree it deleted that way).
  argv+=(--permission-mode "$LH_PERMISSION_MODE" --setting-sources user --disable-slash-commands)
  argv+=(--append-system-prompt-file "$LH_SYSTEM_PROMPT_FILE")
  launch_headless_list "${LH_TOOLS:-}"
  [ ${#LH_LIST[@]} -gt 0 ] && argv+=(--tools "${LH_LIST[@]}")
  launch_headless_list "${LH_ALLOWED_TOOLS:-}"
  [ ${#LH_LIST[@]} -gt 0 ] && argv+=(--allowedTools "${LH_LIST[@]}")
  launch_headless_list "${LH_DISALLOWED_TOOLS:-}"
  [ ${#LH_LIST[@]} -gt 0 ] && argv+=(--disallowedTools "${LH_LIST[@]}")
  [ -n "${LH_MAX_BUDGET_USD:-}" ] && argv+=(--max-budget-usd "$LH_MAX_BUDGET_USD")
  case "${LH_SESSION:-}" in
    fresh) argv+=(--no-session-persistence) ;;
    persistent)
      launch_headless_require LH_SESSION_ID "${LH_SESSION_ID:-}" || return 2
      # Claude refuses --resume for an id with no transcript yet, so the first
      # turn mints the id and every later one resumes it
      # (bin/update-agent-sdk-scheduled.sh:83-100 has run this way for months).
      if [ "${LH_SESSION_RESUME:-0}" = "1" ]; then argv+=(--resume "$LH_SESSION_ID")
      else argv+=(--session-id "$LH_SESSION_ID"); fi ;;
    *) echo "launch-headless: LH_SESSION must be fresh or persistent" >&2; return 2 ;;
  esac
  printf '%s\n' "${argv[@]}"
}

# Codex parity, and where it stops. `codex exec` has no --tools/--allowedTools/
# --disallowedTools, no budget cap, no --effort, and no
# --append-system-prompt-file. The tool constraints and the effort are a sandbox
# the schedule's author declared, so a codex schedule that declares them is
# REFUSED rather than silently launched unconstrained; the system prompt is prepended to the stdin briefing by the
# caller instead. Session persistence has no pre-mintable id either: `codex
# exec resume --last` resumes the newest recorded session for this cwd, which
# is the schedule's own last run.
launch_headless_codex() {
  local -a argv
  launch_headless_require LH_WORKSTREAM "${LH_WORKSTREAM:-}" || return 2
  launch_headless_require LH_PERMISSION_MODE "${LH_PERMISSION_MODE:-}" || return 2
  launch_headless_require LH_CWD "${LH_CWD:-}" || return 2
  local unsupported=""
  [ -n "${LH_TOOLS:-}" ] && unsupported="$unsupported tools"
  [ -n "${LH_ALLOWED_TOOLS:-}" ] && unsupported="$unsupported allowedTools"
  [ -n "${LH_DISALLOWED_TOOLS:-}" ] && unsupported="$unsupported disallowedTools"
  [ -n "${LH_MAX_BUDGET_USD:-}" ] && unsupported="$unsupported maxBudgetUsd"
  [ -n "${LH_EFFORT:-}" ] && unsupported="$unsupported effort"
  if [ -n "$unsupported" ]; then
    echo "launch-headless: codex has no equivalent for:$unsupported — drop them or use agent: claude" >&2
    return 2
  fi
  argv=(codex exec)
  if [ "${LH_SESSION:-}" = "persistent" ] && [ "${LH_SESSION_RESUME:-0}" = "1" ]; then
    argv+=(resume --last)
  fi
  case "$LH_PERMISSION_MODE" in
    bypassPermissions) argv+=(-s danger-full-access) ;;
    dontAsk) argv+=(-s workspace-write) ;;
    *) echo "launch-headless: LH_PERMISSION_MODE must be bypassPermissions or dontAsk" >&2; return 2 ;;
  esac
  argv+=(-c "projects.\"$LH_CWD\".trust_level=\"trusted\"" -c project_doc_max_bytes=131072)
  [ -n "${LH_MODEL:-}" ] && argv+=(-m "$LH_MODEL")
  printf '%s\n' "${argv[@]}"
}

# launch_headless_argv — the assembled command, one element per line.
launch_headless_argv() {
  case "${LH_AGENT:-}" in
    claude) launch_headless_claude ;;
    codex) launch_headless_codex ;;
    *) echo "launch-headless: LH_AGENT must be claude or codex" >&2; return 2 ;;
  esac
}

# Executed rather than sourced: print the argv. Sourcing gets the functions.
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  set -uo pipefail
  launch_headless_argv
fi
