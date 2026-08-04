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
# Stdin: JSON { cwd, session_id, hook_event_name, ... }
# Failures are non-blocking; logged in debug mode only.

set -euo pipefail
exec 1>&2

input=$(cat)
mkdir -p "$HOME/.cache/callback-box"
printf '%s\n' "$input" > "$HOME/.cache/callback-box/last-session-end-input.json"

# ── Append-only lifecycle log ───────────────────────────────────────────
# Diagnostic for the recurring "worktrees don't get cleaned up" problem. It
# records, for EVERY invocation, whether this hook fired and what it decided
# (cleaned / skipped-why). Deliberately at a FIXED top-level path — never a
# per-worktree/per-name subdir — so it lives OUTSIDE everything this hook
# deletes (the worktree, the box clone at ~/src/box-worktrees/$name, and the
# ~/.cache/callback-box/{logs,browse,pids}/$name state). A cleanup therefore
# can't erase the record of itself. `sweep`/`panic` don't touch this file
# either. Never fails the hook (|| true). If a lingering worktree has NO line
# here, the hook never fired for it (e.g. tab-kill sends no SessionEnd).
WORKTREE_LOG="$HOME/.cache/callback-box/worktree-cleanup.log"
wlog() { printf '%s pid=%s SessionEnd %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$$" "$*" >> "$WORKTREE_LOG" 2>/dev/null || true; }

cwd=$(printf '%s' "$input" | jq -r '.cwd // empty')
session_id=$(printf '%s' "$input" | jq -r '.session_id // empty')
reason=$(printf '%s' "$input" | jq -r '.reason // empty')
wlog "event: session=$session_id reason=$reason cwd=$cwd"

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
# Absolute path to the MAIN checkout's copy deliberately: auto-sweep.sh gates
# itself out when its own REPO is a worktree, so invoking a worktree's copy
# would no-op.
"$HOME/src/callback-box/.claude/hooks/auto-sweep.sh" session-end 2>/dev/null || true

# Determine the worktree directory. cwd is the obvious signal, but Claude
# Code reports the session's *final* cwd — an agent that cd'd to the main
# checkout (e.g. to run a cross-tree git command) before exiting would
# defeat a cwd-only check and leak the worktree. transcript_path is the
# durable signal: it encodes the directory the session was launched in,
# embedded as `-Users-ianbicking-src-callback-worktrees-<name>` in
# `~/.claude/projects/<encoded-path>/<uuid>.jsonl`.
worktree_path=""
case "$cwd" in
  "$HOME/src/callback-worktrees/"*) worktree_path="$cwd" ;;
esac

if [ -z "$worktree_path" ]; then
  tpath=$(printf '%s' "$input" | jq -r '.transcript_path // empty')
  case "$tpath" in
    *"-src-callback-worktrees-"*)
      name=$(printf '%s' "$tpath" | sed -E 's|.*-src-callback-worktrees-([^/]+)/.*|\1|')
      candidate="$HOME/src/callback-worktrees/$name"
      if [ -d "$candidate" ]; then
        echo "[session-end] cwd is '$cwd'; using worktree '$candidate' derived from transcript_path"
        worktree_path="$candidate"
      fi
      ;;
  esac
fi

if [ -z "$worktree_path" ] || [ ! -d "$worktree_path" ]; then
  wlog "decision=skip:not-a-worktree-session resolved='$worktree_path'"
  exit 0
fi
wlog "resolved worktree=$worktree_path"

cd "$worktree_path" || { wlog "decision=skip:cd-failed wt=$worktree_path"; exit 0; }

# Another live agent still working here? Then this is NOT the last session in
# the worktree, and cleaning would pull the rug out from under it. `bin/worktrees
# sweep` has always had this check; this hook did not, and that gap has teeth: a
# nested `claude -p` (the /cross-model skill's Codex→Claude reviewer) run from
# inside a worktree ends its own session, fires this hook, and — seeing a merged,
# clean branch — deletes the worktree out from under the session that spawned it.
# Verified on 2026-08-04; recorded in this log.
#
# Excluding "self" is the subtle part. The hook is a descendant of the ending
# agent, so we walk up the ppid chain and exclude the NEAREST claude/codex
# ancestor — that one is the session that's ending. In the nested case the outer
# session is a *farther* ancestor, so it survives the exclusion and blocks the
# cleanup. In a genuine session end the ending process is the only agent here,
# so cleanup proceeds exactly as before.
#
# FAIL CLOSED. This guard stands in front of an irreversible delete, so every
# "can't tell" answer skips the cleanup. A worktree that lingers is collected by
# the next `bin/worktrees sweep`; a worktree deleted under a live session is
# gone. Two independent liveness signals, mirroring sweep:
#   1. argv — `claude --worktree <name>`. Required because a session launched by
#      bin/launch-worktree-session runs claude from the MAIN checkout, so its
#      process cwd is main, not the worktree (same reason the transcript_path
#      fallback above exists). A cwd-only guard misses exactly that case.
#   2. process cwd — resumed claude sessions and all codex sessions carry no
#      --worktree argv, but their cwd is inside the worktree.
#
# NOT `pgrep -x claude`: pgrep matches the 16-char accounting name (`ps ucomm`),
# and a native-installed Claude Code reports that as its VERSION ("2.1.221"),
# not "claude" — so pgrep misses live sessions entirely (verified 2026-08-04:
# 10 of 11 running sessions invisible to it). `ps comm` is the executable path,
# which is reliable; match on its basename.
self_agent=""
probe=$$
while [ -n "$probe" ] && [ "$probe" != "0" ] && [ "$probe" != "1" ]; do
  pcomm=$(ps -o comm= -p "$probe" 2>/dev/null || true)
  case "$(basename "${pcomm:-none}")" in
    claude|codex) self_agent="$probe"; break ;;
  esac
  probe=$(ps -o ppid= -p "$probe" 2>/dev/null | tr -d ' ' || true)
done

wt_name=$(basename "$worktree_path")
agent_snapshot=$(ps -axo pid=,comm= 2>/dev/null || true)
if [ -z "$agent_snapshot" ]; then
  echo "[session-end] cannot enumerate processes — refusing to clean $worktree_path"
  wlog "decision=skip:cannot-enumerate-processes wt=$worktree_path"
  exit 0
fi
other_pids=$(printf '%s\n' "$agent_snapshot" \
  | awk -v self="${self_agent:-0}" \
      '{ n = $2; sub(/.*\//, "", n);
         if ((n == "claude" || n == "codex") && $1 != self) print $1 }')

if [ -n "$other_pids" ]; then
  # Signal 1: argv. Substring match on a literal, no regex — a worktree name
  # with a metacharacter must not silently turn the guard off.
  for pid in $other_pids; do
    pargs=$(ps -o command= -p "$pid" 2>/dev/null || true)
    case "$pargs" in
      *"claude --worktree $wt_name "*|*"claude --worktree $wt_name")
        echo "[session-end] live claude session for '$wt_name' (pid $pid, argv) — leaving alone"
        wlog "decision=skip:other-agent-live signal=argv self=$self_agent pid=$pid wt=$worktree_path"
        exit 0 ;;
    esac
  done

  # Signal 2: process cwd. If lsof tells us nothing about processes we know are
  # alive, we cannot prove none of them lives here — so we skip.
  pid_csv=$(printf '%s\n' "$other_pids" | tr '\n' ',' | sed 's/,$//')
  other_cwds=$(lsof -a -d cwd -p "$pid_csv" -Fn 2>/dev/null | sed -n 's/^n//p' | sort -u || true)
  if [ -z "$other_cwds" ]; then
    echo "[session-end] cannot read cwd of live agent processes — refusing to clean $worktree_path"
    wlog "decision=skip:cannot-read-agent-cwds self=$self_agent others=[$pid_csv] wt=$worktree_path"
    exit 0
  fi
  while IFS= read -r acwd; do
    [ -n "$acwd" ] || continue
    case "$acwd" in
      "$worktree_path"|"$worktree_path"/*)
        echo "[session-end] another live claude/codex session is cwd'd in $worktree_path — leaving alone"
        wlog "decision=skip:other-agent-live signal=cwd self=$self_agent others=[$pid_csv] wt=$worktree_path"
        exit 0 ;;
    esac
  done <<EOF
$other_cwds
EOF
fi

branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
if [ -z "$branch" ] || [ "$branch" = "main" ] || [ "$branch" = "HEAD" ]; then
  echo "[session-end] branch=$branch, not eligible for auto-cleanup"
  wlog "decision=skip:branch-ineligible branch='$branch' wt=$worktree_path"
  exit 0
fi

ahead=$(git rev-list --count main..HEAD 2>/dev/null || echo "?")
# Deletion-only entries (` D ` unstaged / `D  ` staged) don't count as dirt:
# a cleanup killed mid-removal (hook timeout) leaves a half-deleted tree
# whose only changes are phantom deletions of tracked files — content that
# all exists in git. Counting those as dirty made one interrupted cleanup
# poison the worktree against every future cleanup. Anything that isn't a
# pure deletion (modified, untracked, renamed, conflicted) still blocks.
dirty=$(git status --porcelain 2>/dev/null | grep -cvE '^( D|D ) ' || true)

if [ "$ahead" != "0" ] || [ "$dirty" != "0" ]; then
  echo "[session-end] worktree '$branch' not fully merged (ahead=$ahead, non-deletion dirty=$dirty) — leaving alone"
  # Capture WHICH entries block it — untracked file vs unmerged commit is the
  # whole diagnosis (e.g. review-ios lingered on one untracked doc).
  blockers=$(git status --porcelain 2>/dev/null | grep -vE '^( D|D ) ' | head -6 | tr '\n' ';' || true)
  wlog "decision=skip:unmerged branch=$branch ahead=$ahead dirty=$dirty blockers=[$blockers] wt=$worktree_path"
  exit 0
fi
wlog "decision=clean branch=$branch ahead=0 dirty=0 wt=$worktree_path"

# IMPORTANT: derive the name from $worktree_path, not $cwd. When the
# session ends with cwd = main (the original bug that motivated the
# transcript-path fallback above), $cwd is the main checkout, so
# basename($cwd) = "callback-box" — wrong name, wrong target for the
# removal step below.
name=$(basename "$worktree_path")
MONO="$HOME/src/callback-box"

echo "[session-end] worktree '$branch' is fully merged into main and clean — cleaning up"

# Private-issues shadow worktree (bin/private-issues): remove it iff merged
# into private main AND strictly clean; anything else is preserved as an
# orphan OUTSIDE this worktree (the mount is only a symlink, so the public
# cleanup below cannot touch private files) and re-reported by every sweep
# until resolved. Must run BEFORE the trash-mv below (it classifies the
# mount via the symlink). Never blocks public cleanup.
PI_CLI="$worktree_path/bin/private-issues"
[ -x "$PI_CLI" ] || PI_CLI="$MONO/bin/private-issues" # worktree predates the CLI
if [ -x "$PI_CLI" ]; then
  pi_result=$("$PI_CLI" remove-if-safe "$worktree_path" 2>/dev/null || echo "error")
  echo "[session-end]   private-issues: $pi_result"
  wlog "private-issues result=$pi_result wt=$worktree_path"
fi

# Tell the dev router to stop this worktree's processes immediately so
# there's nothing left binding the cloned-box files when we delete them.
if curl -fsS -X POST -m 5 "http://127.0.0.1:3210/__router/stop/$name" >/dev/null 2>&1; then
  echo "[session-end]   told router to stop $name"
fi

# Deleting ~1GB of worktree + box synchronously here used to blow the hook
# timeout: the kill landed mid-`git worktree remove`, leaving a half-deleted
# but still-registered worktree (the accumulation bug of 2026-06). Instead:
# rename everything into a trash dir (instant), do the cheap git bookkeeping,
# and let a detached background process do the slow delete — it survives
# both this hook and the session.
TRASH="$HOME/.cache/callback-box/trash"
mkdir -p "$TRASH"
ts=$(date +%s)

# Trash the cloned box tree ($name/, which contains test1/).
BOX_DEST="$HOME/src/box-worktrees/$name"
if [ -d "$BOX_DEST" ]; then
  mv "$BOX_DEST" "$TRASH/box-$name-$ts"
  echo "[session-end]   trashed $BOX_DEST"
fi

# Move out of the worktree dir before removing it.
cd "$MONO"

# Trash the worktree directory, then prune the now-dangling registration.
if mv "$worktree_path" "$TRASH/wt-$name-$ts" 2>/dev/null; then
  echo "[session-end]   trashed worktree $worktree_path"
fi
git worktree prune 2>/dev/null || true

# Delete the branch.
if git branch -D "$branch" >/dev/null 2>&1; then
  echo "[session-end]   deleted branch $branch"
fi

# Slow delete, detached. Clears earlier leftovers too. git-annex locks its
# object tree read-only, so unlock it first or macOS leaves annex remnants.
nohup sh -c 'chmod -R u+w "$1" 2>/dev/null || true; rm -rf "$1"' sh "$TRASH" >/dev/null 2>&1 &
disown 2>/dev/null || true

# Cache state: browse profile + socket dir, router log, pid file.
# These don't show up in any UI, but they accumulate, and if the session
# ended cleanly there's no reason to leave them behind.
BROWSE_DIR="$HOME/.cache/callback-box/browse/$name"
LOG_FILE="$HOME/.cache/callback-box/logs/$name.log"
PID_FILE="$HOME/.cache/callback-box/pids/$name.json"
[ -d "$BROWSE_DIR" ] && rm -rf "$BROWSE_DIR" && echo "[session-end]   removed $BROWSE_DIR"
[ -f "$LOG_FILE" ]   && rm -f  "$LOG_FILE"   && echo "[session-end]   removed $LOG_FILE"
[ -f "$PID_FILE" ]   && rm -f  "$PID_FILE"   && echo "[session-end]   removed $PID_FILE"

wlog "done: cleaned branch=$branch name=$name (box+worktree trashed, branch deleted)"
echo "[session-end] done"
