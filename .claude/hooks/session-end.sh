#!/usr/bin/env bash
# Claude Code SessionEnd hook.
#
# When a session ends, if we're in a beebox worktree AND the worktree
# branch is fully merged into main (no commits ahead, no uncommitted
# changes), automatically remove the worktree + branch + cloned box + any
# router state for it. Claude Code's built-in auto-cleanup only fires when
# no commits were made during the session — we extend it to "no commits
# remain unmerged."
#
# Safe by construction: we only act when ahead==0 AND dirty==0. Anything
# else (work not yet merged, uncommitted files) gets left alone.
#
# The guards and the removal itself live in bin/lib/worktree-teardown.sh,
# shared with bin/codex-session-end (codex sessions fire no hooks, so their
# teardown is driven by the launcher instead). This file holds what's specific
# to Claude Code: the stdin JSON, resolving which worktree the session belonged
# to, and the unconditional sweep trigger.
#
# Stdin: JSON { cwd, session_id, hook_event_name, ... }
# Failures are non-blocking; logged in debug mode only.

set -euo pipefail
exec 1>&2

input=$(cat)
mkdir -p "$HOME/.cache/beebox"
printf '%s\n' "$input" > "$HOME/.cache/beebox/last-session-end-input.json"

WT_LOG_LABEL="SessionEnd"
WT_SAY_PREFIX="[session-end]   "
. "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/bin/lib/worktree-teardown.sh"
# shellcheck source=../../bin/lib/session-workstream.sh
. "$WT_MONO/bin/lib/session-workstream.sh"

# Managed Claude runs inside the worktree, so it loads that checkout's hook.
# Re-exec the main checkout's copy before teardown: cleanup must not remove the
# directory its script and caller are still executing from. The marker prevents
# a loop if path resolution is ever unusual.
hook_repo=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
if [ "$hook_repo" != "$WT_MONO" ] && [ "${bbx_session_END_MAIN_REEXEC:-0}" != "1" ]; then
  cd "$WT_MONO"
  bbx_session_END_MAIN_REEXEC=1 exec "$WT_MONO/.claude/hooks/session-end.sh" <<<"$input"
fi

cwd=$(printf '%s' "$input" | jq -r '.cwd // empty')
session_id=$(printf '%s' "$input" | jq -r '.session_id // empty')
reason=$(printf '%s' "$input" | jq -r '.reason // empty')
wt_log "event: session=$session_id reason=$reason cwd=$cwd"

# Trigger a sweep on EVERY session end — from an EXIT trap, so it fires from
# every path out of this script including all the early `exit 0`s below.
#
# The sweep does not care which session ended: it removes every eligible
# worktree with no live agent, covering tab-kills and older native `--worktree`
# sessions whose final cwd/transcript could not be resolved here. Previously it
# ran only at SessionStart, so a long-lived main session accumulated finished
# worktrees all day (2026-07-19: nine piled up in one session).
#
# It used to be an inline call right here, with a comment saying it "must be
# here, above the early `exit 0`s, or it never fires in the common case". The
# reachability argument was right; the position it implied was not. A trap is
# reached from every exit path AND runs last, so the two jobs this hook does
# stop sharing a moment: the cheap, specific teardown of THIS session's worktree
# goes first, and the expensive global sweep starts as we leave. They were
# previously running their `git status` calls over the same trees at the same
# time, which is the leading explanation for the 11 of 44 resolved sessions that
# logged `resolved worktree=` and then no decision at all.
#
# The MAIN checkout's copy deliberately: auto-sweep.sh gates itself out when its
# own REPO is a worktree, so invoking a worktree's copy would no-op.
trap '"$WT_MONO/.claude/hooks/auto-sweep.sh" session-end 2>/dev/null || true' EXIT

# Determine the worktree directory. cwd is the obvious signal, but Claude
# Code reports the session's *final* cwd — an agent that cd'd to the main
# checkout (e.g. to run a cross-tree git command) before exiting would
# defeat a cwd-only check and leak the worktree. transcript_path is the
# durable signal: it encodes the directory the session was launched in,
# embedded as `-src-beebox-worktrees-<name>` in
# `~/.claude/projects/<encoded-path>/<uuid>.jsonl`.
worktree_path=""
case "$cwd" in
  "$WT_ROOT/"*) worktree_path="$cwd" ;;
esac

if [ -z "$worktree_path" ]; then
  tpath=$(printf '%s' "$input" | jq -r '.transcript_path // empty')
  if wt_session_workstream_from_transcript "$tpath"; then
    candidate="$WT_ROOT/$WT_SESSION_WORKSTREAM"
    echo "[session-end] cwd is '$cwd'; using worktree '$candidate' derived from transcript_path"
    worktree_path="$candidate"
  fi
fi

if [ -z "$worktree_path" ] || [ ! -d "$worktree_path" ]; then
  wt_log "decision=skip:not-a-worktree-session resolved='$worktree_path'"
  exit 0
fi
wt_log "resolved worktree=$worktree_path"

# Another live agent still working here? Then this is NOT the last session in
# the worktree, and cleaning would pull the rug out from under it. This hook is
# a descendant of the ending agent, so exclude the nearest agent ancestor —
# that one is the session that's ending. Fail closed on `unknown`.
# Timed, because when this hook dies it dies somewhere in here and the log has
# never said where. `resolved` → `decision` spans a process scan plus three git
# commands against the worktree, all unbounded; without per-step elapsed times
# a cancelled hook is indistinguishable between "the liveness scan hung" and
# "git blocked on a lock".
wt_step_start=$(wt_now_ms)
wt_other_agent_live "$worktree_path" --exclude-self-ancestor
wt_log "step=agent-live ms=$(( $(wt_now_ms) - wt_step_start )) state=$WT_AGENT_STATE"
case "$WT_AGENT_STATE" in
  live)
    echo "[session-end] another live claude/codex session belongs to $worktree_path ($WT_AGENT_REASON) — leaving alone"
    wt_log "decision=skip:other-agent-live $WT_AGENT_REASON self=$WT_AGENT_SELF wt=$worktree_path"
    exit 0 ;;
  none) ;;
  *)
    echo "[session-end] cannot rule out a live agent ($WT_AGENT_REASON) — refusing to clean $worktree_path"
    wt_log "decision=skip:$WT_AGENT_REASON self=$WT_AGENT_SELF wt=$worktree_path"
    exit 0 ;;
esac

wt_step_start=$(wt_now_ms)
wt_work_state "$worktree_path"
wt_log "step=work-state ms=$(( $(wt_now_ms) - wt_step_start )) branch=$WT_BRANCH ahead=$WT_AHEAD dirty=$WT_DIRTY"
if [ -z "$WT_BRANCH" ] || [ "$WT_BRANCH" = "main" ] || [ "$WT_BRANCH" = "HEAD" ]; then
  echo "[session-end] branch=$WT_BRANCH, not eligible for auto-cleanup"
  wt_log "decision=skip:branch-ineligible branch='$WT_BRANCH' wt=$worktree_path"
  exit 0
fi

if [ "$WT_AHEAD" != "0" ] || [ "$WT_DIRTY" != "0" ]; then
  echo "[session-end] worktree '$WT_BRANCH' not fully merged (ahead=$WT_AHEAD, non-deletion dirty=$WT_DIRTY) — leaving alone"
  # The boxholder's next question is always "how do I get back to it" — and the
  # harness's own exit line ("claude --resume …") reopens only the SESSION, in
  # this directory, with none of the workstream machinery. Say the real answer.
  ws_name="${WT_BRANCH#worktree-}"
  echo "[session-end] reopen this workstream later:  bin/workstreams resume $ws_name   (from the main checkout; continues the session where possible, recreates the worktree if culled)"
  # WT_BLOCKERS captures WHICH entries block it — untracked file vs unmerged
  # commit is the whole diagnosis (e.g. review-ios lingered on one untracked doc).
  wt_log "decision=skip:unmerged branch=$WT_BRANCH ahead=$WT_AHEAD dirty=$WT_DIRTY blockers=[$WT_BLOCKERS] wt=$worktree_path"
  exit 0
fi
. "$WT_MONO/bin/lib/workstream-box-state.sh"
name=$(basename "$worktree_path")
if pin_reason=$(workstream_cull_pin_reason "$name"); then
  echo "[session-end] worktree '$WT_BRANCH' is pinned ($pin_reason) — leaving alone"
  wt_log "decision=skip:pinned reason=$pin_reason branch=$WT_BRANCH wt=$worktree_path"
  exit 0
fi
wt_log "decision=clean branch=$WT_BRANCH ahead=0 dirty=0 wt=$worktree_path"

# IMPORTANT: the name derives from $worktree_path, not $cwd. When the session
# ends with cwd = main (the original bug that motivated the transcript-path
# fallback above), basename($cwd) = "beebox" — wrong name, wrong target.
echo "[session-end] worktree '$WT_BRANCH' is fully merged into main and clean — cleaning up"
wt_remove_now "$worktree_path" "$WT_BRANCH"

wt_log "done: cleaned branch=$WT_BRANCH name=$(basename "$worktree_path") (box+worktree trashed, branch deleted)"
echo "[session-end] done"
