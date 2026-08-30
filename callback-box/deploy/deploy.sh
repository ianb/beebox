#!/usr/bin/env bash
set -euo pipefail

# Deploy a git COMMIT to the server via rsync — never the working tree.
#
# The old mechanism rsynced the invoking working tree directly, so a dirty tree
# (or a mid-deploy edit) could ship source that matched no commit and lie in
# deploy-info.json. This version builds from a persistent "build checkout" that
# we reset to the target ref before building, and rsyncs FROM that checkout. The
# user's active working tree is never touched, cleaned, or rebuilt by a deploy.
#
# The build checkout is a standalone local `git clone --shared`, NOT a git
# worktree. A worktree shares the main repo's `.git/worktrees/` bookkeeping,
# which concurrent worktree ops (sessions spinning up, cleanup hooks, sweep,
# Claude Code's own `git worktree remove`) kept corrupting mid-creation, failing
# the deploy — see the Build-checkout lifecycle section below and
# issues/bugs/2026-07-10-deploy-checkout-transient-index-lock.md.
#
# Mechanism:
#   * `--ref <ref>` (default: HEAD of the invoking repo) is resolved to a full
#     SHA immediately, so a commit landed mid-deploy can't produce a mixed ship.
#   * The build checkout lives at <main-repo-root>/.deploy-checkout and is SHARED
#     across every worktree of this repo (keyed to the shared git common dir), so
#     concurrent deploys reuse one clone + one warm node_modules. `--shared`
#     points its object store at the main repo, so a just-committed sha needs no
#     fetch and no object copy.
#   * Per deploy we `checkout --detach <sha>` + `git clean -fdx` (preserving only
#     node_modules and the meta file) so a stale gitignored dist/ from a previous
#     ref can never ship — that clean is the whole point: it kills the "commit-X
#     source, commit-Y artifacts" lie the old design allowed.
#   * node_modules is preserved across deploys so the frozen install stays a fast
#     reconcile; it's wiped only when pnpm-lock.yaml or patches/ changed between
#     the last and current ref (patch-package mutates files inside node_modules,
#     so reuse across such a change is unsafe).
#   * deploy-info.json records a hash GUARANTEED to be exactly what shipped, plus
#     the raw requested ref so a rollback (`deploy.sh --ref <old-sha>`) is
#     recognizable in deploy-history.json.
#
# Only server-ip, the failure trap/notify, and the lock/meta files stay keyed to
# the invoking repo; EVERYTHING built or synced comes from the build checkout.
#
# Usage: ./deploy/deploy.sh [--ref <ref>] [--skip-restart]

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"   # callback-box within the invoking tree
MONO_DIR="$(cd "$REPO_DIR/.." && pwd)"     # the invoking tree's monorepo root

# Surface failures. This usually runs backgrounded from the post-commit hook,
# with stdout/err going to a per-run log under deploy/.deploy-logs/ (symlinked as
# deploy/.last-deploy.log) that nobody watches — so on any non-zero exit, echo a
# "Deploy failed" line (the poll pattern in deploy/CLAUDE.md keys off it) AND
# fire a desktop notification. Skipped when run interactively — you already see
# the output. terminal-notifier is optional.
LOG_HINT="callback-box/deploy/.last-deploy.log"
notify() {  # $1=title  $2=message
  [ -t 1 ] && return 0
  # -activate: clicking the notification brings Terminal forward (where the
  # deploy ran) instead of doing nothing. One fixed group replaces stale ones.
  command -v terminal-notifier >/dev/null 2>&1 &&
    terminal-notifier -title "$1" -message "$2" -group callback-deploy       -activate com.apple.Terminal >/dev/null 2>&1 || true
}
# The trap also releases the deploy lock (LOCK_HELD is set only after shlock
# succeeds, further below). If a held deploy fails after a newer request was
# recorded, it still hands off to that request: otherwise the non-blocking lock
# loser has already exited successfully and nobody remains to deploy the newest
# ref. The failed attempt remains explicit before the chained attempt begins.
deploy_exit() {
  local rc=$?
  trap - EXIT
  local held="${LOCK_HELD:-}"
  if [ -n "$held" ]; then
    rm -f "${LOCK_FILE:-}"
    LOCK_HELD=""
  fi
  if [ "$rc" -eq 0 ]; then
    return
  fi

  # Signal exits (rc >= 128: 130 Ctrl-C/tab close, 143 SIGTERM) are an
  # interruption, not a failure — the classic case is closing a workstream's
  # Terminal tab while its post-commit deploy runs in the background. A later
  # landing's deploy covers the same or a newer ref, so a red FAILED here is
  # misleading (boxholder, 2026-08-29). Say what actually happened.
  if [ "$rc" -ge 128 ]; then
    local sig=$((rc - 128))
    echo "Deploy interrupted (signal $sig) — not a failure; the next landing's deploy covers this ref."
    notify "⏸ callback-box deploy interrupted" "signal $sig — the next landing redeploys; see $LOG_HINT"
  else
    echo "Deploy failed (exit $rc)"
    notify "❌ callback-box deploy FAILED" "exit $rc — see $LOG_HINT"
  fi

  local newer=""
  if [ -n "$held" ] && [ -n "${REQUESTED_FILE:-}" ] && [ -n "${SHA:-}" ]; then
    newer="$(cat "$REQUESTED_FILE" 2>/dev/null || true)"
  fi
  # Signal-style exits mean an operator or supervisor deliberately stopped the
  # run. Do not turn Ctrl-C/SIGTERM into a fresh full deploy behind their back.
  if [ "$rc" -lt 128 ] && [ -n "$newer" ] && [ "$newer" != "$SHA" ]; then
    echo "Deploy superseded by $newer — chaining after failed attempt."
    if [ -t 1 ]; then
      "$0" --ref "$newer" --chained || true
    else
      "$0" --ref "$newer" --chained >>"$SCRIPT_DIR/.last-deploy.log" 2>&1 || true
    fi
  fi
  exit "$rc"
}
trap deploy_exit EXIT

# The deploy target IP lives in a gitignored file; a repo move or fresh clone
# leaves it behind — which is exactly how a run of silent no-op deploys just
# happened. Fail loud and actionable instead of a bare "cat: No such file".
# Stays keyed to the invoking tree: server-ip exists only in real checkouts, not
# the (git-clean) build checkout below.
if [ ! -s "$SCRIPT_DIR/server-ip" ]; then
  echo "deploy: $SCRIPT_DIR/server-ip is missing or empty — it holds the deploy" >&2
  echo "  target IP and is gitignored (never committed). Restore it from a backup," >&2
  echo "  or:  echo <SERVER_IP> > $SCRIPT_DIR/server-ip" >&2
  exit 1
fi
SERVER_IP=$(cat "$SCRIPT_DIR/server-ip")
INSTALL_DIR="/opt/callback"

# The latest-wins lock below uses shlock(1) — a PID-based lock that ships with
# macOS at /usr/bin/shlock and auto-breaks a stale lock left by a dead process
# (flock would be the natural choice but stock macOS doesn't have it). Guard
# here with the same loud-and-actionable pattern as server-ip rather than dying
# on a bare "shlock: command not found" deep inside the run.
if ! command -v shlock >/dev/null 2>&1; then
  echo "deploy: shlock is required for deploy serialization but is not on PATH." >&2
  echo "  It ships with macOS (/usr/bin/shlock). On another OS, install inn's" >&2
  echo "  shlock or adapt the locking section to flock(1)." >&2
  exit 1
fi

# --- Argument parsing -------------------------------------------------------
# --skip-frontend is intentionally gone: it's incompatible with "ref == prod"
# (the frontend build is the price of a truthful deploy, and it's backgrounded
# anyway).
RAW_REF="HEAD"          # the ref as requested, recorded verbatim in deploy-info
SKIP_RESTART=false
CHAINED=false           # internal: set by the end-of-run chain re-exec, never by hand
REQUEST_RECORDED=false  # internal: the main hook already stamped latest intent
while [[ $# -gt 0 ]]; do
  case "$1" in
    --chained)
      CHAINED=true
      shift
      ;;
    --request-recorded)
      REQUEST_RECORDED=true
      shift
      ;;
    --ref)
      if [[ $# -lt 2 ]]; then
        echo "deploy: --ref requires a value" >&2
        exit 1
      fi
      RAW_REF="$2"
      shift 2
      ;;
    --skip-restart)
      SKIP_RESTART=true
      shift
      ;;
    *)
      echo "deploy: unknown argument '$1' (usage: deploy.sh [--ref <ref>] [--skip-restart])" >&2
      exit 1
      ;;
  esac
done

# Resolve the requested ref to a FULL sha immediately, against the invoking repo.
# Everything downstream keys off this sha, so a commit landed mid-deploy can't
# produce a mixed ship. Fail loud if the ref doesn't resolve to a commit.
if ! SHA=$(git -C "$MONO_DIR" rev-parse --verify --quiet "${RAW_REF}^{commit}"); then
  echo "deploy: could not resolve ref '$RAW_REF' to a commit in $MONO_DIR" >&2
  exit 1
fi

# --- Build-checkout location ------------------------------------------------
# The checkout is shared across all worktrees of this repo, so key it to the
# shared git common dir (identical for the main checkout and every linked
# worktree) rather than to MONO_DIR (the invoking tree, which varies). The common
# dir is <main-repo-root>/.git; strip the trailing /.git to get the main root.
GIT_COMMON_DIR="$(git -C "$MONO_DIR" rev-parse --path-format=absolute --git-common-dir)"
MAIN_ROOT="${GIT_COMMON_DIR%/.git}"
CHECKOUT="$MAIN_ROOT/.deploy-checkout"
META_FILE="$CHECKOUT/.deploy-last-sha"   # last-installed sha; drives clean-reinstall + git-clean keep
LOCK_FILE="$MAIN_ROOT/.deploy-checkout.lock"
REQUESTED_FILE="$MAIN_ROOT/.deploy-requested"

# checkout_belongs_to_repo: true iff the persistent checkout's root .git file
# points at a worktree gitdir under THIS repo's common dir. A repo move/rename
# (the exact failure that bit server-ip) leaves the old absolute gitdir dangling,
# so this catches it and we recreate from scratch below.
checkout_belongs_to_repo() {
  # $CHECKOUT is a standalone local clone (its own `.git` DIR), not a worktree.
  # It belongs to this repo iff its shared object store (alternates) points at
  # the current main repo's objects. A mismatch (repo moved, or a leftover
  # worktree-form `.git` gitlink from the old design) triggers a wipe + reclone.
  [ -d "$CHECKOUT/.git" ] || return 1
  local alt="$CHECKOUT/.git/objects/info/alternates"
  [ -f "$alt" ] || return 1
  local line resolved_alt resolved_want
  read -r line < "$alt" || return 1
  resolved_alt="$(cd "$line" 2>/dev/null && pwd -P)" || return 1
  resolved_want="$(cd "$GIT_COMMON_DIR/objects" 2>/dev/null && pwd -P)" || return 1
  [ "$resolved_alt" = "$resolved_want" ]
}

# --- Locking: latest-wins ---------------------------------------------------
# Record the requested sha (plain overwrite — last writer wins; a manual
# rollback to an OLDER sha is still the LATEST intent, which is why this is
# write-time ordering, not commit ancestry), then try to take the lock. shlock
# is non-blocking, so a loser doesn't queue: it exits, trusting the current
# holder to CHAIN — after finishing, the holder re-reads .deploy-requested and
# re-execs itself (see end of script). This collapses a rapid `main` commit
# burst to at most one extra deploy, always ending on the latest requested ref.
# A stale lock from a crashed deploy is auto-broken by shlock's PID liveness
# check.
#
# A CHAINED invocation does NOT stamp the file: it carries no new intent, it
# only relays whatever is currently requested. (If it re-stamped, a stale sha
# read just before the re-exec could clobber a newer concurrent request and the
# final deployed state would silently regress.)
if [[ "$CHAINED" != true && "$REQUEST_RECORDED" != true ]]; then
  echo "$SHA" > "$REQUESTED_FILE"
fi
if ! shlock -f "$LOCK_FILE" -p $$; then
  echo "Deploy superseded: $SHA queued; another deploy holds $LOCK_FILE and will chain to it."
  exit 0
fi
LOCK_HELD=1
# Deploy the latest REQUESTED sha, not necessarily our own. For a chained run
# this is the main mechanism (pick up whatever is requested right now); for a
# normal run it catches the race where we won the lock against an invocation
# that stamped a newer sha just before losing.
REQUESTED="$(cat "$REQUESTED_FILE" 2>/dev/null || echo "$SHA")"
if [[ -n "$REQUESTED" && "$REQUESTED" != "$SHA" ]]; then
  echo "Latest requested sha is $REQUESTED — deploying it instead of $SHA."
  SHA="$REQUESTED"
  RAW_REF="$REQUESTED"
fi

echo "Deploying ref '$RAW_REF' ($SHA) from build checkout $CHECKOUT"

# First reclaim deploy-owned caches so a previous accumulation cannot lock out
# the cleanup that repairs it. Best-effort here: the hard post-install prune
# below is authoritative, while this recovery pass may be running on a full
# filesystem with partially broken tools.
echo "Pruning deploy package caches before disk gate..."
ssh "root@$SERVER_IP" bash -s <<'PREFLIGHTCLEAN'
pnpm store prune || echo "  WARNING: root pnpm store preflight prune failed" >&2
sudo -u callback -H bash -lc 'cd /home/callback && pnpm store prune' \
  || echo "  WARNING: callback pnpm store preflight prune failed" >&2
if sudo -u callback -H bash -lc 'command -v uv >/dev/null 2>&1'; then
  sudo -u callback -H bash -lc 'cd /home/callback && uv cache clean' \
    || echo "  WARNING: callback uv cache preflight clean failed" >&2
fi
PREFLIGHTCLEAN

# Refuse to make a low-disk incident worse. This runs before either local or
# remote installs. The 15%-free entry gate stays meaningful across differently
# sized hosts; its 3 GiB floor preserves minimum package/temp/write headroom.
echo "Checking server disk headroom..."
ssh "root@$SERVER_IP" bash -s <<'DISKCHECK'
set -euo pipefail
read -r total_kib free_kib < <(df -Pk / | awk 'NR == 2 { print $2, $4 }')
if [[ ! "$total_kib" =~ ^[0-9]+$ || ! "$free_kib" =~ ^[0-9]+$ ]]; then
  echo "  FAILED: could not determine free disk space for /" >&2
  exit 1
fi
threshold_kib=$((total_kib * 15 / 100))
floor_kib=$((3 * 1024 * 1024))
(( threshold_kib < floor_kib )) && threshold_kib=$floor_kib
if (( free_kib < threshold_kib )); then
  free_gib=$(awk -v kib="$free_kib" 'BEGIN { printf "%.1f", kib / 1024 / 1024 }')
  threshold_gib=$(awk -v kib="$threshold_kib" 'BEGIN { printf "%.1f", kib / 1024 / 1024 }')
  echo "  FAILED: only ${free_gib} GiB free on /; deploy requires ${threshold_gib} GiB (15% capacity, 3 GiB minimum)." >&2
  echo "  Free disk space, then rerun the deploy." >&2
  exit 1
fi
free_gib=$(awk -v kib="$free_kib" 'BEGIN { printf "%.1f", kib / 1024 / 1024 }')
threshold_gib=$(awk -v kib="$threshold_kib" 'BEGIN { printf "%.1f", kib / 1024 / 1024 }')
echo "  Disk headroom OK: ${free_gib} GiB free (deploy threshold: ${threshold_gib} GiB)."
DISKCHECK

# --- Build-checkout lifecycle (persistent local --shared clone) -------------
# `.deploy-checkout` is a SEPARATE local clone, NOT a git worktree — deliberately.
# A worktree shares the main repo's `.git/worktrees/` bookkeeping, which every
# concurrent worktree op mutates: worktree sessions spinning up, cleanup hooks,
# `bin/workstreams sweep`, AND Claude Code's own `git worktree remove` on session
# exit. Those repeatedly corrupted the worktree mid-creation and failed the prod
# deploy (ENOTDIR on `.git/index`). A clone has its OWN `.git` dir and is immune
# to all of it — no serialization/backoff/lock needed. `--shared` points its
# object store at the main repo via alternates, so a just-committed $SHA is
# visible with no fetch and no object copy; node_modules persists across deploys
# (gitignored; untouched by checkout/clean).
# See issues/bugs/2026-07-10-deploy-checkout-transient-index-lock.md.
CHECKOUT_FRESH=false
if [ ! -d "$CHECKOUT/.git" ] || ! checkout_belongs_to_repo; then
  echo "Creating build clone at $CHECKOUT (shared object store)..."
  rm -rf "$CHECKOUT"
  git clone --shared --quiet --no-checkout "$MAIN_ROOT" "$CHECKOUT"
  CHECKOUT_FRESH=true
fi

# Point the clone at $SHA. Objects are shared with the main repo, so a
# just-committed sha resolves with no fetch.
git -C "$CHECKOUT" checkout --detach --quiet "$SHA"

# Clean stale ignored/untracked (notably a previous ref's `dist/`, which must
# never ship) except node_modules and the meta file. Skipped on a fresh clone —
# nothing stale yet, and node_modules doesn't exist until the install below.
if [[ "$CHECKOUT_FRESH" != true ]]; then
  git -C "$CHECKOUT" clean -fdx -e node_modules -e .deploy-last-sha .
fi

# --- Clean-reinstall trigger ------------------------------------------------
# patch-package mutates files inside node_modules, so reusing node_modules across
# a pnpm-lock.yaml or patches/ change (notably a rollback) is unsafe. Wipe all
# node_modules trees (root + workspace members) when the lockfile or patches
# differ between the last-installed sha and this one — or when the meta file is
# missing/invalid (we can't prove the tree is safe to reuse).
NEED_CLEAN_INSTALL=false
if [ -f "$META_FILE" ]; then
  LAST_SHA="$(cat "$META_FILE")"
  if ! git -C "$CHECKOUT" rev-parse --verify --quiet "${LAST_SHA}^{commit}" >/dev/null; then
    NEED_CLEAN_INSTALL=true
  elif ! git -C "$CHECKOUT" diff --quiet "$LAST_SHA" "$SHA" -- pnpm-lock.yaml patches/; then
    NEED_CLEAN_INSTALL=true
  fi
else
  NEED_CLEAN_INSTALL=true
fi
if [[ "$NEED_CLEAN_INSTALL" == true ]]; then
  echo "Lockfile/patches changed (or first install) — wiping checkout node_modules for a clean reinstall..."
  rm -rf "$CHECKOUT/node_modules" \
         "$CHECKOUT/personal-vibe-check/node_modules" \
         "$CHECKOUT/agent-doctest/node_modules" \
         "$CHECKOUT/callback-box/node_modules" \
         "$CHECKOUT/callback-box/src/frontend/node_modules"
fi

# Reconcile the BUILD CHECKOUT's node_modules to the committed lockfile before
# any build. A just-merged dependency change (added/removed dep) otherwise builds
# the frontend/cards package against stale modules and fails — this has bitten the
# auto-deploy repeatedly. Frozen so it's deterministic and never rewrites the
# lockfile; a no-op when already in sync. HUSKY=0 skips the hook install.
echo "Reconciling build-checkout deps..."
(cd "$CHECKOUT" && HUSKY=0 pnpm install --frozen-lockfile --silent)

# Record the sha we just installed against, so the next deploy can decide whether
# node_modules is safe to reuse. Only written after a successful install.
echo "$SHA" > "$META_FILE"

# Build frontend from the checkout (always — no skip). Vite empties its outDir,
# but the git clean above already removed any stale dist as well.
echo "Building frontend..."
(cd "$CHECKOUT/callback-box/src/frontend" && pnpm --silent build)

# Build the CLI bundle from the checkout before syncing. dist/ is rsynced (not
# excluded), and while the server runs cb via tsx (not the bundle), it DOES need
# dist/cards/index.js on disk: box-local schema files import `callback-box/cards`,
# which package.json `exports` maps to ./dist/cards/index.js (a plain-JS build of
# the card-primitive layer, emitted by build-cli.ts alongside dist/cli.mjs). If
# that file is missing or stale on the server, every box-local schema fails to
# load. Building here keeps dist/ in lockstep with the source we rsync.
echo "Building CLI bundle (dist/cli.mjs + dist/cards)..."
(cd "$CHECKOUT/callback-box" && node scripts/build-cli.ts >/dev/null)

RSYNC_OPTS=(-az --delete
  # rsync runs as root over ssh, and -a preserves the sender's (local dev
  # machine's) numeric uid/gid by default. Without this, /opt/callback ends
  # up owned by the deploying laptop's local uid — harmless for reads, but
  # `callback` (the account every box's `pnpm install` runs as, via the
  # `link:/opt/callback/callback-box` dependency — see docs/box-layout.md)
  # can't chmod a bin file it doesn't own, so pnpm's redundant "make sure
  # this bin is executable" step during `_linkBins` throws EPERM and the
  # whole install exits nonzero even though every real package resolved.
  # --chown isn't available in the local macOS rsync (openrsync, no 3.1+
  # extensions) — --no-owner --no-group plus an explicit chown pass below
  # is the portable equivalent.
  --no-owner --no-group
  --exclude node_modules
  --exclude .git
  --exclude '*.secret.json'
  --exclude '*.state.json'
  --exclude '.last-deploy.log'
  --exclude '.env'
  --exclude '.thinking/'
  --exclude '.claude/'
  --exclude 'deploy-info.json'
  --exclude 'deploy-history.json'
  # server-ip and the per-run logs never exist in the git-clean build checkout,
  # so these excludes are belt-and-suspenders — but stated explicitly so the
  # --delete semantics are documented: neither is a build artifact, and neither
  # should ever be pushed to (or deleted from) the server based on the checkout.
  --exclude 'deploy/server-ip'
  --exclude 'deploy/.deploy-logs'
  # pub-worker is a Cloudflare Worker deployed via `cb pub setup` (wrangler), NOT
  # run on the box server. Excluding its dir makes it an absent workspace member
  # on prod, so the root `pnpm install --frozen-lockfile` skips its heavy CF
  # toolchain (workerd, wrangler) — same "partial workspace installs fine" path
  # as browse/agent-browser-typed above. It stays in pnpm-workspace.yaml for local dev.
  --exclude 'pub-worker'
)

# Sync monorepo packages FROM THE BUILD CHECKOUT. These are pnpm workspace
# members linked via `workspace:*` deps, so they must all be present alongside
# callback-box on the server for the root `pnpm install` to resolve.
# personal-vibe-check and agent-doctest are devDeps of callback-box (the server
# install is non-prod because the runtime uses tsx, itself a devDep).
# browse/agent-browser-typed are deliberately NOT synced — they're dev-only
# tooling and a partial workspace installs fine (pnpm ignores absent members).
for repo in personal-vibe-check agent-doctest callback-box; do
  local_path="$CHECKOUT/$repo/"
  if [[ ! -d "$local_path" ]]; then
    echo "  $repo: not found at $local_path, skipping"
    continue
  fi
  echo "Syncing $repo..."
  rsync "${RSYNC_OPTS[@]}" "$local_path" "root@$SERVER_IP:$INSTALL_DIR/$repo/"
done

# Sync the workspace root itself, FROM THE BUILD CHECKOUT. With workspace deps,
# /opt/callback becomes the pnpm workspace root: the single root lockfile +
# manifest + .npmrc + patches drive one reproducible `pnpm install
# --frozen-lockfile` from there (below). These are individual files, so no
# --delete (it would nuke the synced subdirs).
echo "Syncing workspace root..."
rsync -az --no-owner --no-group \
  "$CHECKOUT/package.json" \
  "$CHECKOUT/pnpm-workspace.yaml" \
  "$CHECKOUT/.npmrc" \
  "$CHECKOUT/pnpm-lock.yaml" \
  "root@$SERVER_IP:$INSTALL_DIR/"
rsync -az --delete --no-owner --no-group "$CHECKOUT/patches/" "root@$SERVER_IP:$INSTALL_DIR/patches/"

# --no-owner/--no-group above leave everything owned by root (the ssh
# connection user) rather than the sender's uid — still wrong for `callback`,
# whose `pnpm install` (this box and every box's) needs to own the files it
# might chmod. One pass over the whole tree after every sync is simpler and
# more robust than trying to get every rsync invocation's ownership right.
echo "Fixing ownership..."
# INSTALL_DIR must expand locally before the remote command runs.
# shellcheck disable=SC2029
ssh "root@$SERVER_IP" "chown -R callback:callback $INSTALL_DIR"

# Install deps if package-lock changed (compare hash)
echo "Checking dependencies..."
ssh -A "root@$SERVER_IP" bash -s <<'REMOTE'
  set -e
  # Bootstrap pnpm on demand. corepack ships with Node 24; this is idempotent
  # and a no-op if pnpm is already on PATH.
  if ! command -v pnpm >/dev/null 2>&1; then
    echo "  Bootstrapping pnpm via corepack..."
    corepack enable pnpm
  fi
  # One-time migration: personal-vibe-check moved from /opt/personal-vibe-check
  # (when it was an external sibling repo) to /opt/callback/personal-vibe-check
  # (now a monorepo sibling). Once the new path is populated and the deploy is
  # confirmed working, the old dir is dead weight. Remove it idempotently.
  if [[ -d /opt/callback/personal-vibe-check && -d /opt/personal-vibe-check ]]; then
    echo "  Removing stale /opt/personal-vibe-check (superseded by /opt/callback/personal-vibe-check)..."
    rm -rf /opt/personal-vibe-check
  fi
  # One-time cleanup: the cardworks package was removed (absorbed into
  # callback-box/src/cards). The deploy no longer syncs it, so an old
  # /opt/callback/cardworks just lingers — drop it idempotently.
  if [[ -d /opt/callback/cardworks ]]; then
    echo "  Removing stale /opt/callback/cardworks (package removed)..."
    rm -rf /opt/callback/cardworks
  fi
  # One-time cutover from the old per-subdir installs to a single workspace
  # install. Before this change each subdir had its own isolated node_modules;
  # the workspace uses a hoisted node_modules at the root. Remove the legacy
  # per-package trees once (keyed on the root node_modules not yet existing) so
  # nothing stale shadows the hoisted layout — the exact class of bug this
  # migration fixes. After the first workspace deploy this branch is skipped.
  if [[ ! -d /opt/callback/node_modules ]]; then
    echo "  First workspace deploy: clearing legacy per-package node_modules..."
    rm -rf /opt/callback/cardworks/node_modules \
           /opt/callback/personal-vibe-check/node_modules \
           /opt/callback/agent-doctest/node_modules \
           /opt/callback/callback-box/node_modules \
           /opt/callback/callback-box/src/frontend/node_modules
  fi
  # Reconcile the whole workspace to the synced lockfile in one frozen install
  # from the workspace root. --frozen-lockfile makes the server resolution match
  # dev byte-for-byte (and fails loudly if the lockfile is stale rather than
  # silently resolving something new). HUSKY=0 skips husky's hook install (no
  # .git on the server) so it doesn't print a spurious ".git can't be found".
  # patch-package still runs via the root postinstall to patch eslint-config-agent.
  cd /opt/callback
  echo "  Reconciling workspace deps (frozen)..."
  # The install competes for RAM with every running box's `cb serve` +
  # claude-agent-sdk subprocess on this single small server, and the kernel
  # OOM-kills it (exit 137) under a transient contention spike rather than a
  # permanent regression — a short backoff usually clears it. Retry only on
  # 137; anything else is a real failure (e.g. a stale lockfile) and should
  # fail immediately rather than burn two backoffs on a certain repeat.
  install_with_retry() {
    local attempt=1 max_attempts=3 backoff=60 rc
    while true; do
      # npm_config_update_notifier=false: the "Update available!" banner is
      # noise in a deploy log (and agent context) on every run; updating pnpm
      # is a deliberate act, not something a deploy should advertise.
      # CI=true: run non-interactively — without it pnpm aborts with
      # ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY when it decides the modules
      # dir must be recreated (e.g. after a Node major upgrade).
      if HUSKY=0 npm_config_update_notifier=false CI=true pnpm install --frozen-lockfile; then
        return 0
      else
        rc=$?
      fi
      if [[ "$rc" -ne 137 || "$attempt" -ge "$max_attempts" ]]; then
        return "$rc"
      fi
      echo "  pnpm install OOM-killed (exit 137, attempt $attempt/$max_attempts) — retrying in ${backoff}s..." >&2
      sleep "$backoff"
      backoff=$((backoff * 3))
      attempt=$((attempt + 1))
    done
  }
  install_with_retry
  # Native-module ABI guard. pnpm's side-effects cache keys build artifacts by
  # dependency graph, NOT by Node ABI — after a Node major upgrade, a "clean"
  # reinstall can silently restore a binary compiled for the old ABI (this
  # broke every box child on the 22→24 upgrade, 2026-07-16, while the hub's
  # /healthz stayed green). Load the module with the runtime that will serve
  # traffic; on mismatch, force a real prebuild fetch/compile and re-verify —
  # a second failure fails the deploy.
  if ! node -e 'require("better-sqlite3")' 2>/dev/null; then
    echo "  better-sqlite3 ABI mismatch — forcing rebuild for $(node -v)..."
    (cd node_modules/better-sqlite3 && rm -rf build \
      && { npx --no-install prebuild-install || npx --no-install node-gyp rebuild --release; })
    node -e 'require("better-sqlite3")'
  fi
REMOTE

# Reconcile each v2-shape (package-layout) box's own node_modules against its
# package.json. `cb init`/`box-packageify` scaffold a package.json declaring
# react/react-dom/typescript direct deps (view-metadata compilation needs a
# real, box-owned react — see src/webapp/views/compiler.ts and
# src/core/box/package.ts) but deliberately don't install them (Track F of
# docs/implemented-plans/boxes-as-packages-v2.md has no real registry yet for
# the `callback-box` dependency itself). Left uninstalled, every view in the
# box silently degrades to a "Failed to compile" stub with no bound card
# type and no visible error — see the box-family incident this fixed.
# Runs after every deploy (not just once) because a box's package.json can
# change independently — an agent `pnpm add`s a view dependency, or a fresh
# `box-packageify` runs — between deploys.
echo "Reconciling box package installs..."
ssh "root@$SERVER_IP" bash -s <<'REMOTE'
  set -e
  for box in /home/callback/boxes/*/; do
    pj="$box/package.json"
    [[ -f "$pj" ]] || continue   # shapeVersion 1 (legacy) boxes have none — skip
    name=$(basename "$box")

    # The callback-box dependency ships as a bare semver range (meaningless —
    # there's no registry for it yet), which makes a plain `pnpm install` fail
    # outright trying to resolve it. Normalize it to `link:`, pointing at this
    # same server install, idempotently (a no-op once already rewritten).
    node -e "
      const fs = require('fs');
      const p = JSON.parse(fs.readFileSync('$pj', 'utf-8'));
      const want = 'link:/opt/callback/callback-box';
      if (p.dependencies && p.dependencies['callback-box'] !== want) {
        p.dependencies['callback-box'] = want;
        fs.writeFileSync('$pj', JSON.stringify(p, null, 2) + '\n');
      }
    "

    marker="$box/node_modules/react"
    if [[ ! -e "$marker" || "$pj" -nt "$marker" ]]; then
      echo "  $name: installing (package.json newer than last install, or never installed)..."
      if ! sudo -u callback -H bash -lc "cd '$box' && pnpm install"; then
        echo "  $name: pnpm install exited nonzero — check for real dependency errors above" \
             "(a lone EPERM on .bin linking is a known-harmless pnpm quirk, everything else isn't)"
      fi
    fi
  done
REMOTE

# Deploy installs are what grow both caches. Prune only after the root workspace
# and callback-owned box installs have finished, so this cannot evict entries a
# later install in the same deploy still needs. Start callback-user cleanup in
# its home so upward config discovery cannot reach /root/uv.toml; `-H`
# separately gives HOME-based tools the callback user's home.
echo "Pruning deploy package caches..."
ssh "root@$SERVER_IP" bash -s <<'CACHECLEAN'
set -euo pipefail
pnpm store prune
sudo -u callback -H bash -lc 'cd /home/callback && pnpm store prune'
if sudo -u callback -H bash -lc 'command -v uv >/dev/null 2>&1'; then
  sudo -u callback -H bash -lc 'cd /home/callback && uv cache clean'
fi
CACHECLEAN

# Write deploy info (git hashes + timestamp).
# Build the JSON via node so JSON.stringify escapes subjects correctly —
# commit subjects can contain quotes, backslashes, etc. that break naive
# shell interpolation. Values come through env vars to avoid any shell
# expansion in the node script body. Hash + subject are read from the BUILD
# CHECKOUT at the resolved sha, so the recorded hash is exactly what shipped;
# requestedRef records the raw ref so a rollback is recognizable in history.
echo "Writing deploy info..."
DEPLOYED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
CALLBACK_BOX_HASH=$(git -C "$CHECKOUT" rev-parse --short "$SHA")
CALLBACK_BOX_SUBJECT=$(git -C "$CHECKOUT" log -1 --format=%s "$SHA")
DEPLOY_INFO=$(DEPLOYED_AT="$DEPLOYED_AT" REQUESTED_REF="$RAW_REF" \
  CALLBACK_BOX_HASH="$CALLBACK_BOX_HASH" CALLBACK_BOX_SUBJECT="$CALLBACK_BOX_SUBJECT" \
  node -e '
const out = { deployedAt: process.env.DEPLOYED_AT, requestedRef: process.env.REQUESTED_REF, commits: {} };
if (process.env.CALLBACK_BOX_HASH) {
  out.commits["callback-box"] = { hash: process.env.CALLBACK_BOX_HASH, subject: process.env.CALLBACK_BOX_SUBJECT };
}
process.stdout.write(JSON.stringify(out, null, 2) + "\n");
')
# INSTALL_DIR is the locally configured remote deployment path.
# shellcheck disable=SC2029
ssh "root@$SERVER_IP" "cat > $INSTALL_DIR/callback-box/deploy-info.json" <<< "$DEPLOY_INFO"

# Append to deploy history (keep last 20 entries)
# INSTALL_DIR is intentionally interpolated locally; remote variables are escaped below.
# shellcheck disable=SC2087
ssh "root@$SERVER_IP" bash -s <<HISTEOF
  HIST_FILE="$INSTALL_DIR/callback-box/deploy-history.json"
  if [[ -f "\$HIST_FILE" ]]; then
    # Prepend new entry, keep last 20
    node -e "
      const fs = require('fs');
      const hist = JSON.parse(fs.readFileSync('\$HIST_FILE', 'utf-8'));
      const entry = JSON.parse(fs.readFileSync('$INSTALL_DIR/callback-box/deploy-info.json', 'utf-8'));
      hist.unshift(entry);
      fs.writeFileSync('\$HIST_FILE', JSON.stringify(hist.slice(0, 20), null, 2));
    "
  else
    node -e "
      const fs = require('fs');
      const entry = JSON.parse(fs.readFileSync('$INSTALL_DIR/callback-box/deploy-info.json', 'utf-8'));
      fs.writeFileSync('\$HIST_FILE', JSON.stringify([entry], null, 2));
    "
  fi
HISTEOF

# Restart services
if [[ "$SKIP_RESTART" != true ]]; then
  # Give an active chat turn / running script a bounded chance to finish before
  # we restart, so a deploy doesn't kill active work — and specifically doesn't
  # interrupt a `git commit`, which is how a box ends up with a
  # `.git/index.lock` nothing owns (`src/lib/git-stale-lock.ts`).
  #
  # Installed from the tree we just synced rather than trusted to be on the
  # server already. It used to exist only as a heredoc in setup-server.sh, so a
  # server provisioned before it was added had NO copy and every deploy skipped
  # the wait entirely — silently, because the skip was best-effort.
  # INSTALL_DIR is the locally configured remote deployment path.
  # shellcheck disable=SC2029
  ssh "root@$SERVER_IP" "install -m 0755 $INSTALL_DIR/callback-box/deploy/server-bin/cb-wait-quiet /usr/local/bin/cb-wait-quiet"

  echo "Waiting for boxes to be at rest (best-effort)..."
  ssh "root@$SERVER_IP" /usr/local/bin/cb-wait-quiet

  # Converge each box onto the code that just shipped, in the at-rest window —
  # after cb-wait-quiet, before the restart brings box children back up. A box
  # whose migrations are current prints nothing; anything else prints one line
  # and the deploy continues. This never fails the deploy: a box that needs a
  # human (dirty tree, agent-driven migration, hard failure) is a box to look
  # at, not a reason to abandon a shipped release. Two steps per box, in order:
  # `cb migrate --sweep` (data shape) then `cb docs refresh` (generated
  # guidance). They own their own policy — see src/core/migration-sweep.ts and
  # src/core/docs-refresh.ts.
  echo "Converging boxes (migrations, generated docs)..."
  ssh "root@$SERVER_IP" bash -s <<'REMOTE'
    for boxdir in /home/callback/boxes/*/; do
      name=$(basename "$boxdir")
      box="$boxdir/content"
      # A box with no content/ is not a v2 package. Say so rather than skipping
      # in silence — an unmigratable box is exactly what this step exists to
      # surface, and `cb migrate` treats a manifest-less box as a human decision.
      if [[ ! -d "$box" ]]; then
        echo "  $name: no content/ — not a v2 box, skipped"
        continue
      fi
      # The path is passed as an ARGUMENT to `bash -lc`, never interpolated into
      # the shell source it runs: a box directory name containing a quote would
      # otherwise break — or escape — that string.
      # `timeout` sits directly around `cb`, inside the login shell, because
      # this runs BEFORE the restart and health verification: a migrator that
      # hangs would wedge the whole deploy in the at-rest window rather than
      # just failing one box.
      out=$(sudo -u callback -H bash -lc \
              'set -a; source /home/callback/.env 2>/dev/null; set +a; cd "$1" && timeout 600 cb migrate --sweep' \
              cb-sweep "$box" 2>&1)
      code=$?
      [[ $code -eq 124 ]] && out="${out}"$'\n'"timed out after 600s — migrations left pending, retried next deploy"
      [[ -n "$out" ]] && echo "$out" | sed "s/^/  $name: /"

      # Converge the box's GENERATED guidance the same way — agent docs, card
      # rules, managed skills. Regeneration is otherwise activity-gated (a
      # reactor cycle or a chat session start runs it), so a box nobody talks
      # to keeps the previous engine's docs indefinitely. Runs after the sweep
      # so it sees the tree the sweep left committed. Same shape as above:
      # cache-gated (silent when current), skips a dirty box, never fails the
      # deploy. Policy: src/core/docs-refresh.ts.
      #
      # Deliberately NOT gated on the sweep's exit code. Generated docs describe
      # the engine that just shipped, and any chat or wakeup on that box would
      # regenerate them anyway — so withholding the refresh from a box that
      # needs a human for its migrations buys nothing and leaves that box on
      # older guidance than every box someone happens to talk to.
      out=$(sudo -u callback -H bash -lc \
              'set -a; source /home/callback/.env 2>/dev/null; set +a; cd "$1" && timeout 600 cb docs refresh' \
              cb-docs-refresh "$box" 2>&1)
      code=$?
      [[ $code -eq 124 ]] && out="${out}"$'\n'"timed out after 600s — generated docs left stale, retried next deploy"
      [[ -n "$out" ]] && echo "$out" | sed "s/^/  $name: /"
    done
    # Always succeed: `set -euo pipefail` in the outer script would otherwise
    # abandon a shipped release because one box wants a human.
    exit 0
REMOTE

  # Reconfirm the systemd drop-ins before restarting.
  #
  # The units themselves are NOT regenerated by this script (setup-server.sh
  # owns them, and it still emits the pre-hub shape — see deploy/README.md's
  # "Known gap"), so a setting the running code depends on would otherwise have
  # to be installed by hand once and then silently drift. The drop-in directory
  # is the seam that lets a deploy own such a setting without owning the unit:
  # anything in deploy/systemd/ is reinstalled on every deploy, and the file
  # itself documents what it is for.
  #
  # daemon-reload only when something actually changed, so an unchanged deploy
  # stays quiet. The restart below then picks up whatever was reloaded.
  echo "Reconfirming systemd drop-ins..."
  ssh "root@$SERVER_IP" bash -s "$INSTALL_DIR" <<'REMOTE'
set -euo pipefail
install_dir="$1"
changed=0
for unit in callback-hub callback-scheduler; do
  dir="/etc/systemd/system/$unit.service.d"
  mkdir -p "$dir"
  for src in "$install_dir"/callback-box/deploy/systemd/*.conf; do
    [[ -e "$src" ]] || continue
    dest="$dir/$(basename "$src")"
    if ! cmp -s "$src" "$dest"; then
      install -m 0644 "$src" "$dest"
      echo "  $unit: installed $(basename "$src")"
      changed=1
    fi
  done
done
if [[ $changed -eq 1 ]]; then
  systemctl daemon-reload
  echo "  daemon-reload done"
fi
REMOTE

  echo "Restarting services..."
  ssh "root@$SERVER_IP" 'systemctl restart callback-hub callback-scheduler && echo "Services restarted"'

  # Verify the deploy at two depths, on the server (localhost + local key):
  #   1. Hub /healthz returns a verdict of "ok" — the hub is up AND no box is
  #      crash-looping. The hub blocks on startAll() before it listens, and a
  #      failing box launch blocks ~30s on its readiness timeout, so the hub
  #      genuinely may not answer for ~30s+ precisely when a box is broken —
  #      hence the 180s window (the old 30s raced the cold boot and reported a
  #      false failure during the 2026-07-16 ABI incident). A body of
  #      status:"unhealthy" is a HARD fail, not something to keep polling.
  #   2. /healthz/canary cold-starts ONE real box and confirms it serves — a
  #      child-level check the passive verdict can't give on a lazy hub where
  #      most boxes rest "stopped". A fleet-wide startup break (e.g. a native-
  #      module ABI mismatch) makes this 503. Parsed with node (jq isn't on the
  #      server); the box slug + error land in the log on failure.
  # Verify the runtime tools the box shells out to are actually installed.
  # These are declared in setup-server.sh, but a box provisioned before a tool
  # was added silently 503s the upload/processing path that needs it (qpdf → PDF
  # scan uploads; poppler pdfinfo/pdftoppm → PDF intake; pandoc → doc convert;
  # imagemagick convert → image ops; openpyxl/xlsx2csv → spreadsheet reads;
  # ffmpeg → audio transcode/concat (capture voice); git-annex/git-lfs →
  # assets) until someone hits it in the wild. Catch a
  # "declared but not installed on this older box" gap at deploy, not at first use.
  echo "Verifying required external tools..."
  ssh "root@$SERVER_IP" bash -s <<'TOOLCHECK'
    set -uo pipefail
    missing=""
    for t in qpdf pdfinfo pdftoppm pandoc convert xlsx2csv ffmpeg git git-lfs git-annex; do
      command -v "$t" >/dev/null 2>&1 || missing="$missing $t"
    done
    python3 -c "import openpyxl" >/dev/null 2>&1 || missing="$missing python3-openpyxl"
    if [ -n "$missing" ]; then
      echo "  FAILED: required runtime tools missing on the server:$missing"
      echo "  Fix: re-run deploy/setup-server.sh on the server (or apt-get install the"
      echo "  missing packages), then redeploy. See setup-server.sh for the package list."
      exit 1
    fi
    echo "  Required tools present."
TOOLCHECK

  echo "Verifying hub health + box canary..."
  ssh "root@$SERVER_IP" bash -s "$INSTALL_DIR" <<'HEALTHCHECK'
    set -euo pipefail
    install_dir="$1"
    KEY=$(grep -E '^CB_DIAG_API_KEY=' /home/callback/.env 2>/dev/null | cut -d= -f2- || true)
    # Fail closed: a deploy that can't verify anything must not report success
    # (the whole point of this check). If a server legitimately has no key,
    # set CB_DIAG_API_KEY in /home/callback/.env — the hub needs it to gate
    # /healthz anyway.
    if [ -z "$KEY" ]; then
      echo "  FAILED: CB_DIAG_API_KEY not set in /home/callback/.env — cannot verify the deploy."
      exit 1
    fi

    # curl caps: --connect-timeout bounds the per-attempt TCP connect so a
    # still-booting hub (000) is retried rather than blocking; --max-time
    # bounds a hub that accepts the connection but never responds (which
    # neither the loop nor `set -e` would otherwise interrupt — the advertised
    # 180s only bounds wall-clock if each attempt is itself bounded).
    CURL="curl -s --connect-timeout 5 --max-time 30"

    # (1) Poll /healthz for up to ~180s for a verdict, then judge it. A 503
    # with verdict "unhealthy" is a hard fail; only 200 + "ok" passes.
    verdict=""
    code=""
    for i in $(seq 1 180); do
      code=$($CURL -o /tmp/healthz.out -w '%{http_code}' \
        -H "Authorization: Bearer $KEY" \
        http://localhost:3210/healthz 2>/dev/null || echo "000")
      # 200 (ok) or 503 (unhealthy) both mean the hub answered with a verdict;
      # a connection failure (000) means it's still booting — keep polling.
      if [ "$code" = "200" ] || [ "$code" = "503" ]; then
        verdict=$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync("/tmp/healthz.out","utf8")).status)' 2>/dev/null || echo "unparseable")
        break
      fi
      sleep 1
    done
    if [ "$code" != "200" ] || [ "$verdict" != "ok" ]; then
      echo "  Hub healthz FAILED (verdict: ${verdict:-no-response}, last code: ${code:-000})"
      [ -f /tmp/healthz.out ] && cat /tmp/healthz.out
      rm -f /tmp/healthz.out
      exit 1
    fi
    echo "  Hub healthz OK: $(cat /tmp/healthz.out)"
    rm -f /tmp/healthz.out

    # (2) Canary: actively cold-start one box and confirm it answers its own
    # /healthz 200 (the route fetches the box's healthz server-side). Require
    # BOTH HTTP 200 and body status:"ok".
    ccode=$($CURL -o /tmp/canary.out -w '%{http_code}' \
      -H "Authorization: Bearer $KEY" \
      http://localhost:3210/healthz/canary 2>/dev/null || echo "000")
    cstatus=$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync("/tmp/canary.out","utf8")).status)' 2>/dev/null || echo "unparseable")
    if [ "$ccode" != "200" ] || [ "$cstatus" != "ok" ]; then
      echo "  Box canary FAILED (code: $ccode, status: $cstatus) — a box could not start and serve:"
      [ -f /tmp/canary.out ] && cat /tmp/canary.out
      # The canary body names the slug but not why (launch() records the error
      # on the box, not on the returned failure). Re-fetch /healthz — it now
      # reflects the just-attempted box's status + lastError.
      echo "  Current /healthz:"
      $CURL -H "Authorization: Bearer $KEY" http://localhost:3210/healthz 2>/dev/null || true
      echo
      rm -f /tmp/canary.out
      exit 1
    fi
    echo "  Box canary OK: $(cat /tmp/canary.out)"
    rm -f /tmp/canary.out

    # (3) SPA fallback: the frontend build has to be ON the server.
    # `registerSpaFallback` is installed ONLY when src/frontend/dist/index.html
    # exists (callback-box/src/webapp/server.ts) — without it every page
    # navigation 404s while /healthz and the canary above both stay green. That
    # is the 2026-08-25 escape verbatim
    # (issues/exploration/2026-08-26-post-test-economics-retro.md, incident 3),
    # and it is the half of the smoke tier the local dev-router walk
    # structurally cannot see: in dev, page requests are served by vite and
    # never reach this handler.
    #
    # This asserts the file rather than probing a URL on purpose. An
    # unauthenticated page navigation is redirected to login by the HUB before
    # it ever reaches the child (hub-server.ts's `/*` gate), so a URL probe
    # answers 302 whether or not the child has a fallback — a check that cannot
    # fail for the right reason. The file IS the condition the code branches on.
    spa_index="$install_dir/callback-box/src/frontend/dist/index.html"
    if [ ! -s "$spa_index" ]; then
      echo "  SPA fallback FAILED: $spa_index is missing or empty."
      echo "  Every page navigation on this server will 404 — the frontend build"
      echo "  did not ship. /healthz and the box canary cannot see this."
      exit 1
    fi
    echo "  SPA fallback OK: frontend build present ($(wc -c < "$spa_index") bytes)"
HEALTHCHECK
fi

echo "Deploy complete."
# Truthful "what is actually live" marker, written ONLY here — past the upload,
# the restart, and the health verification. Nothing else in this script is a
# safe proxy: `.deploy-last-sha` is written right after `pnpm install` (it is a
# node_modules cache key, not a success record), so a run that dies during the
# build or the upload leaves it claiming a sha that never shipped.
#
# Why it exists: a deploy killed outright (OOM, terminal closed) never runs the
# EXIT trap, so it prints no "Deploy failed", sends no notification, and leaves
# main silently undeployed — observed 2026-08-10, caught only because someone
# happened to ask. `bin/doctor.ts` compares this against main's HEAD so the
# gap becomes visible instead of waiting for the next question.
echo "$SHA" > "$SCRIPT_DIR/.last-deployed-sha"
# Show what shipped (hash + commit subject) rather than the — frankly boring —
# server IP. Both vars are computed above for deploy-info.json.
notify "🚀 callback-box deployed" "$CALLBACK_BOX_HASH $CALLBACK_BOX_SUBJECT"
echo "Verify externally: curl -H \"Authorization: Bearer \$CB_DIAG_API_KEY\" https://box.example.com/healthz"

# --- Chain to a newer request (latest-wins, second half) ----------------------
# If a deploy was requested while this one ran, its invocation exited early
# (shlock held) trusting us to pick it up. Release the lock and re-exec in
# --chained mode (which re-reads .deploy-requested itself rather than trusting
# the sha we read here — see the stamping comment above). Ordering matters:
# release BEFORE the re-check, so a request that lands in the gap either gets
# seen by our re-check or finds the lock free and runs itself — no window where
# a request is silently dropped. --skip-restart is deliberately not propagated:
# the chained request came from a hook wanting a full deploy. (exec does not
# fire the EXIT trap, hence the manual release.)
rm -f "$LOCK_FILE"
LOCK_HELD=""
NEWREQ="$(cat "$REQUESTED_FILE" 2>/dev/null || true)"
if [ -n "$NEWREQ" ] && [ "$NEWREQ" != "$SHA" ]; then
  echo "A newer deploy ($NEWREQ) was requested during this run — chaining."
  if [ -t 1 ]; then
    exec "$0" --ref "$NEWREQ" --chained
  else
    # Backgrounded (hook) case: our stdout is run N's per-run log, but anyone
    # polling follows the .last-deploy.log symlink, which the newer request's
    # hook already repointed at ITS log. Send the chained run's output through
    # the symlink so "Deploy complete/failed" lands in the log being watched.
    exec "$0" --ref "$NEWREQ" --chained >>"$SCRIPT_DIR/.last-deploy.log" 2>&1
  fi
fi
