#!/usr/bin/env bash
# Worktree creation. SOURCE this file; don't execute it.
#
#   . "<repo>/bin/lib/worktree-create.sh"
#   wt_create <name> <base_ref>       # path on stdout, logs on stderr
#
# This is the repo's ONE implementation of "make a worktree ready to work in".
# It lived in .claude/hooks/worktree-create.sh until 2026-08, which made it look
# like Claude Code's property: Codex had to synthesize hook JSON and pipe it into
# a file under .claude/ to reach the repo's own worktree logic, and any third
# frontend would have had to do the same. Now every frontend is a thin client of
# `bin/workstreams create`, and .claude/hooks/worktree-create.sh is a ~15-line
# adapter that translates hook JSON into these two arguments.
#
# What it does beyond `git worktree add`:
#   - OVERRIDES the worktree location to WT_ROOT/<name> (bin/lib/worktree-paths.sh).
#     Claude Code would default to <repo>/.claude/worktrees/<name>/. Reason:
#     callback-box has a file: dep on personal-vibe-check at
#     file:../personal-vibe-check, and that relative path only resolves when the
#     worktree is a SIBLING of the monorepo root (same depth as main checkout).
#   - clones WT_BOX_SRC to WT_BOX_ROOT/<name>/test1/
#     (URL slug = basename = "test1" for every worktree, so links like
#     /<wt>/test1/... swap cleanly across worktrees — true whether the clone
#     is a legacy box or a v2 package, see box-entry.ts)
#     (kept outside the monorepo so the box doesn't inherit monorepo CLAUDE.md)
#   - for a v2 (package-layout) clone, points its "callback-box" dependency
#     at THIS worktree's own engine checkout (pnpm.overrides link:) and
#     installs the box's own node_modules — see Track G in
#     docs/implemented-plans/boxes-as-packages-v2.md. Legacy clones are untouched.
#   - runs pnpm install at the worktree root (root husky), callback-box, and
#     callback-box/src/frontend. After this the worktree is ready for the
#     dev router to serve.
#
# The dev router lazy-spawns Vite + Fastify per worktree on first request, so
# we don't start any dev server here. Ports are also allocated dynamically by
# the router — no need to write a .env file with FRONTEND_PORT/BACKEND_PORT.
# A .env file is still respected by the router if you create one (BOXES line
# overrides the default WT_BOX_ROOT/<name>/test1/), but not required.
#
# Idempotent: an already-registered worktree takes the resume branch, which
# re-mounts private-issues and regenerates the Codex mirrors and returns.

# shellcheck source=worktree-paths.sh
. "$(dirname "${BASH_SOURCE[0]}")/worktree-paths.sh"

# The private-issues shadow-repo mount (bin/private-issues). Runs on BOTH the
# fresh-create and resume paths (a resume must self-heal a missing mount).
# Soft dependency: without an initialized private repo it logs one line and
# does nothing. Never blocks worktree creation (|| true) — a broken private
# mount means the session runs without private issues, not no session.
wt_create_mount_private_issues() {
  local pi="$1/bin/private-issues"
  [ -x "$pi" ] || pi="$WT_MONO/bin/private-issues"
  [ -x "$pi" ] || return 0
  "$pi" mount "$1" >/dev/null || true
}

# Regenerate the gitignored AGENTS.md and .agents/skills mirrors (Codex CLI
# reads AGENTS.md where Claude reads CLAUDE.md/rules and scans .agents/skills —
# see bin/generate-agents-md.ts). Runs on BOTH the fresh and resume paths: a
# resume must refresh mirrors against whatever Claude docs and skills now say,
# and skipping it would leave a hand-launched `codex` in a resumed worktree on
# stale guidance. tsx lives at the worktree ROOT node_modules (hoisted
# workspace — callback-box/node_modules/.bin has no tsx). Non-blocking: a
# Claude session doesn't need the mirrors, and the codex launcher path
# re-verifies the root AGENTS.md exists before exec'ing codex.
wt_create_generate_agents_md() {
  local wt="$1" name="$2" tsx="$1/node_modules/.bin/tsx"
  if [ -x "$tsx" ]; then
    "$tsx" "$wt/bin/generate-agents-md.ts" --worktree-name "$name" "$wt" \
      || echo "[worktree-create] WARNING: generate-agents-md failed; codex sessions will lack mirrors" >&2
  else
    echo "[worktree-create] WARNING: no tsx at $tsx; skipping Codex mirror generation" >&2
  fi
}

wt_create_restore_box_ref() {
  local box_dest="$1" box_ref="$2"
  [ -n "$box_ref" ] || return 0
  git -C "$box_dest" fetch --quiet origin "$box_ref" || return 1
  git -C "$box_dest" checkout -q main || return 1
  git -C "$box_dest" reset --hard FETCH_HEAD >&2
}

# wt_create <name> <base_ref> [<worktree_path>]
#
# Prints nothing on stdout — the caller owns stdout, and reads the resulting
# path from WT_CREATED_PATH. All progress goes to stderr.
wt_create() {
  local NAME="$1" base_ref="$2" worktree_path="${3:-}" box_ref="${4:-}"

  wt_paths_init || return 1
  # Same rule as removal: a name becomes a path, and a name with a slash in it
  # would put the worktree (and its branch) somewhere nothing else can find or
  # clean up. Matches what bin/launch-worktree-session already enforces.
  if ! wt_paths_valid_name "$NAME"; then
    echo "[worktree-create] FATAL: '$NAME' is not a worktree name ([a-zA-Z0-9_-]+, no slashes)" >&2
    return 1
  fi
  if [ "$NAME" = "unattached" ] || [ "$NAME" = "unknown" ]; then
    echo "[worktree-create] FATAL: '$NAME' is reserved for frontmatter provenance" >&2
    return 1
  fi

  local new_branch="worktree-$NAME"
  [ -n "$worktree_path" ] || worktree_path="$WT_ROOT/$NAME"
  local BOX_SRC="$WT_BOX_SRC"
  local BOX_DEST="$WT_BOX_ROOT/$NAME/test1"
  WT_CREATED_PATH="$worktree_path"

  # Shared append-only lifecycle log (see session-end.sh for rationale) — the
  # create end of the lifecycle, so a lingering worktree can be traced back to
  # when/how it was made vs. when its session-end fired.
  local wlog_file="$WT_STATE_DIR/worktree-cleanup.log"
  mkdir -p "$WT_STATE_DIR"
  wt_create_log() {
    printf '%s pid=%s WorktreeCreate %s\n' \
      "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$$" "$*" >> "$wlog_file" 2>/dev/null || true
  }

  echo "[worktree-create] name=$NAME base=$base_ref path=$worktree_path" >&2
  wt_create_log "event: name=$NAME base=$base_ref path=$worktree_path"

  # 1. Create (or re-attach to) the worktree.
  mkdir -p "$(dirname "$worktree_path")"
  if git -C "$WT_MONO" worktree list --porcelain | grep -qxF "worktree $worktree_path"; then
    echo "[worktree-create] worktree already registered at $worktree_path — resume, skipping setup" >&2
    wt_create_log "resume: existing worktree reused name=$NAME"
    wt_create_mount_private_issues "$worktree_path"
    wt_create_generate_agents_md "$worktree_path" "$NAME"
    return 0
  elif git -C "$WT_MONO" show-ref --verify --quiet "refs/heads/$new_branch"; then
    echo "[worktree-create] branch $new_branch already exists — attaching without -b" >&2
    git -C "$WT_MONO" worktree add "$worktree_path" "$new_branch" >&2
  else
    git -C "$WT_MONO" worktree add -b "$new_branch" "$worktree_path" "$base_ref" >&2
  fi

  wt_create_mount_private_issues "$worktree_path"

  # 2. Clone the test box if it doesn't already exist (idempotent).
  #
  # BOX_DEST is either a legacy box (content lives at its root) or a v2
  # package (content lives at BOX_DEST/content — see "The box repository" in
  # docs/implemented-plans/boxes-as-packages-v2.md). Either way its basename stays
  # "test1", so the URL slug matches across worktrees (bin/box-entry.ts
  # derives the v2 slug from the PACKAGE root's basename for exactly this
  # reason — confirmed against this clone layout).
  mkdir -p "$(dirname "$BOX_DEST")"
  if [ ! -d "$BOX_DEST" ]; then
    if [ -d "$BOX_SRC" ]; then
      echo "[worktree-create] cloning $BOX_SRC -> $BOX_DEST" >&2
      git clone --quiet "$BOX_SRC" "$BOX_DEST"
      wt_create_restore_box_ref "$BOX_DEST" "$box_ref"

      local box_content_dir="$BOX_DEST"
      [ -d "$BOX_DEST/content" ] && box_content_dir="$BOX_DEST/content"

      # Carry over gitignored connector secrets (deepgram, gmail, google,
      # dropbox, etc.). The source box gitignores config/connectors/*.secret.*
      # so git clone leaves them behind, breaking transcription and external
      # syncs in the worktree until the user manually copies them. config/
      # lives under content/ for a v2 box, at the root for legacy.
      local box_src_content_dir="$BOX_SRC"
      [ -d "$BOX_SRC/content" ] && box_src_content_dir="$BOX_SRC/content"
      if [ -d "$box_src_content_dir/config/connectors" ]; then
        mkdir -p "$box_content_dir/config/connectors"
        local copied=0 f
        for f in "$box_src_content_dir"/config/connectors/*.secret.*; do
          [ -e "$f" ] || continue
          cp "$f" "$box_content_dir/config/connectors/"
          copied=$((copied + 1))
        done
        if [ "$copied" -gt 0 ]; then
          echo "[worktree-create] copied $copied connector secret(s) from source box" >&2
        fi
      fi

      # Fetch asset content from the source box via git-annex.
      #
      # A clone gets every asset's pointer but none of its bytes, so without this
      # every image in the worktree's UI renders as alt text and image work is
      # untestable against the worktree box. This replaces a cp loop over
      # `ls-files --others --ignored` that predates git-annex (assets used to be
      # gitignored with a manifest.json alongside them); `git annex get` is
      # strictly better — it verifies content against its key and works even
      # when the source box has content the destination should not fetch.
      #
      # The `annex merge` in the SOURCE is not optional. git-annex buffers
      # location writes in .git/annex/journal until something folds them into the
      # git-annex branch; a clone taken before that flush reports "0 copies" and
      # `git annex get` fails with "No other repository is known to contain the
      # file" — verified. Flushing the source, then syncing the clone, is what
      # makes the fetch possible at all.
      if command -v git-annex >/dev/null 2>&1 && git -C "$BOX_SRC" annex info --fast >/dev/null 2>&1; then
        git -C "$BOX_SRC" annex merge >/dev/null 2>&1 || true
        git -C "$BOX_DEST" annex init "worktree-$NAME" >/dev/null 2>&1 || true
        # annex.thin does NOT propagate to clones — it's plain git config — and
        # thin mode silently disables fsck's corruption detection. Set it here so
        # a fresh worktree box starts correct rather than waiting for the doctor.
        git -C "$BOX_DEST" config annex.thin false
        git -C "$BOX_DEST" annex sync >/dev/null 2>&1 || true
        if git -C "$BOX_DEST" annex get . >/dev/null 2>&1; then
          echo "[worktree-create] fetched asset content via git-annex" >&2
        else
          echo "[worktree-create] WARNING: git annex get failed; images will render as alt text" >&2
        fi
      elif command -v git-annex >/dev/null 2>&1; then
        echo "[worktree-create] source box is not annexed; skipping asset fetch" >&2
      else
        echo "[worktree-create] WARNING: git-annex not installed; worktree box has no asset content" >&2
      fi

      # v2 (package-layout) box: redirect its "callback-box" dependency at
      # THIS worktree's own callback-box checkout via a pnpm.overrides
      # `link:` entry — a live symlink that never installs the target's own
      # deps, revertible without touching `dependencies` (see "Prior art" /
      # Track G in docs/implemented-plans/boxes-as-packages-v2.md). Without this the
      # clone would resolve callback-box from whatever the box's lockfile
      # pins — never this worktree's in-progress engine code, defeating the
      # whole point of a worktree. Legacy clones have no package.json here
      # and are left untouched.
      if [ -f "$BOX_DEST/package.json" ] && jq -e '(.dependencies["callback-box"] // .devDependencies["callback-box"]) != null' "$BOX_DEST/package.json" >/dev/null; then
        echo "[worktree-create] v2 box detected — pointing callback-box at $worktree_path/callback-box" >&2
        local tmp_pkg
        tmp_pkg=$(mktemp)
        jq --arg link "link:$worktree_path/callback-box" '.pnpm.overrides["callback-box"] = $link' \
          "$BOX_DEST/package.json" > "$tmp_pkg"
        mv "$tmp_pkg" "$BOX_DEST/package.json"
        echo "[worktree-create] running pnpm install in $BOX_DEST..." >&2
        (cd "$BOX_DEST" && pnpm install >&2)
      fi
    else
      echo "[worktree-create] warning: $BOX_SRC not found; router will fall back to defaults" >&2
    fi
  else
    echo "[worktree-create] reusing existing box $BOX_DEST" >&2
  fi

  # 2.5. Copy the main checkout's callback-box/.env, if it has one.
  #
  # `.env` is gitignored, so a fresh worktree gets none — and the router loads
  # each checkout's OWN .env into the dev processes it spawns (bin/router-core.ts),
  # so without this copy a worktree runs with none of the local dev config the
  # main checkout has (CB_BROWSE_API_KEY, a BOXES override). Copying keeps the
  # rule uniform — every checkout reads its own file, nothing reaches across
  # into another checkout at runtime. Copy, not symlink: a worktree is free to
  # diverge (point at a different box, use a different key) without editing the
  # file every other checkout reads.
  # BOXES is dropped, NOT copied. It is the one line in that file that is
  # inherently per-checkout: the main checkout's points at the real boxes, and a
  # worktree that inherited it would silently serve those instead of the
  # isolated clone made above, which is the whole point of a worktree. Omitting
  # the line makes the router fall back to WT_BOX_ROOT/<name>/test1
  # (bin/router.ts `boxes ?? [...]`), which is exactly right. Add a BOXES line to
  # the worktree's own .env to override.
  local main_env="$WT_MONO/callback-box/.env"
  if [ -f "$main_env" ]; then
    grep -v '^BOXES=' "$main_env" > "$worktree_path/callback-box/.env"
    echo "[worktree-create] copied callback-box/.env from the main checkout (minus BOXES)" >&2
  else
    echo "[worktree-create] no callback-box/.env in the main checkout — skipping" >&2
  fi

  # 3. pnpm install. ONE workspace install at the root — never per-subpackage.
  # Under pnpm workspaces with node-linker=hoisted, running `pnpm install`
  # inside a subpackage walks up to the workspace root anyway, but in
  # practice it also seems to wipe the root lockfile in some cases, leaving
  # the worktree with node_modules/ populated but node_modules/.bin/ empty
  # (which then breaks bin/browse, bin/cb, etc.). Same shape as what
  # deploy/deploy.sh does on the server.
  echo "[worktree-create] running pnpm install (workspace-wide)..." >&2
  (cd "$worktree_path" && pnpm install >&2)

  # 3.5. AGENTS.md and skill mirrors for Codex sessions (see above — this needs
  # the install for tsx).
  wt_create_generate_agents_md "$worktree_path" "$NAME"

  # 4. Write .claude/settings.local.json so the agent's shell sees the worktree's
  # own cb on PATH. Per-worktree because each worktree has its own absolute
  # callback-box/bin path. Claude Code's env block doesn't substitute ${PATH},
  # so we have to expand it at write time. settings.local.json is gitignored.
  echo "[worktree-create] writing .claude/settings.local.json with PATH override..." >&2
  mkdir -p "$worktree_path/.claude"
  cat > "$worktree_path/.claude/settings.local.json" <<EOF
{
  "env": {
    "PATH": "$worktree_path/callback-box/bin:$PATH"
  }
}
EOF

  # 5. Refresh box hooks: the cloned box's .git/hooks/pre-commit and
  # .claude/settings.json have the source box's cb path baked in (often the
  # pre-migration path). Re-run cb init against the cloned box from the
  # WORKTREE's cb so its hooks point at the worktree's cb.
  # Idempotent (cb init is "initialize or update").
  if [ -d "$BOX_DEST" ]; then
    echo "[worktree-create] refreshing box hooks (worktree's cb -> $BOX_DEST)..." >&2
    # CB_HOOK_BIN: without it, resolveCbBin() detects it's running from a linked
    # worktree and rebases the hook's embedded cb path back onto the MAIN
    # checkout, defeating this refresh (a stale main cb then rejects cards using
    # in-flight schema changes; see
    # issues/closed/bugs/2026-07-10-box-hook-stale-cross-checkout-cb.md).
    CB_HOOK_BIN="$worktree_path/callback-box/bin/cb" \
      "$worktree_path/callback-box/bin/cb" init "$BOX_DEST" >/dev/null
  fi

  echo "[worktree-create] done. open http://localhost:3210/$NAME/ when the router is running" >&2
  return 0
}
