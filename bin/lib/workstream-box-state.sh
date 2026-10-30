#!/usr/bin/env bash
# Read-only test1 clone state for workstream listing and cull eligibility.

# The commit message prefix that identifies the setup commit; it has no ref.
WORKSTREAM_SETUP_COMMIT_GREP='^Worktree setup: link the beebox engine to worktree '

# Succeeds when everything on the clone's keep tip is already in the source
# box's main, ignoring the clone's worktree-setup commit (bin/lib/worktree-create.sh
# step 6), which never reaches the source. Each other commit must be an ancestor
# of main or patch-equivalent to a commit on it (git cherry), so a keep that
# holds only the setup commit counts as merged. Read-only: the clone reads the
# source's objects through an alternate object directory instead of fetching.
# The setup commit is found by message prefix.
workstream_keep_merged() {
  local clone="$1" source="$2" keep_sha="$3" main_sha setup_sha objects pending
  [ -n "$keep_sha" ] || return 1
  main_sha=$(git -C "$source" rev-parse --verify -q refs/heads/main) || return 1
  objects=$(git -C "$source" rev-parse --path-format=absolute --git-path objects) || return 1
  setup_sha=$(git -C "$clone" log --format=%H -n 1 --grep="$WORKSTREAM_SETUP_COMMIT_GREP" "$keep_sha" 2>/dev/null || true)
  pending=$(cd "$clone" && GIT_ALTERNATE_OBJECT_DIRECTORIES="$objects" git cherry "$main_sha" "$keep_sha" 2>/dev/null) || return 1
  ! printf '%s\n' "$pending" | awk -v setup="$setup_sha" '$1 == "+" && $2 != setup { found = 1 } END { exit(found ? 0 : 1) }'
}

workstream_box_state() {
  local clone="$1" source="$2" test_setup=false keep_unmerged=false pristine=null
  local main_sha="" setup_sha="" keep_sha=""
  if [ -d "$clone/.git" ] || git -C "$clone" rev-parse --git-dir >/dev/null 2>&1; then
    if git -C "$clone" show-ref --verify --quiet refs/heads/test-setup; then
      test_setup=true
      main_sha=$(git -C "$clone" rev-parse refs/heads/main 2>/dev/null || true)
      setup_sha=$(git -C "$clone" rev-parse refs/heads/test-setup 2>/dev/null || true)
      pristine=false
      [ -n "$main_sha" ] && [ "$main_sha" = "$setup_sha" ] && pristine=true
    fi
    if git -C "$clone" show-ref --verify --quiet refs/heads/keep; then
      keep_sha=$(git -C "$clone" rev-parse refs/heads/keep 2>/dev/null || true)
      if ! workstream_keep_merged "$clone" "$source" "$keep_sha"; then
        keep_unmerged=true
      fi
    fi
  fi
  jq -n --argjson testSetup "$test_setup" --argjson keepUnmerged "$keep_unmerged" \
    --argjson pristine "$pristine" \
    '{testSetup:$testSetup, keepUnmerged:$keepUnmerged, pristine:$pristine}'
}

# Prints the first cull pin reason and succeeds when the workstream must stay.
workstream_cull_pin_reason() {
  local name="$1" clone="$WT_BOX_ROOT/$1/test1" issue
  if git -C "$clone" show-ref --verify --quiet refs/heads/keep 2>/dev/null; then
    local keep_sha
    keep_sha=$(git -C "$clone" rev-parse refs/heads/keep 2>/dev/null || true)
    if ! workstream_keep_merged "$clone" "$WT_BOX_SRC" "$keep_sha"; then
      echo keep-unmerged
      return 0
    fi
  fi
  if git -C "$clone" show-ref --verify --quiet refs/heads/test-setup 2>/dev/null; then
    echo test-setup
    return 0
  fi
  while IFS= read -r issue; do
    [ -f "$issue" ] || continue
    if grep -q "^workstream: $name$" "$issue" && awk '
      /^---$/ { boundaries++; next }
      boundaries != 1 { next }
      /^needs:.*manual-testing/ { found=1 }
      in_needs && /^[[:space:]]*-[[:space:]]*manual-testing[[:space:]]*$/ { found=1 }
      /^needs:[[:space:]]*$/ { in_needs=1; next }
      in_needs && !/^[[:space:]]*-/ { in_needs=0 }
      END { exit(found ? 0 : 1) }
    ' "$issue"; then
      echo manual-testing
      return 0
    fi
  done < <(find "$WT_MONO/issues" -mindepth 2 -maxdepth 2 -type f -name '*.md' ! -path '*/deferred/*' 2>/dev/null)
  return 1
}

# Preserve an unmerged keep branch before its clone is removed. The caller reads
# WORKSTREAM_PRESERVED_BOX_REF; an empty value means keep was absent or already
# reachable from source main. A push failure is fatal so teardown stays intact.
workstream_preserve_keep() {
  local name="$1" clone="$WT_BOX_ROOT/$1/test1" keep_sha
  WORKSTREAM_PRESERVED_BOX_REF=""
  git -C "$clone" show-ref --verify --quiet refs/heads/keep 2>/dev/null || return 0
  keep_sha=$(git -C "$clone" rev-parse refs/heads/keep 2>/dev/null || true)
  if workstream_keep_merged "$clone" "$WT_BOX_SRC" "$keep_sha"; then
    return 0
  fi
  WORKSTREAM_PRESERVED_BOX_REF="keep/$name-$(date -u +%Y-%m-%d)"
  # Worktree creation committed the clone's engine link ("Worktree setup: …",
  # bin/lib/worktree-create.sh step 6). It points at this worktree, so push
  # keep replayed without it. A box agent's later `pnpm add` edits the same
  # package.json and lockfile, so the replay can conflict. Then push keep
  # unrebased, setup commit included: that commit adds only a gitignored link
  # and a lockfile.
  local setup_sha preserved="refs/heads/keep" scratch
  setup_sha=$(git -C "$clone" log --format=%H -n 1 --grep="$WORKSTREAM_SETUP_COMMIT_GREP" refs/heads/keep 2>/dev/null || true)
  if [ -n "$setup_sha" ]; then
    scratch=$(mktemp -d) || return 1
    if { git -C "$clone" worktree add -q --detach "$scratch/keep" refs/heads/keep \
        && git -C "$scratch/keep" rebase -q --onto "$setup_sha^" "$setup_sha"; } >/dev/null 2>&1; then
      preserved=$(git -C "$scratch/keep" rev-parse HEAD)
    else
      git -C "$scratch/keep" rebase --abort >/dev/null 2>&1 || true
      echo "[workstream] $name's keep branch carries the worktree setup commit (it adds only a gitignored engine link and a lockfile); pushing it unrebased" >&2
    fi
    if ! git -C "$clone" worktree remove --force "$scratch/keep" >/dev/null 2>&1; then
      echo "[workstream] could not remove the temporary worktree $scratch/keep from $name's clone" >&2
      return 1
    fi
    rm -rf "$scratch"
  fi
  git -C "$clone" push "$WT_BOX_SRC" \
    "$preserved:refs/heads/$WORKSTREAM_PRESERVED_BOX_REF" >/dev/null
}
