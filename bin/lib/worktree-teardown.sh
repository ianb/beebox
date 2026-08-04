#!/usr/bin/env bash
# Shared worktree-teardown machinery. SOURCE this file; don't execute it.
#
#   . "<repo>/bin/lib/worktree-teardown.sh"
#
# One implementation of the destructive path, used by every caller that can
# remove a worktree on its own initiative:
#   - .claude/hooks/session-end.sh   (Claude Code SessionEnd)
#   - bin/codex-session-end          (codex tab exit, via launch-worktree-session)
#
# `bin/worktrees sweep` deliberately does NOT use this: it takes ONE
# system-wide process snapshot and reuses it across N worktrees, and removes
# with `git worktree remove --force` rather than the trash-mv below. Converging
# it is a separate change with its own risk.
#
# Everything here stands in front of an irreversible delete, so every "can't
# tell" answer resolves to "don't delete". A worktree that lingers is collected
# by the next `bin/worktrees sweep`; a worktree deleted under live work is gone.

WT_STATE_DIR="${CALLBACK_STATE_DIR:-$HOME/.cache/callback-box}"

# The MAIN checkout — where the git bookkeeping (prune, branch -D) has to run.
# Derived from this file's own location, then resolved through git-common-dir so
# a worktree's copy still points at main. Falls back to the historical path.
_wt_lib_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." 2>/dev/null && pwd || echo "")
WT_MONO=""
if [ -n "$_wt_lib_dir" ]; then
  _wt_common=$(git -C "$_wt_lib_dir" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)
  [ -n "$_wt_common" ] && WT_MONO=$(dirname "$_wt_common")
fi
if [ -z "$WT_MONO" ] || [ ! -d "$WT_MONO/callback-box" ]; then
  WT_MONO="$HOME/src/callback-box"
fi
unset _wt_lib_dir _wt_common

# ── Append-only lifecycle log ───────────────────────────────────────────
# Diagnostic for the recurring "worktrees don't get cleaned up" problem. It
# records, for EVERY invocation, whether a teardown fired and what it decided
# (cleaned / skipped-why). Deliberately at a FIXED top-level path — never a
# per-worktree/per-name subdir — so it lives OUTSIDE everything a teardown
# deletes (the worktree, the box clone at ~/src/box-worktrees/$name, and the
# state/{logs,browse,pids}/$name dirs). A cleanup therefore can't erase the
# record of itself. `sweep`/`panic` don't touch this file either. Never fails
# the caller (|| true). If a lingering worktree has NO line here, no teardown
# ever fired for it (e.g. a tab-kill, which sends no exit signal at all).
#
# WT_LOG_LABEL names the caller (SessionEnd / CodexExit) so one file covers
# both agents.
WT_LOG_FILE="$WT_STATE_DIR/worktree-cleanup.log"
WT_LOG_LABEL="${WT_LOG_LABEL:-Teardown}"
wt_log() {
  printf '%s pid=%s %s %s\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$$" "$WT_LOG_LABEL" "$*" \
    >> "$WT_LOG_FILE" 2>/dev/null || true
}

# Progress line for the human. WT_SAY_PREFIX lets a caller keep its own tag on
# every line it emits (the hooks prefix "[session-end]").
wt_say() { printf '%s%s\n' "${WT_SAY_PREFIX:-  }" "$*"; }

# ── Is another agent still working in this worktree? ────────────────────
#
# wt_other_agent_live <worktree_path> [--exclude-self-ancestor]
#
# Always returns 0; the answer is in WT_AGENT_STATE (`none` | `live` |
# `unknown`) with detail in WT_AGENT_REASON. Callers MUST treat `unknown` the
# same as `live` — that's the fail-closed half of this guard.
#
# Cleaning a worktree that still has a live agent pulls the rug out from under
# it. `bin/worktrees sweep` has always checked; session-end.sh did not, and that
# gap had teeth: a nested `claude -p` (the /cross-model skill's Codex→Claude
# reviewer) run from inside a worktree ends its own session, fires the hook, and
# — seeing a merged, clean branch — deletes the worktree out from under the
# session that spawned it. Verified 2026-08-04; recorded in the log above.
#
# --exclude-self-ancestor is for a caller that runs as a DESCENDANT of the agent
# that's ending (a SessionEnd hook): walk up the ppid chain and exclude the
# NEAREST claude/codex ancestor, since that one is the session on its way out.
# In the nested case the outer session is a *farther* ancestor, so it survives
# the exclusion and blocks the cleanup. A caller that runs AFTER its agent has
# already exited (bin/codex-session-end) must omit the flag: there is no self to
# exclude, and excluding an ancestor would be wrong if the script were ever run
# by hand from inside a live session.
#
# Two independent liveness signals, mirroring sweep:
#   1. argv — `claude --worktree <name>`. Required because a session launched by
#      bin/launch-worktree-session runs claude from the MAIN checkout, so its
#      process cwd is main, not the worktree.
#   2. process cwd — resumed claude sessions and all codex sessions carry no
#      --worktree argv, but their cwd is inside the worktree.
#
# NOT `pgrep -x claude`: pgrep matches the 16-char accounting name (`ps ucomm`),
# and a native-installed Claude Code reports that as its VERSION ("2.1.221"),
# not "claude" — so pgrep misses live sessions entirely (verified 2026-08-04:
# 10 of 11 running sessions invisible to it). `ps comm` is the executable path,
# which is reliable; match on its basename.
wt_other_agent_live() {
  local worktree_path="$1" exclude_self=""
  [ "${2:-}" = "--exclude-self-ancestor" ] && exclude_self=1
  local wt_name
  wt_name=$(basename "$worktree_path")

  WT_AGENT_STATE="unknown"
  WT_AGENT_REASON=""
  WT_AGENT_SELF=""

  if [ -n "$exclude_self" ]; then
    local probe=$$ pcomm
    while [ -n "$probe" ] && [ "$probe" != "0" ] && [ "$probe" != "1" ]; do
      pcomm=$(ps -o comm= -p "$probe" 2>/dev/null || true)
      case "$(basename "${pcomm:-none}")" in
        claude|codex) WT_AGENT_SELF="$probe"; break ;;
      esac
      probe=$(ps -o ppid= -p "$probe" 2>/dev/null | tr -d ' ' || true)
    done
  fi

  local snapshot
  snapshot=$(ps -axo pid=,comm= 2>/dev/null || true)
  if [ -z "$snapshot" ]; then
    WT_AGENT_REASON="cannot-enumerate-processes"
    return 0
  fi

  local other_pids
  other_pids=$(printf '%s\n' "$snapshot" \
    | awk -v self="${WT_AGENT_SELF:-0}" \
        '{ n = $2; sub(/.*\//, "", n);
           if ((n == "claude" || n == "codex") && $1 != self) print $1 }')
  if [ -z "$other_pids" ]; then
    WT_AGENT_STATE="none"
    return 0
  fi

  # Signal 1: argv. Substring match on a literal, no regex — a worktree name
  # with a metacharacter must not silently turn the guard off.
  local pid pargs
  for pid in $other_pids; do
    pargs=$(ps -o command= -p "$pid" 2>/dev/null || true)
    case "$pargs" in
      *"claude --worktree $wt_name "*|*"claude --worktree $wt_name")
        WT_AGENT_STATE="live"
        WT_AGENT_REASON="signal=argv pid=$pid"
        return 0 ;;
    esac
  done

  # Signal 2: process cwd. If lsof tells us nothing about processes we know are
  # alive, we cannot prove none of them lives here — so the answer is unknown.
  local pid_csv other_cwds acwd
  pid_csv=$(printf '%s\n' "$other_pids" | tr '\n' ',' | sed 's/,$//')
  other_cwds=$(lsof -a -d cwd -p "$pid_csv" -Fn 2>/dev/null | sed -n 's/^n//p' | sort -u || true)
  if [ -z "$other_cwds" ]; then
    WT_AGENT_REASON="cannot-read-agent-cwds others=[$pid_csv]"
    return 0
  fi
  # Literal prefix match, not a regex, for the same reason as signal 1.
  while IFS= read -r acwd; do
    [ -n "$acwd" ] || continue
    case "$acwd" in
      "$worktree_path"|"$worktree_path"/*)
        WT_AGENT_STATE="live"
        WT_AGENT_REASON="signal=cwd others=[$pid_csv]"
        return 0 ;;
    esac
  done <<EOF
$other_cwds
EOF

  WT_AGENT_STATE="none"
  return 0
}

# ── How much unlanded work does this worktree hold? ─────────────────────
#
# wt_work_state <worktree_path>
#
# Sets WT_BRANCH, WT_AHEAD (commits not in main; "?" if git can't say),
# WT_DIRTY (count of non-deletion working-tree entries) and WT_BLOCKERS (the
# first few of those entries, for the log — untracked file vs unmerged commit
# is the whole diagnosis).
#
# Deletion-only entries (` D ` unstaged / `D  ` staged) don't count as dirt: a
# cleanup killed mid-removal (hook timeout) leaves a half-deleted tree whose
# only changes are phantom deletions of tracked files — content that all exists
# in git. Counting those as dirty made one interrupted cleanup poison the
# worktree against every future cleanup. Anything that isn't a pure deletion
# (modified, untracked, renamed, conflicted) still blocks.
wt_work_state() {
  local d="$1"
  WT_BRANCH=$(git -C "$d" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
  WT_AHEAD=$(git -C "$d" rev-list --count main..HEAD 2>/dev/null || echo "?")

  # `git status` failing must NOT read as "clean". Piping it straight into
  # `grep -c` loses that distinction: a status that errors out with no output
  # yields a count of 0, i.e. exactly the value that authorizes a delete. So
  # capture it, keep git's exit status, and report "?" — which every caller
  # compares against "0" and therefore treats as blocking.
  local status_out
  if status_out=$(git -C "$d" status --porcelain 2>/dev/null); then
    if [ -z "$status_out" ]; then
      WT_DIRTY=0
      WT_BLOCKERS=""
    else
      WT_DIRTY=$(printf '%s\n' "$status_out" | grep -cvE '^( D|D ) ' || true)
      WT_BLOCKERS=$(printf '%s\n' "$status_out" | grep -vE '^( D|D ) ' | head -6 | tr '\n' ';' || true)
    fi
  else
    WT_DIRTY="?"
    WT_BLOCKERS="git-status-failed"
  fi
  [ -n "$WT_DIRTY" ] || WT_DIRTY="?"
}

# ── Remove the worktree, the box clone, and the router/cache state ──────
#
# wt_remove_now <worktree_path> <branch> [--keep-branch]
#
# CHANGES THE CALLER'S CWD to $WT_MONO — it has to, since the directory it
# deletes may be the shell's cwd. Callers must not assume where they are
# afterwards. Progress goes to stdout (both current callers route stdout to
# stderr or to a terminal).
#
# --keep-branch leaves the branch in place. Used when the caller is removing a
# worktree that still has unmerged commits on explicit human say-so: the tree
# and its uncommitted changes go, but `git branch -D` on unmerged commits is a
# different order of loss for no benefit — the branch costs nothing and
# `git worktree add` resurrects the work.
wt_remove_now() {
  local worktree_path="$1" branch="$2" keep_branch=""
  [ "${3:-}" = "--keep-branch" ] && keep_branch=1
  local name
  name=$(basename "$worktree_path")

  # Private-issues shadow worktree (bin/private-issues): remove it iff merged
  # into private main AND strictly clean; anything else is preserved as an
  # orphan OUTSIDE this worktree (the mount is only a symlink, so the public
  # cleanup below cannot touch private files) and re-reported by every sweep
  # until resolved. Must run BEFORE the trash-mv below (it classifies the
  # mount via the symlink). Never blocks public cleanup.
  local pi_cli pi_result
  pi_cli="$worktree_path/bin/private-issues"
  [ -x "$pi_cli" ] || pi_cli="$WT_MONO/bin/private-issues" # worktree predates the CLI
  if [ -x "$pi_cli" ]; then
    pi_result=$("$pi_cli" remove-if-safe "$worktree_path" 2>/dev/null || echo "error")
    wt_say "private-issues: $pi_result"
    wt_log "private-issues result=$pi_result wt=$worktree_path"
  fi

  # Tell the dev router to stop this worktree's processes immediately so
  # there's nothing left binding the cloned-box files when we delete them.
  # Over the Unix-domain socket: the router's TCP listener authenticates every
  # request (it's exposable over Tailscale) and a hook carries no session
  # cookie, so a TCP call just 401s. The UDS is the trusted-local channel every
  # other CLI caller uses. TCP stays as a fallback for a router old enough not
  # to have the socket.
  local router_port="${ROUTER_PORT:-3210}"
  if curl -fsS -X POST -m 5 --unix-socket "$WT_STATE_DIR/router.sock" \
       "http://router/__router/stop/$name" >/dev/null 2>&1 \
     || curl -fsS -X POST -m 5 "http://127.0.0.1:$router_port/__router/stop/$name" >/dev/null 2>&1; then
    wt_say "told router to stop $name"
  fi

  # Deleting ~1GB of worktree + box synchronously used to blow the hook
  # timeout: the kill landed mid-`git worktree remove`, leaving a half-deleted
  # but still-registered worktree (the accumulation bug of 2026-06). Instead:
  # rename everything into a trash dir (instant), do the cheap git bookkeeping,
  # and let a detached background process do the slow delete — it survives both
  # the caller and the session.
  local trash="$WT_STATE_DIR/trash" ts
  mkdir -p "$trash"
  ts=$(date +%s)

  # Trash the cloned box tree ($name/, which contains test1/).
  local box_dest="$HOME/src/box-worktrees/$name"
  if [ -d "$box_dest" ]; then
    mv "$box_dest" "$trash/box-$name-$ts"
    wt_say "trashed $box_dest"
  fi

  # Move out of the worktree dir before removing it.
  cd "$WT_MONO" || return 0

  # Trash the worktree directory, then prune the now-dangling registration.
  if mv "$worktree_path" "$trash/wt-$name-$ts" 2>/dev/null; then
    wt_say "trashed worktree $worktree_path"
  fi
  git worktree prune 2>/dev/null || true

  if [ -n "$keep_branch" ]; then
    wt_say "kept branch $branch (unmerged work; \`git worktree add\` to resume)"
  elif [ -n "$branch" ] && git branch -D "$branch" >/dev/null 2>&1; then
    wt_say "deleted branch $branch"
  fi

  # Slow delete, detached. Clears earlier leftovers too. git-annex locks its
  # object tree read-only, so unlock it first or macOS leaves annex remnants.
  nohup sh -c 'chmod -R u+w "$1" 2>/dev/null || true; rm -rf "$1"' sh "$trash" >/dev/null 2>&1 &
  disown 2>/dev/null || true

  # Cache state: browse profile + socket dir, router log, pid file.
  # These don't show up in any UI, but they accumulate, and there's no reason
  # to leave them behind.
  local browse_dir="$WT_STATE_DIR/browse/$name"
  local log_file="$WT_STATE_DIR/logs/$name.log"
  local pid_file="$WT_STATE_DIR/pids/$name.json"
  [ -d "$browse_dir" ] && rm -rf "$browse_dir" && wt_say "removed $browse_dir"
  [ -f "$log_file" ]   && rm -f  "$log_file"   && wt_say "removed $log_file"
  [ -f "$pid_file" ]   && rm -f  "$pid_file"   && wt_say "removed $pid_file"

  return 0
}
