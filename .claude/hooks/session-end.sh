#!/usr/bin/env bash
# Claude Code SessionEnd hook.
#
# When a session ends, if we're in a callback-box worktree AND the worktree
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
mkdir -p "$HOME/.cache/callback-box"
printf '%s\n' "$input" > "$HOME/.cache/callback-box/last-session-end-input.json"

WT_LOG_LABEL="SessionEnd"
WT_SAY_PREFIX="[session-end]   "
. "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/bin/lib/worktree-teardown.sh"

cwd=$(printf '%s' "$input" | jq -r '.cwd // empty')
session_id=$(printf '%s' "$input" | jq -r '.session_id // empty')
reason=$(printf '%s' "$input" | jq -r '.reason // empty')
wt_log "event: session=$session_id reason=$reason cwd=$cwd"

# Trigger a sweep on EVERY session end, before the per-worktree logic below
# runs (which mostly can't resolve its own worktree — see next comment). Must
# be here, above the early `exit 0`s, or it never fires in the common case.
#
# Why: the per-session cleanup below identifies its worktree from cwd or
# transcript_path, and BOTH are the main checkout when the session was started
# by `bin/launch-worktree-session` (it runs `claude --worktree <name>` from the
# monorepo root, so Claude Code files the session under main's project dir).
# So this hook logs `skip:not-a-worktree-session` and cleans nothing. The sweep
# doesn't care whose session ended — it removes every worktree that is merged,
# clean, and has no live `claude` — so it covers this case and tab-kills alike.
# Previously the sweep only ran at SessionStart, which meant a long-lived main
# session accumulated finished worktrees all day with nothing to collect them
# (2026-07-19: nine piled up in one session).
#
# The MAIN checkout's copy deliberately: auto-sweep.sh gates itself out when its
# own REPO is a worktree, so invoking a worktree's copy would no-op.
"$WT_MONO/.claude/hooks/auto-sweep.sh" session-end 2>/dev/null || true

# Determine the worktree directory. cwd is the obvious signal, but Claude
# Code reports the session's *final* cwd — an agent that cd'd to the main
# checkout (e.g. to run a cross-tree git command) before exiting would
# defeat a cwd-only check and leak the worktree. transcript_path is the
# durable signal: it encodes the directory the session was launched in,
# embedded as `-src-callback-worktrees-<name>` in
# `~/.claude/projects/<encoded-path>/<uuid>.jsonl`.
worktree_path=""
case "$cwd" in
  "$WT_ROOT/"*) worktree_path="$cwd" ;;
esac

if [ -z "$worktree_path" ]; then
  tpath=$(printf '%s' "$input" | jq -r '.transcript_path // empty')
  # Claude Code encodes the launch directory by replacing every `/` with `-`, so
  # the encoded worktree root is derived from WT_ROOT rather than spelled out.
  # Matched and split with parameter expansion, not sed: WT_ROOT is a literal
  # here, and a path component that happened to be a regex metacharacter would
  # otherwise mis-parse the name.
  wt_root_encoded=$(printf '%s' "$WT_ROOT" | tr '/' '-')
  case "$tpath" in
    *"$wt_root_encoded-"*)
      name=${tpath#*"$wt_root_encoded-"}
      name=${name%%/*}
      candidate="$WT_ROOT/$name"
      if [ -d "$candidate" ]; then
        echo "[session-end] cwd is '$cwd'; using worktree '$candidate' derived from transcript_path"
        worktree_path="$candidate"
      fi
      ;;
  esac
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
wt_other_agent_live "$worktree_path" --exclude-self-ancestor
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

wt_work_state "$worktree_path"
if [ -z "$WT_BRANCH" ] || [ "$WT_BRANCH" = "main" ] || [ "$WT_BRANCH" = "HEAD" ]; then
  echo "[session-end] branch=$WT_BRANCH, not eligible for auto-cleanup"
  wt_log "decision=skip:branch-ineligible branch='$WT_BRANCH' wt=$worktree_path"
  exit 0
fi

if [ "$WT_AHEAD" != "0" ] || [ "$WT_DIRTY" != "0" ]; then
  echo "[session-end] worktree '$WT_BRANCH' not fully merged (ahead=$WT_AHEAD, non-deletion dirty=$WT_DIRTY) — leaving alone"
  # WT_BLOCKERS captures WHICH entries block it — untracked file vs unmerged
  # commit is the whole diagnosis (e.g. review-ios lingered on one untracked doc).
  wt_log "decision=skip:unmerged branch=$WT_BRANCH ahead=$WT_AHEAD dirty=$WT_DIRTY blockers=[$WT_BLOCKERS] wt=$worktree_path"
  exit 0
fi
wt_log "decision=clean branch=$WT_BRANCH ahead=0 dirty=0 wt=$worktree_path"

# IMPORTANT: the name derives from $worktree_path, not $cwd. When the session
# ends with cwd = main (the original bug that motivated the transcript-path
# fallback above), basename($cwd) = "callback-box" — wrong name, wrong target.
echo "[session-end] worktree '$WT_BRANCH' is fully merged into main and clean — cleaning up"
wt_remove_now "$worktree_path" "$WT_BRANCH"

wt_log "done: cleaned branch=$WT_BRANCH name=$(basename "$worktree_path") (box+worktree trashed, branch deleted)"
echo "[session-end] done"
